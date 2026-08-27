// ============================================================================
// Вертикальный сектор поместья (Этап B стадии Visual Overhaul, см.
// docs/FINAL_VISION.md разделы 4.1 и 20, техпромт "Vertical Overhaul, этап 1").
// Чистые данные + чистые функции — без Phaser — чтобы раскладку и коллизии
// можно было проверить юнит-тестом (worldConfig.test.ts), а EstateScene.ts
// только рендерила то, что здесь посчитано.
//
// Это НЕ полная карта поместья (48×48 из GDD) — один законченный сектор:
// дом, 6 грядок (все стартовые из GARDEN_CONFIG.startUnlockedPlots), дорожка,
// лаборатория, маленький пруд, декор, ворота будущего расширения, один NPC.
// ============================================================================

import type { Rect, Point } from './movement';

export const TILE = 32;
export const WORLD_COLS = 30;
export const WORLD_ROWS = 20;
export const WORLD_WIDTH = WORLD_COLS * TILE; // 960
export const WORLD_HEIGHT = WORLD_ROWS * TILE; // 640

export type TerrainKind = 'grass' | 'path' | 'water';

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

export const PLAYER_SPAWN: Point = { x: 300, y: 300 };

export const HOUSE: WorldBuilding = {
  id: 'house',
  assetId: 'building_house',
  x: 170,
  y: 230,
  displayWidth: 200,
  displayHeight: 200,
  interactive: false,
  interactionRadius: 0,
  label: 'Дом',
};

export const LAB_BUILDING: WorldBuilding = {
  id: 'lab',
  assetId: 'building_lab',
  x: 760,
  y: 260,
  displayWidth: 220,
  displayHeight: 220,
  interactive: true,
  interactionRadius: 100,
  label: 'Лаборатория',
};

export const GREENHOUSE: WorldBuilding = {
  id: 'greenhouse',
  assetId: 'building_greenhouse',
  x: 860,
  y: 500,
  displayWidth: 170,
  displayHeight: 170,
  interactive: false,
  interactionRadius: 0,
  label: 'Теплица (скоро)',
};

export const EXPANSION_GATE: WorldBuilding = {
  id: 'gate',
  assetId: 'fence_gate',
  x: 930,
  y: 340,
  displayWidth: 110,
  displayHeight: 90,
  interactive: true,
  interactionRadius: 80,
  label: 'Будущее расширение',
};

export const BUILDINGS: WorldBuilding[] = [HOUSE, LAB_BUILDING, GREENHOUSE, EXPANSION_GATE];

export const POND: Rect = { x: 500, y: 480, w: 140, h: 90 };

export const DECOR: WorldDecor[] = [
  { id: 'bench', assetId: 'decor_bench', x: 640, y: 560, displayWidth: 70, displayHeight: 46 },
  { id: 'lantern_path', assetId: 'decor_lantern', x: 250, y: 340, displayWidth: 40, displayHeight: 60 },
  { id: 'lantern_lab', assetId: 'decor_lantern', x: 700, y: 330, displayWidth: 40, displayHeight: 60 },
];

// 6 стартовых грядок (GARDEN_CONFIG.startUnlockedPlots) как мировые сущности —
// id 0..5 напрямую соответствуют gameStore.getState().plots[0..5].
export const PLOT_SLOTS: WorldPlotSlot[] = [
  { plotId: 0, x: 330, y: 210, size: 56 },
  { plotId: 1, x: 406, y: 210, size: 56 },
  { plotId: 2, x: 482, y: 210, size: 56 },
  { plotId: 3, x: 330, y: 286, size: 56 },
  { plotId: 4, x: 406, y: 286, size: 56 },
  { plotId: 5, x: 482, y: 286, size: 56 },
];

export const NPC_PATROL: NpcPatrol = {
  id: 'mascot',
  assetId: 'npc_mascot_patrol',
  from: { x: 500, y: 400 },
  to: { x: 630, y: 400 },
  speed: 24,
  displayWidth: 40,
  displayHeight: 48,
};

/** Простая ломаная дорожки — используется и для отрисовки tile_path, и просто
 * как визуальный ориентир; коллизий не создаёт (дорожка не мешает ходить). */
export const PATH_POLYLINE: Point[] = [
  { x: 170, y: 300 },
  { x: 170, y: 250 },
  { x: 400, y: 250 },
  { x: 400, y: 250 },
  { x: 620, y: 260 },
  { x: 760, y: 260 },
  { x: 850, y: 320 },
  { x: 930, y: 340 },
];

/** Все непроходимые прямоугольники сектора (кроме границ мира — те клэмпятся отдельно). */
export function collisionRects(): Rect[] {
  const buildingRects = BUILDINGS.map((b) => buildingFootprint(b.x, b.y, b.displayWidth, b.displayHeight));
  return [...buildingRects, POND];
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

export function terrainAt(col: number, row: number, pathTiles: Set<string>): TerrainKind {
  const cx = col * TILE + TILE / 2;
  const cy = row * TILE + TILE / 2;
  if (cx >= POND.x && cx <= POND.x + POND.w && cy >= POND.y && cy <= POND.y + POND.h) return 'water';
  if (pathTiles.has(`${col},${row}`)) return 'path';
  return 'grass';
}

export function pathTileKeySet(): Set<string> {
  return new Set(pathTileCenters().map((p) => `${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)}`));
}
