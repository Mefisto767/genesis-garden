import { describe, expect, it } from 'vitest';
import {
  RARITY_RECYCLE_DUST,
  grownRecycleDustV2,
  nurseryRecycleDustV2,
  firstRecycleTopUpV2,
  recycleNoticeLines,
} from './recyclingV2';
import type { AllelePair, GenomeV2 } from './geneticsV2';
import type { RarityTierV2 } from './rarityV2';

// ============================================================================
// Genetics V2 — Slice 7: recycling economy (contract §4.10.1, delta doc §0.9).
// Чистые функции/константы — без RNG, без GameState. Store-level интеграция
// (recycleNurserySeedV2/recycleSpecimenV2, атомарность, firstRecycleTopUpClaimed,
// ambiguous_plot_reference) — store.recyclingV2.test.ts.
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

describe('RARITY_RECYCLE_DUST / grownRecycleDustV2 — полный тариф (100%), все 6 тиров', () => {
  const expected: Record<RarityTierV2, number> = {
    Common: 1,
    Uncommon: 2,
    Rare: 5,
    Epic: 12,
    Legendary: 30,
    Mythic: 80,
  };

  (Object.keys(expected) as RarityTierV2[]).forEach((tier) => {
    it(`${tier} -> ${expected[tier]}`, () => {
      expect(RARITY_RECYCLE_DUST[tier]).toBe(expected[tier]);
    });
  });

  it('Common-геном -> grownRecycleDustV2 = 1 (rarityOfV2 определяет тир, не mutationId напрямую)', () => {
    expect(grownRecycleDustV2(fixtureGenomeV2(1))).toBe(1);
  });

  it('Rare-геном (mutationId=golden_vein, Minor floor) -> grownRecycleDustV2 = 5', () => {
    expect(grownRecycleDustV2(fixtureGenomeV2(1, { mutationId: 'golden_vein' }))).toBe(5);
  });

  it('Legendary-геном (mutationId=phoenix, naturalScore<5) -> grownRecycleDustV2 = 30', () => {
    expect(grownRecycleDustV2(fixtureGenomeV2(1, { mutationId: 'phoenix' }))).toBe(30);
  });

  it('Mythic-геном (mutationId=phoenix + naturalScore>=5) -> grownRecycleDustV2 = 80 (через rarityOfV2, не mutationId напрямую)', () => {
    const genome = fixtureGenomeV2(1, { mutationId: 'phoenix', pattern: homo('pattern_veins'), aura: homo('aura_faint') }); // Slice 13: MYTHIC_CO_THRESHOLD moved 5->6, score must be >=6 (5+1=6)
    expect(grownRecycleDustV2(genome)).toBe(80);
  });
});

describe('nurseryRecycleDustV2 — половинный тариф (Nursery Tray), max(1, floor(full/2)), все 6 тиров', () => {
  const expected: Record<RarityTierV2, number> = {
    Common: 1,
    Uncommon: 1,
    Rare: 2,
    Epic: 6,
    Legendary: 15,
    Mythic: 40,
  };

  it('Common (full=1) -> floor(1/2)=0 -> max(1,0)=1', () => {
    expect(nurseryRecycleDustV2(fixtureGenomeV2(1))).toBe(expected.Common);
  });

  it('Uncommon (full=2) -> floor(2/2)=1', () => {
    // naturalScore=4 (leaf_frilled, 4 rarity points) даёт Uncommon без мутации.
    const genome = fixtureGenomeV2(1, { leafForm: homo('leaf_frilled') });
    expect(grownRecycleDustV2(genome)).toBe(2);
    expect(nurseryRecycleDustV2(genome)).toBe(expected.Uncommon);
  });

  it('Rare (full=5) -> floor(5/2)=2, НЕ 3 — Math.floor зафиксирован явно, снимает неоднозначность округления', () => {
    const genome = fixtureGenomeV2(1, { mutationId: 'golden_vein' });
    expect(grownRecycleDustV2(genome)).toBe(5);
    expect(nurseryRecycleDustV2(genome)).toBe(2);
  });

  it('Epic (full=12) -> floor(12/2)=6', () => {
    const genome = fixtureGenomeV2(1, { mutationId: 'stardust' });
    expect(nurseryRecycleDustV2(genome)).toBe(expected.Epic);
  });

  it('Legendary (full=30) -> floor(30/2)=15', () => {
    const genome = fixtureGenomeV2(1, { mutationId: 'phoenix' });
    expect(nurseryRecycleDustV2(genome)).toBe(expected.Legendary);
  });

  it('Mythic (full=80) -> floor(80/2)=40', () => {
    const genome = fixtureGenomeV2(1, { mutationId: 'phoenix', pattern: homo('pattern_veins'), aura: homo('aura_faint') }); // Slice 13: MYTHIC_CO_THRESHOLD moved 5->6, score must be >=6 (5+1=6)
    expect(nurseryRecycleDustV2(genome)).toBe(expected.Mythic);
  });
});

