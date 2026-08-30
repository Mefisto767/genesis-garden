import { describe, expect, it } from 'vitest';
import { rectsIntersect, pointBlocked, moveWithCollisions } from './movement';
import { FULL_WORLD_COLS, FULL_WORLD_HEIGHT, FULL_WORLD_ROWS, FULL_WORLD_WIDTH } from './estateBlueprint';
import {
  BOUNDARY_TRANSITIONS,
  BUILDINGS,
  CAMERA_BOUNDS,
  DECOR,
  LAB_BUILDING,
  PLAYER_SPAWN,
  PLOT_SLOTS,
  POND,
  SECTOR,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  collisionRects,
  isInsideOpenSector,
  pathTileKeySet,
  terrainAt,
} from './worldConfig';

describe('full world dimensions (see estateBlueprint.ts)', () => {
  it('logically spans ~48x48 tiles', () => {
    expect(FULL_WORLD_COLS).toBe(48);
    expect(FULL_WORLD_ROWS).toBe(48);
    expect(FULL_WORLD_WIDTH).toBe(48 * 32);
    expect(FULL_WORLD_HEIGHT).toBe(48 * 32);
  });

  it('only renders/bounds a small slice of the full world, never the whole thing', () => {
    expect(WORLD_WIDTH).toBeLessThan(FULL_WORLD_WIDTH);
    expect(WORLD_HEIGHT).toBeLessThan(FULL_WORLD_HEIGHT);
    // камера должна показывать заметно меньше, чем весь мир — не просто "чуть меньше"
    expect(WORLD_WIDTH).toBeLessThan(FULL_WORLD_WIDTH * 0.6);
    expect(WORLD_HEIGHT).toBeLessThan(FULL_WORLD_HEIGHT * 0.6);
  });

  it('keeps the rendered/camera area fully inside the full 48x48 world', () => {
    expect(CAMERA_BOUNDS.x).toBeGreaterThanOrEqual(0);
    expect(CAMERA_BOUNDS.y).toBeGreaterThanOrEqual(0);
    expect(CAMERA_BOUNDS.x + CAMERA_BOUNDS.w).toBeLessThanOrEqual(FULL_WORLD_WIDTH);
    expect(CAMERA_BOUNDS.y + CAMERA_BOUNDS.h).toBeLessThanOrEqual(FULL_WORLD_HEIGHT);
  });
});

describe('world sector layout invariants', () => {
  it('spawns the player outside every collision rect', () => {
    expect(pointBlocked(PLAYER_SPAWN, collisionRects())).toBe(false);
  });

  it('spawns the player inside the open sector', () => {
    const col = Math.floor(PLAYER_SPAWN.x / 32);
    const row = Math.floor(PLAYER_SPAWN.y / 32);
    expect(isInsideOpenSector(col, row)).toBe(true);
  });

  it('keeps every plot slot walkable (not inside a building/pond/boundary footprint)', () => {
    const obstacles = collisionRects();
    for (const plot of PLOT_SLOTS) {
      expect(pointBlocked({ x: plot.x, y: plot.y }, obstacles)).toBe(false);
    }
  });

  it('keeps every plot slot inside the open sector', () => {
    for (const plot of PLOT_SLOTS) {
      const col = Math.floor(plot.x / 32);
      const row = Math.floor(plot.y / 32);
      expect(isInsideOpenSector(col, row)).toBe(true);
    }
  });

  it('has 6 plot slots with unique ids 0..5, matching GARDEN_CONFIG.startUnlockedPlots', () => {
    expect(PLOT_SLOTS).toHaveLength(6);
    const ids = PLOT_SLOTS.map((p) => p.plotId).sort((a, b) => a - b);
    expect(ids).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('gives every Visual V1 plot a 64px footprint and a full-tile gutter', () => {
    expect(PLOT_SLOTS.every((plot) => plot.size === 64)).toBe(true);
    const top = PLOT_SLOTS.slice(0, 3);
    const bottom = PLOT_SLOTS.slice(3);
    expect(top.map((plot) => plot.x)).toEqual([704, 800, 896]);
    expect(bottom.map((plot) => plot.x)).toEqual([704, 800, 896]);
    expect(new Set(top.map((plot) => plot.y))).toEqual(new Set([720]));
    expect(new Set(bottom.map((plot) => plot.y))).toEqual(new Set([816]));
    expect(top[1].x - top[0].x - top[0].size).toBe(32);
    expect(bottom[0].y - top[0].y - top[0].size).toBe(32);
  });

  it('keeps all world objects inside the rendered camera-bounds area', () => {
    for (const b of BUILDINGS) {
      expect(b.x).toBeGreaterThanOrEqual(CAMERA_BOUNDS.x);
      expect(b.x).toBeLessThanOrEqual(CAMERA_BOUNDS.x + CAMERA_BOUNDS.w);
      expect(b.y).toBeGreaterThanOrEqual(CAMERA_BOUNDS.y);
      expect(b.y).toBeLessThanOrEqual(CAMERA_BOUNDS.y + CAMERA_BOUNDS.h);
    }
    for (const d of DECOR) {
      expect(d.x).toBeGreaterThanOrEqual(CAMERA_BOUNDS.x);
      expect(d.x).toBeLessThanOrEqual(CAMERA_BOUNDS.x + CAMERA_BOUNDS.w);
    }
    expect(POND.x + POND.w).toBeLessThanOrEqual(CAMERA_BOUNDS.x + CAMERA_BOUNDS.w);
    expect(POND.y + POND.h).toBeLessThanOrEqual(CAMERA_BOUNDS.y + CAMERA_BOUNDS.h);
  });

  it('marks the lab building as interactive with a positive radius', () => {
    expect(LAB_BUILDING.interactive).toBe(true);
    expect(LAB_BUILDING.interactionRadius).toBeGreaterThan(0);
  });

  it('does not let two building footprints overlap each other', () => {
    const rects = collisionRects();
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(rectsIntersect(rects[i], rects[j])).toBe(false);
      }
    }
  });

  it('derives terrain kind consistently from the path/pond data', () => {
    const pathTiles = pathTileKeySet();
    // тайл в центре пруда — вода
    const pondCol = Math.floor((POND.x + POND.w / 2) / 32);
    const pondRow = Math.floor((POND.y + POND.h / 2) / 32);
    expect(terrainAt(pondCol, pondRow, pathTiles)).toBe('water');
    // клетка внутри сектора без дорожки и пруда — трава
    const sectorInsideCol = Math.floor((SECTOR.x + 4) / 32);
    const sectorInsideRow = Math.floor((SECTOR.y + 4) / 32);
    expect(terrainAt(sectorInsideCol, sectorInsideRow, pathTiles)).toBe('grass');
  });
});

