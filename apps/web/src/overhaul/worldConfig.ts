// ============================================================================
// Stage-1 сектор поместья: то, что EstateScene реально рисует и делает
// проходимым сегодня. Данные ЭТОГО файла — конкретная застройка одной
// открытой зоны (`zone_starting_garden`) из estateBlueprint.ts; расположение
// каждого здания здесь ссылается на BUILDING_SLOTS оттуда по стабильному ID,
// а не придумывается заново — так и планировалось техпромтом ("не хардкодь
// расположение будущих зданий непосредственно внутри рендера").
//
// Полный логический мир — 48×48 тайлов (FULL_WORLD_*, см. estateBlueprint.ts).
// Отрисовывается и проходим только прямоугольник CAMERA_BOUNDS (стартовый
// сектор + узкое кольцо зарослей/разрушенных проходов по периметру) — камера
// никогда не пытается показать весь 48×48 мир одновременно, а игрок физически
// не может выйти за пределы этого кольца (см. BOUNDARY_BANDS в collisionRects()).
// ============================================================================

import type { Rect, Point } from './movement';
import {
  FULL_WORLD_HEIGHT,
  FULL_WORLD_WIDTH,
  LANDMARK_SLOTS,
  TILE,
  ZONE_STARTING_GARDEN,
  buildingSlotById,
} from './estateBlueprint';

export { FULL_WORLD_WIDTH, FULL_WORLD_HEIGHT, TILE };

export type TerrainKind = 'grass' | 'path' | 'water' | 'thicket';

export interface WorldBuilding {
  id: string;
  assetId: string;
  x: number;
  y: number; // anchor: bottom-center
  displayWidth: number;
  displayHeight: number;
  interactive: boolean;
  /** Радиус (px), в пределах которого персонаж считается "рядом" для подсказки/входа. */
  interactionRadius: number;
  label: string;
}

export interface WorldDecor {
  id: string;
  assetId: string;
  x: number;
  y: number;
  displayWidth: number;
  displayHeight: number;
}

export interface WorldPlotSlot {
  plotId: number;
  x: number;
  y: number;
  size: number;
}

export interface NpcPatrol {
  id: string;
  assetId: string;
  from: Point;
  to: Point;
  speed: number; // px/s
  displayWidth: number;
  displayHeight: number;
}

/** Точка перехода на границе открытого сектора — честная "заглушка будущей
 * зоны": видна, интерактивна (тост "скоро"/направление), но непроходима —
 * реального открытия новых секторов на этом этапе нет (см. ограничения). */
export interface BoundaryTransition {
  id: string;
  assetId: string;
  x: number;
  y: number;
  displayWidth: number;
  displayHeight: number;
  interactionRadius: number;
  label: string;
  towardZoneId: string | null;
}

/** Прямоугольник "подошвы" строения — то, во что персонаж реально упирается.
 * Верхняя часть спрайта (крыша) визуально перекрывает персонажа по Y-sort,
 * но не блокирует движение — иначе застревание выглядело бы неестественно. */
export function buildingFootprint(x: number, y: number, w: number, h: number): Rect {
  const footprintWidthRatio = 0.62;
  const footprintHeightRatio = 0.34;
  const fw = w * footprintWidthRatio;
  const fh = h * footprintHeightRatio;
  return { x: x - fw / 2, y: y - fh, w: fw, h: fh };
}

// ---- Открытый сектор (пиксельные координаты в полном 48×48 мире) -----------
// zone_starting_garden.tileRect = {col:15,row:16,cols:18,rows:16} —
// см. estateBlueprint.ts. Переводим в пиксели одним местом, чтобы вся
// остальная раскладка сектора была уже в мировых px-координатах, как раньше.

const SECTOR_TILE = ZONE_STARTING_GARDEN.tileRect;
export const SECTOR: Rect = {
  x: SECTOR_TILE.col * TILE,
  y: SECTOR_TILE.row * TILE,
  w: SECTOR_TILE.cols * TILE,
  h: SECTOR_TILE.rows * TILE,
};

/** Кольцо зарослей вокруг сектора — сколько px камера видит "за краем", не
 * позволяя игроку туда попасть (см. collisionRects()). 2 тайла. */
const BOUNDARY_MARGIN = TILE * 2;

/** Область, которую EstateScene реально рендерит и в пределах которой ходит
 * камера. Меньше полного 48×48 мира — то, что и требуется ("камера не
 * пытается уместить весь мир в экран"). */
export const CAMERA_BOUNDS: Rect = {
  x: SECTOR.x - BOUNDARY_MARGIN,
  y: SECTOR.y - BOUNDARY_MARGIN,
  w: SECTOR.w + BOUNDARY_MARGIN * 2,
  h: SECTOR.h + BOUNDARY_MARGIN * 2,
};

