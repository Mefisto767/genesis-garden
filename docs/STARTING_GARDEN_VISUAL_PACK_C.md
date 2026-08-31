# Genesis Garden — Starting Garden Visual Pack C

Статус: visual-only handoff для интеграции Клодом. Этот пакет не меняет
механику, layout, world coordinates или progression.

## Style source of truth

- `docs/reference/starting_garden_style_target_v1.png` — единственный эталон
  материалов, света, палитры и визуальной иерархии.
- `docs/reference/starting_garden_object_scale_proof.png` — проверка объектов
  рядом с домом, лабораторией и грядкой в реальном игровом масштабе.
- Полный style target запрещено использовать как background-карту.

## Принятые visual candidates

| Runtime role | Candidate | Canvas |
|---|---|---:|
| основная трава | `material_candidates/terrain_grass_base_01.png` | 32×32 |
| редкая вариация травы | `material_candidates/terrain_grass_base_02.png` | 32×32 |
| земля дорожки | `material_candidates/path_earth_base_01.png` | 32×32 |
| вода, кадр A | `material_candidates/water_base_01.png` | 32×32 |
| вода, кадр B | `material_candidates/water_base_02.png` | 32×32 |
| центральный монумент | `runtime_candidates/landmark_monument.png` | 64×64 |
| разрушенный проход | `runtime_candidates/boundary_ruined_passage.png` | 96×80 |
| органическая изгородь | `runtime_candidates/boundary_hedge.png` | 64×64 |

Все пути выше относительны
`apps/web/art_source/v1/starting_garden/`.

## Что было отбраковано

- кислотная шумная трава после point-downscale;
- зеркальная 32×32 изгородь, создававшая новый симметричный повтор;
- шахматный/чёрный фон, нарисованный внутрь исходных PNG;
- полноэкранная картинка вместо отдельных ассетов.

Отбракованные варианты не являются частью handoff.

## Граница ответственности

Клод выполняет только визуальное подключение через существующие asset ID.
Запрещено менять:

- `estateBlueprint.ts`, `estateProgression.ts`, unlock requirements;
- `worldConfig.ts`, координаты, footprints, collision rectangles;
- камеру, количество и pitch грядок;
- GameStore, RNG, генетику, экономику, lifecycle и `SAVE_VERSION`;
- направления Crossroads Estate и состав будущих расширений.

Допустимо:

- скопировать принятые PNG в `public/assets/v1/`;
- заменить file source существующего visual asset ID в manifest;
- заменить procedural visual generator на file source без изменения размера,
  anchor, interaction или collision contract;
- добавить проверки canvas/alpha/manifest и screenshot-only E2E.

## Mapping для интеграции

| Existing visual ID | Candidate |
|---|---|
| `tile_grass_v1` | `terrain_grass_base_01.png` |
| `tile_grass_v1_alt` | `terrain_grass_base_02.png` |
| `tile_path_earth_v1` | `path_earth_base_01.png` |
| `tile_water_v1` | `water_base_01.png` |
| `tile_water_v1_alt` | `water_base_02.png` |
| `landmark_clearing` | `landmark_monument.png` |
| `prop_ruined_passage` | `boundary_ruined_passage.png` |

`boundary_hedge.png` нельзя превращать в один повторяющийся full-screen tile.
Использовать только как отдельные 64×64 boundary sprites с
детерминированными вариантами поворота/смещения, если это не меняет collision
contract. Иначе оставить вне runtime до отдельного visual wiring pass.

## Screenshot acceptance

После интеграции обязательны реальные кадры Overhaul + Genetics V2:

1. 1440×900 — пустой стартовый сад;
2. 1440×900 — растущий скрытый гибрид;
3. 960×540 — reference viewport;
4. 360×800 — mobile;
5. увеличенные crop дорожки, воды, границы и монумента.

Пакет принимается только если нет checkerboard, круговой цепочки дорожки,
лепесткового пруда, повторяющегося «глаза» изгороди и конфликтов масштаба.
