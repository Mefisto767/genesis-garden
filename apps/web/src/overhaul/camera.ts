// ============================================================================
// Responsive cover-камера overhaul-режима — чистая, тестируемая логика без
// Phaser (см. docs/VISUAL_BIBLE_V1.md §3, уточнённый контракт V1).
//
// Контракт: canvas responsive (Phaser Scale.RESIZE) и заполняет реальный
// viewport целиком; камера обязана НИКОГДА не показывать пустое пространство
// за пределами CAMERA_BOUNDS (worldConfig.ts). Для этого zoom выбирается
// cover-подходом: видимая область мира (viewport / zoom) должна помещаться
// внутрь CAMERA_BOUNDS по обеим осям →
//   zoom = max(viewportWidth / bounds.w, viewportHeight / bounds.h)
// На landscape доминирует ширина (камера покрывает ширину CAMERA_BOUNDS),
// на portrait — высота. Fractional zoom разрешён контрактом: это масштаб
// камеры, единый для всего мира, world-координаты и anchors остаются целыми.
//
// Безопасный диапазон [MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM] ограничивает zoom,
// но требование «нет пустоты за CAMERA_BOUNDS» сильнее верхней границы:
// если cover-минимум превышает MAX_CAMERA_ZOOM (сверхширокий 4K-viewport),
// побеждает cover-минимум, а не кап.
// ============================================================================

import type { Rect } from './movement';
import { CAMERA_BOUNDS } from './worldConfig';

/** Нижняя граница: не отдаляем камеру дальше «пиксель мира = пиксель CSS». */
export const MIN_CAMERA_ZOOM = 1;
/** Верхняя граница «безопасного диапазона» — защищает от абсурдного
 * приближения на нестандартно крошечных viewport'ах. Уступает cover-минимуму. */
export const MAX_CAMERA_ZOOM = 4;

/** Follow-offset камеры по Y (world px): центр кадра держится чуть выше
 * персонажа, чтобы при нижнем клампе скролла ряд грядок не уезжал под
 * верхний HUD (64 CSS px) на контрольном viewport 960×540. */
export const CAMERA_FOLLOW_OFFSET_Y = 56;

/**
 * Cover-zoom для произвольного viewport. Гарантия: при любом валидном входе
 * viewport/zoom ≤ bounds по обеим осям (пустота за CAMERA_BOUNDS невозможна,
 * пока scroll клампится по bounds — это делает Phaser camera.setBounds).
 * Невалидный вход (нулевые/отрицательные размеры) → безопасный фолбэк 1.
 */
export function computeCameraZoom(
  viewportWidth: number,
  viewportHeight: number,
  bounds: Rect = CAMERA_BOUNDS
): number {
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    bounds.w <= 0 ||
    bounds.h <= 0
  ) {
    return MIN_CAMERA_ZOOM;
  }
  const coverZoom = Math.max(viewportWidth / bounds.w, viewportHeight / bounds.h);
  const clamped = Math.min(Math.max(coverZoom, MIN_CAMERA_ZOOM), MAX_CAMERA_ZOOM);
  // «Нет пустоты за CAMERA_BOUNDS» сильнее верхней границы диапазона.
  return Math.max(clamped, coverZoom);
}

/** Видимая область мира (world px) при данном viewport'е — удобно для
 * тестов и e2e-инвариантов «камера не показывает пустоту». */
export function visibleWorldSize(
  viewportWidth: number,
  viewportHeight: number,
  bounds: Rect = CAMERA_BOUNDS
): { w: number; h: number } {
  const zoom = computeCameraZoom(viewportWidth, viewportHeight, bounds);
  return { w: viewportWidth / zoom, h: viewportHeight / zoom };
}
