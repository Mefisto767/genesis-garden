-- Genesis Garden — тесты migrate_local_progress (Этап 4). Продолжает сессию
-- из 02_scenario_tests.sql (та же БД, пользователь A уже существует).

\set ON_ERROR_STOP on

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- --- keep_local: облачные coins/dust заменяются локальными -----------------
do $$
declare
  v_garden_a uuid;
  v_local_state jsonb;
  v_resp jsonb;
  v_coins bigint;
  v_dust bigint;
begin
  select id into v_garden_a from public.gardens where owner_id = auth.uid();

  v_local_state := jsonb_build_object(
    'coins', 12345,
    'geneticDust', 777,
    'plots', jsonb_build_array(jsonb_build_object('id', 6, 'unlocked', true)),
    'specimens', jsonb_build_array()
  );

  v_resp := public.migrate_local_progress('keep_local', v_local_state, gen_random_uuid());
  if not (v_resp->>'ok')::boolean then raise exception 'FAIL: migrate_local_progress(keep_local) не удался: %', v_resp; end if;

  select coins, genetic_dust into v_coins, v_dust from public.gardens where id = v_garden_a;
  if v_coins <> 12345 or v_dust <> 777 then
    raise exception 'FAIL: keep_local не заменил coins/dust (coins=% dust=%)', v_coins, v_dust;
  end if;

  perform 1 from public.plots where garden_id = v_garden_a and plot_index = 6 and unlocked;
  if not found then raise exception 'FAIL: keep_local не разблокировал грядку 6 из локального сохранения'; end if;

  raise notice 'PASS: migrate_local_progress(keep_local) переносит coins/dust/разблокировки';
end $$;

-- --- merge: берём MAX, не сумму (не дублируем ресурсы) --------------------
do $$
declare
  v_garden_a uuid;
  v_local_state jsonb;
  v_resp jsonb;
  v_coins bigint;
begin
  select id into v_garden_a from public.gardens where owner_id = auth.uid();
  -- Облако сейчас 12345 (после предыдущего теста) — локальное меньше.
  v_local_state := jsonb_build_object('coins', 100, 'geneticDust', 5, 'specimens', jsonb_build_array());

  v_resp := public.migrate_local_progress('merge', v_local_state, gen_random_uuid());
  if not (v_resp->>'ok')::boolean then raise exception 'FAIL: migrate_local_progress(merge) не удался: %', v_resp; end if;

  select coins into v_coins from public.gardens where id = v_garden_a;
  if v_coins <> 12345 then
    raise exception 'FAIL: merge должен взять MAX(12345, 100)=12345, получено %', v_coins;
  end if;
  raise notice 'PASS: migrate_local_progress(merge) берёт максимум, не сумму — ресурсы не дублируются';
end $$;

-- --- merge: растения объединяются без дублей по отпечатку генома ----------
do $$
declare
  v_garden_a uuid;
  v_plants_before int;
  v_plants_after int;
  v_genome jsonb;
  v_local_state jsonb;
  v_resp jsonb;
begin
  select id into v_garden_a from public.gardens where owner_id = auth.uid();
  select count(*) into v_plants_before from public.plants where garden_id = v_garden_a;
  select genome into v_genome from public.plants where garden_id = v_garden_a limit 1;

  -- Один "дубль" существующего генома + один по-настоящему новый.
  v_local_state := jsonb_build_object(
    'coins', 0, 'geneticDust', 0,
    'specimens', jsonb_build_array(
      jsonb_build_object('genome', v_genome),
      jsonb_build_object('genome', jsonb_build_object(
        'shape', 7, 'primary', '#000000', 'secondary', '#000000', 'leaf', '#000000',
        'pattern', 'solid', 'size', 'small', 'aura', 'none', 'mutationId', null
      ))
    )
  );

  v_resp := public.migrate_local_progress('merge', v_local_state, gen_random_uuid());
  if not (v_resp->>'ok')::boolean then raise exception 'FAIL: migrate_local_progress(merge, specimens) не удался: %', v_resp; end if;
  if (v_resp->>'plants_migrated')::int <> 1 then
    raise exception 'FAIL: ожидался ровно 1 новый специмен (второй — дубль генома), получено %', v_resp->>'plants_migrated';
  end if;

  select count(*) into v_plants_after from public.plants where garden_id = v_garden_a;
  if v_plants_after <> v_plants_before + 1 then
    raise exception 'FAIL: ожидалось +1 растение, было % стало %', v_plants_before, v_plants_after;
  end if;
  raise notice 'PASS: merge растений — дубль генома пропущен, новый геном добавлен ровно один раз';
end $$;

-- --- Повторный вызов с тем же request_id идемпотентен ----------------------
do $$
declare
  v_req uuid := gen_random_uuid();
  v_resp1 jsonb;
  v_resp2 jsonb;
begin
  v_resp1 := public.migrate_local_progress('keep_cloud', '{}'::jsonb, v_req);
  v_resp2 := public.migrate_local_progress('keep_cloud', '{}'::jsonb, v_req);
  if v_resp1 <> v_resp2 then raise exception 'FAIL: migrate_local_progress не идемпотентен по request_id'; end if;
  raise notice 'PASS: migrate_local_progress идемпотентен по request_id';
end $$;

reset role;
\echo '=== ТЕСТЫ MIGRATE_LOCAL_PROGRESS ПРОШЛИ ==='
