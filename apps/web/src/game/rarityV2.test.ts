import { describe, expect, it } from 'vitest';
import { naturalScoreOfV2, rarityOfV2, MUTATION_TIER_BY_ID, type RarityTierV2 } from './rarityV2';
import type { AllelePair, GenomeV2, MutationIdV2 } from './geneticsV2';

// ============================================================================
// Genetics V2 — Slice 3 (рабочая rarity-модель). Обязательные тесты из
// задания владельца (2026-08-28, пакетный проход Slice 3-4): naturalScore и
// все границы редкости, все mutation floors и условие Mythic. `breedV2`
// (Slice 4, интеграция rarity в реальное скрещивание с mutation roll) —
// отдельный файл mutationV2.test.ts, здесь rarityOfV2 тестируется напрямую,
// без RNG, как того явно требует контракт (§4.5.1).
// ============================================================================

function homo<T extends string>(value: T): AllelePair<T> {
  return { a: value, b: value };
}

/** Гомозиготный (нейтральный, naturalScore=0) фикстурный геном — та же база,
 * что и в phenotypeV2.test.ts/inheritanceV2.test.ts. */
function fixtureGenomeV2(overrides: Partial<GenomeV2> = {}): GenomeV2 {
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
    speciesId: 1,
    mutationId: null,
    ...overrides,
  } as GenomeV2;
}

describe('naturalScoreOfV2 — сумма rarity points выраженных аллелей', () => {
  it('полностью нейтральный геном (все дефолтные аллели) -> score 0', () => {
    expect(naturalScoreOfV2(fixtureGenomeV2())).toBe(0);
  });

  it('гетерозиготный локус учитывает только ВЫРАЖЕННЫЙ (доминантный) аллель, не скрытый', () => {
    // stemForm: stem_standard (rank1, points0) / stem_climbing (rank3, points5)
    // — доминирует stem_standard, значит выраженные points = 0, не 5.
    const genome = fixtureGenomeV2({ stemForm: { a: 'stem_standard', b: 'stem_climbing' } });
    expect(naturalScoreOfV2(genome)).toBe(0);
  });

  it('суммирует очки нескольких локусов одновременно', () => {
    const genome = fixtureGenomeV2({
      primaryColor: homo('primary_frost'), // 4
      secondaryColor: homo('secondary_ochre'), // 4
      aura: homo('aura_faint'), // 1
    });
    expect(naturalScoreOfV2(genome)).toBe(9);
  });

  it('не зависит от mutationId — считает только девять локусов', () => {
    const withoutMutation = fixtureGenomeV2({ mutationId: null });
    const withMutation = fixtureGenomeV2({ mutationId: 'phoenix' });
    expect(naturalScoreOfV2(withoutMutation)).toBe(naturalScoreOfV2(withMutation));
  });
});

