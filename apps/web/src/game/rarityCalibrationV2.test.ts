import { describe, expect, it } from 'vitest';
import {
  RARITY_CALIBRATION_SEED,
  RARITY_CALIBRATION_MEASURED_COUNT,
  runRarityCalibrationSimulationV2,
} from './rarityCalibrationV2';
import type { RarityTierV2 } from './rarityV2';

// ============================================================================
// Genetics V2 — Slice 13: rarity calibration statistical test.
//
// Implements docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.5.7/§4.5.8 and
// docs/GENETICS_TARGET_DELTA.md §0.15 exactly. The per-tier count intervals
// below were fixed in the docs-lock commit (`docs(genetics): lock final Gate
// 1 calibration and regression`) BEFORE the production points/thresholds in
// `rarityV2.ts` were calibrated — see contract §4.5.8 for the exact
// methodology (±6 standard deviations of the binomial distribution implied
// by each tier's TARGET percentage at n=100000, rounded outward to the
// nearest 10). This is deliberately NOT one tolerance percentage applied
// uniformly to all six tiers — Mythic (expected ~100 of 100000) uses a
// narrow absolute count band, not a percentage-of-target band, precisely
// because a percentage tolerance that would be reasonable for Common
// (expected ~50000) would let Mythic drift by an order of magnitude and
// still "pass".
// ============================================================================

/** Contract §4.5.8 — fixed BEFORE calibration, not derived from the
 * measured result. `[min, max]` inclusive count bounds out of 100000. */
const RARITY_TIER_INTERVALS: Record<RarityTierV2, readonly [number, number]> = {
  Common: [49050, 50950],
  Uncommon: [29125, 30875],
  Rare: [13340, 14660],
  Epic: [4585, 5415],
  Legendary: [720, 1080],
  Mythic: [40, 160],
};

describe('Slice 13 — V2 rarity calibration (100000 measured breedV2 results)', () => {
  it('measures exactly 100000 successful results from a diverse, deterministic, multi-species population', () => {
    const result = runRarityCalibrationSimulationV2();
    expect(result.total).toBe(RARITY_CALIBRATION_MEASURED_COUNT);
    const sum = (Object.keys(result.counts) as RarityTierV2[]).reduce((acc, tier) => acc + result.counts[tier], 0);
    expect(sum).toBe(RARITY_CALIBRATION_MEASURED_COUNT);
  });

  it('is byte-reproducible — running the same seed twice yields identical counts', () => {
    const first = runRarityCalibrationSimulationV2(RARITY_CALIBRATION_SEED);
    const second = runRarityCalibrationSimulationV2(RARITY_CALIBRATION_SEED);
    expect(second).toEqual(first);
  });

  it('produces a tier distribution within the pre-committed statistical intervals (contract §4.5.8)', () => {
    const result = runRarityCalibrationSimulationV2();
    const failures: string[] = [];
    for (const tier of Object.keys(RARITY_TIER_INTERVALS) as RarityTierV2[]) {
      const [min, max] = RARITY_TIER_INTERVALS[tier];
      const count = result.counts[tier];
      const pct = ((count / result.total) * 100).toFixed(3);
      if (count < min || count > max) {
        failures.push(`${tier}: ${count} (${pct}%) is outside the committed interval [${min}, ${max}]`);
      }
    }

    if (failures.length > 0) {
      // Print the full breakdown on failure (owner requirement: "тест
      // выводит фактические counts и percentages при падении") — every tier,
      // not just the ones that failed, so a future recalibration pass has
      // the complete picture in one place.
      const lines = (Object.keys(result.counts) as RarityTierV2[]).map((tier) => {
        const count = result.counts[tier];
        const pct = ((count / result.total) * 100).toFixed(3);
        const [min, max] = RARITY_TIER_INTERVALS[tier];
        return `  ${tier}: ${count} (${pct}%) — committed interval [${min}, ${max}]`;
      });
      // eslint-disable-next-line no-console
      console.error(`Rarity calibration distribution (seed=${RARITY_CALIBRATION_SEED}):\n${lines.join('\n')}`);
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });
});
