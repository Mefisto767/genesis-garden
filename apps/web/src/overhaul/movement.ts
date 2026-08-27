// ============================================================================
// Чистая логика перемещения персонажа EstateScene — без зависимости от
// Phaser, чтобы её можно было юнит-тестировать (Vitest, без canvas/DOM).
// EstateScene.ts вызывает эти функции каждый кадр и применяет результат к
// спрайту. Здесь же — простое разрешение коллизий по осям (AABB, ось за
// осью), чтобы персонаж скользил вдоль стены здания, а не залипал.
// ============================================================================

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Персонажа представляем маленьким AABB вокруг его "ног" (anchor-точки). */
export function characterRect(x: number, y: number, halfW: number, halfH: number): Rect {
  return { x: x - halfW, y: y - halfH, w: halfW * 2, h: halfH * 2 };
}

/**
 * Двигает точку (x, y) на (dx, dy), проверяя коллизии по X и Y раздельно —
 * стандартный приём для топ-дауна: если движение по одной оси врезается в
 * препятствие, персонаж всё равно продолжает скользить по другой оси.
 */
export function moveWithCollisions(
  x: number,
  y: number,
  dx: number,
  dy: number,
  halfW: number,
  halfH: number,
  obstacles: readonly Rect[]
): Point {
  let nx = x;
  let ny = y;

  if (dx !== 0) {
    const tryX = x + dx;
    const rect = characterRect(tryX, y, halfW, halfH);
    if (!obstacles.some((o) => rectsIntersect(rect, o))) nx = tryX;
  }
  if (dy !== 0) {
    const tryY = y + dy;
    const rect = characterRect(nx, tryY, halfW, halfH);
    if (!obstacles.some((o) => rectsIntersect(rect, o))) ny = tryY;
  }
  return { x: nx, y: ny };
}

export function clampToWorld(
  x: number,
  y: number,
  halfW: number,
  halfH: number,
  worldWidth: number,
  worldHeight: number
): Point {
  return {
    x: Math.min(Math.max(x, halfW), worldWidth - halfW),
    y: Math.min(Math.max(y, halfH), worldHeight - halfH),
  };
}

/** То же самое, что clampToWorld, но для прямоугольника с произвольным
 * origin (не обязательно (0,0)) — нужно с тех пор, как отрисовываемая/
 * проходимая область (CAMERA_BOUNDS в worldConfig.ts) стала смещённым
 * прямоугольником внутри гораздо большего 48×48 логического мира, а не
 * самим миром от (0,0). */
export function clampToBounds(x: number, y: number, halfW: number, halfH: number, bounds: Rect): Point {
  return {
    x: Math.min(Math.max(x, bounds.x + halfW), bounds.x + bounds.w - halfW),
    y: Math.min(Math.max(y, bounds.y + halfH), bounds.y + bounds.h - halfH),
  };
}

export type Facing = 'up' | 'down' | 'left' | 'right';

export function facingFromDelta(dx: number, dy: number, prev: Facing): Facing {
  if (dx === 0 && dy === 0) return prev;
  // Побеждает ось с бОльшим модулем смещения — привычное поведение для 4-directional спрайтов.
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/**
 * Шаг к цели клика/тапа: возвращает смещение (dx, dy), не длиннее maxDist,
 * и флаг достижения цели (в пределах arriveEpsilon). Используется для
 * click/tap-to-move — раздельно от WASD, который двигает напрямую по вводу.
 */
export function stepTowardTarget(
  x: number,
  y: number,
  target: Point,
  maxDist: number,
  arriveEpsilon = 2
): { dx: number; dy: number; arrived: boolean } {
  const toX = target.x - x;
  const toY = target.y - y;
  const dist = Math.hypot(toX, toY);
  if (dist <= arriveEpsilon) return { dx: 0, dy: 0, arrived: true };
  const step = Math.min(maxDist, dist);
  return { dx: (toX / dist) * step, dy: (toY / dist) * step, arrived: false };
}

/** true, если точка (для клика/тапа) попадает внутрь непроходимого прямоугольника. */
export function pointBlocked(point: Point, obstacles: readonly Rect[]): boolean {
  return obstacles.some(
    (o) => point.x >= o.x && point.x <= o.x + o.w && point.y >= o.y && point.y <= o.y + o.h
  );
}
