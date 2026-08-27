# CLAUDE.md — гид для следующей сессии

Этот файл — для Claude (или другого агента), который продолжит работу над Genesis Garden. Человеческая документация — в `README.md` и `docs/`. Здесь — практические заметки о том, как эта сессия разработки на самом деле всё запускала, какие есть особенности среды и что осталось сделать.

## Что это за проект

Пиксельная браузерная ферма/питомник с генетикой. Полная история и текущий статус — `docs/IMPLEMENTATION_STATUS.md` (обновляется на каждом этапе, это единственный источник правды о прогрессе — читай его в первую очередь, не полагайся на память из старых сессий). Исходное ТЗ — «главный технический регламент» David, разбитый на 12 этапов (`docs/MASTER_PLAN.md`).

Сквозной принцип всей работы: **никогда не притворяться, что функциональность есть, если её нет.** Либо строится и по-настоящему тестируется, либо честно помечается "не подключено"/"скоро" в UI и коде (примеры: `PaddlePaymentProvider` без аккаунта Paddle, Sentry-адаптер без DSN, `tutorial_completed` только на реальном завершении, а не на пропуске). Продолжай этот принцип.

## Репозиторий и git

- Апстрим — `Mefisto767/genesis-garden` на GitHub, ветки `main` (исходники) + `gh-pages` (билд, публикуется CI).
- Push-доступ к GitHub зависит от конкретной sandbox-сессии — проверяй `env | grep -i github`/`git ls-remote origin` в начале работы вместо того, чтобы полагаться на память из старых сессий. Сессия техрегламента (см. историю ниже) push-доступа не имела; сессия Visual Overhaul (ветка `visual-overhaul`) — имела (`GH_TOKEN`/`GITHUB_TOKEN` были проброшены средой) и запушила ветку напрямую. Если доступа нет — попроси у владельца PAT (repo scope) или патч, задокументировав это честно, а не тратя время на обходной путь.
- Коммить только когда изменения одного этапа реально протестированы (lint/tsc/vitest/SQL/e2e) — см. историю коммитов (`git log --oneline`) как образец гранулярности: один коммит на этап техрегламента, с честным описанием, что реально проверено.

## Visual Overhaul (ветка `visual-overhaul`, отдельный трек от техрегламента)

Живое поместье + перемещение персонажа + полноэкранная лаборатория вместо
классической сетки грядок — см. `docs/FINAL_VISION.md` (GDD-регламент этого
трека, отдельный от `docs/MASTER_PLAN.md`) и `docs/ASSET_MANIFEST.md`.
Полностью за feature-флагом `VITE_VISUAL_OVERHAUL_ENABLED` (default false,
не установлен в production) — см. `apps/web/.env.example`. Флаг реально
tree-shake'ится Vite/Rolldown при сборке: `grep EstateScene dist/assets/*.js`
на дефолтной (флаг выключен) сборке возвращает 0 совпадений — overhaul-код
физически не попадает в production-бандл, а не просто скрыт рантайм-веткой.

Ключевые новые файлы: `apps/web/src/overhaul/` (worldConfig/movement/events/
assetManifest/proceduralAssets/OverhaulApp — вся логика без Phaser-зависимости
юнит-тестируется отдельно от Phaser-частей), `apps/web/src/game/scenes/
EstateScene.ts` + `LaboratoryScene.ts` + `BootSceneOverhaul.ts`, `apps/web/src/
ClassicApp.tsx` (byte-for-byte старый `App.tsx`, теперь выбирается через
новый `App.tsx`-переключатель). Игровая модель (`game/store.ts`, `genetics.ts`,
`config.ts`) НЕ менялась — оба режима читают один и тот же `gameStore`/
localStorage-сейв, переключение флага не мигрирует сохранение.

Собрать и проверить overhaul-режим локально:

