# Genesis Garden — Environment Art Slice B (integration lock)

Статус: **принято**, шесть 32×32 материалов террейна — второй production-art
проход после Art Vertical Slice A (`docs/ART_VERTICAL_SLICE_A.md`), описанный
в `docs/VISUAL_PRODUCTION_ROADMAP.md`. Это docs-only коммит-замок: фиксирует
точные хэши/размеры/scope ДО того, как в следующем коммите появится код
интеграции — если что-то из зафиксированного здесь разойдётся с реально
закоммиченным, это баг ревью, а не молчаливое разночтение.

## Источник

Пакет `artpack-b` (директория, не zip в этот раз), доставлен владельцем,
хэши сверены владельцем против `SHA256SUMS` пакета до начала интеграции.
Разбор пакета: `CLAUDE_INTEGRATION_PROMPT.md` (техрегламент),
`ART_SLICE_B_CONTRACT.md` (локальный визуальный контракт), `README.md`
(таблица ассетов), `game-ready/*.png` (шесть runtime-текстур),
`sources/*.png` (высокое разрешение, НЕ публикуется), `reference/
environment_target.png` (визуальный ориентир, НЕ файл для рендера в игре),
`reference/game_ready_contact_sheet.png` (контакт-лист для сверки).

## Шесть одобренных материалов — приняты как есть (RGBA, 32×32)

| Файл (`apps/web/public/assets/terrain/`) | Canvas | SHA256 |
|---|---:|---|
| `tile_grass_v1.png` | 32×32 | `fc399a8d7fef881f001b8499360abba37d1911f0676d5857db06d3bde09d2824` |
| `tile_grass_v1_alt.png` | 32×32 | `bc36a1510496c500fe899333cce53747eff4ff242bee4cb7edfa8f7b40db72c1` |
| `tile_path_earth_v1.png` | 32×32 | `3dc040cb1aa1a1607c0200a555f2e2e154ee5192bbe462172ff6e7ea192a7de9` |
| `tile_water_v1.png` | 32×32 | `44983a4cae94a59fb425221ae37717b9d08e9ee46a6e124345867322213b2bce` |
| `tile_water_v1_alt.png` | 32×32 | `6c0f2c26b7b7f2c8d321242823e6d711a506889710f1b01ada8615d480116384` |
| `tile_thicket_v1.png` | 32×32 | `bbe9fbc767da187b97456e2277f2e54aa27954f76b4cc6dc9aef050facc82b4b` |

Байт-в-байт копии пакета (`sha256sum` сверен против пакетного `SHA256SUMS`
до и после копирования — см. финальный отчёт интеграции). Никогда не
редактируются последующими проходами — редактировать можно только код
компоновки (`overhaul/terrainComposition.ts` / `overhaul/terrainTextures.ts`).
`sources/*.png` (высокое разрешение) и `reference/environment_target.png`
(визуальный ориентир) намеренно НЕ скопированы в `apps/web/public/` — не
runtime-ассеты, не должны отдаваться браузеру.

**Директория**: `apps/web/public/assets/terrain/` — новая, отдельная от
`assets/tiles/` (грядки, Art Vertical Slice A). Материалы террейна и тайлы
грядок — разные семейства ассетов с разным жизненным циклом; отдельная
директория делает это явным, тем же духом, что `apps/web/art_source/v1/`
как отдельная source-art директория для Slice A.

## Куда подключаются (сужение по коду)

- **Загрузка**: `BootSceneOverhaul.preload()` — все шесть грузятся
  безусловно для Overhaul (и Legacy, и V2 Genetics; это не V2-only ассет,
  как `plant_hybrid_unrevealed_v1`/`plant_sunflower_mature_v1`). Classic не
  импортирует `BootSceneOverhaul`/`EstateScene` вообще — подтверждено тем же
  `grep EstateScene dist/assets/*.js` = 0 совпадений на дефолтной сборке,
  что и раньше для остального overhaul-кода (см. `CLAUDE.md`).
- **`EstateScene.renderTerrain()`** — полностью переписан: вместо
  фиксированного набора `tile_grass`/`tile_path`/`tile_water`/`tile_thicket`
  (процедурные Phaser Graphics-текстуры, `overhaul/proceduralAssets.ts`)
  теперь вызывает `terrainTextures.terrainCellTextures()` на каждую
  отрисовываемую клетку (`terrainAt()`/`pathTileKeySet()` — те же данные
  `worldConfig.ts`, что и раньше, без изменений). Четыре старых процедурных
  генератора (`generateGrassTile`/`generatePathTile`/`generateWaterTile`/
  `generateThicketTile`) удалены — заменены, не оставлены как мёртвый код.
- **`overhaul/terrainComposition.ts`** (новый, Phaser-free, юнит-тестируется
  отдельно — тот же паттерн, что `camera.ts`/`movement.ts`/
  `lumiBehavior.ts`): 4-битная маска соседства (`neighbourMaskAt`),
  классификация 16 масок (`classifyFourNeighbourMask` — isolated/end×4/
  straight×2/corner×4/T×4/cross), детерминированный хэш травы
  (`grassVariantAlt`, НЕ игровой RNG), детерминированный редкий декор берега
  (`bankDecorAt`), решение про water shimmer + `prefers-reduced-motion`
  (`waterAnimatesFor`).
- **`overhaul/terrainTextures.ts`** (новый, тонкий Phaser-слой): по маске/
  решению из `terrainComposition.ts` компонует настоящую Phaser-текстуру
  через Canvas 2D (`scene.textures.createCanvas` + `drawImage`/`clip()`),
  кэшируя по текстурному ключу (`terrain_path_v1_<mask>`,
  `terrain_water_v1_<mask>_<base|alt>`, `terrain_bank_v1_<mask>_<decor>`) —
  генерируется один раз при первом использовании маски, не на каждый кадр.