describe('firstRecycleTopUpV2 — компенсация до 3 при первой переработке', () => {
  it('Common (base=1), флаг false -> дополняется до 3 (topUpDust=2, dustGained=3)', () => {
    expect(firstRecycleTopUpV2(1, false)).toEqual({ baseDust: 1, topUpDust: 2, dustGained: 3 });
  });

  it('Uncommon nursery (base=1), флаг false -> тоже дополняется до 3', () => {
    expect(firstRecycleTopUpV2(1, false)).toEqual({ baseDust: 1, topUpDust: 2, dustGained: 3 });
  });

  it('Rare nursery (base=2), флаг false -> дополняется до 3 (topUpDust=1)', () => {
    expect(firstRecycleTopUpV2(2, false)).toEqual({ baseDust: 2, topUpDust: 1, dustGained: 3 });
  });

  it('награда уже >= 3 (base=5), флаг false -> компенсация НЕ добавляется', () => {
    expect(firstRecycleTopUpV2(5, false)).toEqual({ baseDust: 5, topUpDust: 0, dustGained: 5 });
  });

  it('награда ровно 3, флаг false -> компенсация не добавляется (граничное значение)', () => {
    expect(firstRecycleTopUpV2(3, false)).toEqual({ baseDust: 3, topUpDust: 0, dustGained: 3 });
  });

  it('флаг уже true -> компенсация не повторяется, даже если base < 3', () => {
    expect(firstRecycleTopUpV2(1, true)).toEqual({ baseDust: 1, topUpDust: 0, dustGained: 1 });
  });
});

// ============================================================================
// Slice 7 UI-фикс (defect report bug 2) — структурированный результат
// уведомления о переработке: ДВЕ раздельные строки, не одна собранная через
// ` · ` строка. `.tsx` рендерит `primary`/`secondary` как два отдельных
// DOM-элемента (см. LabPanelV2.tsx/AlbumPanelV2.tsx) — здесь проверяется
// только чистая модель представления.
// ============================================================================

describe('recycleNoticeLines', () => {
  it('dustGained=3 -> primary "+3 генетической пыли", secondary дословно, без общей строки', () => {
    expect(recycleNoticeLines(3)).toEqual({
      primary: '+3 генетической пыли',
      secondary: 'Пыль пригодится в лаборатории',
    });
  });

  it('dustGained=1 -> "+1 генетической пыли"', () => {
    expect(recycleNoticeLines(1)).toEqual({
      primary: '+1 генетической пыли',
      secondary: 'Пыль пригодится в лаборатории',
    });
  });

  it('dustGained=80 (Mythic, полный тариф) -> "+80 генетической пыли"', () => {
    expect(recycleNoticeLines(80)).toEqual({
      primary: '+80 генетической пыли',
      secondary: 'Пыль пригодится в лаборатории',
    });
  });

  it('ни primary, ни secondary не содержат "·" — они не объединены в одну строку', () => {
    const lines = recycleNoticeLines(5);
    expect(lines.primary).not.toContain('·');
    expect(lines.secondary).not.toContain('·');
  });
});
