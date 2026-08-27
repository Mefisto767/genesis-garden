# Genesis Garden — модель данных (Supabase/Postgres)

Полный DDL — в `supabase/migrations/`. Здесь только карта: что за таблица и зачем.

| Таблица | Назначение | Владелец строки (RLS) |
|---|---|---|
| `profiles` | Публичный профиль поверх `auth.users`: `public_code` (поиск друзьями, не email), `display_name`, `is_admin`, `banned` | `id = auth.uid()` |
| `gardens` | 1:1 с профилем (MVP — один сад на игрока). Здесь живут `coins`, `genetic_dust`, `pity_counter` | `owner_id = auth.uid()` |
| `seed_catalog` | Серверный каталог семян (зеркало `SEED_BALANCE` в config.ts) | публичное чтение |
| `plots` | 24 грядки на сад, `plot_index` 0..23, `seed_id`/`planted_at` для расчёта роста по дельте времени | через `garden_id` |
| `plants` | Специмены с геномом (`genome` jsonb + `rarity` + `mutation_id`) | через `garden_id` |
| `plant_ancestry` | Родословная: `parent_a_id`/`parent_b_id` (null у стартовых) | через связанное растение |
| `inventory` | Семена на руках (`seed_id` → `qty`) | через `garden_id` |
| `breeding_jobs` | Журнал скрещиваний (кто с кем, мутировало ли, сработал ли pity) | через `garden_id` |
| `economy_ledger` | Аудит каждого изменения `coins`/`genetic_dust` — история покупок и трат | через `garden_id` |
| `request_log` | Идемпотентность: `request_id` → сохранённый ответ. Клиенту не виден вообще | нет доступа клиенту |
| `quests` / `quest_progress` | Каталог квестов + прогресс на сад | каталог публичный, прогресс — свой |
| `seasons` | Сезонный пропуск (наполнится в Этапе 7) | публичное чтение |
| `social_connections` | Друзья/блокировки | свои строки (по любой из сторон) |
| `gift_transactions` | Подарки: `item_type` (`plant`/`dust`, `pollen`/`cutting` — задел схемы), `status` (`pending`/`claimed`/`declined`) | отправитель или получатель |
| `purchases` | Покупки (mock/paddle), идемпотентны по `(provider, provider_transaction_id)` | свои |
| `entitlements` | Активные ускорители/пропуска, привязаны к `purchases` | свои |
| `analytics_events` | Продуктовая аналитика (см. `docs/ANALYTICS.md`) | insert через RPC, select — только админ |
| `audit_events` | Служебный аудит (действия админов, подозрительные попытки) | только админ |

## Принцип RLS

Клиент **всегда только читает** свои строки (`owner_id`/`garden_id`/`profile_id` = `auth.uid()`). У роли `authenticated` явно отозваны `INSERT`/`UPDATE`/`DELETE` на все игровые таблицы (`REVOKE` в `20260827120100_rls.sql`) — единственный способ что-то изменить это вызвать SECURITY DEFINER RPC-функцию (`supabase/migrations/20260827120200_functions.sql`), которая сама проверяет владение и бизнес-правила через `auth.uid()`, никогда не доверяя параметрам от клиента напрямую (кроме содержательных, вроде «какое семя посадить» — но какая грядка/чей сад определяется только через `auth.uid()`).

## Идемпотентность операций

Каждая изменяющая функция принимает `p_request_id uuid`, генерируемый клиентом один раз на попытку действия (и переиспользуемый при retry). См. `docs/ECONOMY.md` → «Идемпотентность и деньги» и живые тесты в `supabase/tests/02_scenario_tests.sql`.

## Локальная проверка без Docker/Supabase CLI

В песочнице разработки нет доступа к Docker, поэтому полноценный `supabase start` не поднимался. Вместо этого `supabase/tests/00_local_auth_shim_pre.sql` подделывает минимально необходимое поведение Supabase (схему `auth`, `auth.uid()`, роли `anon`/`authenticated`/`service_role`) поверх голой PostgreSQL 16, и `supabase/tests/run_local.sh` прогоняет все миграции + сценарные RLS/RPC/идемпотентность тесты end-to-end. Это НЕ замена `supabase start` на реальной машине разработчика/CI с Docker — там нужно проверить то же самое штатными средствами (`supabase db reset && supabase test db`, см. `docs/TESTING.md`), но SQL уже реально выполнялся и проверялся, а не просто написан вслепую.