// Genetics V2 — Slice 13 calibration (contract §4.5.7/§4.5.8): rank-3/rank-4
// rarity points and the Epic/Legendary boundary were recalibrated (Common<3,
// Uncommon<6 and Rare<8 are UNCHANGED — the tutorial guarantees, contract
// §4.6.3/§4.6.4, pin those three exactly; only the Epic/Legendary boundary
// moved from 10 to 11, and `leaf_narrow`/`flower_cap`/`primary_leaf`/
// `secondary_sky`/`leaf_color_forest`/`pattern_spots`/`aura_glow` moved from
// 2 to 3 rarity points, `pattern_stripes` from 3 to 4). The boundary cases
// below use combinations of the RECALIBRATED point values — see
// docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.5.8 for the exact deltas
// and why each one was safe to change (none of them touch the five allele
// point values the two guaranteed tutorial breeds depend on).
describe('rarityOfV2 — границы редкости по naturalScore (без мутации)', () => {
  const cases: Array<{ overrides: Partial<GenomeV2>; expectedScore: number; expectedTier: RarityTierV2 }> = [
    { overrides: {}, expectedScore: 0, expectedTier: 'Common' },
    { overrides: { stemForm: homo('stem_branching') }, expectedScore: 2, expectedTier: 'Common' },
    { overrides: { size: homo('size_giant') }, expectedScore: 3, expectedTier: 'Uncommon' }, // нижняя граница Uncommon
    { overrides: { stemForm: homo('stem_climbing') }, expectedScore: 5, expectedTier: 'Uncommon' }, // верхняя граница Uncommon
    {
      overrides: { stemForm: homo('stem_branching'), leafForm: homo('leaf_narrow'), aura: homo('aura_faint') },
      expectedScore: 6,
      expectedTier: 'Rare',
    }, // нижняя граница Rare (2 + 3 + 1)
    {
      overrides: { primaryColor: homo('primary_frost'), size: homo('size_giant') },
      expectedScore: 7,
      expectedTier: 'Rare',
    }, // верхняя граница Rare (4 + 3)
    {
      overrides: { primaryColor: homo('primary_frost'), secondaryColor: homo('secondary_ochre') },
      expectedScore: 8,
      expectedTier: 'Epic',
    }, // нижняя граница Epic
    {
      overrides: {
        primaryColor: homo('primary_frost'),
        secondaryColor: homo('secondary_ochre'),
        aura: homo('aura_faint'),
      },
      expectedScore: 9,
      expectedTier: 'Epic',
    },
    {
      overrides: {
        stemForm: homo('stem_climbing'),
        primaryColor: homo('primary_frost'),
        aura: homo('aura_faint'),
      },
      expectedScore: 10,
      expectedTier: 'Epic',
    }, // верхняя граница Epic (расширена калибровкой Slice 13, была 9)
    {
      overrides: {
        primaryColor: homo('primary_frost'),
        secondaryColor: homo('secondary_ochre'),
        aura: homo('aura_glow'),
      },
      expectedScore: 11,
      expectedTier: 'Legendary',
    }, // нижняя граница Legendary (сдвинута калибровкой Slice 13, была 10)
  ];

  for (const { overrides, expectedScore, expectedTier } of cases) {
    it(`score=${expectedScore} -> ${expectedTier}`, () => {
      const genome = fixtureGenomeV2(overrides);
      expect(naturalScoreOfV2(genome)).toBe(expectedScore);
      expect(rarityOfV2(genome, null)).toBe(expectedTier);
    });
  }

  it('очень высокий naturalScore (максимум по всем локусам) без мутации -> Legendary, НЕ Mythic', () => {
    const maxGenome = fixtureGenomeV2({
      stemForm: homo('stem_climbing'),
      leafForm: homo('leaf_frilled'),
      flowerForm: homo('flower_star'),
      primaryColor: homo('primary_frost'),
      secondaryColor: homo('secondary_ochre'),
      leafColor: homo('leaf_color_forest'),
      pattern: homo('pattern_veins'),
      size: homo('size_giant'),
      aura: homo('aura_radiant'),
    });
    expect(rarityOfV2(maxGenome, null)).toBe('Legendary');
  });
});

describe('rarityOfV2 — mutation floors (contract §4.5.3)', () => {
  const commonGenome = fixtureGenomeV2(); // naturalScore = 0 -> Common без мутации

  it('Minor mutation (golden_vein) поднимает Common минимум до Rare', () => {
    expect(rarityOfV2(commonGenome, 'golden_vein')).toBe('Rare');
  });

  it('Minor mutation (double_bloom) — тот же floor Rare', () => {
    expect(rarityOfV2(commonGenome, 'double_bloom')).toBe('Rare');
  });

  it('Major mutation (stardust) поднимает Common минимум до Epic', () => {
    expect(rarityOfV2(commonGenome, 'stardust')).toBe('Epic');
  });

  it('Major mutation (prism) — тот же floor Epic', () => {
    expect(rarityOfV2(commonGenome, 'prism')).toBe('Epic');
  });

  it('Major mutation (luminous_edge) — тот же floor Epic', () => {
    expect(rarityOfV2(commonGenome, 'luminous_edge')).toBe('Epic');
  });

  it('Signature mutation (phoenix) с низким naturalScore (<5) поднимает минимум до Legendary, не Mythic', () => {
    const lowScoreGenome = fixtureGenomeV2({ primaryColor: homo('primary_frost') }); // score=4 < 5
    expect(naturalScoreOfV2(lowScoreGenome)).toBe(4);
    expect(rarityOfV2(lowScoreGenome, 'phoenix')).toBe('Legendary');
  });

  it('floor не занижает уже более редкий natural tier (Minor на уже-Legendary геноме остаётся Legendary)', () => {
    const alreadyLegendary = fixtureGenomeV2({
      primaryColor: homo('primary_frost'),
      secondaryColor: homo('secondary_ochre'),
      aura: homo('aura_glow'),
    }); // score=10 -> Legendary
    expect(rarityOfV2(alreadyLegendary, 'golden_vein')).toBe('Legendary');
  });

  it('каждый mutationId каталога сопоставлен ровно своему тиру (MUTATION_TIER_BY_ID) — полнота без пропусков', () => {
    const expected: Record<MutationIdV2, 'Minor' | 'Major' | 'Signature'> = {
      golden_vein: 'Minor',
      double_bloom: 'Minor',
      stardust: 'Major',
      prism: 'Major',
      luminous_edge: 'Major',
      phoenix: 'Signature',
    };
    expect(MUTATION_TIER_BY_ID).toEqual(expected);
  });
});

