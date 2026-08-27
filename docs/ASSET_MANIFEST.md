# ASSET_MANIFEST — Visual Overhaul (вертикальный срез)

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

## paths/water/fences

| id | source | status | назначение |
|---|---|---|---|
| `fence_gate` | procedural: `generateGateTexture` | temporary | ворота будущего расширения, подпись «Скоро» |

## buildings

| id | source | status | назначение |
|---|---|---|---|
| `building_house` | `assets/buildings/building_storage.png` (замещение) | temporary | дом владельца — реального ассета дома нет |
| `building_house_final` | `assets/buildings/building_house.png` (не существует) | **missing** | целевой ассет дома |
| `building_lab` | `assets/buildings/building_lab.png` | approved | здание лаборатории на карте |
| `building_greenhouse` | `assets/buildings/building_greenhouse.png` | approved | теплица, видна как декор сектора, не интерактивна в срезе |

## character movement/actions

| id | source | status | назначение |
|---|---|---|---|
| `char_avatar` | procedural: `generateCharacterPlaceholder` | temporary | капсула + треугольник направления, НЕ финальный арт персонажа |

## NPC

| id | source | status | назначение |
|---|---|---|---|
| `npc_mascot_patrol` | `assets/ui/mascot_neutral.png` | temporary | существующий маскот на коротком патрульном маршруте вместо полноценного NPC |

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
