// ============================================================================
// Typed V1 asset manifest — производственный контракт ассетов Visual V1
// (docs/VISUAL_ASSET_CONTRACT.md §5/§9). Отдельный от legacy assetManifest.ts:
// тот описывает текущий рантайм вертикального среза (включая процедурные
// текстуры), этот — типизированный контракт ФАЙЛОВЫХ ассетов с полной
// метадатой (sourceSize/displaySize/anchor/footprint/interactionPoint/
// depthOffset) и честными статусами:
//
//   'placeholder' — существующее изображение временно занимает слот; НЕ
//                   прошло V1 validation и не объявляется production-артом.
//                   ВСЕ текущие изображения v0.2/v0.3-паков — placeholder.
//   'approved'    — прошло полный V1 pipeline и принято владельцем.
//                   На момент создания манифеста таких ассетов НЕ было —
//                   production-арт ещё не начинался. Первые три approved
//                   записи появились с Art Vertical Slice A (см.
//                   docs/ART_VERTICAL_SLICE_A.md): plot_empty,
//                   plant_hybrid_unrevealed, plant_sunflower_mature.
//   'missing'     — файла не существует вообще; целевой слот будущего арта.
//
// Сцены ПОКА продолжают использовать legacy assetManifest.ts — переключение
// на этот манифест произойдёт вместе с первым production-арт-паком (иначе
// пришлось бы притвориться, что арт уже существует). Валидация — чистый
// validateAssetManifestV1() (assetValidatorV1.ts) + assetManifestV1.test.ts,
// который сверяет фактические PNG на диске с заявленными sourceSize.
//
// footprint / interactionPoint — в px ОТНОСИТЕЛЬНО anchor-точки
// (docs/VISUAL_ASSET_CONTRACT.md §5). anchor — доли [0..1] от левого
// верхнего угла. sourceSize — фактический canvas PNG-файла.
// ============================================================================

export type AssetStatusV1 = 'placeholder' | 'approved' | 'missing';

export interface AssetMetadataV1 {
  /** Стабильный ID слота (lowercase snake case, см. контракт §4). */
  id: string;
  /** Путь файла относительно apps/web/public/ (для status 'missing' — целевой путь). */
  file: string;
  /** Фактический canvas исходного PNG [w, h]; для 'missing' — целевой canvas. */
  sourceSize: [number, number];
  /** Display box в мировых px [w, h]. */
  displaySize: [number, number];
  /** Anchor в долях [0..1] от левого верхнего угла. */
  anchor: [number, number];
  /** Коллизионная «подошва» [x, y, w, h] в px от anchor-точки; null — без коллизии. */
  footprint: [number, number, number, number] | null;
  /** Точка взаимодействия [x, y] в px от anchor-точки; null — не интерактивен. */
  interactionPoint: [number, number] | null;
  /** Смещение depth относительно world-y (Y-sort), обычно 0. */
  depthOffset: number;
  status: AssetStatusV1;
  /** required-ассет обязан существовать: status 'missing' для него — ошибка валидации. */
  required: boolean;
  /** Слои одного набора растения (одинаковый canvas и anchor — валидируется). */
  plantSet?: string;
  note?: string;
}

const PLANT_LAYERS = ['line', 'mask_leaf', 'mask_primary', 'mask_secondary'] as const;

/** Послойные наборы растений видов 1–2 (V1 production package C), стадии 1–3.
 * Все текущие файлы — 512×512, единый canvas и anchor внутри набора. */
function plantLayerEntries(species: 'species01' | 'species02'): AssetMetadataV1[] {
  const entries: AssetMetadataV1[] = [];
  for (const stage of [1, 2, 3] as const) {
    for (const layer of PLANT_LAYERS) {
      entries.push({
        id: `plant_${species}_stage${stage}_${layer}`,
        file: `assets/plants/plant_${species}_stage${stage}_${layer}.png`,
        sourceSize: [512, 512],
        displaySize: [64, 64],
        anchor: [0.5, 0.5],
        footprint: null,
        interactionPoint: null,
        depthOffset: 0,
        status: 'placeholder',
        required: true,
        plantSet: `plant_${species}_stage${stage}`,
      });
    }
  }
  return entries;
}

