# ASSET_MANIFEST — Visual Overhaul (вертикальный срез)

> Production note: следующий визуальный проход зафиксирован в
> `VISUAL_BIBLE_V1.md`, `VISUAL_ASSET_CONTRACT.md` и
> `VISUAL_PRODUCTION_ROADMAP.md`. Существующий пакет ниже считается
> legacy/placeholder до прохождения V1 validation конкретным asset family.

Источник правды — машиночитаемый `apps/web/src/overhaul/assetManifest.ts`.
Этот файл — читаемая проекция того же списка для ревью художником/владельцем.
Если правишь состав ассетов — правь оба файла синхронно (или сначала `.ts`,
потом переноси таблицу сюда; `.ts` первичен, если они разойдутся).

Код сцен (`EstateScene`, `LaboratoryScene`, `RevealScene`) никогда не
ссылается на голые имена файлов — только на `id` из этой таблицы. Заменить
временный ассет на финальный — значит поменять одну запись `source` в
`assetManifest.ts`, не трогая сцены.

## Легенда статуса

- **approved** — уже часть проверенного арт-пака (Fable, v0.2/v0.3-pixel), используется как есть.
- **temporary** — аккуратный код-плейсхолдер/dev-заглушка ИЛИ существующий ассет временно замещает отсутствующий (например, `building_storage.png` как силуэт дома).
- **missing** — в срезе не реализовано вообще; система либо не показывает функциональность, либо честно помечает «скоро».

## terrain tiles

| id | source | status | назначение |
|---|---|---|---|
| `tile_grass` | procedural: `generateGrassTile` | temporary | базовая трава EstateScene |
| `tile_path` | procedural: `generatePathTile` | temporary | дорожка |
| `tile_water` | procedural: `generateWaterTile` (2 кадра мерцания) | temporary | пруд |
| `tile_soil` | `assets/tiles/tile_soil.png` | approved | открытая грядка (без изменений) |
| `tile_soil_locked` | `assets/tiles/tile_soil_locked.png` | approved | заблокированная грядка (без изменений) |
| `tile_thicket` | procedural: `generateThicketTile` | temporary | заросли за границей открытого сектора — непроходимо |

## paths/water/fences

| id | source | status | назначение |
|---|---|---|---|
| `fence_gate` | procedural: `generateGateTexture` | temporary | ворота на границе сектора (2 из 4 переходов — восток/юг) |
| `prop_ruined_passage` | procedural: `generateRuinedPassageTexture` | temporary | разрушенный проход на границе сектора (2 из 4 переходов — север/запад) |
| `landmark_clearing` | procedural: `generateLandmarkClearingTexture` | temporary | расчищенная поляна на месте зарезервированного `landmark_central` — без монумента |

## buildings

| id | source | status | назначение |
|---|---|---|---|
| `building_house` | `assets/buildings/building_storage.png` (замещение) | temporary | дом владельца — реального ассета дома нет |
| `building_house_final` | `assets/buildings/building_house.png` (не существует) | **missing** | целевой ассет дома |
| `building_lab` | `assets/buildings/building_lab.png` | approved | здание лаборатории на карте (building_laboratory slot) |
| `building_storage_shed` | procedural: `generateStorageShedTexture` | temporary | небольшой склад стартового сада (building_storage slot), отдельный силуэт от дома |
| `building_greenhouse` | `assets/buildings/building_greenhouse.png` | approved | reserved building slot зоны «Рабочая ферма» — в Stage-1 не рендерится (зона закрыта) |

## character movement/actions

| id | source | status | назначение |
|---|---|---|---|
| `char_avatar` | procedural: `generateCharacterPlaceholder` | temporary | капсула + треугольник направления, НЕ финальный арт персонажа |

## NPC

| id | source | status | назначение |
|---|---|---|---|
| `npc_mascot_patrol` | `assets/ui/mascot_neutral.png` | temporary | существующий маскот на коротком патрульном маршруте вместо полноценного NPC |

## companion Lumi

