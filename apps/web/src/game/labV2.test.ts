import { describe, expect, it } from 'vitest';
import {
  COLOKOLNIK_LOCKED_TEXT_V2,
  FIRST_HYBRID_POLLEN_GRANT,
  GATED_SPECIES_ID_V2,
  LAB_LEVEL_2,
  isSpeciesUnlockedV2,
} from './labV2';

// ============================================================================
// Genetics V2 — Slice 8: labV2.ts — чистые константы + гейт-предикат
// (contract §4.11.1/§4.11.2). Store-level интеграция (harvestHybridV2 грант,
// buySeedV2/plantSeedV2/breedNurseryV2 гейт) — отдельный файл store.labV2.test.ts.
// ============================================================================

describe('labV2 — константы', () => {
  it('LAB_LEVEL_2 === 2', () => {
    expect(LAB_LEVEL_2).toBe(2);
  });

  it('FIRST_HYBRID_POLLEN_GRANT === 8', () => {
    expect(FIRST_HYBRID_POLLEN_GRANT).toBe(8);
  });

  it('GATED_SPECIES_ID_V2 === 2 (Колокольник)', () => {
    expect(GATED_SPECIES_ID_V2).toBe(2);
  });

  it('точный текст блокировки Колокольника (contract §4.11.2)', () => {
    expect(COLOKOLNIK_LOCKED_TEXT_V2).toBe(
      'Этот вид пока недоступен — вырасти своего первого гибрида, чтобы открыть его'
    );
  });
});

describe('isSpeciesUnlockedV2', () => {
  it('негейтящиеся виды доступны при любом labLevel, включая 0', () => {
    for (const speciesId of [1, 3, 4, 5, 6, 7, 8]) {
      expect(isSpeciesUnlockedV2(speciesId, 0)).toBe(true);
      expect(isSpeciesUnlockedV2(speciesId, 1)).toBe(true);
      expect(isSpeciesUnlockedV2(speciesId, 2)).toBe(true);
    }
  });

  it('Колокольник (speciesId 2) заблокирован при labLevel < 2', () => {
    expect(isSpeciesUnlockedV2(GATED_SPECIES_ID_V2, 0)).toBe(false);
    expect(isSpeciesUnlockedV2(GATED_SPECIES_ID_V2, 1)).toBe(false);
  });

  it('Колокольник доступен при labLevel >= 2', () => {
    expect(isSpeciesUnlockedV2(GATED_SPECIES_ID_V2, 2)).toBe(true);
    expect(isSpeciesUnlockedV2(GATED_SPECIES_ID_V2, 3)).toBe(true);
  });
});
