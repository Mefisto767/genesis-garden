# Genesis Garden — Visual Asset Contract V1

Статус: обязательный контракт генерации, очистки и интеграции ассетов.

## 1. Основной принцип

AI используется как concept/variation-инструмент, а не как финальный renderer.
Полный AI-скриншот сада не кладётся в `public/assets` и не становится картой.

Production pipeline:

1. спецификация объекта;
2. один style target;
3. contact sheet вариантов;
4. выбор одного варианта;
5. разбор на слои;
6. ручная pixel-cleanup;
7. техническая валидация;
8. greybox-интеграция;
9. проверка desktop/mobile;
10. массовое производство только принятого семейства.

## 2. Категории

| Категория | Формат | Стратегия |
|---|---|---|
| Terrain | PNG 32×32 | seamless tiles + edge/corner variants |
| Paths | PNG 32×32 | autotile, не цельный фон |
| Water | spritesheet 32×32 | 4–8 кадров + береговые маски |
| Buildings | transparent PNG | отдельный объект, bottom-center anchor |
| Props | transparent PNG | отдельный объект + footprint metadata |
| Player/NPC | spritesheet | фиксированный frame box |
| Plants | layered transparent PNG | общий canvas и маски генов |
| Effects | transparent spritesheet | blend/alpha задаются кодом |
| Laboratory | 960×540 base + overlays | authored scene + hotspots |
| UI | 9-slice PNG, icons, CSS | React, текст не запекается |

## 3. Запрещено

- текст, цифры или иконки в background;
- разная перспектива в одном asset family;
- обрезанная тень;
- цветной фон вместо alpha;
- anti-alias fringe на pixel-art контуре;
- JPEG;
- случайный internal padding;
- объект без определимого масштаба;
- свет, делающий неактивный декор похожим на действие.

## 4. Структура и naming

```text
apps/web/public/assets/v1/
  terrain/
  paths/
  water/
  buildings/
  props/
  characters/
  plants/
  effects/
  laboratory/
  ui/
  metadata/
```

Имена — lowercase snake case:

```text
terrain_grass_base_01.png
path_stone_straight_n.png
building_laboratory_l1.png
plant_species01_stage_bud_line.png
plant_species01_stage_bud_mask_primary.png
effect_aura_radiant_idle.png
lab_l1_background_day.png
lab_l1_hotspot_microscope_hover.png
```

Запрещены `final`, `new`, `fixed2`, даты и названия генеративной модели.

## 5. Размеры и anchors

| Family | Source canvas | Display box | Anchor |
|---|---:|---:|---|
| Terrain/path tile | 32×32 | 32×32 | top-left |
| Plot base | 64×64 | 64×64 | center |
| Plant | 64×96 | до 64×96 | bottom-center at soil point |
| Player | 32×48/frame | 32×48 | bottom-center, y=44–46 |
| Lumi | 32×40/frame | 32×40 | bottom-center |
| Small prop | multiple of 16 | metadata | bottom-center |
| Building | multiple of 32 | metadata | bottom-center |
| Lab background | 960×540 | viewport | top-left |
| UI icon | 24/32/48 | CSS size | center |

World-object metadata:

```json
{
  "id": "building_laboratory_l1",
  "file": "buildings/building_laboratory_l1.png",
  "sourceSize": [224, 192],
  "displaySize": [224, 192],
  "anchor": [0.5, 1.0],
  "footprint": [-80, -48, 160, 48],
  "interactionPoint": [0, -16],
  "depthOffset": 0
}
```

`footprint` и `interactionPoint` задаются относительно anchor.

## 6. Plant kit

Production V1 содержит пять authored stages:

```text
seed
sprout
young
bud
mature
```

`regrowing` сохраняет mature-силуэт и меняет отдельный yield-слой:
`empty -> forming -> ready`.

Для каждой species/stage:

```text
line
mask_stem
mask_leaf
mask_primary
mask_secondary
mask_pattern
neutral_preview
```

Для mature дополнительно: `yield_empty`, `yield_forming`, `yield_ready`,
`shadow`. Mutation/aura подключается отдельно по ID.

Mask contract:

- canvas строго 64×96;
- одинаковый anchor у всех слоёв;
- mask RGB white, alpha только 0/255;
- line не содержит phenotype color;
- neutral preview не выдаёт primary/secondary/pattern/mutation;
- safe margin 2 px;
- тень отдельна и не tint'ится;
- browser composite совпадает с approved reference thumbnail.

## 7. Карточка задания на генерацию