```bash
cd apps/web
npm install
# Обычная (production, флаг выключен) сборка — как и раньше:
npm run build && npm run preview -- --port 4173 --strictPort &

# Отдельная сборка с включённым флагом, для ручной проверки/e2e:
VITE_VISUAL_OVERHAUL_ENABLED=true npx vite build --outDir dist-overhaul
npx vite preview --outDir dist-overhaul --port 4174 --strictPort &

# e2e-сценарии overhaul-режима (корень репозитория, playwright из корневого package.json):
node test-e2e-overhaul.mjs http://localhost:4174/genesis-garden/
node test-e2e-overhaul-responsive.mjs http://localhost:4174/genesis-garden/
```

`dist-overhaul/` в `.gitignore` — это локальный тестовый бандл, не коммитится
и не деплоится. CI (`.github/workflows/ci.yml`) не менялся: он триггерится
только на `main`/PR в `main`, поэтому пуш ветки `visual-overhaul` его не
запускает — все проверки в этой ветке прогонялись вручную в sandbox-сессии
(см. финальный отчёт в истории чата/коммитах). Если/когда владелец решит
влить эту ветку — стоит отдельным шагом добавить overhaul-сборку и
`test-e2e-overhaul*.mjs` в CI, это осознанно не сделано сейчас, чтобы не
трогать поведение CI для `main` без явного решения.

### Estate Architecture (тот же трек, продолжение Visual Overhaul)

Второй проход по ветке `visual-overhaul`: Stage 1 (вертикальный слайс) был
принят как техническая демонстрация, но его EstateScene выглядела как один
законченный экран без места для роста. Этот проход не меняет визуал на
финальный (задача явно это запрещала) — он перестраивает архитектуру мира
под расширение: `apps/web/src/overhaul/estateBlueprint.ts` — 48×48-тайловый
логический мир, 4 зоны (`zone_starting_garden` открыта, остальные три —
`zone_working_farm`/`zone_botanical_estate`/`zone_late_territory` —
заблокированы и существуют только как данные), 9+1 building slots и 3
landmark slots со стабильными ID (см. `docs/ESTATE_LAYOUT_BLUEPRINT.md`).
`worldConfig.ts` строит фактический Stage-1 сектор ИЗ этих слотов (никогда
не хардкодит координаты будущих зданий напрямую).

Добавлен постоянный помощник **Люми** (`apps/web/src/overhaul/lumiBehavior.ts`
— чистая логика, без побочных эффектов и без gameStore, поэтому физически не
может вызвать игровое действие дважды) — следует за игроком, не участвует в
коллизиях, не интерактивна. Только `idle`/`follow` (одна текстура) и
пульсирующее свечение реализованы; `move`/`point`/`work` честно `missing`.

Граница открытого сектора — сплошное кольцо коллизии "заросли" (2 тайла) с 4
интерактивными "заглушками будущего" (ворота/разрушенные проходы,
`BOUNDARY_TRANSITIONS` в `worldConfig.ts`) — все ведут в закрытые зоны честным
тостом "скоро", реального открытия новых секторов в этом проходе нет (и не
должно быть — см. ограничения задачи).

Игровая модель по-прежнему не тронута (грядки — те же 6 ID `gameStore`),
LaboratoryScene/RevealScene не переделывались на этом этапе. Тесты: было
107 Vitest, стало заметно больше (`estateBlueprint.test.ts`,
`lumiBehavior.test.ts`, расширенный `worldConfig.test.ts` с проверкой
недостижимости закрытых секторов) — см. финальный отчёт в истории чата для
точных чисел и commit hash'ей этого прохода.

## Как всё запускать в песочнице разработки

```bash
# Установка (один раз)
cd apps/web && npm install
cd /root/work/genesis-garden && npm install   # корневой package.json — только playwright для e2e

# Дев-сервер
cd apps/web && npm run dev

# Lint / typecheck / unit-тесты
cd apps/web && npm run lint && npx tsc -b --noEmit && npx vitest run

# SQL/RLS/RPC тесты — нужен системный PostgreSQL 16, запускать через sudo
# (шим создаёт временную схему auth + роли anon/authenticated/service_role
# поверх обычного Postgres, см. docs/ARCHITECTURE.md)
sudo bash supabase/tests/run_local.sh

# Playwright e2e — нужен собранный бандл на localhost:4173
cd apps/web && npm run build
cd apps/web && npm run preview -- --port 4173 --strictPort &
node test-e2e.mjs http://localhost:4173/genesis-garden/
node test-e2e-genetics.mjs http://localhost:4173/genesis-garden/
node test-e2e-newuser-journey.mjs http://localhost:4173/genesis-garden/
```

