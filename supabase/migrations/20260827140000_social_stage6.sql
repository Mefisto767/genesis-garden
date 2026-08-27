-- Genesis Garden — Этап 6: социальный обмен, серверная часть, довесок к
-- уже готовым с Этапа 3 send_gift/claim_gift/decline_gift.
--
-- Что добавляет этот файл (создать новую миграцию, а не редактировать
-- 20260827120200_functions.sql напрямую — так делать нельзя, если файл уже
-- мог быть применён на реальном проекте; здесь этого не произошло, но
-- привычка важнее конкретного случая):
--
--   1. block_user / unblock_user — RPC поверх social_connections (таблица и
--      RLS SELECT-политика для неё уже были в Этапе 3, но самих функций для
--      записи не было — см. комментарий "friend-функции появятся в Этапе 6"
--      в 20260827120100_rls.sql).
--   2. send_gift пересоздаётся (create or replace) с двумя новыми проверками
--      защиты от злоупотреблений, которых не было в Этапе 3:
--        - получатель заблокировал отправителя (или наоборот) -> gift_blocked
--        - у отправителя аккаунт младше v_min_account_age -> account_too_new
--      Остальная логика send_gift не меняется (числа/поведение идентичны).
--
-- Честная оговорка по охвату Этапа 6 (см. docs/IMPLEMENTATION_STATUS.md):
-- формальной системы "заявка в друзья -> принять/отклонить" здесь нет —
-- "список друзей" в клиенте будет построен как "последние, с кем был обмен
-- подарками" (из gift_transactions), это дешевле и достаточно для 50-100
-- бета-тестеров. Полноценные friend-requests — кандидат на пост-бету.

