-- Genesis Garden — Этап 4: перенос локального прогресса в облако после входа.
-- Выполняется ОДИН раз на аккаунт (клиент помечает флагом в localStorage
-- после успешного вызова, см. apps/web/src/sync/migration.ts). Всегда
-- работает от лица текущего auth.uid() — свой же только что созданный сад
-- (handle_new_user уже отработал при регистрации).
--
-- p_choice:
--   'keep_cloud' — ничего не делать, локальные данные просто отбрасываются
--                  клиентом после этого вызова (сервер не трогает ничего).
--   'keep_local' — облачный сад целиком заменяется значениями локального
--                  сохранения (числа) + локальные растения добавляются
--                  (местных стартовых цифр в облаке ещё не было потрачено,
--                  это безопасно на "первом" входе).
--   'merge'      — берём MAX по каждому числовому ресурсу (никогда не
--                  суммируем — так по прямому требованию мастер-промта
--                  нельзя дублировать ресурсы), плюс объединяем растения
--                  по отпечатку генома (genome::text), чтобы не заводить
--                  визуально одинаковых дублей из двух источников.

create or replace function public.migrate_local_progress(
  p_choice text,
  p_local_state jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_garden_id uuid;
  v_cached jsonb;
  v_response jsonb;
  v_local_coins bigint;
  v_local_dust bigint;
  v_coins_before bigint;
  v_dust_before bigint;
  v_coins_after bigint;
  v_dust_after bigint;
  v_local_specimen jsonb;
  v_existing_fingerprints text[];
  v_inserted_count int := 0;
  v_local_plot jsonb;
begin
  if p_choice not in ('keep_cloud', 'keep_local', 'merge') then
    raise exception 'invalid_choice';
  end if;

  select id into v_garden_id from public.gardens where owner_id = auth.uid();
  if v_garden_id is null then raise exception 'garden_not_found'; end if;

  begin
    insert into public.request_log (request_id, endpoint, garden_id)
      values (p_request_id, 'migrate_local_progress', v_garden_id);
  exception when unique_violation then
    select response into v_cached from public.request_log where request_id = p_request_id;
    return v_cached;
  end;

  if p_choice = 'keep_cloud' then
    v_response := jsonb_build_object('ok', true, 'choice', p_choice, 'plants_migrated', 0);
    update public.request_log set response = v_response where request_id = p_request_id;
    return v_response;
  end if;

  v_local_coins := coalesce((p_local_state->>'coins')::bigint, 0);
  v_local_dust := coalesce((p_local_state->>'geneticDust')::bigint, 0);

  select coins, genetic_dust into v_coins_before, v_dust_before from public.gardens where id = v_garden_id;

  if p_choice = 'keep_local' then
    update public.gardens set coins = v_local_coins, genetic_dust = v_local_dust, updated_at = now()
      where id = v_garden_id;
  else -- merge
    update public.gardens
      set coins = greatest(coins, v_local_coins),
          genetic_dust = greatest(genetic_dust, v_local_dust),
          updated_at = now()
      where id = v_garden_id;
  end if;

  select coins, genetic_dust into v_coins_after, v_dust_after from public.gardens where id = v_garden_id;

  -- Разблокированные грядки: только "включаем" дополнительные (never lock a plot back).
  if p_local_state ? 'plots' then
    for v_local_plot in select * from jsonb_array_elements(p_local_state->'plots')
    loop
      if (v_local_plot->>'unlocked')::boolean then
        update public.plots set unlocked = true
          where garden_id = v_garden_id and plot_index = (v_local_plot->>'id')::int;
      end if;
    end loop;
  end if;

  -- Растения: избегаем визуальных дублей по отпечатку генома (genome::text).
  select array_agg(genome::text) into v_existing_fingerprints from public.plants where garden_id = v_garden_id;
  v_existing_fingerprints := coalesce(v_existing_fingerprints, array[]::text[]);

  if p_local_state ? 'specimens' then
    for v_local_specimen in select * from jsonb_array_elements(p_local_state->'specimens')
    loop
      if not ((v_local_specimen->'genome')::text = any (v_existing_fingerprints)) then
        insert into public.plants (garden_id, genome, rarity, mutation_id)
        values (
          v_garden_id,
          v_local_specimen->'genome',
          public.rarity_of(v_local_specimen->'genome', nullif(v_local_specimen->'genome'->>'mutationId', '')),
          nullif(v_local_specimen->'genome'->>'mutationId', '')
        );
        v_existing_fingerprints := array_append(v_existing_fingerprints, (v_local_specimen->'genome')::text);
        v_inserted_count := v_inserted_count + 1;
      end if;
    end loop;
  end if;

  insert into public.economy_ledger (garden_id, delta_coins, delta_dust, reason, request_id)
    values (v_garden_id, v_coins_after - v_coins_before, v_dust_after - v_dust_before,
            'migrate_local_progress:' || p_choice, p_request_id);

  v_response := jsonb_build_object('ok', true, 'choice', p_choice, 'plants_migrated', v_inserted_count);
  update public.request_log set response = v_response where request_id = p_request_id;
  return v_response;
end;
$$;

revoke execute on function public.migrate_local_progress(text, jsonb, uuid) from public, anon;
grant execute on function public.migrate_local_progress(text, jsonb, uuid) to authenticated;
