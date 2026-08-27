# Genesis Garden — тестирование

Три независимых слоя тестов, каждый проверяет то, что реально может проверить:

1. **SQL/RPC-тесты** (`supabase/tests/`, запускаются `sudo bash supabase/tests/run_local.sh`) — сервер-авторитетная логика: RLS, идемпотентность, отказ подделанных запросов. Работают на локальной PostgreSQL с шимом схемы `auth`/ролей (без Docker/полного Supabase CLI — недоступны в этой песочнице, см. `docs/AUDIT.md`), поэтому это не "мок", а реальное выполнение реальных миграций и RPC.
2. **Vitest юнит-тесты** (`apps/web`, `npx vitest run`) — чистая игровая модель и клиентские обёртки (генетика, экономика, миграция, офлайн-очередь, retention, платежи) без браузера и без сети.
3. **Playwright E2E** (`node test-e2e*.mjs` из корня репозитория, требует `npm run build && npm run preview` в `apps/web`) — реальный браузер поверх собранного бандла, локальный игровой цикл целиком.

Текущие цифры (после Этапа 9): SQL — 35/35 assertions зелёных, Vitest — 85/85, три Playwright-скрипта — все зелёные.

## 5 критических сценариев мастер-промта → где именно проверены

Мастер-промт требует E2E для 5 сценариев. Честная оговорка: сценарии 2–5 фундаментально проверяют серверную авторизацию/идемпотентность — экономический смысл теста не меняется от того, вызван ли RPC из настоящего браузера через Supabase JS SDK или напрямую по SQL на том же RPC с теми же ролями (`authenticated`/`anon`/`service_role`) — а вот дойти до них из Playwright-браузера в этой песочнице нельзя: нет живого Supabase-проекта (GoTrue auth, реальный HTTPS RPC-эндпоинт), см. открытые вопросы владельцу в `docs/IMPLEMENTATION_STATUS.md`. Поэтому эти четыре проверены на уровне, где защита реализована — SQL против реальной Postgres/RLS с теми же ролями, что использует настоящий Supabase.

| # | Сценарий из мастер-промта | Где проверено | Файл:строка / скрипт |
|---|---|---|---|
| 1 | Новый пользователь, полный путь | **Playwright, реальный браузер** | `test-e2e-newuser-journey.mjs` — онбординг до конца, посадка, квест "Первая посадка" забран, покупка, скрещивание, reload сохраняет всё |
| 2 | Старый локальный пользователь: вход + миграция + reload | SQL (миграция) + Vitest (чистые функции миграции) | `supabase/tests/03_migration_tests.sql` (4 assertions: keep_local/merge/дедуп генома/идемпотентность request_id) + `apps/web/src/sync/migration.test.ts` (summarizeLocalState/migrationOptions/shouldPromptMigration). Полный браузерный проход экрана логина недостижим без живого Supabase Auth — UI-логика (`AuthGate.tsx`) покрыта только тем, что видно глазами при ручной проверке сборки |
| 3 | Двойная трата (double-spend) подарка | SQL | `supabase/tests/02_scenario_tests.sql:253-264` — повторный `claim_gift` с новым request_id падает `gift_already_resolved`, не начисляет пыль дважды |
| 4 | Sandbox-чекаут + без дублирования entitlement | SQL | `supabase/tests/05_payments_tests.sql` — идемпотентность `mock_grant_purchase` по request_id (ровно одна запись `purchases`/`entitlements` при повторе), потолок буста 25% держится при избыточной покупке |
| 5 | Подделанный клиентом запрос отклонён сервером | SQL | `supabase/tests/02_scenario_tests.sql` — прямой `UPDATE gardens` под `authenticated` запрещён (insufficient_privilege), `anon` не видит чужие сады и не может звать `harvest()` (EXECUTE отозван), `breed()` отклоняет чужое растение (`parent_not_owned`) |

## Остальные пункты Этапа 10 из мастер-промта

- **Миграция старого localStorage-сейва** — см. сценарий 2 выше; отдельно, чисто локально (без облака вообще) миграция схемы сохранения v1→v2→v3 покрыта в `apps/web/src/game/store.test.ts` (повреждённый JSON, отсутствующие поля новых версий — не роняет игру, не теряет прогресс).
- **Session-restore** — локальный игровой прогресс переживает `reload()` (все три Playwright-скрипта это проверяют явно). Восстановление облачной Supabase-сессии — штатное поведение `@supabase/supabase-js` (`persistSession: true`, `autoRefreshToken: true`), это протестированное поведение самой библиотеки, отдельно не переизобретается.
- **Офлайн/retry** — `apps/web/src/sync/offlineQueue.test.ts` (7 тестов: остановка дренажа на первой сетевой ошибке без потери порядка, переиспользование request_id при повторе, персистентность очереди между "перезагрузками", no-op без доступного storage) + `gameApi.test.ts` (`drainQueue`). Реальное подключение к событию `window.online` — см. `App.tsx`, не юнит-тестируется отдельно (тонкая обвязка в 15 строк), проверено вручную поведение `game.input.enabled`/офлайн-баннера через Playwright при Этапе 9.
- **Продакшн-сборка + GitHub Pages base-path** — `vite.config.ts` (`base: '/genesis-garden/'`), проверено на каждом этапе через `npm run build && npm run preview -- --strictPort` + Playwright по адресу `http://localhost:4173/genesis-garden/` (не корню — так же, как реальный Pages URL). Живой деплой `https://mefisto767.github.io/genesis-garden/` подтверждён достижимым и отдающим правильный `<title>Genesis Garden</title>` через `WebFetch` (ранее в `docs/AUDIT.md` было отмечено как непроверенное из песочницы — снято на Этапе 10); сам деплой не обновлён на последнюю версию до Этапа 11 (CI/CD) — это ожидаемо, задеплоена только v0.4-genetics.

## Как запустить всё вручную

```bash
# 1. SQL/RPC (нужен системный PostgreSQL 16, роль postgres)
sudo bash supabase/tests/run_local.sh

# 2. Vitest
cd apps/web && npx vitest run

# 3. Playwright E2E (нужен собранный бандл)
cd apps/web && npm run build && npm run preview -- --port 4173 --strictPort &
cd .. && node test-e2e.mjs http://localhost:4173/genesis-garden/
node test-e2e-genetics.mjs http://localhost:4173/genesis-garden/
node test-e2e-newuser-journey.mjs http://localhost:4173/genesis-garden/
```