create or replace function public.block_user(p_target_public_code text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_garden uuid;
  v_target uuid;
  v_cached jsonb;
  v_response jsonb;
begin
  select id into v_actor_garden from public.gardens where owner_id = v_actor;
  if v_actor_garden is null then raise exception 'garden_not_found'; end if;

  begin
    insert into public.request_log (request_id, endpoint, garden_id) values (p_request_id, 'block_user', v_actor_garden);
  exception when unique_violation then
    select response into v_cached from public.request_log where request_id = p_request_id;
    return v_cached;
  end;

  select id into v_target from public.profiles where public_code = p_target_public_code;
  if v_target is null then raise exception 'recipient_not_found'; end if;
  if v_target = v_actor then raise exception 'cannot_block_self'; end if;

  insert into public.social_connections (profile_id, friend_id, status)
    values (v_actor, v_target, 'blocked')
    on conflict (profile_id, friend_id) do update set status = 'blocked';

  v_response := jsonb_build_object('ok', true);
  update public.request_log set response = v_response where request_id = p_request_id;
  return v_response;
end;
$$;

create or replace function public.unblock_user(p_target_public_code text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_garden uuid;
  v_target uuid;
  v_cached jsonb;
  v_response jsonb;
begin
  select id into v_actor_garden from public.gardens where owner_id = v_actor;
  if v_actor_garden is null then raise exception 'garden_not_found'; end if;

  begin
    insert into public.request_log (request_id, endpoint, garden_id) values (p_request_id, 'unblock_user', v_actor_garden);
  exception when unique_violation then
    select response into v_cached from public.request_log where request_id = p_request_id;
    return v_cached;
  end;

  select id into v_target from public.profiles where public_code = p_target_public_code;
  if v_target is null then raise exception 'recipient_not_found'; end if;

  delete from public.social_connections
    where profile_id = v_actor and friend_id = v_target and status = 'blocked';

  v_response := jsonb_build_object('ok', true);
  update public.request_log set response = v_response where request_id = p_request_id;
  return v_response;
end;
$$;

revoke execute on function public.block_user(text, uuid) from public, anon;
grant execute on function public.block_user(text, uuid) to authenticated;
revoke execute on function public.unblock_user(text, uuid) from public, anon;
grant execute on function public.unblock_user(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- resolve_public_code — единственная "дырка" наружу из profiles RLS
-- (profiles_select_own разрешает видеть только свою строку). Отправитель
-- подарка виден клиенту только как sender_id (uuid) — чтобы показать
-- «Подарок от <код>» в списке входящих, клиенту нужно превратить uuid в
-- public_code. public_code — по определению предназначен быть шариться
-- (это и есть «код друга», который игроки сообщают друг другу вручную),
-- так что отдавать его по id не сложнее, чем то, что игрок мог бы узнать,
-- просто получив ссылку/код от этого же человека — никаких приватных
-- данных профиля (email, is_admin, banned) эта функция не раскрывает.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_public_code(p_profile_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select public_code from public.profiles where id = p_profile_id;
$$;

revoke execute on function public.resolve_public_code(uuid) from public, anon;
grant execute on function public.resolve_public_code(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- send_gift — пересоздаём с проверками блокировки и минимального возраста
-- аккаунта. Тело идентично Этапу 3, кроме двух новых блоков ниже (отмечены).
-- ---------------------------------------------------------------------------
create or replace function public.send_gift(
  p_recipient_public_code text,
  p_item_type text,
  p_item_payload jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_profile uuid := auth.uid();
  v_recipient_profile uuid;
  v_sender_garden uuid;
  v_sender_created_at timestamptz;
  v_gift_id uuid;
  v_cached jsonb;
  v_response jsonb;
  v_daily_limit integer := 5; -- лимит подарков/сутки, см. docs/ECONOMY.md
  -- Этап 6: минимальный возраст аккаунта перед первой отправкой подарка —
  -- анти-абьюз мера (мгновенный фарм новыми аккаунтами), см. docs/ECONOMY.md.
  v_min_account_age interval := interval '10 minutes';
  v_sent_today integer;
  v_blocked boolean;
  v_plant_id uuid;
  v_plant_genome jsonb;
  v_plant_rarity text;
  v_plant_mutation text;
  v_dust_amount integer;
  v_final_payload jsonb;
begin
  if p_item_type not in ('plant', 'dust') then
    raise exception 'unsupported_item_type';
  end if;

  select id into v_sender_garden from public.gardens where owner_id = v_sender_profile;
  if v_sender_garden is null then raise exception 'garden_not_found'; end if;

  select id into v_recipient_profile from public.profiles where public_code = p_recipient_public_code;
  if v_recipient_profile is null then raise exception 'recipient_not_found'; end if;
  if v_recipient_profile = v_sender_profile then raise exception 'cannot_gift_self'; end if;

  begin
    insert into public.request_log (request_id, endpoint, garden_id) values (p_request_id, 'send_gift', v_sender_garden);
  exception when unique_violation then
    select response into v_cached from public.request_log where request_id = p_request_id;
    return v_cached;
  end;

  -- Этап 6, новое: заблокировавшая сторона (в любом направлении) закрывает обмен.
  select exists (
    select 1 from public.social_connections
    where status = 'blocked'
      and ((profile_id = v_sender_profile and friend_id = v_recipient_profile)
        or (profile_id = v_recipient_profile and friend_id = v_sender_profile))
  ) into v_blocked;
  if v_blocked then raise exception 'gift_blocked'; end if;

  -- Этап 6, новое: минимальный возраст аккаунта отправителя.
  select created_at into v_sender_created_at from public.profiles where id = v_sender_profile;
  if v_sender_created_at is null or now() - v_sender_created_at < v_min_account_age then
    raise exception 'account_too_new';
  end if;

  select count(*) into v_sent_today from public.gift_transactions
    where sender_id = v_sender_profile and created_at > now() - interval '24 hours';
  if v_sent_today >= v_daily_limit then raise exception 'daily_gift_limit_reached'; end if;

  if p_item_type = 'plant' then
    v_plant_id := (p_item_payload->>'plant_id')::uuid;
    select genome, rarity, mutation_id into v_plant_genome, v_plant_rarity, v_plant_mutation
      from public.plants where id = v_plant_id and garden_id = v_sender_garden;
    if v_plant_genome is null then raise exception 'plant_not_owned'; end if;
    delete from public.plants where id = v_plant_id;
    v_final_payload := jsonb_build_object('genome', v_plant_genome, 'rarity', v_plant_rarity, 'mutation_id', v_plant_mutation);
  else
    v_dust_amount := (p_item_payload->>'amount')::int;
    if v_dust_amount is null or v_dust_amount <= 0 then raise exception 'invalid_amount'; end if;
    update public.gardens set genetic_dust = genetic_dust - v_dust_amount
      where id = v_sender_garden and genetic_dust >= v_dust_amount;
    if not found then raise exception 'insufficient_dust'; end if;
    v_final_payload := jsonb_build_object('amount', v_dust_amount);
  end if;

  insert into public.gift_transactions (sender_id, recipient_id, item_type, item_payload, request_id)
    values (v_sender_profile, v_recipient_profile, p_item_type, v_final_payload, p_request_id)
    returning id into v_gift_id;

  v_response := jsonb_build_object('ok', true, 'gift_id', v_gift_id);
  update public.request_log set response = v_response where request_id = p_request_id;
  return v_response;
end;
$$;

revoke execute on function public.send_gift(text, text, jsonb, uuid) from public, anon;
grant execute on function public.send_gift(text, text, jsonb, uuid) to authenticated;
