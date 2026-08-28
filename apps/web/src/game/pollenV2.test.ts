import { describe, expect, it } from 'vitest';
import {
  SAME_SPECIES_BREED_COST,
  INTERSPECIES_BREED_COST,
  SPECIES_BASE_POLLEN,
  RARITY_POLLEN_BONUS,
  breedCostV2,
  speciesBasePollenV2,
  pollenRewardV2,
} from './pollenV2';
import type { AllelePair, GenomeV2 } from './geneticsV2';
import type { RarityTierV2 } from './rarityV2';

// ============================================================================
// Genetics V2 — Slice 6: pollen economy (contract §4.9.1, delta doc §0.8).
// Чистые функции/константы — без RNG, без GameState. Store-level интеграция
// (breedNurseryV2/harvestHybridV2, атомарность, insufficient_pollen,
// firstBreedFreeClaimed) — store.pollenV2.test.ts.
// ============================================================================

function homo<T extends string>(value: T): AllelePair<T> {
  return { a: value, b: value };
}

function fixtureGenomeV2(speciesId: number, overrides: Partial<GenomeV2> = {}): GenomeV2 {
  return {
    stemForm: homo('stem_standard'),
    leafForm: homo('leaf_standard'),
    flowerForm: homo('flower_standard'),
    primaryColor: homo('primary_honey'),
    secondaryColor: homo('secondary_forest'),
    leafColor: homo('leaf_color_meadow'),
    pattern: homo('pattern_solid'),
    size: homo('size_normal'),
    aura: homo('aura_none'),
    speciesId,
    mutationId: null,
    ...overrides,
  } as GenomeV2;
}

describe('breedCostV2 — стоимость скрещивания', () => {
  it('одновидовая пара (species1×species1) стоит SAME_SPECIES_BREED_COST=8', () => {
    expect(breedCostV2(1, 1)).toBe(SAME_SPECIES_BREED_COST);
    expect(breedCostV2(1, 1)).toBe(8);
  });

  it('одновидовая пара (species2×species2) стоит 8', () => {
    expect(breedCostV2(2, 2)).toBe(8);
  });

  it('межвидовая пара стоит INTERSPECIES_BREED_COST=12 (зафиксировано, недостижимо в проде до Slice 9)', () => {
    expect(breedCostV2(1, 2)).toBe(INTERSPECIES_BREED_COST);
    expect(breedCostV2(2, 1)).toBe(12);
  });
});

describe('speciesBasePollenV2 / SPECIES_BASE_POLLEN — базовая пыльца обоих видов', () => {
  it('Солнечник (species 1) — 2', () => {
    expect(SPECIES_BASE_POLLEN[1]).toBe(2);
    expect(speciesBasePollenV2(1)).toBe(2);
  });

  it('Колокольник (species 2) — 2', () => {
    expect(SPECIES_BASE_POLLEN[2]).toBe(2);
    expect(speciesBasePollenV2(2)).toBe(2);
  });

  it('неподдерживаемый speciesId (не 1/2) обрабатывается явно и безопасно — возвращает 0, не бросает', () => {
    expect(speciesBasePollenV2(3)).toBe(0);
    expect(speciesBasePollenV2(0)).toBe(0);
    expect(speciesBasePollenV2(-1)).toBe(0);
    expect(() => speciesBasePollenV2(99)).not.toThrow();
  });
});

describe('RARITY_POLLEN_BONUS — бонусы всех шести тиров', () => {
  const expected: Record<RarityTierV2, number> = {
    Common: 0,
    Uncommon: 0,
    Rare: 1,
    Epic: 1,
    Legendary: 2,
    Mythic: 2,
  };

  (Object.keys(expected) as RarityTierV2[]).forEach((tier) => {
    it(`${tier} -> +${expected[tier]}`, () => {
      expect(RARITY_POLLEN_BONUS[tier]).toBe(expected[tier]);
    });
  });
});

describe('pollenRewardV2 — формула speciesBasePollen + rarityBonus', () => {
  it('Common-геном species 1 -> 2 + 0 = 2', () => {
    // Полностью гомозиготный "нейтральный" геном — naturalScore=0 -> Common.
    expect(pollenRewardV2(fixtureGenomeV2(1))).toBe(2);
  });

  it('Common-геном species 2 -> 2 + 0 = 2', () => {
    expect(pollenRewardV2(fixtureGenomeV2(2))).toBe(2);
  });

  it('Rare-геном (mutationId=golden_vein, Minor floor=Rare) -> 2 + 1 = 3', () => {
    const genome = fixtureGenomeV2(1, { mutationId: 'golden_vein' });
    expect(pollenRewardV2(genome)).toBe(3);
  });

  it('Epic-геном (mutationId=stardust, Major floor=Epic) -> 2 + 1 = 3', () => {
    const genome = fixtureGenomeV2(1, { mutationId: 'stardust' });
    expect(pollenRewardV2(genome)).toBe(3);
  });

  it('Legendary-геном (mutationId=phoenix, Signature floor=Legendary, naturalScore<5) -> 2 + 2 = 4', () => {
    const genome = fixtureGenomeV2(1, { mutationId: 'phoenix' });
    expect(pollenRewardV2(genome)).toBe(4);
  });

  it('Mythic-геном (mutationId=phoenix + naturalScore>=5) -> 2 + 2 = 4 (mutation floor корректно влияет на награду через rarityOfV2)', () => {
    // Достаточно редкий naturalScore (>=5) + Signature-мутация -> Mythic по rarityOfV2.
    const genome = fixtureGenomeV2(1, {
      mutationId: 'phoenix',
      pattern: homo('pattern_veins'), // 5 очков — уже достаточно для MYTHIC_CO_THRESHOLD=5
    });
    expect(pollenRewardV2(genome)).toBe(4); // Mythic -> +2, тот же бонус, что и Legendary — проверяем именно через rarityOfV2, не напрямую по mutationId
  });

  it('неподдерживаемый speciesId в pollenRewardV2 не начисляет случайное значение — база 0, только rarityBonus', () => {
    const genome = fixtureGenomeV2(3);
    expect(pollenRewardV2(genome)).toBe(0); // Common rarity, base 0 (unsupported species) + bonus 0
  });
});
