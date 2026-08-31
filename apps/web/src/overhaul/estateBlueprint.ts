// ============================================================================
// Estate Layout Blueprint — расширяемая структура поместья (Этап "Estate
// Architecture" стадии Visual Overhaul, см. docs/ESTATE_LAYOUT_BLUEPRINT.md
// для читаемой версии этого же плана). Чистые данные, без Phaser — единый
// источник правды для: (1) зон поместья, (2) building slots, (3) landmark
// slots — все со стабильными ID, чтобы EstateScene и будущие сцены НИКОГДА
// не хардкодили расположение зданий прямо в рендере, а брали их отсюда.
//
// Полный логический мир — 48×48 тайлов (см. FULL_WORLD_*). В вертикальном
// срезе Stage 1 отрисовывается и проходима только ОДНА зона —
// 'zone_starting_garden' (см. worldConfig.ts, который строит фактический
// Stage-1 сектор из слотов этой зоны). Остальные три зоны существуют только
// как данные: их building/landmark slots имеют status='reserved' и НЕ
// рендерятся как игровые объекты — так и должно быть, пока эти зоны не
// открыты (нельзя показывать всё поместье одновременно на одном экране).
// ============================================================================

export const TILE = 32;
export const FULL_WORLD_COLS = 48;
export const FULL_WORLD_ROWS = 48;
export const FULL_WORLD_WIDTH = FULL_WORLD_COLS * TILE; // 1536
export const FULL_WORLD_HEIGHT = FULL_WORLD_ROWS * TILE; // 1536

export type ZoneStatus = 'open' | 'locked';
export type SlotStatus = 'active' | 'reserved';

