-- ============================================================================
-- Genesis Garden — сценарные тесты RPC + RLS на локальной Postgres (см.
-- 00_local_auth_shim_pre.sql). Каждый блок печатает 'PASS: ...' или
-- прерывает выполнение через RAISE EXCEPTION 'FAIL: ...' (ON_ERROR_STOP=1
-- в вызывающем psql делает любой FAIL заметным и останавливает скрипт).
-- ============================================================================

\set ON_ERROR_STOP on

-- --- Подготовка: два пользователя, созданных как это делает Supabase Auth ---
reset role;
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.test');

do $$
declare
  v_garden_a uuid;
  v_garden_b uuid;
  v_plots_a int;
  v_plants_a int;
  v_inv_a int;
begin
  select id into v_garden_a from public.gardens where owner_id = '11111111-1111-1111-1111-111111111111';
  select id into v_garden_b from public.gardens where owner_id = '22222222-2222-2222-2222-222222222222';
  if v_garden_a is null or v_garden_b is null then
    raise exception 'FAIL: handle_new_user не создал сад для одного из пользователей';
  end if;

  select count(*) into v_plots_a from public.plots where garden_id = v_garden_a;
  if v_plots_a <> 24 then raise exception 'FAIL: ожидалось 24 грядки, получено %', v_plots_a; end if;

  select count(*) into v_plants_a from public.plants where garden_id = v_garden_a;
  if v_plants_a <> 2 then raise exception 'FAIL: ожидалось 2 стартовых специмена, получено %', v_plants_a; end if;

  select qty into v_inv_a from public.inventory where garden_id = v_garden_a and seed_id = 'sprout';
  if v_inv_a <> 3 then raise exception 'FAIL: ожидалось 3 ростка в стартовом инвентаре, получено %', v_inv_a; end if;

  raise notice 'PASS: handle_new_user создаёт garden+24 плота+2 специмена+3 ростка';
end $$;

-- Задним числом "состариваем" тестовые профили — иначе min-account-age
-- защита в send_gift (Этап 6, см. 20260827140000_social_stage6.sql) не даст
-- протестировать подарки ниже на только что созданных аккаунтах.
update public.profiles set created_at = now() - interval '1 day'
  where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

-- --- Роль A: видит только свой сад -----------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare v_count int;
begin
  select count(*) into v_count from public.gardens;
  if v_count <> 1 then raise exception 'FAIL: пользователь A видит % садов вместо 1 (RLS не фильтрует select)', v_count; end if;
  raise notice 'PASS: RLS ограничивает SELECT gardens одной строкой (своей)';
end $$;

-- --- Прямой UPDATE на свой же gardens запрещён (только через RPC) ----------
do $$
begin
  begin
    update public.gardens set coins = 999999 where owner_id = auth.uid();
    raise exception 'FAIL: прямой UPDATE gardens прошёл — экономика не сервер-авторитетна';
  exception when insufficient_privilege then
    raise notice 'PASS: прямой UPDATE gardens запрещён (insufficient_privilege), только RPC';
  end;
end $$;

-- --- A не может увидеть/поменять сад B --------------------------------------
do $$
declare v_garden_b uuid;
begin
  reset role; -- временно суперпользователем достаём id сада B для попытки атаки
  select id into v_garden_b from public.gardens where owner_id = '22222222-2222-2222-2222-222222222222';
  set role authenticated;
  set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  perform 1 from public.gardens where id = v_garden_b;
  if found then raise exception 'FAIL: A видит сад B через прямой SELECT по id'; end if;
  raise notice 'PASS: A не видит сад B напрямую (RLS блокирует чужой id)';
end $$;

-- --- Полный игровой путь A: купить семя -> посадить -> собрать -------------
do $$
declare
  v_garden_a uuid;
  v_coins_before bigint;
  v_coins_after bigint;
  v_resp jsonb;
  v_req1 uuid := gen_random_uuid();
begin
  select id into v_garden_a from public.gardens where owner_id = auth.uid();
  select coins into v_coins_before from public.gardens where id = v_garden_a;

  v_resp := public.plant(0, 'sprout', gen_random_uuid());
  if not (v_resp->>'ok')::boolean then raise exception 'FAIL: plant() не удался: %', v_resp; end if;

  -- growMs у sprout = 60с, проверяем немедленный harvest -> должен отклониться.
  begin
    perform public.harvest(0, gen_random_uuid());
    raise exception 'FAIL: harvest() прошёл до созревания';
  exception when others then
    if sqlerrm <> 'not_ready_yet' then raise exception 'FAIL: неожиданная ошибка harvest(): %', sqlerrm; end if;
  end;
  raise notice 'PASS: harvest() до созревания отклонён (not_ready_yet)';

  -- "телепортируем" plant.planted_at в прошлое, чтобы не ждать реальную минуту.
  reset role;
  update public.plots set planted_at = now() - interval '2 minutes'
    where garden_id = v_garden_a and plot_index = 0;
  set role authenticated;
  set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  v_resp := public.harvest(0, v_req1);
  if not (v_resp->>'ok')::boolean then raise exception 'FAIL: harvest() не удался после созревания: %', v_resp; end if;

  select coins into v_coins_after from public.gardens where id = v_garden_a;
  if v_coins_after <> v_coins_before + 8 then
    raise exception 'FAIL: ожидалось +8 монет за sprout, было % стало %', v_coins_before, v_coins_after;
  end if;
  raise notice 'PASS: полный путь купить/посадить/собрать начисляет ровно sellValue';
