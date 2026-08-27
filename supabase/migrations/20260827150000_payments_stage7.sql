-- Genesis Garden — Этап 7: монетизация, серверная часть.
--
-- Каталог (см. apps/web/src/payments/catalog.ts для цен и текста — цифры
-- здесь и там должны совпадать, как и остальной баланс, см. ECONOMY.md):
--   season_pass       — $7.99 / 60 дней — статус-энтайтлмент (season_pass)
--   greenhouse_boost  — $4.99 / 30 дней — +10% к росту (growth_boost)
--   fertilizer_boost  — $1.99 / 24 часа — +15% к росту (growth_boost)
--
-- Честная оговорка (см. docs/IMPLEMENTATION_STATUS.md): "storage"-слоты и
-- косметика из мастер-промта НЕ продаются — в игре пока нет ни лимита
-- инвентаря, ни системы косметики, продавать снятие несуществующего лимита
-- или скин без слота для него означало бы брать деньги за ничего не
-- делающую покупку. Каталог и клиентский UI показывают их как "скоро",
-- недоступными для покупки, а не незаметно опускают из списка.
--
-- "Фертилизатор/пропуск таймера" из ТЗ реализован как временный (24ч), а не
-- мгновенный буст — механики "мгновенно доращиваем ОДНУ конкретную грядку"
-- у нас не было и добавлять её сейчас означало бы новую server-authoritative
-- операцию поверх ещё не подключённого к облаку игрового цикла (см. Этап 6,
-- та же оговорка про "растения" в подарках). Временный буст даёт тот же
-- потребительский эффект (быстрее расти прямо сейчас) через уже готовый и
-- протестированный механизм entitlements/active_growth_boost_percent.

-- ---------------------------------------------------------------------------
-- Общая логика начисления entitlement по product_id — используется и
-- боевым grant_purchase() (только service_role, настоящий webhook), и
-- песочным mock_grant_purchase() ниже (только для этой sandbox-среды без
-- живого Paddle-аккаунта, см. предупреждение у самой функции).
-- ---------------------------------------------------------------------------
create or replace function public._apply_purchase_entitlement(
  p_profile_id uuid,
  p_product_id text,
  p_purchase_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_product_id = 'greenhouse_boost' then
    insert into public.entitlements (profile_id, type, percent, expires_at, source_purchase_id)
      values (p_profile_id, 'growth_boost', 0.10, now() + interval '30 days', p_purchase_id);
  elsif p_product_id = 'fertilizer_boost' then
    insert into public.entitlements (profile_id, type, percent, expires_at, source_purchase_id)
      values (p_profile_id, 'growth_boost', 0.15, now() + interval '24 hours', p_purchase_id);
  elsif p_product_id = 'season_pass' then
    insert into public.entitlements (profile_id, type, expires_at, source_purchase_id)
      values (p_profile_id, 'season_pass', now() + interval '60 days', p_purchase_id);
  else
    raise exception 'unknown_product_id';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- grant_purchase — пересоздаём: та же идемпотентность и структура, что в
-- Этапе 3, но начисление entitlement теперь через общую функцию выше
-- (полный каталог, не только 2 захардкоженных product_id). Всё ещё только
-- service_role — единственный настоящий путь начисления это webhook.
-- ---------------------------------------------------------------------------
create or replace function public.grant_purchase(
  p_profile_id uuid,
  p_product_id text,
  p_provider text,
  p_provider_transaction_id text,
  p_amount_cents integer,
  p_currency text,
  p_raw_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_id uuid;
  v_existing uuid;
  v_response jsonb;
begin
  select id into v_existing from public.purchases
    where provider = p_provider and provider_transaction_id = p_provider_transaction_id;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'already_processed', true, 'purchase_id', v_existing);
  end if;

  insert into public.purchases (
    profile_id, product_id, provider, provider_transaction_id, status,
    amount_cents, currency, raw_payload, completed_at
  )
  values (p_profile_id, p_product_id, p_provider, p_provider_transaction_id, 'completed',
          p_amount_cents, p_currency, p_raw_payload, now())
  returning id into v_purchase_id;

  perform public._apply_purchase_entitlement(p_profile_id, p_product_id, v_purchase_id);

  v_response := jsonb_build_object('ok', true, 'purchase_id', v_purchase_id);
  return v_response;
end;
$$;

revoke execute on function public.grant_purchase(uuid, text, text, text, integer, text, jsonb) from public, authenticated, anon;
grant execute on function public.grant_purchase(uuid, text, text, text, integer, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- mock_grant_purchase — САНДБОКС/ДЕВ-ОНЛИ. Владелец платёжного аккаунта
-- (Paddle) на момент написания этого кода отсутствует (см. "Открытые
-- вопросы владельцу" в docs/IMPLEMENTATION_STATUS.md), а без него нельзя
-- ни развернуть настоящий webhook, ни протестировать реальный checkout.
-- Эта функция — единственный способ прогнать покупку/entitlement end-to-end
-- в этой среде: в отличие от grant_purchase, она НАМЕРЕННО callable для
-- authenticated (сам себе выдаёт покупку без внешнего платежа) — это
-- нарушение обычной серверной авторитетности денег, оправданное только тем,
-- что это mock-провайдер (реальные деньги никогда не участвуют,
-- provider='mock' жёстко зашит, а не приходит от клиента).
--
-- ВАЖНО перед production-запуском с реальным Paddle: эта функция может
-- оставаться подключённой (она безвредна — просто эмулирует бесплатную
-- покупку тестового товара), но клиентский UI должен показывать её только
-- когда VITE_PAYMENTS_PROVIDER=mock (см. apps/web/src/payments/catalog.ts) —
-- иначе тестер сможет "купить" что угодно бесплатно в проде. Это
-- ответственность клиентской конфигурации, не RLS/RPC (сервер сам по себе
-- не может отличить бета-тест от прода без отдельного окружения/ключа).
-- ---------------------------------------------------------------------------
create or replace function public.mock_grant_purchase(p_product_id text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := auth.uid();
  v_garden_id uuid;
  v_purchase_id uuid;
  v_cached jsonb;
  v_response jsonb;
  v_amount_cents integer;
begin
  select id into v_garden_id from public.gardens where owner_id = v_profile;
  if v_garden_id is null then raise exception 'garden_not_found'; end if;

  begin
    insert into public.request_log (request_id, endpoint, garden_id) values (p_request_id, 'mock_grant_purchase', v_garden_id);
  exception when unique_violation then
    select response into v_cached from public.request_log where request_id = p_request_id;
    return v_cached;
  end;

  v_amount_cents := case p_product_id
    when 'season_pass' then 799
    when 'greenhouse_boost' then 499
    when 'fertilizer_boost' then 199
    else null
  end;
  if v_amount_cents is null then raise exception 'unknown_product_id'; end if;

  insert into public.purchases (
    profile_id, product_id, provider, provider_transaction_id, status, amount_cents, currency, completed_at
  )
  values (v_profile, p_product_id, 'mock', 'mock_' || p_request_id::text, 'completed', v_amount_cents, 'USD', now())
  returning id into v_purchase_id;

  perform public._apply_purchase_entitlement(v_profile, p_product_id, v_purchase_id);

  v_response := jsonb_build_object('ok', true, 'purchase_id', v_purchase_id);
  update public.request_log set response = v_response where request_id = p_request_id;
  return v_response;
end;
$$;

revoke execute on function public.mock_grant_purchase(text, uuid) from public, anon;
grant execute on function public.mock_grant_purchase(text, uuid) to authenticated;