Особенности этой конкретной sandbox-среды (могут не повторяться в другой среде — код уже написан с этим в виду):

- Chromium для Playwright лежит по фиксированному пути `/opt/pw-browsers/chromium` — все три `test-e2e*.mjs` подхватывают его через `existsSync()`-проверку, с fallback на обычный `npx playwright install` вариант (так работает CI). Не хардкодь новый путь без такой проверки.
- `playwright` резолвится из корневого `package.json` (`genesis-garden-e2e-tools`), не из `apps/web` — это специально: e2e-скрипты живут в корне репозитория, а не внутри `apps/web`.
- Docker/Supabase CLI недоступны в этой песочнице — поэтому серверный код тестируется SQL-шимом (`supabase/tests/`), а не `supabase start`. Если в будущей сессии Docker появится — можно (но не обязательно) перейти на настоящий `supabase start`, шим и так даёт реальное покрытие тем же SQL/RLS/RPC кодом.
- `pip`/`npm` install команды могут требовать сети — обычно доступна (allowlisted registries).

## Где искать что

- **Баланс игры** — оба места сразу: `apps/web/src/game/config.ts` (клиент) и `supabase/migrations/20260827120200_functions.sql` + `20260827120300_catalog_data.sql` (сервер). Меняешь одно число — меняй оба, иначе клиент и сервер разойдутся (см. `docs/ECONOMY.md`, там же зафиксирован технический долг — нет единой таблицы `game_config`).
- **RLS/RPC-безопасность** — `docs/SECURITY.md` описывает все слои защиты и какой тест что проверяет; сами тесты — `supabase/tests/02_scenario_tests.sql` и далее.
- **Feature flags** — `apps/web/.env.example` — единственное место, где должны быть перечислены ВСЕ реально используемые переменные окружения. Если добавляешь новый флаг — сразу добавь его сюда с комментарием; если убираешь код, который читал какую-то переменную, — убери и её отсюда (см. историю с `VITE_POSTHOG_*`, Этап 11: переменные лежали в примере, но их никто не читал — удалены как честность).
- **Что уже сделано по каждому из 12 этапов** — `docs/IMPLEMENTATION_STATUS.md`, раздел на каждый этап + "Открытые вопросы владельцу" + "Известные ограничения" в конце файла.

## Проектная память (claude.ai Project "GENESIS GARDEN")

Помимо файлов в репозитории, у этой работы есть привязанный claude.ai проект с документами:
- `claude/status.md` — сводка прогресса для владельца (короче, чем `IMPLEMENTATION_STATUS.md`, обновляется на каждом крупном этапе/версии).
- `claude/genesis-garden-plan.md`, `claude/fable-art-brief.md`, `claude/style-directions.md`, `claude/assets-and-prompts.md`, `claude/evaluation-2026-08-26.md` — исторический контекст более ранних версий (арт-пайплайн v0.2/v0.3), полезен для понимания, откуда взялся текущий арт и стиль, но не для баланса/техрегламента.

Если продолжаешь эту работу в новой сессии, привязанной к тому же проекту, — читай `claude/status.md` и `docs/IMPLEMENTATION_STATUS.md` вместе, они не дублируют, а дополняют друг друга (первый — для владельца, второй — подробный источник правды).

## Стиль работы, унаследованный от техрегламента (актуален и дальше, если не сказано иное)

- UI — только на русском.
- Числа баланса — в конфиг, не хардкодить в компонентах.
- После каждого значимого изменения — прогонять тесты (lint/tsc/vitest/SQL/e2e), не полагаться на "выглядит правильно" (см. найденный на Этапе 9 баг с Phaser click-through — его поймал только настоящий e2e, не юнит-тест модели).
- Не спрашивать подтверждения между этапами — работать автономно, спрашивать только когда реально заблокирован на внешних ключах/аккаунтах/необратимых действиях.
