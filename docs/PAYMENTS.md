# Genesis Garden — монетизация (Этап 7)

## Архитектура

`PaymentProvider` (`apps/web/src/payments/PaymentProvider.ts`) — единый интерфейс checkout'а на клиенте:

```ts
interface PaymentProvider {
  readonly name: 'mock' | 'paddle';
  checkout(productId: ProductId): Promise<{ ok: boolean; errorMessage?: string }>;
}
```

Выбирается через `VITE_PAYMENTS_PROVIDER` (`.env.example`): `mock` (по умолчанию) или `paddle`. Вся секция покупок в UI (`PurchasesPanel.tsx`, кнопка «Поддержать» в HUD) видна только когда `VITE_PAYMENTS_ENABLED=true` **и** у игрока настоящий облачный аккаунт (`auth.status === 'signed_in'`) — entitlements существуют только в облаке, локальная офлайн-игра монетизацию не показывает вообще.

## Каталог

`apps/web/src/payments/catalog.ts` — три товара, зеркалированы 1:1 в `supabase/migrations/20260827150000_payments_stage7.sql` (`_apply_purchase_entitlement`):

| product_id | Цена | Что даёт |
|---|---|---|
| `season_pass` | $7.99 | entitlement `season_pass`, 60 дней (статус, без функциональных бонусов — сознательно, чтобы не изобретать баланс, которого не просили) |
| `greenhouse_boost` | $4.99 | entitlement `growth_boost` +10%, 30 дней |
| `fertilizer_boost` | $1.99 | entitlement `growth_boost` +15%, 24 часа |

Суммарный `growth_boost` всегда зажат в 25% на сервере (`active_growth_boost_percent()`, `least(sum, 0.25)`) — даже если купить бустов больше, чем нужно для потолка. Проверено вживую в `supabase/tests/05_payments_tests.sql`.

**Честно не продаётся** (см. `COMING_SOON_CATEGORIES` в `catalog.ts` и `docs/IMPLEMENTATION_STATUS.md`): слоты хранилища и косметика из исходного ТЗ — в игре пока нет ни лимита инвентаря, ни системы косметических предметов, продавать их означало бы брать деньги за ничего не делающую покупку. UI показывает эти категории как «скоро», а не тихо опускает.

## Mock-провайдер (текущее состояние без Paddle-аккаунта)

У владельца проекта пока нет ни продакшен-, ни sandbox-аккаунта Paddle (см. «Открытые вопросы владельцу» в `docs/IMPLEMENTATION_STATUS.md`). Чтобы прогнать весь путь покупка → entitlement → отображение в игре по-настоящему (а не просто написать код и не проверить его), сделан `mock_grant_purchase(product_id, request_id)` RPC:

- Callable **напрямую клиентом** (`authenticated`) — единственное исключение из правила «деньги только через service_role webhook» во всём проекте, и оно осознанное: это не платёж, реальные деньги никогда не участвуют, `provider='mock'` жёстко зашит на сервере (не приходит от клиента).
- Идемпотентен по `request_id`, использует ту же логику начисления entitlement, что и боевой `grant_purchase` (общая функция `_apply_purchase_entitlement`), так что мы тестируем реальный путь начисления, а не отдельную упрощённую копию.
- **Перед реальным запуском с Paddle**: функцию можно оставить в базе (она безвредна сама по себе), но `VITE_PAYMENTS_PROVIDER` в проде должен быть `paddle`, а не `mock` — иначе бета-тестер сможет «купить» что угодно бесплатно. Это ответственность клиентской конфигурации/окружения, не RLS.

## Настоящий Paddle (когда появится аккаунт)

`PaddlePaymentProvider.checkout()` сейчас всегда возвращает `paddle_not_configured` — специально, а не заглушка-обман: писать непроверенный код интеграции с реальными деньгами и выдавать его за готовый прямо запрещено правилами проекта. Когда у владельца будет аккаунт Paddle:

1. Получить `VITE_PADDLE_CLIENT_TOKEN` (Paddle Dashboard → Developer Tools → Authentication) и прописать в `.env`/CI-секреты вместе с `VITE_PADDLE_ENVIRONMENT=sandbox` для первой проверки.
2. Подключить Paddle.js overlay checkout в `PaddlePaymentProvider.checkout()` (см. официальный `Paddle.Checkout.open()`), передавая `productId` → реальный Paddle price ID (маппинг завести отдельной таблицей/константой — id в `catalog.ts` сейчас внутренние, не Paddle-шные).
3. Развернуть webhook-приёмник (Supabase Edge Function, `supabase/functions/paddle-webhook/` — ещё не создана, это следующий шаг вместе с реальным проектом) с проверкой подписи Paddle (`Paddle-Signature` заголовок) и вызовом `grant_purchase(...)` от имени `service_role`.
4. Переключить `VITE_PAYMENTS_PROVIDER=paddle` только после сквозной проверки в sandbox (тестовая карта Paddle → webhook → entitlement → игра видит буст).
5. Обновить это досье фактическим адресом webhook и результатами проверки.

## Жёсткие ограничения (соблюдены)

- Платежи не влияют на шанс редкости — `breed()` не принимает и не смотрит ни на что платёжное.
- Суммарный буст роста ≤ 25%, независимо от количества покупок.
- Никаких платных «мистери-боксов» со случайным контентом, никаких призов в реальных деньгах, никакого NFT/крипто/вывода средств — в каталоге таких товаров нет и не будет.
- Никакой покупки «бесконечных попыток скрещивания» — `breed()` как был, так и остался ограничен только монетами/дровам родителей, без платёжного обхода.
