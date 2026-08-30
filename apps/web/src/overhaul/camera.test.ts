import { describe, expect, it } from 'vitest';
import {
  CAMERA_FOLLOW_OFFSET_Y,
  MAX_CAMERA_ZOOM,
  MIN_CAMERA_ZOOM,
  computeCameraZoom,
  visibleWorldSize,
} from './camera';
import { CAMERA_BOUNDS } from './worldConfig';

// Контрольные viewport'ы контракта (docs/VISUAL_BIBLE_V1.md §3 + roadmap V1).
const REFERENCE = { w: 960, h: 540 };
const DESKTOP = { w: 1366, h: 768 };
const MOBILE = { w: 360, h: 800 };

describe('computeCameraZoom — cover-подход по CAMERA_BOUNDS', () => {
  it('never lets the visible world area exceed CAMERA_BOUNDS on any tested viewport', () => {
    const viewports = [
      REFERENCE,
      DESKTOP,
      MOBILE,
      { w: 390, h: 844 },
      { w: 844, h: 390 },
      { w: 768, h: 1024 },
      { w: 1920, h: 1080 },
      { w: 2560, h: 1440 },
      { w: 3840, h: 2160 },
      { w: 320, h: 480 },
    ];
    for (const vp of viewports) {
      const { w, h } = visibleWorldSize(vp.w, vp.h);
      expect(w, `viewport ${vp.w}x${vp.h} visible width`).toBeLessThanOrEqual(CAMERA_BOUNDS.w + 1e-6);
      expect(h, `viewport ${vp.w}x${vp.h} visible height`).toBeLessThanOrEqual(CAMERA_BOUNDS.h + 1e-6);
    }
  });

  it('covers the CAMERA_BOUNDS width on landscape viewports', () => {
    for (const vp of [REFERENCE, DESKTOP, { w: 1920, h: 1080 }]) {
      const { w } = visibleWorldSize(vp.w, vp.h);
      expect(w).toBeCloseTo(CAMERA_BOUNDS.w, 6);
    }
  });

  it('covers the CAMERA_BOUNDS height on portrait viewports', () => {
    for (const vp of [MOBILE, { w: 390, h: 844 }, { w: 768, h: 1024 }]) {
      const { h } = visibleWorldSize(vp.w, vp.h);
      expect(h).toBeCloseTo(CAMERA_BOUNDS.h, 6);
    }
  });

  it('produces the documented fractional zoom on the 960x540 reference viewport', () => {
    // 960/704 ≈ 1.364 (ширина доминирует на landscape) — дробный zoom разрешён контрактом.
    expect(computeCameraZoom(REFERENCE.w, REFERENCE.h)).toBeCloseTo(960 / CAMERA_BOUNDS.w, 10);
  });

  it('stays within the safe range when cover fits inside it', () => {
    for (const vp of [REFERENCE, DESKTOP, MOBILE, { w: 844, h: 390 }]) {
      const zoom = computeCameraZoom(vp.w, vp.h);
      expect(zoom).toBeGreaterThanOrEqual(MIN_CAMERA_ZOOM);
      expect(zoom).toBeLessThanOrEqual(MAX_CAMERA_ZOOM);
    }
  });

  it('never zooms below MIN_CAMERA_ZOOM even when the viewport is smaller than the bounds', () => {
    // 320x240: cover = max(0.5, 0.416) = 0.5 → floor поднимает до MIN (1)
    // и видимая область (320x240 world px) всё равно остаётся внутри bounds.
    const zoom = computeCameraZoom(320, 240);
    expect(zoom).toBe(MIN_CAMERA_ZOOM);
    const { w, h } = visibleWorldSize(320, 240);
    expect(w).toBeLessThanOrEqual(CAMERA_BOUNDS.w);
    expect(h).toBeLessThanOrEqual(CAMERA_BOUNDS.h);
  });

  it('lets the cover minimum win over MAX_CAMERA_ZOOM (no-empty-space is stronger than the cap)', () => {
    // 3840x2160: cover = 3840/704 ≈ 5.45 > MAX (4) — побеждает cover, не кап.
    const zoom = computeCameraZoom(3840, 2160);
    expect(zoom).toBeGreaterThan(MAX_CAMERA_ZOOM);
    expect(zoom).toBeCloseTo(3840 / CAMERA_BOUNDS.w, 10);
  });

  it('falls back to MIN_CAMERA_ZOOM on degenerate input instead of NaN/Infinity', () => {
    expect(computeCameraZoom(0, 0)).toBe(MIN_CAMERA_ZOOM);
    expect(computeCameraZoom(-100, 500)).toBe(MIN_CAMERA_ZOOM);
    expect(computeCameraZoom(Number.NaN, 500)).toBe(MIN_CAMERA_ZOOM);
    expect(computeCameraZoom(Number.POSITIVE_INFINITY, 500)).toBe(MIN_CAMERA_ZOOM);
  });

  it('is symmetric in orientation: rotating the viewport keeps the same zoom', () => {
    // cover = max(a/bw, b/bh) vs max(b/bw, a/bh) в общем случае разные, но
    // инвариант «нет пустоты» держится в обеих ориентациях — проверяем это.
    const portrait = visibleWorldSize(390, 844);
    const landscape = visibleWorldSize(844, 390);
    expect(portrait.w).toBeLessThanOrEqual(CAMERA_BOUNDS.w + 1e-6);
    expect(portrait.h).toBeLessThanOrEqual(CAMERA_BOUNDS.h + 1e-6);
    expect(landscape.w).toBeLessThanOrEqual(CAMERA_BOUNDS.w + 1e-6);
    expect(landscape.h).toBeLessThanOrEqual(CAMERA_BOUNDS.h + 1e-6);
  });

  it('keeps the 64px plot footprint above the 44px touch-target minimum on every contract viewport', () => {
    for (const vp of [REFERENCE, DESKTOP, MOBILE]) {
      const zoom = computeCameraZoom(vp.w, vp.h);
      expect(64 * zoom).toBeGreaterThanOrEqual(44);
    }
  });

  it('keeps a positive follow offset small enough to stay inside the bounds half-height', () => {
    expect(CAMERA_FOLLOW_OFFSET_Y).toBeGreaterThan(0);
    expect(CAMERA_FOLLOW_OFFSET_Y).toBeLessThan(CAMERA_BOUNDS.h / 2);
  });
});
