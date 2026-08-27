-- Genesis Garden — тесты Этапа 6 (block_user/unblock_user + новые проверки
-- в send_gift: gift_blocked, account_too_new). Продолжает сессию из
-- 02_scenario_tests.sql / 03_migration_tests.sql (та же БД, пользователи
-- A/B уже существуют и "состарены" там же ради этого файла).
--
-- Важно (как и в 02_scenario_tests.sql): profiles RLS разрешает SELECT
-- только своей строки (profiles_select_own), поэтому чтобы под ролью A
-- узнать public_code пользователя B, нужно на секунду `reset role` (супер-
-- пользователь). Значения передаём между do-блоками через session-level
-- GUC (set_config(..., false)) — psql-переменные (:'var') внутри $$-блоков
-- НЕ подставляются (psql не трогает содержимое dollar-quoted строк), а
-- current_setting() работает из PL/pgSQL под любой ролью.

\set ON_ERROR_STOP on

-- --- block_user на себя отклоняется -----------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare v_code_a text;
begin
  select public_code into v_code_a from public.profiles where id = '11111111-1111-1111-1111-111111111111';
  begin
    perform public.block_user(v_code_a, gen_random_uuid());
    raise exception 'FAIL: block_user(себя) прошёл';
  exception when others then
    if sqlerrm <> 'cannot_block_self' then raise exception 'FAIL: неожиданная ошибка при block_user(себя): %', sqlerrm; end if;
    raise notice 'PASS: block_user на самого себя отклонён (cannot_block_self)';
  end;
end $$;

-- --- Достаём public_code A и B один раз под суперпользователем --------------
reset role;
do $$
declare
  v_code_a text;
  v_code_b text;
begin
  select public_code into v_code_a from public.profiles where id = '11111111-1111-1111-1111-111111111111';
  select public_code into v_code_b from public.profiles where id = '22222222-2222-2222-2222-222222222222';
  perform set_config('test.code_a', v_code_a, false);
  perform set_config('test.code_b', v_code_b, false);
end $$;

-- --- A блокирует B: запись появляется, направление верное -------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  v_resp jsonb;
  v_status text;
begin
  v_resp := public.block_user(current_setting('test.code_b'), gen_random_uuid());
  if not (v_resp->>'ok')::boolean then raise exception 'FAIL: block_user не удался: %', v_resp; end if;

  select status into v_status from public.social_connections
    where profile_id = '11111111-1111-1111-1111-111111111111'
      and friend_id = '22222222-2222-2222-2222-222222222222';
  if v_status <> 'blocked' then raise exception 'FAIL: social_connections не содержит blocked после block_user'; end if;
  raise notice 'PASS: block_user создаёт запись status=blocked в правильном направлении';
end $$;

-- --- send_gift между заблокированными сторонами отклоняется -----------------
do $$
begin
  begin
    perform public.send_gift(current_setting('test.code_b'), 'dust', jsonb_build_object('amount', 1), gen_random_uuid());
    raise exception 'FAIL: send_gift к заблокированному получателю прошёл';
  exception when others then
    if sqlerrm <> 'gift_blocked' then raise exception 'FAIL: неожиданная ошибка при send_gift(blocked): %', sqlerrm; end if;
    raise notice 'PASS: send_gift отклонён между заблокированными сторонами (gift_blocked)';
  end;
end $$;

-- --- Блокировка действует и с обратной стороны (B -> A тоже заблокирован) ---
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
begin
  begin
    perform public.send_gift(current_setting('test.code_a'), 'dust', jsonb_build_object('amount', 1), gen_random_uuid());
    raise exception 'FAIL: send_gift от B к A (A заблокировал B) прошёл';
  exception when others then
    if sqlerrm <> 'gift_blocked' then raise exception 'FAIL: неожиданная ошибка при обратном send_gift(blocked): %', sqlerrm; end if;
    raise notice 'PASS: блокировка симметрично закрывает обмен в обе стороны';
  end;
end $$;

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- --- unblock_user снимает блокировку, обмен снова возможен ------------------
do $$
declare
  v_dust_a_before bigint;
  v_dust_a_after bigint;
  v_garden_a uuid;
  v_resp jsonb;
begin
  perform public.unblock_user(current_setting('test.code_b'), gen_random_uuid());

  perform 1 from public.social_connections
    where profile_id = '11111111-1111-1111-1111-111111111111'
      and friend_id = '22222222-2222-2222-2222-222222222222'
      and status = 'blocked';
  if found then raise exception 'FAIL: unblock_user не убрал запись blocked'; end if;

  select id into v_garden_a from public.gardens where owner_id = auth.uid();
  select genetic_dust into v_dust_a_before from public.gardens where id = v_garden_a;
  v_resp := public.send_gift(current_setting('test.code_b'), 'dust', jsonb_build_object('amount', 1), gen_random_uuid());
  if not (v_resp->>'ok')::boolean then raise exception 'FAIL: send_gift после unblock_user не удался: %', v_resp; end if;

  select genetic_dust into v_dust_a_after from public.gardens where id = v_garden_a;
  if v_dust_a_after <> v_dust_a_before - 1 then raise exception 'FAIL: send_gift после unblock_user не списал пыль'; end if;
  raise notice 'PASS: unblock_user снимает блокировку, обмен снова работает';
end $$;

-- --- Новый (не состаренный) аккаунт не может отправить подарок --------------
reset role;
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'c@example.test');
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

do $$
begin
  begin
    perform public.send_gift(current_setting('test.code_a'), 'dust', jsonb_build_object('amount', 1), gen_random_uuid());
    raise exception 'FAIL: send_gift с только что созданного аккаунта прошёл';
  exception when others then
    if sqlerrm <> 'account_too_new' then raise exception 'FAIL: неожиданная ошибка для нового аккаунта: %', sqlerrm; end if;
    raise notice 'PASS: min-account-age блокирует send_gift со свежесозданного аккаунта (account_too_new)';
  end;
end $$;

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- --- block_user идемпотентен по request_id ----------------------------------
do $$
declare
  v_req uuid := gen_random_uuid();
  v_resp1 jsonb;
  v_resp2 jsonb;
begin
  v_resp1 := public.block_user(current_setting('test.code_b'), v_req);
  v_resp2 := public.block_user(current_setting('test.code_b'), v_req);
  if v_resp1 <> v_resp2 then raise exception 'FAIL: block_user не идемпотентен по request_id'; end if;
  -- откатываем блокировку, чтобы не мешать другим файлам, если порядок запуска изменится
  perform public.unblock_user(current_setting('test.code_b'), gen_random_uuid());
  raise notice 'PASS: block_user идемпотентен по request_id';
end $$;

-- --- resolve_public_code: A может узнать код B по его uuid, хотя прямой
-- SELECT profiles B ему запрещён RLS (уже проверено выше в 02_scenario_tests) --
do $$
declare v_resolved text;
begin
  select public.resolve_public_code('22222222-2222-2222-2222-222222222222') into v_resolved;
  if v_resolved <> current_setting('test.code_b') then
    raise exception 'FAIL: resolve_public_code вернул % вместо %', v_resolved, current_setting('test.code_b');
  end if;
  raise notice 'PASS: resolve_public_code отдаёт public_code по id, не требуя прямого SELECT profiles';
end $$;

reset role;
\echo '=== ТЕСТЫ SOCIAL (ЭТАП 6) ПРОШЛИ ==='
