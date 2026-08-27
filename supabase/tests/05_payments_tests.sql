-- Genesis Garden — тесты Этапа 7 (mock_grant_purchase + пересозданный
-- grant_purchase через общую _apply_purchase_entitlement, потолок 25%).
-- Продолжает сессию из предыдущих файлов (пользователь A существует).

\set ON_ERROR_STOP on

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- --- Неизвестный product_id отклоняется -------------------------------------
do $$
begin
  begin
    perform public.mock_grant_purchase('does_not_exist', gen_random_uuid());
    raise exception 'FAIL: mock_grant_purchase с неизвестным product_id прошёл';
  exception when others then
    if sqlerrm <> 'unknown_product_id' then raise exception 'FAIL: неожиданная ошибка: %', sqlerrm; end if;
    raise notice 'PASS: mock_grant_purchase отклоняет неизвестный product_id';
  end;
end $$;

-- --- season_pass даёт entitlement season_pass с expires_at в будущем -------
do $$
declare
  v_resp jsonb;
  v_expires timestamptz;
begin
  v_resp := public.mock_grant_purchase('season_pass', gen_random_uuid());
  if not (v_resp->>'ok')::boolean then raise exception 'FAIL: mock_grant_purchase(season_pass) не удался: %', v_resp; end if;

  select expires_at into v_expires from public.entitlements
    where profile_id = auth.uid() and type = 'season_pass'
    order by created_at desc limit 1;
  if v_expires is null or v_expires <= now() then raise exception 'FAIL: season_pass entitlement без корректного expires_at'; end if;
  raise notice 'PASS: mock_grant_purchase(season_pass) создаёt действующий entitlement';
end $$;

-- --- greenhouse_boost + fertilizer_boost суммируются, но не выше потолка ---
do $$
declare
  v_boost_before numeric;
  v_boost_after numeric;
begin
  select public.active_growth_boost_percent(auth.uid()) into v_boost_before;

  perform public.mock_grant_purchase('greenhouse_boost', gen_random_uuid()); -- +10%
  perform public.mock_grant_purchase('fertilizer_boost', gen_random_uuid()); -- +15%

  select public.active_growth_boost_percent(auth.uid()) into v_boost_after;
  if v_boost_after <> least(v_boost_before + 0.25, 0.25) then
    raise exception 'FAIL: ожидался буст %, получено %', least(v_boost_before + 0.25, 0.25), v_boost_after;
  end if;
  raise notice 'PASS: greenhouse_boost(10 percent) + fertilizer_boost(15 percent) суммируются корректно: %', v_boost_after;
end $$;

-- --- Ещё одна покупка буста не поднимает суммарный буст выше 25% ----------
do $$
declare v_boost numeric;
begin
  perform public.mock_grant_purchase('greenhouse_boost', gen_random_uuid()); -- ещё +10%, было бы 35%
  select public.active_growth_boost_percent(auth.uid()) into v_boost;
  if v_boost <> 0.25 then raise exception 'FAIL: суммарный буст должен быть зажат в 0.25, получено %', v_boost; end if;
  raise notice 'PASS: потолок 25 percent держится даже при избыточных покупках бустов';
end $$;

-- --- Идемпотентность по request_id ------------------------------------------
do $$
declare
  v_req uuid := gen_random_uuid();
  v_resp1 jsonb;
  v_resp2 jsonb;
  v_count int;
begin
  v_resp1 := public.mock_grant_purchase('season_pass', v_req);
  v_resp2 := public.mock_grant_purchase('season_pass', v_req);
  if v_resp1 <> v_resp2 then raise exception 'FAIL: mock_grant_purchase не идемпотентен по request_id'; end if;

  select count(*) into v_count from public.purchases where provider_transaction_id = 'mock_' || v_req::text;
  if v_count <> 1 then raise exception 'FAIL: повторный вызов создал % записей purchases вместо 1', v_count; end if;
  raise notice 'PASS: mock_grant_purchase идемпотентен по request_id (одна запись purchases)';
end $$;

-- --- Реальный grant_purchase (service_role) по-прежнему работает через
-- общую _apply_purchase_entitlement (регрессия после рефакторинга) ----------
reset role;
set role service_role;
do $$
declare
  v_resp jsonb;
  v_expires timestamptz;
begin
  v_resp := public.grant_purchase(
    '11111111-1111-1111-1111-111111111111', 'greenhouse_boost', 'paddle', 'ptxn_regress_1', 499, 'USD', '{}'::jsonb
  );
  if not (v_resp->>'ok')::boolean then raise exception 'FAIL: grant_purchase(greenhouse_boost) не удался: %', v_resp; end if;

  select expires_at into v_expires from public.entitlements
    where profile_id = '11111111-1111-1111-1111-111111111111' and source_purchase_id = (v_resp->>'purchase_id')::uuid;
  if v_expires is null then raise exception 'FAIL: grant_purchase не создал entitlement через общую функцию'; end if;
  raise notice 'PASS: grant_purchase (service_role) по-прежнему создаёт entitlements после рефакторинга';
end $$;

-- --- authenticated по-прежнему не может звать настоящий grant_purchase -----
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
begin
  begin
    perform public.grant_purchase(
      '11111111-1111-1111-1111-111111111111', 'season_pass', 'paddle', 'ptxn_attack', 799, 'USD', '{}'::jsonb
    );
    raise exception 'FAIL: authenticated смог вызвать настоящий grant_purchase напрямую';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated по-прежнему не может звать grant_purchase напрямую (только service_role/webhook)';
  end;
end $$;

reset role;
\echo '=== ТЕСТЫ PAYMENTS (ЭТАП 7) ПРОШЛИ ==='
