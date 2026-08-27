import { describe, expect, it } from 'vitest';
import {
  characterRect,
  clampToBounds,
  clampToWorld,
  facingFromDelta,
  moveWithCollisions,
  pointBlocked,
  rectsIntersect,
  stepTowardTarget,
} from './movement';

describe('rectsIntersect', () => {
  it('detects overlap', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });
  it('detects no overlap', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 10, h: 10 })).toBe(false);
  });
});

describe('moveWithCollisions', () => {
  const obstacle = { x: 50, y: 0, w: 20, h: 20 };

  it('moves freely with no obstacles nearby', () => {
    const result = moveWithCollisions(0, 0, 5, 5, 4, 4, []);
    expect(result).toEqual({ x: 5, y: 5 });
  });

  it('blocks the X axis when it would enter an obstacle, but still allows Y', () => {
    // персонаж рядом со стеной справа, пытается идти вправо и вниз одновременно
    const result = moveWithCollisions(44, 10, 10, 5, 4, 4, [obstacle]);
    expect(result.x).toBe(44); // движение по X заблокировано стеной
    expect(result.y).toBe(15); // движение по Y всё равно прошло — скольжение вдоль стены
  });

  it('allows movement away from an obstacle', () => {
    const result = moveWithCollisions(44, 10, -10, 0, 4, 4, [obstacle]);
    expect(result.x).toBe(34);
  });
});

describe('clampToWorld', () => {
  it('clamps within bounds', () => {
    expect(clampToWorld(-100, -100, 10, 10, 640, 480)).toEqual({ x: 10, y: 10 });
    expect(clampToWorld(10000, 10000, 10, 10, 640, 480)).toEqual({ x: 630, y: 470 });
  });
  it('leaves in-bounds points untouched', () => {
    expect(clampToWorld(100, 100, 10, 10, 640, 480)).toEqual({ x: 100, y: 100 });
  });
});

describe('clampToBounds', () => {
  const bounds = { x: 400, y: 500, w: 700, h: 640 };
  it('clamps within an off-origin rect', () => {
    expect(clampToBounds(-100, -100, 10, 10, bounds)).toEqual({ x: 410, y: 510 });
    expect(clampToBounds(100000, 100000, 10, 10, bounds)).toEqual({ x: 1090, y: 1130 });
  });
  it('leaves in-bounds points untouched', () => {
    expect(clampToBounds(700, 800, 10, 10, bounds)).toEqual({ x: 700, y: 800 });
  });
});

describe('facingFromDelta', () => {
  it('keeps previous facing when not moving', () => {
    expect(facingFromDelta(0, 0, 'up')).toBe('up');
  });
  it('picks the dominant horizontal axis', () => {
    expect(facingFromDelta(5, 1, 'up')).toBe('right');
    expect(facingFromDelta(-5, 1, 'up')).toBe('left');
  });
  it('picks the dominant vertical axis', () => {
    expect(facingFromDelta(1, 5, 'up')).toBe('down');
    expect(facingFromDelta(1, -5, 'down')).toBe('up');
  });
});

describe('stepTowardTarget', () => {
  it('arrives when already close enough', () => {
    const result = stepTowardTarget(10, 10, { x: 11, y: 10 }, 5);
    expect(result.arrived).toBe(true);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
  });
  it('steps toward a far target, capped at maxDist', () => {
    const result = stepTowardTarget(0, 0, { x: 100, y: 0 }, 5);
    expect(result.arrived).toBe(false);
    expect(result.dx).toBeCloseTo(5);
    expect(result.dy).toBeCloseTo(0);
  });
  it('normalizes diagonal movement to maxDist', () => {
    const result = stepTowardTarget(0, 0, { x: 100, y: 100 }, 10);
    const dist = Math.hypot(result.dx, result.dy);
    expect(dist).toBeCloseTo(10);
  });
});

describe('pointBlocked / characterRect', () => {
  it('reports a point inside an obstacle as blocked', () => {
    expect(pointBlocked({ x: 55, y: 5 }, [{ x: 50, y: 0, w: 20, h: 20 }])).toBe(true);
    expect(pointBlocked({ x: 5, y: 5 }, [{ x: 50, y: 0, w: 20, h: 20 }])).toBe(false);
  });
  it('builds a centered rect around the character anchor', () => {
    expect(characterRect(10, 10, 4, 6)).toEqual({ x: 6, y: 4, w: 8, h: 12 });
  });
});