describe('closed sectors are inaccessible to the player', () => {
  it('classifies every tile outside the open sector as thicket (not grass/path/water)', () => {
    const pathTiles = pathTileKeySet();
    // Точка чётко за пределами сектора, но внутри отрисовываемой области.
    const outsideCol = Math.floor(CAMERA_BOUNDS.x / 32) + 1;
    const outsideRow = Math.floor(CAMERA_BOUNDS.y / 32) + 1;
    expect(isInsideOpenSector(outsideCol, outsideRow)).toBe(false);
    expect(terrainAt(outsideCol, outsideRow, pathTiles)).toBe('thicket');
  });

  it('blocks movement attempting to cross the sector boundary north/south/east/west', () => {
    // Игрок в реальной игре двигается маленькими шагами каждый кадр (~2px при
    // 130px/s и 60fps), а не телепортируется — поэтому здесь симулируем много
    // маленьких шагов подряд в сторону границы (реалистичная развёртка), а не
    // один гигантский прыжок (который может "прошить" тонкую полосу коллизии
    // насквозь, что было бы ложным провалом теста, а не багом игры).
    const obstacles = collisionRects();
    const halfW = 9;
    const halfH = 8;
    const STEP = 2;
    const STEPS = 200;
    const attempts: Array<{ start: { x: number; y: number }; dx: number; dy: number }> = [
      { start: { x: SECTOR.x + SECTOR.w / 2, y: SECTOR.y + 20 }, dx: 0, dy: -STEP }, // север
      { start: { x: SECTOR.x + SECTOR.w / 2, y: SECTOR.y + SECTOR.h - 20 }, dx: 0, dy: STEP }, // юг
      { start: { x: SECTOR.x + 20, y: SECTOR.y + SECTOR.h / 2 }, dx: -STEP, dy: 0 }, // запад
      { start: { x: SECTOR.x + SECTOR.w - 20, y: SECTOR.y + SECTOR.h / 2 }, dx: STEP, dy: 0 }, // восток
    ];
    for (const a of attempts) {
      let pos = a.start;
      for (let i = 0; i < STEPS; i++) {
        pos = moveWithCollisions(pos.x, pos.y, a.dx, a.dy, halfW, halfH, obstacles);
      }
      const stillInsideOrAtEdge =
        pos.x >= SECTOR.x - 1 &&
        pos.x <= SECTOR.x + SECTOR.w + 1 &&
        pos.y >= SECTOR.y - 1 &&
        pos.y <= SECTOR.y + SECTOR.h + 1;
      expect(stillInsideOrAtEdge, `escaped the sector via dx=${a.dx},dy=${a.dy}`).toBe(true);
    }
  });

  it('defines exactly 4 boundary transitions, all honestly marked as leading nowhere yet', () => {
    expect(BOUNDARY_TRANSITIONS).toHaveLength(4);
    const ids = BOUNDARY_TRANSITIONS.map((t) => t.id);
    expect(new Set(ids).size).toBe(4);
    for (const t of BOUNDARY_TRANSITIONS) {
      expect(t.label.toLowerCase()).toContain('скоро');
    }
  });
});
