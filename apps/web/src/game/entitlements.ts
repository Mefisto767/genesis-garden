// ============================================================================
// Ускорители роста (entitlements) — модуль-заготовка Этапа 2, наполняется
// реальными покупками на Этапе 7 (монетизация). Уже сейчас применяется к
// расчёту роста, чтобы движок не пришлось переделывать, когда появятся
// первые товары («теплица +10%», «удобрение»).
//
// Жёсткое правило мастер-промта: суммарное ускорение роста не может
// превышать BOOSTS_CONFIG.maxTotalGrowthBoostPercent (25%) — ограничение
// применяется здесь, один раз, а не в каждом месте, где он используется.
// ============================================================================

import { BOOSTS_CONFIG } from './config';
import type { Entitlement } from './types';

/** Суммарный активный процент ускорения роста, обрезанный по лимиту. */
export function activeGrowthBoostPercent(entitlements: Entitlement[], now: number = Date.now()): number {
  const total = entitlements
    .filter((e) => e.type === 'growth_boost' && (e.expiresAt === null || e.expiresAt > now))
    .reduce((sum, e) => sum + e.percent, 0);
  return Math.min(total, BOOSTS_CONFIG.maxTotalGrowthBoostPercent);
}

/**
 * "Эффективное" прошедшее время с учётом буста — растение растёт быстрее,
 * поэтому засчитываем больше времени, чем прошло по часам.
 */
export function effectiveElapsedMs(realElapsedMs: number, boostPercent: number): number {
  return realElapsedMs * (1 + boostPercent);
}
