# Genesis Garden

Пиксельная браузерная ферма/питомник: сажаешь, собираешь урожай, скрещиваешь растения с генетикой (8-параметрический геном, редкости, мутации), обмениваешься с друзьями, ставишь цели. Работает полностью локально (localStorage) без единого внешнего сервиса, а на облачных фичах (аккаунт, синхронизация, соцобмен, покупки, аналитика) — за feature flags, выключенными по умолчанию.

**🔗 Живая версия (v0.4-genetics, деплой ждёт Этапа 11 CI/CD):** https://mefisto767.github.io/genesis-garden/

## Стек

Vite 8 + React 19 + TypeScript 6, Phaser 3.90 (игровая сцена сада), Supabase (Postgres + Auth + RLS + RPC — опционально, за флагом), oxlint, Vitest, Playwright.

## Быстрый старт (локальная игра, без облака)

```bash
cd apps/web
npm install
npm run dev
```

Открой `http://localhost:5173`. По умолчанию `VITE_CLOUD_SYNC_ENABLED` не установлен — игра полностью локальная, прогресс живёт в `localStorage`, аккаунт не нужен.

## Структура репозитория

```
apps/web/           — фронтенд (единственное приложение в монорепо)
  src/game/          — игровая модель: store, config, genetics, Phaser-сцены
  src/ui/            — React-панели (магазин, инвентарь, лаборатория, альбом, соцпанель, покупки, admin, цели)
  src/auth/          — гость/magic-link, AuthGate
  src/sync/          — миграция localStorage → облако, офлайн-очередь
  src/payments/      — PaymentProvider (mock/paddle), каталог товаров
  src/analytics/     — track(), события
  src/admin/         — чтение агрегатов для admin-дашборда
  src/pwa/           — service worker, манифест
  src/monitoring/    — опциональный Sentry-адаптер
supabase/
  migrations/        — весь серверный SQL: схема, RLS, RPC, соцобмен, платежи
  tests/             — SQL/RLS/RPC-тесты против настоящего локального Postgres
docs/                — вся проектная документация (см. ниже)
.github/workflows/   — CI/CD (GitHub Actions)
test-e2e*.mjs        — Playwright e2e-сценарии (корень репозитория)
```

## Документация

- `docs/ARCHITECTURE.md` — как всё устроено и как связаны клиент/сервер.
- `docs/DATA_MODEL.md` — таблицы Supabase.
- `docs/ECONOMY.md` — баланс игры (клиент ↔ сервер).
- `docs/SECURITY.md` — модель безопасности (RLS, GRANT, SECURITY DEFINER RPC).
- `docs/PAYMENTS.md` — монетизация.
- `docs/ANALYTICS.md` — события и admin-дашборд.
- `docs/TESTING.md` — карта тестового покрытия по критическим сценариям.
- `docs/DEPLOYMENT.md` — CI/CD пайплайн и деплой на GitHub Pages.
- `docs/BETA_RUNBOOK.md` — как запустить закрытую бету и что делать при инцидентах.
- `docs/IMPLEMENTATION_STATUS.md` — актуальный статус по всем 12 этапам техрегламента (источник правды).
- `docs/MASTER_PLAN.md`, `docs/AUDIT.md` — исходный план и аудит на старте работ.
- `CLAUDE.md` — гид для следующей сессии Claude, которая продолжит эту работу.

## Тесты

```bash
# Юнит-тесты (чистая игровая модель, без браузера)
cd apps/web && npx vitest run

# SQL/RLS/RPC (нужен системный PostgreSQL 16, роль postgres)
sudo bash supabase/tests/run_local.sh

# Playwright e2e (нужен собранный бандл)
cd apps/web && npm run build && npm run preview -- --port 4173 --strictPort &
node test-e2e.mjs http://localhost:4173/genesis-garden/
node test-e2e-genetics.mjs http://localhost:4173/genesis-garden/
node test-e2e-newuser-journey.mjs http://localhost:4173/genesis-garden/
```

Подробности и карта покрытия по критическим сценариям — `docs/TESTING.md`.

## Облачные фичи (опционально)

Аккаунт/синхронизация, соцобмен, покупки и admin-дашборд реализованы полностью и протестированы (SQL против реального Postgres, имитирующего Supabase), но выключены по умолчанию. Чтобы включить их на реальном Supabase-проекте — см. `apps/web/.env.example` и `docs/DEPLOYMENT.md`.