end $$;

-- --- Идемпотентность: повтор того же request_id не начисляет повторно ------
do $$
declare
  v_garden_a uuid;
  v_coins_before bigint;
  v_coins_after bigint;
  v_resp1 jsonb;
  v_resp2 jsonb;
  v_req uuid := gen_random_uuid();
begin
  select id into v_garden_a from public.gardens where owner_id = auth.uid();

  perform public.plant(1, 'sprout', gen_random_uuid());
  reset role;
  update public.plots set planted_at = now() - interval '2 minutes' where garden_id = v_garden_a and plot_index = 1;
  set role authenticated;
  set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  select coins into v_coins_before from public.gardens where id = v_garden_a;
  v_resp1 := public.harvest(1, v_req);
  select coins into v_coins_after from public.gardens where id = v_garden_a;
  if v_coins_after <> v_coins_before + 8 then raise exception 'FAIL: первый harvest не начислил награду'; end if;

  -- Повтор того же request_id: должен вернуть тот же ответ, монеты не изменить.
  v_resp2 := public.harvest(1, v_req);
  if v_resp1 <> v_resp2 then raise exception 'FAIL: повторный запрос вернул другой ответ: % vs %', v_resp1, v_resp2; end if;
  perform 1 from public.gardens where id = v_garden_a and coins = v_coins_after;
  if not found then raise exception 'FAIL: повторный request_id изменил баланс повторно'; end if;
  raise notice 'PASS: повторный request_id идемпотентен — награда не задваивается';
end $$;

-- --- Скрещивание чужим растением отклоняется --------------------------------
do $$
declare
  v_garden_b uuid;
  v_plant_b uuid;
  v_my_plant uuid;
begin
  reset role;
  select id into v_garden_b from public.gardens where owner_id = '22222222-2222-2222-2222-222222222222';
  select id into v_plant_b from public.plants where garden_id = v_garden_b limit 1;
  set role authenticated;
  set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  select id into v_my_plant from public.plants where garden_id = (select id from public.gardens where owner_id = auth.uid()) limit 1;

  begin
    perform public.breed(v_plant_b, v_my_plant, gen_random_uuid());
    raise exception 'FAIL: breed() с чужим растением прошёл';
  exception when others then
    if sqlerrm <> 'parent_not_owned' then raise exception 'FAIL: неожиданная ошибка breed(): %', sqlerrm; end if;
  end;
  raise notice 'PASS: breed() отклоняет чужое растение (parent_not_owned)';
end $$;

-- --- Реальное скрещивание двух своих растений работает и списывает монеты --
do $$
declare
  v_garden_a uuid;
  v_ids uuid[];
  v_p1 uuid;
  v_p2 uuid;
  v_coins_before bigint;
  v_coins_after bigint;
  v_resp jsonb;
begin
  select id into v_garden_a from public.gardens where owner_id = auth.uid();
  -- created_at может совпадать у обоих стартовых специменов (одна транзакция
  -- в handle_new_user) — сортируем по id, а не по времени, чтобы гарантированно
  -- получить ДВЕ РАЗНЫЕ особи.
  select array_agg(id order by id) into v_ids from public.plants where garden_id = v_garden_a;
  v_p1 := v_ids[1];
  v_p2 := v_ids[2];

  select coins into v_coins_before from public.gardens where id = v_garden_a;
  v_resp := public.breed(v_p1, v_p2, gen_random_uuid());
  if not (v_resp->>'ok')::boolean then raise exception 'FAIL: breed() своих растений не удался: %', v_resp; end if;
  select coins into v_coins_after from public.gardens where id = v_garden_a;
  if v_coins_after <> v_coins_before - 12 then raise exception 'FAIL: breed() должен снять 12 монет'; end if;
  raise notice 'PASS: breed() своих растений создаёт потомка и списывает breedCost';
end $$;

-- --- Подарок: A отправляет пыль B, B получает один раз ----------------------
do $$
declare
  v_code_b text;
  v_dust_a_before bigint;
  v_dust_a_after bigint;
  v_dust_b_before bigint;
  v_dust_b_after bigint;
  v_resp jsonb;
  v_gift_id uuid;
  v_garden_a uuid;
  v_garden_b uuid;