| id | source | status | назначение |
|---|---|---|---|
| `companion_lumi_idle` | procedural: `generateLumiIdleTexture` | temporary | базовый вид Люми — используется и для idle, и для follow |
| `companion_lumi_move` | — | **missing** | отдельная поза движения (пока переиспользуется idle) |
| `companion_lumi_point` | — | **missing** | отдельная поза «указывает на объект» (пока только состояние, без новой графики) |
| `companion_lumi_work` | — | **missing** | поза «занята помощью» — поздняя функция, не реализована |
| `companion_lumi_glow` | procedural: `generateLumiGlowTexture` | temporary | пульсирующее свечение живого ростка внутри колбы |
| `building_lumi_station` | procedural: `generateLumiStationTexture` | temporary | станция/насест Люми в стартовом саду — без коллизии |

## plant stages / phenotype layers

| id | source | status | назначение |
|---|---|---|---|
| `plant_layers_existing` | `assets/plants/*` (весь существующий пак) | approved | без изменений — `buildPlantSprite()` переиспользован как есть |

## laboratory background/layers

| id | source | status | назначение |
|---|---|---|---|
| `lab_bg_level1` | procedural: `generateLabBackdrop` | temporary | тёмно-зелёный градиент+виньетка с водяным знаком «временный фон» |
| `lab_bg_final` | `assets/lab/lab_bg_level1.png` (не существует) | **missing** | целевой иллюстрированный фон по разделу 12 GDD (fable-art-brief.md) |

## UI icons/panels

| id | source | status | назначение |
|---|---|---|---|
| `ui_panel_cream` | `assets/ui/panel_cream.png` | approved | существующая деревянная панель |
| `hotspot_icon_workbench` / `_showcase` / `_book` / `_microscope` / `_dryer` | procedural: `generateHotspotIcon` | temporary | геометрические dev-иконки 5 зон лаборатории (не эмодзи) |
| `hud_interact_prompt` | procedural: `generateInteractPrompt` | temporary | контекстная подсказка «E / тап — действие» |

## particles/weather

| id | source | status | назначение |
|---|---|---|---|
| `weather_rain` | — | **missing** | вне объёма Этапа B по разделу 18 GDD (Этап C) |

## reveal effects

| id | source | status | назначение |
|---|---|---|---|
| `reveal_backdrop` | procedural: `generateRevealBackdrop` | temporary | полноэкранный фон RevealScene |
| `reveal_pedestal` | procedural: `generateRevealPedestal` | temporary | подставка; сам специмен — существующий `SpecimenThumbnail` (approved) |

## Что не переиспользовано автоматически

`decor_bench.png` и `decor_lantern.png` (approved, уже в арт-паке) размещены
в EstateScene как атмосферный декор сектора — так же, как раньше в
`GardenScene.renderDecor()`, без изменений самих файлов.

## Известные пробелы манифеста (честно, не скрыто)

1. Нет отдельного ассета для дома владельца — временное замещение.
2. Нет иллюстрированного фона лаборатории — код-плейсхолдер вместо него.
3. Нет финального персонажа (4 направления, анимации ходьбы/полива/сбора/переноса) — геометрический токен.
4. Погодная система и частицы — не в объёме вертикального среза.
5. NPC — один переиспользованный маскот на патруле, не полноценный набор из 6-7 NPC (раздел 10 GDD).
6. Люди (Lumi) — только `idle`/`follow` (одна и та же текстура) и свечение реализованы; `move`/`point`/`work` — честно `missing`, ждут отдельного арт-прохода (см. docs/ESTATE_LAYOUT_BLUEPRINT.md).
7. 6 из 9 building slots (`building_greenhouse`, `building_compost`, `building_seed_nursery`, `building_apiary`, `building_exhibition_pavilion`, `building_genesis_conservatory`) и 2 из 3 landmark slots (`landmark_pond`, `landmark_exhibition`) существуют только как reserved-данные в `estateBlueprint.ts` — не отрисованы, их зоны ещё закрыты.