describe('rarityOfV2 — Mythic (contract §4.5.4, отдельное явное условие)', () => {
  // Genetics V2 — Slice 13 calibration: MYTHIC_CO_THRESHOLD moved from 5 to 6
  // (contract §4.5.8) — the boundary fixtures below use score 6/5, not 5/4.
  it('Signature mutation + naturalScore >= 6 (ровно на новом пороге) -> Mythic', () => {
    const genome = fixtureGenomeV2({ primaryColor: homo('primary_leaf'), secondaryColor: homo('secondary_sky') }); // score=6, ровно порог
    expect(naturalScoreOfV2(genome)).toBe(6);
    expect(rarityOfV2(genome, 'phoenix')).toBe('Mythic');
  });

  it('Signature mutation + naturalScore = 5 (на единицу ниже нового порога) -> Legendary, НЕ Mythic', () => {
    const genome = fixtureGenomeV2({ stemForm: homo('stem_climbing') }); // score=5
    expect(naturalScoreOfV2(genome)).toBe(5);
    expect(rarityOfV2(genome, 'phoenix')).toBe('Legendary');
  });

  it('Minor mutation никогда не даёт Mythic, даже при максимальном naturalScore', () => {
    const maxGenome = fixtureGenomeV2({
      stemForm: homo('stem_climbing'),
      leafForm: homo('leaf_frilled'),
      flowerForm: homo('flower_star'),
      primaryColor: homo('primary_frost'),
      secondaryColor: homo('secondary_ochre'),
      leafColor: homo('leaf_color_forest'),
      pattern: homo('pattern_veins'),
      size: homo('size_giant'),
      aura: homo('aura_radiant'),
    });
    expect(rarityOfV2(maxGenome, 'golden_vein')).toBe('Legendary');
  });

  it('Major mutation никогда не даёт Mythic, даже при максимальном naturalScore', () => {
    const maxGenome = fixtureGenomeV2({
      stemForm: homo('stem_climbing'),
      leafForm: homo('leaf_frilled'),
      flowerForm: homo('flower_star'),
      primaryColor: homo('primary_frost'),
      secondaryColor: homo('secondary_ochre'),
      leafColor: homo('leaf_color_forest'),
      pattern: homo('pattern_veins'),
      size: homo('size_giant'),
      aura: homo('aura_radiant'),
    });
    expect(rarityOfV2(maxGenome, 'stardust')).toBe('Legendary');
  });

  it('без мутации (mutationId=null) Mythic недостижим ни при каком naturalScore', () => {
    const maxGenome = fixtureGenomeV2({
      stemForm: homo('stem_climbing'),
      leafForm: homo('leaf_frilled'),
      flowerForm: homo('flower_star'),
      primaryColor: homo('primary_frost'),
      secondaryColor: homo('secondary_ochre'),
      leafColor: homo('leaf_color_forest'),
      pattern: homo('pattern_veins'),
      size: homo('size_giant'),
      aura: homo('aura_radiant'),
    });
    expect(rarityOfV2(maxGenome, null)).not.toBe('Mythic');
  });
});
