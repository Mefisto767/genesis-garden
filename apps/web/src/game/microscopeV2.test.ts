import { describe, expect, it } from 'vitest';
import type { AllelePair, GenomeV2, RevealedLocusEntry } from './geneticsV2';
import { availableLociForRevealV2, insufficientDustLabelV2, MICROSCOPE_REVEAL_COST } from './microscopeV2';

// ============================================================================
// Genetics V2 — Slice 8: microscopeV2.ts — чистые функции выбора доступных
// для раскрытия локусов + текст недостатка пыли (contract §4.11.3/§4.11.4).
// Store-level атомарность списания/раскрытия — store.microscopeV2.test.ts.
// ============================================================================

function homo<T extends string>(value: T): AllelePair<T> {
  return { a: value, b: value };
}

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

describe('MICROSCOPE_REVEAL_COST', () => {
  it('равна 3 (contract §4.11.3)', () => {
    expect(MICROSCOPE_REVEAL_COST).toBe(3);
  });
});

describe('availableLociForRevealV2', () => {
  it('полностью гомозиготный геном — доступных локусов нет', () => {
    expect(availableLociForRevealV2(fixtureGenomeV2())).toEqual([]);
  });

  it('гетерозиготный нераскрытый локус — доступен для раскрытия', () => {
    const genome = fixtureGenomeV2({ stemForm: { a: 'stem_standard', b: 'stem_climbing' } });
    expect(availableLociForRevealV2(genome)).toEqual(['stemForm']);
  });

  it('не предлагает гомозиготные локусы, даже если для них ошибочно есть revealedLoci-запись', () => {
    const genome = fixtureGenomeV2();
    const revealedLoci: RevealedLocusEntry[] = [{ locus: 'stemForm', source: 'natural' }];
    // stemForm гомозиготен в этой фикстуре — `resolveExtendedCard` должен
    // безусловно вернуть `homozygous`, игнорируя ошибочную запись (тот же
    // инвариант, что уже покрыт в phenotypeV2.test.ts).
    expect(availableLociForRevealV2(genome, revealedLoci)).toEqual([]);
  });

  it('уже раскрытый локус (natural или microscope) исключается из доступных', () => {
    const genome = fixtureGenomeV2({
      stemForm: { a: 'stem_standard', b: 'stem_climbing' },
      leafForm: { a: 'leaf_standard', b: 'leaf_broad' },
    });
    const revealedLoci: RevealedLocusEntry[] = [{ locus: 'stemForm', source: 'natural' }];
    expect(availableLociForRevealV2(genome, revealedLoci)).toEqual(['leafForm']);

    const bothRevealed: RevealedLocusEntry[] = [
      { locus: 'stemForm', source: 'natural' },
      { locus: 'leafForm', source: 'microscope' },
    ];
    expect(availableLociForRevealV2(genome, bothRevealed)).toEqual([]);
  });

  it('сохраняет стабильный порядок девяти локусов (GENOME_V2_LOCUS_KEYS)', () => {
    const genome = fixtureGenomeV2({
      leafForm: { a: 'leaf_standard', b: 'leaf_broad' },
      stemForm: { a: 'stem_standard', b: 'stem_climbing' },
    });
    // stemForm объявлен раньше leafForm в GENOME_V2_LOCUS_KEYS — порядок
    // результата должен это отражать независимо от порядка override'ов выше.
    expect(availableLociForRevealV2(genome)).toEqual(['stemForm', 'leafForm']);
  });
});

describe('insufficientDustLabelV2', () => {
  it('точный текст (contract §4.11.4): "Не хватает пыли: нужно 3, есть M"', () => {
    expect(insufficientDustLabelV2(0)).toBe('Не хватает пыли: нужно 3, есть 0');
    expect(insufficientDustLabelV2(2)).toBe('Не хватает пыли: нужно 3, есть 2');
  });
});