// Тайловая сетка рендера — только CAMERA_BOUNDS, не все 48×48.
export const RENDER_COL_START = Math.floor(CAMERA_BOUNDS.x / TILE);
export const RENDER_ROW_START = Math.floor(CAMERA_BOUNDS.y / TILE);
export const RENDER_COLS = Math.ceil(CAMERA_BOUNDS.w / TILE);
export const RENDER_ROWS = Math.ceil(CAMERA_BOUNDS.h / TILE);

// Обратная совместимость по именам для остального кода/тестов, которые уже
// привыкли к WORLD_WIDTH/HEIGHT — теперь это размер отрисовываемой области
// (CAMERA_BOUNDS), а не всего 48×48 мира (см. FULL_WORLD_WIDTH/HEIGHT выше
// для полного логического размера).
export const WORLD_WIDTH = CAMERA_BOUNDS.w;
export const WORLD_HEIGHT = CAMERA_BOUNDS.h;
export const WORLD_COLS = RENDER_COLS;
export const WORLD_ROWS = RENDER_ROWS;

function tileToPx(col: number, row: number): Point {
  return { x: col * TILE, y: row * TILE };
}

const houseSlot = buildingSlotById('building_house')!;
const labSlot = buildingSlotById('building_laboratory')!;
const storageSlot = buildingSlotById('building_storage')!;
const lumiStationSlot = buildingSlotById('building_lumi_station')!;

export const PLAYER_SPAWN: Point = { x: 780, y: 852 };

export const HOUSE: WorldBuilding = {
  id: houseSlot.id,
  assetId: 'building_house',
  ...tileToPx(houseSlot.tile.col, houseSlot.tile.row),
  displayWidth: 150,
  displayHeight: 150,
  interactive: false,
  interactionRadius: 0,
  label: 'Дом',
};

export const LAB_BUILDING: WorldBuilding = {
  id: labSlot.id,
  assetId: 'building_lab',
  ...tileToPx(labSlot.tile.col, labSlot.tile.row),
  displayWidth: 150,
  displayHeight: 150,
  interactive: true,
  interactionRadius: 100,
  label: 'Лаборатория',
};

export const STORAGE_BUILDING: WorldBuilding = {
  id: storageSlot.id,
  assetId: 'building_storage_shed',
  ...tileToPx(storageSlot.tile.col, storageSlot.tile.row),
  displayWidth: 70,
  displayHeight: 70,
  interactive: false,
  interactionRadius: 0,
  label: 'Склад (скоро)',
};

export const BUILDINGS: WorldBuilding[] = [HOUSE, LAB_BUILDING, STORAGE_BUILDING];

export const LUMI_STATION_POS: Point = tileToPx(lumiStationSlot.tile.col, lumiStationSlot.tile.row);

export const POND: Rect = { x: 740, y: 912, w: 100, h: 70 };

export const DECOR: WorldDecor[] = [
  { id: 'bench', assetId: 'decor_bench', x: 852, y: 660, displayWidth: 64, displayHeight: 42 },
  { id: 'lantern_path', assetId: 'decor_lantern', x: 700, y: 780, displayWidth: 36, displayHeight: 54 },
  { id: 'lantern_lab', assetId: 'decor_lantern', x: 1012, y: 780, displayWidth: 36, displayHeight: 54 },
];

// Зарезервированная площадка landmark_central (см. estateBlueprint.ts) —
// координаты в px, для отрисовки нейтральной "расчищенной поляны" (не
// монумента — конкретный монумент этим этапом не придумывается).
const centralLandmark = LANDMARK_SLOTS.find((l) => l.id === 'landmark_central')!;
export const LANDMARK_CENTRAL_POS: Point = tileToPx(centralLandmark.tile.col, centralLandmark.tile.row);

// 6 стартовых грядок (GARDEN_CONFIG.startUnlockedPlots) как мировые сущности —
// id 0..5 напрямую соответствуют gameStore.getState().plots[0..5]. Visual V1:
// отдельные 64px footprints стоят с pitch 96px (полный 32px тайл между
// грядками), чтобы высокое растение однозначно относилось к одной ячейке.
export const PLOT_SLOTS: WorldPlotSlot[] = [
  { plotId: 0, x: 704, y: 720, size: 64 },
  { plotId: 1, x: 800, y: 720, size: 64 },
  { plotId: 2, x: 896, y: 720, size: 64 },
  { plotId: 3, x: 704, y: 816, size: 64 },
  { plotId: 4, x: 800, y: 816, size: 64 },
  { plotId: 5, x: 896, y: 816, size: 64 },
];

export const NPC_PATROL: NpcPatrol = {
  id: 'mascot',
  assetId: 'npc_mascot_patrol',
  from: { x: 760, y: 660 },
  to: { x: 900, y: 660 },
  speed: 24,
  displayWidth: 40,
  displayHeight: 48,
};

/** Простая ломаная дорожки — используется и для отрисовки tile_path, и просто
 * как визуальный ориентир; коллизий не создаёт (дорожка не мешает ходить). */
export const PATH_POLYLINE: Point[] = [
  { x: 610, y: 790 },
  { x: 700, y: 790 },
  { x: 780, y: 852 },
  { x: 780, y: 770 },
  { x: 852, y: 770 },
  { x: 924, y: 770 },
  { x: 980, y: 800 },
];

