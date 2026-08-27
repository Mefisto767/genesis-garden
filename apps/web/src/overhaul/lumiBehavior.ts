// ============================================================================
// Люми (Lumi) — постоянный помощник поместья, чистая логика без Phaser (см.
// docs/ESTATE_LAYOUT_BLUEPRINT.md раздел "Люми" и техпромт этапа "Estate
// Architecture", задача 3). Маленький ботанический автомат: латунный корпус
// в форме семени, стеклянная колба, живой светящийся росток внутри.
//
// Этот модуль — ЧИСТЫЕ функции состояния/движения, без побочных эффектов и
// без обращения к gameStore. Это намеренно: Люми на этом этапе НЕ собирает
// урожай, не поливает, не меняет экономику и не должна иметь возможность
// вызвать игровое действие даже случайно — раз она не мутирует стор, дважды
// вызвать посадку/сбор/скрещивание она физически не может. EstateScene.ts
// только читает результат `lumiFollowStep()`/`deriveLumiState()` каждый кадр
// и позиционирует свой (не интерактивный, без коллизий) Container.
// ============================================================================

import type { Point } from './movement';

export type LumiState = 'idle' | 'follow' | 'point' | 'work';

/** Расстояние (px), при котором Люми считается "рядом" с игроком и не идёт следом. */
export const LUMI_FOLLOW_SLACK = 46;
/** Максимальная скорость Люми — чуть медленнее игрока, чтобы она правдоподобно "нагоняла". */
export const LUMI_SPEED = 150; // px/s

/**
 * Один шаг движения Люми к игроку с небольшим отставанием (не телепорт, не
 * жёсткая привязка). Если игрок в пределах LUMI_FOLLOW_SLACK — Люми не
 * двигается (idle рядом с игроком), иначе плавно доходит следом.
 */
export function lumiFollowStep(lumiPos: Point, playerPos: Point, dt: number): Point {
  const toX = playerPos.x - lumiPos.x;
  const toY = playerPos.y - lumiPos.y;
  const dist = Math.hypot(toX, toY);
  if (dist <= LUMI_FOLLOW_SLACK) return lumiPos;
  const remaining = dist - LUMI_FOLLOW_SLACK;
  const step = Math.min(LUMI_SPEED * dt, remaining);
  return { x: lumiPos.x + (toX / dist) * step, y: lumiPos.y + (toY / dist) * step };
}

/**
 * Состояние Люми для текущего кадра — чисто производное от того, что уже
 * известно EstateScene (движется ли игрок, рядом ли интерактивная точка).
 * 'work' зарезервировано на будущее (см. blueprint, "Поздние функции") и
 * этим шагом никогда не возвращается — честно не реализовано, не подделано.
 */
export function deriveLumiState(params: { playerIsMoving: boolean; nearInteractable: boolean; lumiIsMoving: boolean }): LumiState {
  if (params.nearInteractable) return 'point';
  if (params.playerIsMoving || params.lumiIsMoving) return 'follow';
  return 'idle';
}
