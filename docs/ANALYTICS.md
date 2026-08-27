# Genesis Garden — аналитика и admin-дашборд (Этап 8)

## Как это работает

Клиент никогда не пишет напрямую в `analytics_events` — единственный путь: RPC
`log_analytics_event(p_event_name text, p_payload jsonb default '{}')`
(`supabase/migrations/20260827120200_functions.sql`), которая проставляет
`profile_id = auth.uid()` сама и не принимает его от клиента. Таблица
`analytics_events` (Этап 3) недоступна на прямой `SELECT` никому, кроме
`is_admin()`-профиля — обычный игрок не может прочитать чужие или даже свои
события напрямую, только писать через RPC.

`apps/web/src/analytics/track.ts` — единственная точка входа на клиенте:

```ts
track(event: AnalyticsEventName, payload?: Record<string, unknown>): void
```

- Если `VITE_CLOUD_SYNC_ENABLED=false` (по умолчанию у бета-тестера без
  аккаунта) — функция ничего не делает. Аналитика без реального backend'а не
  имеет смысла, поэтому здесь нет оффлайн-очереди/буфера — это осознанное
  решение, не недосмотр.
- Если облако включено — fire-and-forget вызов RPC. Сетевая ошибка тихо
  проглатывается (`.catch(() => {})`) — аналитика не должна ронять игровой UX.

## Список событий

Источник правды типов — `apps/web/src/analytics/events.ts` (`AnalyticsEventName`).

| Событие | Где вызывается | payload |
|---|---|---|
| `session_started` | `App.tsx` при монтировании (`recordSessionStart`) | `{}` |
| `day_1_return` | `analytics/retention.ts`, ровно на день 1 от первого визита на устройстве | `{}` |
| `day_7_return` | `analytics/retention.ts`, ровно на день 7 | `{}` |
| `tutorial_started` / `tutorial_completed` | **не вызываются** — обучения в игре ещё нет (см. Этап 9) | — |
| `store_opened` | Открытие магазина семян (HUD и PlantPicker) и панели поддержки (`PurchasesPanel`) | `{}` |
| `seed_bought` | Успешная покупка семян, `ShopPanel` | `{ seedId, cost }` |
| `plant_planted` | Успешная посадка, `PlantPicker` | `{ plotId, seedId }` |
| `plant_harvested` | Сбор урожая, `GardenScene` | `{ plotId, seedId }` |
| `first_breed_started` / `first_breed_completed` | Первая попытка скрещивания на устройстве (флаг в `localStorage`), `LabPanel` | `{}` |
| `breed_completed` | Каждое скрещивание, `LabPanel` | `{ mutated, dustGained }` |
| `plant_recycled` | Переработка в пыль, `AlbumPanel` | `{ dustGained }` |
| `share_clicked` | Нажатие «Поделиться», `AlbumPanel` | `{ rarity, mutation }` |
| `gift_sent` | Успешная отправка подарка, `SocialPanel` | `{ itemType, amount }` |
| `gift_claimed` | Успешное получение подарка, `SocialPanel` | `{ giftId }` |
| `product_viewed` | Каждый товар каталога при открытии `PurchasesPanel` | `{ productId }` |
| `checkout_started` / `checkout_completed` / `purchase_failed` | Вокруг `provider.checkout()`, `PurchasesPanel` | `{ productId[, errorMessage] }` |

## Admin-дашборд

`apps/web/src/ui/AdminPanel.tsx` + `apps/web/src/admin/adminData.ts`.

Никаких новых RPC не создавалось — RLS-политики Этапа 3
(`supabase/migrations/20260827120100_rls.sql`) уже дают `is_admin()`-профилю
прямой `SELECT` по `profiles`, `gardens`, `purchases`, `entitlements`,
`analytics_events`, `audit_events`. `fetchAdminOverview()` делает несколько
параллельных `SELECT` и агрегирует результат **на клиенте** (count по
`event_name`, сумма `amount_cents` по `status='completed'` и т.д.).

Доступ к кнопке «Admin» в HUD появляется только после того, как
`checkIsAdmin()` подтвердил `profiles.is_admin === true` для текущего
`auth.uid()` — запрос фильтруется по своему id явно, поэтому обойти его
подделкой ответа на клиенте нельзя: любой не-админ получит `false`, а сам
`AdminPanel` в любом случае упрётся в те же RLS-политики при реальном чтении
данных, если бы кто-то попытался открыть панель без прав.

Как назначить первого админа (владелец, вручную, через `service_role`,
Supabase SQL editor или `psql` с сервисным ключом — клиент не может
самоповысить права, это заблокировано триггером
`profiles_protect_privileged_columns`):

```sql
update public.profiles set is_admin = true where id = '<uuid игрока>';
```

### Пределы масштабирования (честная оговорка)

Клиентская агрегация — осознанный выбор ради простоты и прозрачности на
масштабе закрытой беты (50–100 игроков, события — низкие тысячи строк).
`fetchAdminOverview()` ограничивает выборку событий 20000 строками за запрос
(`EVENTS_FETCH_LIMIT` в `adminData.ts`) и предупреждает в UI
(`eventsSampleTruncated`), если лимит достигнут — тогда счётчики становятся
приблизительными (последние N событий, не все за всё время). До публичного
релиза с трафиком на порядки больше беты это стоит заменить на серверные
материализованные вьюхи или RPC с `group by`/`count(*)` в самой БД, а не на
клиенте.