- **`assetManifest.ts`** (legacy) и **`assetManifestV1.ts`** (typed) — все
  шесть зарегистрированы в обоих, status `approved`, `sourceSize`/`sizePx`
  ровно `[32, 32]`, `required: true` в typed-манифесте. Четыре старых
  `temporary`-записи террейна (`tile_grass`/`tile_path`/`tile_water`/
  `tile_thicket`) удалены из `assetManifest.ts` вместе с генераторами.

## Adjacency-правила (что реально реализовано)

- **Трава**: `tile_grass_v1` заливает весь открытый сектор; `tile_grass_v1_alt`
  выбирается на ~12% клеток чистым хэшем `(col,row)` (не RNG, не
  персистится) — разреженная вариация, не второй базовый цвет.
- **Дорожка**: `tile_path_earth_v1` заливает органичную форму (скруглённое
  ядро + "рукава" к каждому связанному соседу по 4-битной маске из
  `pathTileKeySet()`), поверх травяного фона — прямые/концы/повороты/
  T-развилки/перекрёстки не выглядят изолированными прямоугольниками. Для
  генерации текстуры (не для логической классификации, которая тестируется
  отдельно на чистой path-связности) соседняя клетка воды считается такой же
  "мокрой", как путь — иначе на единственном реальном стыке дорожки и пруда
  (тайл `(23,27)`, дорожка идёт вдоль северного края пруда) оставалась бы
  ложная полоса травы между силуэтом дорожки и кромкой воды. Задокументировано
  и покрыто тестом (`terrainComposition.test.ts`, "documents the one real
  exception").
- **Пруд**: `tile_water_v1`/`tile_water_v1_alt` заливают органичную форму
  внутри `POND`-прямоугольника (`worldConfig.ts`, не изменён), берег строится
  из 4-битной маски "сосед — тоже вода" — непрерывная кромка со всех сторон
  и по углам, без квадратных синих краёв. Клетки травы, соседствующие с водой,
  получают компоновку "берег": тонкая полупрозрачная кромка влажной земли
  (глубина ~22% тайла, alpha 0.28) вдоль водной стороны, плюс редкий (~13%
  таких клеток, детерминированно) один маленький камень ИЛИ пучок камыша —
  никогда оба сразу, оба остаются subordinate по масштабу/контрасту.
- **Заросли**: `tile_thicket_v1` рисуется напрямую (без компоновки по маске —
  контракт не требует адаптивной формы для границы, только "единая масса,
  явно непроходимо, не чёрное"). Occupancy/collision — те же
  `collisionRects()`-полосы, что и раньше, не тронуты.
- **Контактные тени**: одна сдержанная тень (два наложенных эллипса низкой
  alpha 0.14, смещение вниз-вправо, согласованное со светом "сверху слева")
  — за зданиями, грядками, персонажем, Люми. Presentation-only: без
  `setInteractive`, никогда не добавляется в `obstacles`/`collisionRects()`.
  **Явная интерпретация**: контракт не фиксирует точные offset/opacity/blur
  — Phaser не даёт дешёвого CSS-blur-эквивалента без отдельного post-fx
  pipeline (вне объёма "сдержанной" тени), поэтому мягкий край имитируется
  двумя эллипсами разного размера вместо настоящего блюра. Задокументировано
  как осознанный выбор, не молчаливое упрощение.
- **Water shimmer**: alpha-tween между `tile_water_v1` и `tile_water_v1_alt`,
  как и раньше, но теперь честно проверяет `prefers-reduced-motion`
  (`terrainComposition.waterAnimatesFor`) — при reduced motion рисуется
  только базовый кадр, вторая текстура даже не создаётся для этой сессии.
  Раньше (до этого прохода) shimmer-tween не проверял reduced motion вообще
  — это реальная регрессия/пробел, который этот проход закрывает, а не
  переносит дальше.

## Явно не входит в объём (без изменений в этом проходе)

Здания/персонаж/Люми/ворота/грядки/растения/HUD/Reveal/лаборатория/
генетика/экономика/save-формат/будущие зоны. Никаких новых цветов, мостов,
лилий, рыб, погоды — контракт пакета это явно запрещает. Позиции грядок
(64×64, pitch 96), `PATH_POLYLINE`, `POND`, `CAMERA_BOUNDS`,
`collisionRects()` — не менялись; вся компоновка этого прохода читает эти
данные, никогда не переопределяет.

## Проверено

`docs/ART_SLICE_B_CONTRACT.md` acceptance-критерии: нет пустоты/швов на
desktop 1440×900 / reference 960×540 / mobile 360×800 (новый
`test-e2e-environment-art-b.mjs`); нет очевидного checkerboard при обычном
зуме (человеческая проверка скриншотов); дорожка читается как связный
маршрут с корректными концами/поворотами/развилками (юнит-тесты
adjacency-классификации против реальных данных `PATH_POLYLINE`); пруд имеет
непрерывный берег без квадратных краёв (юнит-тесты pond-классификации
против реального `POND`); заросли читаются одной массой, коллизия
сохранена (не тронута); шесть грядок остаются кликабельными и визуально
доминирующими (`test-e2e-environment-art-b.mjs`); поведение Slice A
(hidden/revealed растения) не изменилось (та же проверка, плюс повторный
прогон `test-e2e-art-vertical-slice-a.mjs`); mobile без horizontal overflow.