Каждый запрос заполняется по шаблону:

```text
ASSET FAMILY:
PURPOSE IN GAME:
SOURCE CANVAS:
CAMERA / PERSPECTIVE:
ANCHOR:
SILHOUETTE REQUIREMENTS:
MATERIALS:
PALETTE:
ALLOWED DETAIL:
FORBIDDEN DETAIL:
NEIGHBOUR SCALE REFERENCES:
TRANSPARENCY:
OUTPUT CONTACT SHEET:
```

Один запрос создаёт варианты одного объекта в одном масштабе. Нельзя одним
запросом просить карту, здания, растения, UI и лабораторию.

## 8. Cleanup checklist

- силуэт проверен на 100%, 200% и 50%;
- свет сверху-слева;
- единый размер пикселя;
- нет anti-alias fringe и дыр в alpha;
- контролируемая палитра;
- корректный anchor;
- footprint меньше видимой верхней части;
- все plant masks совпадают;
- нет запечённого UI;
- нет узнаваемого копирования референса.

## 9. Интеграция Phaser

```text
terrain (-1000)
path/water edge (-950)
ground decals (-900)
plot base (world y)
plant shadow (world y - 2)
plant layers (world y)
character/building/prop (world y + depthOffset)
world marker (world y + 100)
weather/light overlay (camera-fixed)
React UI
```

Все world-объекты используют bottom-center Y-sort. Видимая крыша или крона
не расширяет collision footprint.

Типизированный V1 manifest (`apps/web/src/overhaul/assetManifestV1.ts`)
использует статусы `placeholder` / `approved` / `missing`:

- `placeholder` — существующее изображение или процедурная текстура,
  временно занимающая слот; НЕ прошло V1 validation и не объявляется
  production-артом;
- `approved` — прошло полный V1 pipeline (§1) и принято владельцем;
- `missing` — файла нет вообще; система честно не показывает
  функциональность или помечает «скоро».

Все текущие изображения по умолчанию — `placeholder`, пока владелец явно
не примет конкретный asset family.

Типизированный manifest валидируется тестом:

- файл существует и PNG имеет ожидаемый размер (фактический canvas файла
  совпадает с `sourceSize`);
- ID уникален;
- anchor находится в `[0,1]`;
- footprint валиден;
- plant layers одного набора имеют одинаковый canvas и anchor;
- required production asset не имеет status `missing`.

Camera/viewport: canvas responsive, камера — cover-подход с допустимым
дробным zoom (см. уточнённый контракт `VISUAL_BIBLE_V1.md` §3); 960×540 —
контрольный desktop viewport, не фиксированный размер canvas.

## 10. UI integration

- UI-текст остаётся DOM-текстом;
- panel frame — 9-slice;
- иконки имеют accessible label;
- hover не является единственным способом узнать время;
- selected plot хранится в UI-state;
- React читает `progress`, `remainingMs`, `ready`, но не рассчитывает рост;
- mobile bottom sheet не даёт horizontal overflow на 360×800.

## 11. Production packages

### A — Visual foundation

Palette/material sheet, scale lineup, grass/path/soil greybox, typed asset
metadata/validator, проверка 960×540, 1280×720 и 360×800.

### B — Starting garden

Шесть 64×64 грядок с pitch 96, дом, лаборатория, склад, станция Люми, пруд,
ворота, заросли, дорожки, player/Lumi и contextual timer/ready marker.

### C — Two-species plant kit

Солнечник и Колокольник, пять стадий, layered phenotype, neutral preview,
repeat-yield layers, шесть mutation effects.

### D — Garden UI

Compact HUD, plot detail, shared inventory/nursery/album skin, responsive и
accessibility pass.

### E — Laboratory L1

960×540 background, пять hotspot overlays, workbench/Reveal, microscope,
Botanical Book, day lighting и restrained ambient loops.

### F — Expansion zones

Только после A–E: Working Farm с 18 грядками, Botanical Estate, Late
Territory. Reserved slots не требуют заранее рисовать финальные здания.

## 12. Gate массовой генерации

До полного batch принимается один micro-vertical slice:

- 1 grass tile и 1 path set;
- 1 plot base;
- 1 player idle frame;
- 1 laboratory exterior;
- 1 mature layered plant;
- 1 neutral unrevealed plant;
- 1 timer popover и 1 ready state;
- desktop и mobile screenshots из реального билда.

Если элементы не выглядят одним продуктом, исправляется style target, а не
генерируются десятки несогласованных файлов.