// ---- Граница открытого сектора: заросли/ворота/разрушенные проходы ---------
// 4 точки перехода по периметру сектора — честная "заглушка будущего": видны,
// подписаны (куда ведут), реагируют на E/клик тостом "скоро", но не пускают
// дальше. Две используют текстуру "ворота" (fence_gate), две — "разрушенный
// проход" (prop_ruined_passage), см. Task4 ("ворота ИЛИ разрушенные проходы").
export const BOUNDARY_TRANSITIONS: BoundaryTransition[] = [
  {
    id: 'transition_north',
    assetId: 'prop_ruined_passage',
    x: SECTOR.x + SECTOR.w / 2,
    y: SECTOR.y,
    displayWidth: 90,
    displayHeight: 70,
    interactionRadius: 90,
    label: 'К северу — скоро',
    towardZoneId: null,
  },
  {
    id: 'transition_east',
    assetId: 'fence_gate',
    x: SECTOR.x + SECTOR.w,
    y: SECTOR.y + SECTOR.h / 2,
    displayWidth: 96,
    displayHeight: 64,
    interactionRadius: 90,
    label: 'На восток — скоро',
    towardZoneId: 'zone_working_farm',
  },
  {
    id: 'transition_south',
    assetId: 'fence_gate',
    x: SECTOR.x + SECTOR.w / 2,
    y: SECTOR.y + SECTOR.h,
    displayWidth: 96,
    displayHeight: 64,
    interactionRadius: 90,
    label: 'На юг — скоро',
    towardZoneId: 'zone_botanical_estate',
  },
  {
    id: 'transition_west',
    assetId: 'prop_ruined_passage',
    x: SECTOR.x,
    y: SECTOR.y + SECTOR.h / 2,
    displayWidth: 90,
    displayHeight: 70,
    interactionRadius: 90,
    label: 'На запад — скоро',
    towardZoneId: 'zone_late_territory',
  },
];

/** Все непроходимые прямоугольники сектора: здания + пруд + сплошное кольцо
 * зарослей по периметру CAMERA_BOUNDS (4 полосы) — обеспечивает, что
 * закрытые направления физически недоступны игроку, а не просто "выглядят
 * закрытыми". */
export function collisionRects(): Rect[] {
  const buildingRects = BUILDINGS.map((b) => buildingFootprint(b.x, b.y, b.displayWidth, b.displayHeight));
  const bands: Rect[] = [
    // север
    { x: CAMERA_BOUNDS.x, y: CAMERA_BOUNDS.y, w: CAMERA_BOUNDS.w, h: BOUNDARY_MARGIN },
    // юг
    { x: CAMERA_BOUNDS.x, y: SECTOR.y + SECTOR.h, w: CAMERA_BOUNDS.w, h: BOUNDARY_MARGIN },
    // запад
    { x: CAMERA_BOUNDS.x, y: SECTOR.y, w: BOUNDARY_MARGIN, h: SECTOR.h },
    // восток
    { x: SECTOR.x + SECTOR.w, y: SECTOR.y, w: BOUNDARY_MARGIN, h: SECTOR.h },
  ];
  return [...buildingRects, POND, ...bands];
}

/** Тайлы дорожки — прямоугольники TILE×TILE вдоль PATH_POLYLINE, для рендера
 * логически-тайловой дорожки поверх травяного фона (см. EstateScene). */
export function pathTileCenters(): Point[] {
  const seen = new Set<string>();
  const centers: Point[] = [];
  for (let i = 0; i < PATH_POLYLINE.length - 1; i++) {
    const a = PATH_POLYLINE[i];
    const b = PATH_POLYLINE[i + 1];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(dist / (TILE * 0.6)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      const col = Math.floor(px / TILE);
      const row = Math.floor(py / TILE);
      const key = `${col},${row}`;
      if (seen.has(key)) continue;
      seen.add(key);
      centers.push({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });
    }
  }
  return centers;
}

export function pathTileKeySet(): Set<string> {
  return new Set(pathTileCenters().map((p) => `${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)}`));
}

/** true, если тайл (col,row) лежит внутри открытого стартового сектора. */
export function isInsideOpenSector(col: number, row: number): boolean {
  const cx = col * TILE + TILE / 2;
  const cy = row * TILE + TILE / 2;
  return cx >= SECTOR.x && cx <= SECTOR.x + SECTOR.w && cy >= SECTOR.y && cy <= SECTOR.y + SECTOR.h;
}

export function terrainAt(col: number, row: number, pathTiles: Set<string>): TerrainKind {
  if (!isInsideOpenSector(col, row)) return 'thicket';
  const cx = col * TILE + TILE / 2;
  const cy = row * TILE + TILE / 2;
  if (cx >= POND.x && cx <= POND.x + POND.w && cy >= POND.y && cy <= POND.y + POND.h) return 'water';
  if (pathTiles.has(`${col},${row}`)) return 'path';
  return 'grass';
}
