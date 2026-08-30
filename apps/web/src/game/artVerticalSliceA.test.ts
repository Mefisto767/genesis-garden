import { describe, expect, it } from 'vitest';
import { isCoralMatureSunflower } from './artVerticalSliceA';
import { PRIMARY_HEX_TO_ID } from './geneticsV2';

describe('isCoralMatureSunflower (Art Vertical Slice A gating, docs/ART_VERTICAL_SLICE_A.md)', () => {
  it('is true for speciesId 1 (Солнечник) with primary_coral (#FF8C77)', () => {
    expect(isCoralMatureSunflower({ shape: 1, primary: '#FF8C77' })).toBe(true);
  });

  it('is false for the same species with any other primary color', () => {
    for (const [hex, id] of Object.entries(PRIMARY_HEX_TO_ID)) {
      if (id === 'primary_coral') continue;
      expect(isCoralMatureSunflower({ shape: 1, primary: hex }), hex).toBe(false);
    }
  });

  it('is false for primary_coral on a different species (e.g. speciesId 2, Колокольник)', () => {
    expect(isCoralMatureSunflower({ shape: 2, primary: '#FF8C77' })).toBe(false);
  });

  it('is false for any other speciesId entirely (1-8 catalog)', () => {
    for (let shape = 2; shape <= 8; shape++) {
      expect(isCoralMatureSunflower({ shape, primary: '#FF8C77' }), `shape=${shape}`).toBe(false);
    }
  });

  it('is false for an unrecognized/corrupted hex not in the primary pool', () => {
    expect(isCoralMatureSunflower({ shape: 1, primary: '#000000' })).toBe(false);
  });
});