begin
  select id into v_garden_a from public.gardens where owner_id = auth.uid();
  select genetic_dust into v_dust_a_before from public.gardens where id = v_garden_a;
  if v_dust_a_before < 3 then
    -- Гарантируем запас пыли для теста. Найденный здесь же баг (обнаружен
    -- Playwright-независимо, при запуске этого файла): прямой UPDATE
    -- gardens под ролью authenticated всегда был запрещён RLS/грантами —
    -- этот путь просто редко срабатывал из-за случайности breed()-награды
    -- (random() на сервере, без seed). Чиним: временно снимаем роль, как
    -- уже делается чуть ниже для чтения чужого сада B.
    reset role;
    update public.gardens set genetic_dust = 10 where id = v_garden_a;
    set role authenticated;
    set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  end if;

  reset role;
  select public_code into v_code_b from public.profiles where id = '22222222-2222-2222-2222-222222222222';
  select id into v_garden_b from public.gardens where owner_id = '22222222-2222-2222-2222-222222222222';
  select genetic_dust into v_dust_b_before from public.gardens where id = v_garden_b;
  set role authenticated;
  set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  select genetic_dust into v_dust_a_before from public.gardens where id = v_garden_a;
  v_resp := public.send_gift(v_code_b, 'dust', jsonb_build_object('amount', 3), gen_random_uuid());
  if not (v_resp->>'ok')::boolean then raise exception 'FAIL: send_gift не удался: %', v_resp; end if;
  v_gift_id := (v_resp->>'gift_id')::uuid;

  select genetic_dust into v_dust_a_after from public.gardens where id = v_garden_a;
  if v_dust_a_after <> v_dust_a_before - 3 then raise exception 'FAIL: send_gift не списал пыль у отправителя'; end if;

  set role authenticated;
  set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  v_resp := public.claim_gift(v_gift_id, gen_random_uuid());
  if not (v_resp->>'ok')::boolean then raise exception 'FAIL: claim_gift не удался: %', v_resp; end if;

  select genetic_dust into v_dust_b_after from public.gardens where id = v_garden_b;
  if v_dust_b_after <> v_dust_b_before + 3 then raise exception 'FAIL: claim_gift не начислил пыль получателю'; end if;

  -- Повторный claim того же подарка отклоняется — защита от двойного получения.
  begin
    perform public.claim_gift(v_gift_id, gen_random_uuid());
    raise exception 'FAIL: повторный claim_gift прошёл — двойное получение подарка возможно';
  exception when others then
    if sqlerrm <> 'gift_already_resolved' then raise exception 'FAIL: неожиданная ошибка при повторном claim_gift: %', sqlerrm; end if;
  end;
  raise notice 'PASS: подарок пыли списывается один раз у отправителя и начисляется один раз получателю';
end $$;

-- --- Webhook (service_role) выдаёт entitlement и не дублирует при повторе ---
reset role;
set role service_role;

do $$
declare
  v_resp1 jsonb;
  v_resp2 jsonb;
  v_count int;
begin
  v_resp1 := public.grant_purchase(
    '11111111-1111-1111-1111-111111111111', 'greenhouse_boost', 'mock', 'txn_test_001',
    499, 'USD', '{}'::jsonb
  );
  if not (v_resp1->>'ok')::boolean then raise exception 'FAIL: grant_purchase не удался: %', v_resp1; end if;

  -- Повторный вызов того же webhook (типичный at-least-once retry у провайдеров).
  v_resp2 := public.grant_purchase(
    '11111111-1111-1111-1111-111111111111', 'greenhouse_boost', 'mock', 'txn_test_001',
    499, 'USD', '{}'::jsonb
  );
  if not (v_resp2->>'already_processed')::boolean then
    raise exception 'FAIL: повторный webhook не распознан как уже обработанный: %', v_resp2;
  end if;

  select count(*) into v_count from public.entitlements
    where profile_id = '11111111-1111-1111-1111-111111111111' and type = 'growth_boost';
  if v_count <> 1 then raise exception 'FAIL: повторный webhook создал % entitlements вместо 1', v_count; end if;
  raise notice 'PASS: grant_purchase идемпотентен по (provider, provider_transaction_id)';
end $$;

-- --- authenticated не может напрямую вызвать grant_purchase (только webhook) ---
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
begin
  begin
    perform public.grant_purchase('11111111-1111-1111-1111-111111111111', 'greenhouse_boost', 'mock', 'txn_hack', 0, 'USD', '{}'::jsonb);
    raise exception 'FAIL: authenticated смог вызвать grant_purchase напрямую — клиент может сам выдать себе покупку';
  exception when insufficient_privilege then
    raise notice 'PASS: grant_purchase недоступен для authenticated (только service_role/webhook)';
  end;
end $$;

-- --- anon не может вызывать игровые RPC вообще ------------------------------
reset role;
set role anon;
reset request.jwt.claim.sub;

do $$
begin
  begin
    perform public.harvest(0, gen_random_uuid());
    raise exception 'FAIL: anon смог вызвать harvest()';
  exception when insufficient_privilege then
    raise notice 'PASS: anon не может вызывать harvest() (EXECUTE отозван)';
  end;
end $$;

do $$
declare v_count int;
begin
  set role anon;
  select count(*) into v_count from public.gardens;
  if v_count <> 0 then raise exception 'FAIL: anon видит % садов (ожидалось 0)', v_count; end if;
  raise notice 'PASS: anon не видит ни одного сада через SELECT';
end $$;

reset role;
\echo '=== ВСЕ СЦЕНАРНЫЕ ТЕСТЫ ПРОШЛИ ==='