export const ASSET_MANIFEST_V1: AssetMetadataV1[] = [
  // ---- terrain / plot bases ------------------------------------------------
  {
    id: 'tile_soil',
    file: 'assets/tiles/tile_soil.png',
    sourceSize: [512, 512],
    displaySize: [64, 64],
    anchor: [0.5, 0.5],
    footprint: null,
    interactionPoint: [0, 0],
    depthOffset: 0,
    status: 'placeholder',
    required: true,
    note: 'Открытая грядка (v0.3-pixel пак). Плейсхолдер до V1 validation семейства plot base.',
  },
  {
    id: 'tile_soil_locked',
    file: 'assets/tiles/tile_soil_locked.png',
    sourceSize: [512, 512],
    displaySize: [64, 64],
    anchor: [0.5, 0.5],
    footprint: null,
    interactionPoint: [0, 0],
    depthOffset: 0,
    status: 'placeholder',
    required: true,
  },

  // ---- buildings -----------------------------------------------------------
  {
    id: 'building_house',
    file: 'assets/v1/buildings/building_house.png',
    sourceSize: [128, 128],
    displaySize: [128, 128],
    anchor: [0.5, 1],
    footprint: [-40, -44, 80, 44],
    interactionPoint: null,
    depthOffset: 0,
    status: 'placeholder',
    required: true,
    note: 'Gate 2 runtime art-test. Отдельный дом прошёл scale validation, но остаётся placeholder до screenshot approval.',
  },
  {
    id: 'building_lab',
    file: 'assets/v1/buildings/building_laboratory.png',
    sourceSize: [128, 128],
    displaySize: [128, 128],
    anchor: [0.5, 1],
    footprint: [-40, -44, 80, 44],
    interactionPoint: [0, -16],
    depthOffset: 0,
    status: 'placeholder',
    required: true,
    note: 'Gate 2 упрощённый runtime candidate. Механика входа и footprint не менялись.',
  },
  {
    id: 'building_storage_shed',
    file: 'assets/v1/buildings/building_storage.png',
    sourceSize: [70, 70],
    displaySize: [70, 70],
    anchor: [0.5, 0.92],
    footprint: [-22, -24, 44, 24],
    interactionPoint: null,
    depthOffset: 0,
    status: 'placeholder',
    required: true,
    note: 'Gate 2 runtime candidate; отдельный силуэт склада.',
  },
  {
    id: 'building_lumi_station',
    file: 'assets/v1/buildings/lumi_station.png',
    sourceSize: [64, 80],
    displaySize: [64, 80],
    anchor: [0.5, 0.92],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'placeholder',
    required: true,
    note: 'Gate 2 runtime candidate; декоративная станция без коллизии.',
  },
  {
    id: 'building_greenhouse',
    file: 'assets/buildings/building_greenhouse.png',
    sourceSize: [512, 512],
    displaySize: [128, 128],
    anchor: [0.5, 1],
    footprint: [-40, -40, 80, 40],
    interactionPoint: null,
    depthOffset: 0,
    status: 'placeholder',
    required: false,
    note: 'Reserved slot зоны «Рабочая ферма» — в Stage 1 не рендерится (зона закрыта).',
  },

  // ---- laboratory ----------------------------------------------------------
  {
    id: 'lab_bg_level1_target',
    file: 'assets/lab/lab_bg_level1.png',
    sourceSize: [960, 540],
    displaySize: [960, 540],
    anchor: [0, 0],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'missing',
    required: false,
    note: 'Целевой authored background лаборатории 960×540 (контракт §2) — не существует.',
  },

  // ---- actors --------------------------------------------------------------
  {
    id: 'npc_mascot_patrol',
    file: 'assets/ui/mascot_neutral.png',
    sourceSize: [256, 256],
    displaySize: [40, 48],
    anchor: [0.5, 0.92],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'placeholder',
    required: true,
    note: 'UI-маскот временно исполняет роль NPC на патруле — не production NPC-набор.',
  },

  // ---- decor ---------------------------------------------------------------
  {
    id: 'decor_bench',
    file: 'assets/decor/decor_bench.png',
    sourceSize: [256, 256],
    displaySize: [64, 42],
    anchor: [0.5, 1],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'placeholder',
    required: true,
  },
  {
    id: 'decor_lantern',
    file: 'assets/decor/decor_lantern.png',
    sourceSize: [256, 256],
    displaySize: [36, 54],
    anchor: [0.5, 1],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'placeholder',
    required: true,
  },

  // ---- UI ------------------------------------------------------------------
  {
    id: 'ui_panel_cream',
    file: 'assets/ui/panel_cream.png',
    sourceSize: [96, 96],
    displaySize: [96, 96],
    anchor: [0.5, 0.5],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'placeholder',
    required: true,
    note: '9-slice панель HUD; текст не запекается (контракт §2 UI).',
  },
  {
    id: 'ui_icon_coin',
    file: 'assets/ui/icon_coin.png',
    sourceSize: [128, 128],
    displaySize: [24, 24],
    anchor: [0.5, 0.5],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'placeholder',
    required: true,
  },

  // ---- plant layer sets (виды 1–2, стадии 1–3) ------------------------------
  ...plantLayerEntries('species01'),
  ...plantLayerEntries('species02'),

  // ---- Art Vertical Slice A (см. docs/ART_VERTICAL_SLICE_A.md) -------------
  // Первые три approved production-ассета манифеста. Runtime-производные
  // (64×64 / 64×96), сгенерированы детерминированно
  // scripts/build-art-vertical-slice-a.py из untouched source-PNG в
  // apps/web/art_source/v1/ (не публикуются, вне public/).
  {
    id: 'plot_empty',
    file: 'assets/tiles/plot_empty.png',
    sourceSize: [64, 64],
    displaySize: [64, 64],
    anchor: [0.5, 0.5],
    footprint: null,
    interactionPoint: [0, 0],
    depthOffset: 0,
    status: 'approved',
    required: true,
    note: 'Art Vertical Slice A — заменяет tile_soil как базовый тайл грядки (EstateScene.addTile).',
  },
  {
    id: 'plant_hybrid_unrevealed',
    file: 'assets/plants/plant_hybrid_unrevealed.png',
    sourceSize: [64, 96],
    displaySize: [64, 96],
    anchor: [0.5, 1],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'approved',
    required: true,
    note: 'Art Vertical Slice A — нейтральный species-neutral спрайт для hybridV2 phase=growing (planted/growing/pending-Reveal), не раскрывает фенотип/редкость.',
  },
  {
    id: 'plant_sunflower_mature',
    file: 'assets/plants/plant_sunflower_mature.png',
    sourceSize: [64, 96],
    displaySize: [64, 96],
    anchor: [0.5, 1],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'approved',
    required: true,
    note: 'Art Vertical Slice A — mature-рендер ТОЛЬКО для speciesId===1 (Солнечник) с primary===primary_coral (#FF8C77); любой другой вид/цвет остаётся на процедурном рендере (см. docs/ART_VERTICAL_SLICE_A.md).',
  },

  // ---- Environment Art Slice B (см. docs/ENVIRONMENT_ART_SLICE_B.md) -------
  // Six approved 32×32 material textures. footprint stays null for all six —
  // terrain collision comes from worldConfig.collisionRects()/POND (world
  // data, unchanged by this slice), not from a per-asset footprint the way
  // actor/building entries use it.
  {
    id: 'tile_grass_v1',
    file: 'assets/terrain/tile_grass_v1.png',
    sourceSize: [32, 32],
    displaySize: [32, 32],
    anchor: [0, 0],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'approved',
    required: true,
    note: 'Environment Art Slice B — base meadow material for the whole open sector.',
  },
  {
    id: 'tile_grass_v1_alt',
    file: 'assets/terrain/tile_grass_v1_alt.png',
    sourceSize: [32, 32],
    displaySize: [32, 32],
    anchor: [0, 0],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'approved',
    required: true,
    note: 'Environment Art Slice B — sparse variation, chosen by a pure (col,row) hash (terrainComposition.grassVariantAlt), never the game RNG.',
  },
  {
    id: 'tile_path_earth_v1',
    file: 'assets/terrain/tile_path_earth_v1.png',
    sourceSize: [32, 32],
    displaySize: [32, 32],
    anchor: [0, 0],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'approved',
    required: true,
    note: 'Environment Art Slice B — material fill for connected path cells; composited into an adjacency-derived organic shape by terrainTextures.ts.',
  },
  {
    id: 'tile_water_v1',
    file: 'assets/terrain/tile_water_v1.png',
    sourceSize: [32, 32],
    displaySize: [32, 32],
    anchor: [0, 0],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'approved',
    required: true,
    note: 'Environment Art Slice B — pond base frame; occupancy/collision still comes from worldConfig.POND, unchanged by this slice.',
  },
  {
    id: 'tile_water_v1_alt',
    file: 'assets/terrain/tile_water_v1_alt.png',
    sourceSize: [32, 32],
    displaySize: [32, 32],
    anchor: [0, 0],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'approved',
    required: true,
    note: 'Environment Art Slice B — restrained shimmer frame; only drawn when terrainComposition.waterAnimatesFor() allows it (never in prefers-reduced-motion).',
  },
  {
    id: 'tile_thicket_v1',
    file: 'assets/terrain/tile_thicket_v1.png',
    sourceSize: [32, 32],
    displaySize: [32, 32],
    anchor: [0, 0],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'approved',
    required: true,
    note: 'Environment Art Slice B — impassable boundary material; occupancy/collision unchanged (worldConfig.collisionRects() boundary bands).',
  },

  // ---- Starting Garden Visual Pack C --------------------------------------
  // Screenshot-gated visual replacements. They remain placeholder until the
  // owner accepts their in-game scale and composition; runtime coordinates,
  // interactions and collision continue to come from worldConfig.
  {
    id: 'landmark_monument',
    file: 'assets/v1/environment/landmark_monument.png',
    sourceSize: [64, 64],
    displaySize: [64, 64],
    anchor: [0.5, 0.5],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'placeholder',
    required: true,
    note: 'Visual replacement for runtime key landmark_clearing; no world-data change.',
  },
  {
    id: 'boundary_ruined_passage',
    file: 'assets/v1/environment/boundary_ruined_passage.png',
    sourceSize: [96, 80],
    displaySize: [90, 70],
    anchor: [0.5, 1],
    footprint: null,
    interactionPoint: [0, 0],
    depthOffset: 0,
    status: 'placeholder',
    required: true,
    note: 'Visual replacement for runtime key prop_ruined_passage; existing interaction/collision contract stays intact.',
  },
  {
    id: 'boundary_hedge_v1',
    file: 'assets/v1/environment/boundary_hedge.png',
    sourceSize: [64, 64],
    displaySize: [32, 32],
    anchor: [0, 0],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'placeholder',
    required: true,
    note: 'Organic foliage source composited into deterministic 32×32 boundary variants; collision remains in worldConfig.',
  },
];

export function assetV1ById(id: string): AssetMetadataV1 | undefined {
  return ASSET_MANIFEST_V1.find((a) => a.id === id);
}
