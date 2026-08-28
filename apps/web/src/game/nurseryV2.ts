// ============================================================================
// Genetics V2 — Slice 5: рост Nursery Tray гибридов (persisted nursery
// lifecycle contract, docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.8.3).
//
// Реализует ТОЛЬКО тайминг роста (первый рост + повторный цикл) по
// `genomeV2.speciesId`, docs/GENETICS_TARGET_DELTA.md §2.1 — отдельная V2-
// конфигурация, сознательно НЕ переиспользующая legacy `SEED_BALANCE.growMs`
// (другая экономика, другие числа). Никакой мутации `GameState` здесь нет —
// чистые функции над переданными значениями, тот же принцип, что и у
// `entitlements.ts`/`store.ts` `plotStatus()`. Ускорители роста (`entitlements`)
// на V2-таймеры не распространяются в Slice 5 (решение не запрашивалось и не
// принималось владельцем — не регрессия, осознанный пропуск).
// ============================================================================

import type { HybridSeedV2 } from './geneticsV2';

/** Вместимость Nursery Tray (delta doc §6 п.1) — единственное место, где это
 * число объявлено, `store.ts` его переиспользует. */
export const NURSERY_TRAY_CAPACITY = 8;

export interface SpeciesGrowthV2 {
  /** Длительность первого роста посаженного `HybridSeedV2`, мс. */
  firstGrowMs: number;
  /** Длительность повторного цикла зрелого постоянного растения, мс. */
  regrowMs: number;
}

/**
 * Gate 1 поддерживает только Солнечника (`speciesId:1`) и Колокольника
 * (`speciesId:2`) как родителей V2 (Slice 3-4, `SUPPORTED_PARENT_SPECIES_V2`)
 * — соответственно, только для них здесь определён тайминг роста. Точные
 * числа — `GENETICS_TARGET_DELTA.md` §2.1, синхронизированы с
 * `genesis-garden-balance-model-v3.xlsx` (лист `Species`).
 */
export const SPECIES_GROWTH_V2: Record<number, SpeciesGrowthV2> = {
  1: { firstGrowMs: 5 * 60 * 1000, regrowMs: 20 * 60 * 1000 }, // Солнечник
  2: { firstGrowMs: 8 * 60 * 1000, regrowMs: 30 * 60 * 1000 }, // Колокольник
};

export function speciesGrowthV2(speciesId: number): SpeciesGrowthV2 | undefined {
  return SPECIES_GROWTH_V2[speciesId];
}

/**
 * Genetics V2 fix-pass (audit, bug 2): текст счётчика Nursery Tray в
 * `LabPanelV2.tsx`. При `count >= capacity` UI обязан показывать ДОСЛОВНО
 * `Питомник заполнен: X/Y` — не перестановку вида `Питомник: X/Y — питомник
 * заполнен`, которая была раньше. Вынесена в чистую функцию (а не оставлена
 * инлайном в JSX), т.к. в репозитории нет React Testing Library/`.tsx`
 * vitest-конфигурации (`vitest.config.ts` включает только `src/**\/*.test.ts`)
 * — иначе точный текст было бы нечем проверить автоматически.
 */
export function nurseryTrayLabel(count: number, capacity: number = NURSERY_TRAY_CAPACITY): string {
  return count >= capacity ? `Питомник заполнен: ${count}/${capacity}` : `Питомник: ${count}/${capacity}`;
}

export interface GrowthStatusV2 {
  ready: boolean;
  /** 0..1. */
  progress: number;
  remainingMs: number;
  totalMs: number;
}

/**
 * Статус первого роста ещё не собранного `HybridSeedV2`, посаженного на
 * грядку (`Plot.hybridV2.phase === 'growing'`). Та же форма/семантика, что
 * `GameStore.plotStatus()` — единая точка правды для UI и фактического сбора
 * (`GameStore.harvestHybridV2`), чтобы они никогда не разошлись.
 */
export function hybridGrowthStatusV2(
  hybrid: Pick<HybridSeedV2, 'genomeV2' | 'plantedAt'>,
  now: number = Date.now()
): GrowthStatusV2 | null {
  if (hybrid.plantedAt === null) return null;
  const growth = speciesGrowthV2(hybrid.genomeV2.speciesId);
  if (!growth) return null;
  const elapsed = Math.max(0, now - hybrid.plantedAt);
  const totalMs = growth.firstGrowMs;
  return {
    ready: elapsed >= totalMs,
    progress: Math.min(1, elapsed / totalMs),
    remainingMs: Math.max(0, totalMs - elapsed),
    totalMs,
  };
}

/**
 * Статус повторного цикла уже зрелого постоянного растения
 * (`Plot.hybridV2.phase === 'mature'`) — считается от `lastHarvestAt`, не от
 * исходной посадки.
 */
export function regrowStatusV2(
  speciesId: number,
  lastHarvestAt: number,
  now: number = Date.now()
): GrowthStatusV2 | null {
  const growth = speciesGrowthV2(speciesId);
  if (!growth) return null;
  const elapsed = Math.max(0, now - lastHarvestAt);
  const totalMs = growth.regrowMs;
  return {
    ready: elapsed >= totalMs,
    progress: Math.min(1, elapsed / totalMs),
    remainingMs: Math.max(0, totalMs - elapsed),
    totalMs,
  };
}