export interface TileRect {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

export interface EstateZone {
  id: string;
  nameRu: string;
  descriptionRu: string;
  tileRect: TileRect;
  status: ZoneStatus;
}

export interface BuildingSlot {
  id: string;
  zoneId: string;
  nameRu: string;
  /** Позиция в тайлах полного 48×48 мира (anchor: низ-центр footprint'а). */
  tile: { col: number; row: number };
  status: SlotStatus;
}

export interface LandmarkSlot {
  id: string;
  zoneId: string;
  nameRu: string;
  tile: { col: number; row: number };
  status: SlotStatus;
  note: string;
}

// ---- Зоны -------------------------------------------------------------------
// Прямоугольники не перекрываются (см. estateBlueprint.test.ts) и намеренно
// не покрывают весь 48×48 мир целиком — оставшийся "буфер" между зонами
// читается как неисследованная территория поместья, а не баг раскладки.

export const ZONE_STARTING_GARDEN: EstateZone = {
  id: 'zone_starting_garden',
  nameRu: 'Начальный сад',
  descriptionRu:
    'Дом, 4–6 грядок, лаборатория, небольшой склад, точка появления игрока, станция помощника Люми.',
  tileRect: { col: 15, row: 16, cols: 18, rows: 16 },
  status: 'open',
};

export const ZONE_WORKING_FARM: EstateZone = {
  id: 'zone_working_farm',
  nameRu: 'Рабочая ферма',
  descriptionRu: 'Теплица, компостная мастерская, питомник и хранилище семян, дополнительные грядки.',
  tileRect: { col: 15, row: 0, cols: 18, rows: 16 },
  status: 'locked',
};

export const ZONE_BOTANICAL_ESTATE: EstateZone = {
  id: 'zone_botanical_estate',
  nameRu: 'Пруд и сад опылителей',
  descriptionRu: 'Большой пруд, пасека, цветочный сад и три водных habitat-места; без обычных грядок.',
  tileRect: { col: 33, row: 16, cols: 15, rows: 16 },
  status: 'locked',
};

export const ZONE_EXHIBITION_COURTYARD: EstateZone = {
  id: 'zone_exhibition_courtyard',
  nameRu: 'Выставочный и социальный двор',
  descriptionRu: 'Выставочный павильон, витрины растений и родословных, гостевые ворота.',
  tileRect: { col: 0, row: 16, cols: 15, rows: 16 },
  status: 'locked',
};

export const ZONE_LATE_TERRITORY: EstateZone = {
  id: 'zone_late_territory',
  nameRu: 'Поздняя территория',
  descriptionRu: 'Ночной сад, большая Genesis Conservatory, сезонная исследовательская зона.',
  tileRect: { col: 15, row: 32, cols: 18, rows: 16 },
  status: 'locked',
};

export const ESTATE_ZONES: EstateZone[] = [
  ZONE_STARTING_GARDEN,
  ZONE_WORKING_FARM,
  ZONE_BOTANICAL_ESTATE,
  ZONE_EXHIBITION_COURTYARD,
  ZONE_LATE_TERRITORY,
];

export function zoneById(id: string): EstateZone | undefined {
  return ESTATE_ZONES.find((z) => z.id === id);
}

// ---- Building slots (минимум 9 по ТЗ) ---------------------------------------
// Координаты reserved-слотов — ориентировочная точка внутри зоны для
// планирования, НЕ финальная расстановка конкретной будущей зоны (см. note в
// docs/ESTATE_LAYOUT_BLUEPRINT.md — точная компоновка каждой зоны спроектируется
// отдельно, когда до неё дойдёт очередь).

export const BUILDING_SLOTS: BuildingSlot[] = [
  { id: 'building_house', zoneId: 'zone_starting_garden', nameRu: 'Дом', tile: { col: 19, row: 23 }, status: 'active' },
  {
    id: 'building_laboratory',
    zoneId: 'zone_starting_garden',
    nameRu: 'Лаборатория',
    tile: { col: 31, row: 28 },
    status: 'active',
  },
  {
    id: 'building_storage',
    zoneId: 'zone_starting_garden',
    nameRu: 'Небольшой склад',
    tile: { col: 19, row: 29 },
    status: 'active',
  },
  {
    id: 'building_greenhouse',
    zoneId: 'zone_working_farm',
    nameRu: 'Теплица',
    tile: { col: 20, row: 7 },
    status: 'reserved',
  },
  {
    id: 'building_compost',
    zoneId: 'zone_working_farm',
    nameRu: 'Компостная мастерская',
    tile: { col: 28, row: 8 },
    status: 'reserved',
  },
  {
    id: 'building_seed_nursery',
    zoneId: 'zone_working_farm',
    nameRu: 'Питомник и хранилище семян',
    tile: { col: 22, row: 13 },
    status: 'reserved',
  },
  {
    id: 'building_apiary',
    zoneId: 'zone_botanical_estate',
    nameRu: 'Пасека / опылительный сад',
    tile: { col: 42, row: 22 },
    status: 'reserved',
  },
  {
    id: 'building_exhibition_pavilion',
    zoneId: 'zone_exhibition_courtyard',
    nameRu: 'Выставочный павильон',
    tile: { col: 7, row: 24 },
    status: 'reserved',
  },
  {
    id: 'building_genesis_conservatory',
    zoneId: 'zone_late_territory',
    nameRu: 'Genesis Conservatory',
    tile: { col: 24, row: 42 },
    status: 'reserved',
  },
  // Станция Люми — не входит в минимальный список 9 building ID из ТЗ (у неё
  // отдельные companion_lumi_* asset id, см. assetManifest.ts), но ей тоже
  // нужен стабильный slot ID и место в мире, поэтому она здесь же.
  {
    id: 'building_lumi_station',
    zoneId: 'zone_starting_garden',
    nameRu: 'Станция помощника Люми',
    tile: { col: 25, row: 19 },
    status: 'active',
  },
];

export function buildingSlotById(id: string): BuildingSlot | undefined {
  return BUILDING_SLOTS.find((b) => b.id === id);
}

export function buildingSlotsForZone(zoneId: string): BuildingSlot[] {
  return BUILDING_SLOTS.filter((b) => b.zoneId === zoneId);
}

// ---- Landmark slots (минимум 3 по ТЗ) ---------------------------------------
// Зарезервированные площадки под будущие крупные декоративные объекты/
// монументы. Конкретные монументы сейчас НЕ придумываются и не реализуются —
// только координаты + стабильный ID, чтобы место было исторически зарезервировано
// и не потребовало передвигать соседние постройки, когда монумент появится.

export const LANDMARK_SLOTS: LandmarkSlot[] = [
  {
    id: 'landmark_central',
    zoneId: 'zone_starting_garden',
    nameRu: 'Центральный монумент',
    tile: { col: 24, row: 21 },
    status: 'reserved',
    note: 'Геометрический центр всего 48×48 мира — рядом со стартовым садом. Зарезервировано под главный будущий монумент поместья.',
  },
  {
    id: 'landmark_pond',
    zoneId: 'zone_botanical_estate',
    nameRu: 'Большой пруд / влажная зона',
    tile: { col: 38, row: 23 },
    status: 'reserved',
    note: 'Крупный водный ландшафтный объект Ботанического поместья — не путать с маленьким декоративным прудом стартового сада (тот отдельный, см. worldConfig.POND).',
  },
  {
    id: 'landmark_exhibition',
    zoneId: 'zone_exhibition_courtyard',
    nameRu: 'Выставочный двор',
    tile: { col: 11, row: 25 },
    status: 'reserved',
    note: 'Площадка под будущие выставки/социальные события — рядом с building_exhibition_pavilion.',
  },
];

export function landmarkSlotById(id: string): LandmarkSlot | undefined {
  return LANDMARK_SLOTS.find((l) => l.id === id);
}

// Минимальные stable ID из ТЗ — используются в тестах, чтобы гарантировать,
// что ни один обязательный ID не потерялся при будущих правках блюпринта.
export const REQUIRED_BUILDING_IDS = [
  'building_house',
  'building_laboratory',
  'building_storage',
  'building_greenhouse',
  'building_compost',
  'building_seed_nursery',
  'building_apiary',
  'building_exhibition_pavilion',
  'building_genesis_conservatory',
] as const;

export const REQUIRED_LANDMARK_IDS = ['landmark_central', 'landmark_pond', 'landmark_exhibition'] as const;
