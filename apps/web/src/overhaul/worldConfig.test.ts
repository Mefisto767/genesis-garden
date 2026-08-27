import { describe, expect, it } from 'vitest';
import { rectsIntersect, pointBlocked } from './movement';
import {
  BUILDINGS,
  DECOR,
  EXPANSION_GATE,
  LAB_BUILDING,
  PLAYER_SPAWN,
  PLOT_SLOTS,
  POND,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  collisionRects,
  pathTileKeySet,
  terrainAt,
} from './worldConfig';

describe('world sector layout invariants', () => {
  it('spawns the player outside every collision rect', () => {
    expect(pointBlocked(PLAYER_SPAWN, collisionRects())).toBe(false);
  });

  it('keeps every plot slot walkable (not inside a building/pond footprint)', () => {
    const obstacles = collisionRects();
    for (const plot of PLOT_SLOTS) {
      expect(pointBlocked({ x: plot.x, y: plot.y }, obstacles)).toBe(false);
    }
  });

  it('has 6 plot slots with unique ids 0..5, matching GARDEN_CONFIG.startUnlockedPlots', () => {
    expect(PLOT_SLOTS).toHaveLength(6);
    const ids = PLOT_SLOTS.map((p) => p.plotId).sort((a, b) => a - b);
    expect(ids).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('keeps all world objects inside world bounds', () => {
    for (const b of [...BUILDINGS, EXPANSION_GATE]) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeLessThanOrEqual(WORLD_WIDTH);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeLessThanOrEqual(WORLD_HEIGHT);
    }
    for (const d of DECOR) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(WORLD_WIDTH);
    }
    expect(POND.x + POND.w).toBeLessThanOrEqual(WORLD_WIDTH);
    expect(POND.y + POND.h).toBeLessThanOrEqual(WORLD_HEIGHT);
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
    // далёкий угол сектора без дорожки и пруда — трава
    expect(terrainAt(0, 0, pathTiles)).toBe('grass');
  });
});
