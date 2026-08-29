import { describe, expect, it } from 'vitest';
import {
  buildRevealCardViewModel,
  buildRevealWhyViewModel,
  computeNaturalRevealsV2,
  findPendingHybridRevealV2,
  resolveTraitOriginV2,
  traitOriginLabelsV2,
} from './revealV2';
import { GENOME_V2_LOCUS_KEYS, type AllelePair, type GenomeV2 } from './geneticsV2';

// ============================================================================
// Genetics V2 — Slice 12: Reveal view-model + естественное раскрытие. Юнит
// покрытие §4.14.5/§4.14.6/§4.14.7 GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md.
// Не тестирует UI (RevealPanelV2.tsx) — только чистые функции над уже
// готовыми GenomeV2 (той же дисциплины, что hybridCardViewModel.test.ts).
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

describe('resolveTraitOriginV2 — происхождение вычисляется структурно из a/b, не по совпадению фенотипа', () => {
  it('гомозиготный локус (a===b===expressed) — origin "both"', () => {
    const genome = fixtureGenomeV2(1);
    const rows = resolveTraitOriginV2(genome, false);
    expect(rows).toHaveLength(GENOME_V2_LOCUS_KEYS.length);
    for (const row of rows) expect(row.origin).toBe('both');
  });

  it('выражен a (Seed Parent) — origin "seed"', () => {
    const genome = fixtureGenomeV2(1, {
      // stem_standard доминантен над stem_climbing (dominance table) —
      // a=stem_standard выражается.
      stemForm: { a: 'stem_standard', b: 'stem_climbing' },
    });
    const row = resolveTraitOriginV2(genome, false).find((r) => r.locus === 'stemForm')!;
    expect(row.origin).toBe('seed');
  });

  it('выражен b (Pollen Parent) — origin "pollen"', () => {
    const genome = fixtureGenomeV2(1, {
      stemForm: { a: 'stem_climbing', b: 'stem_standard' },
    });
    const row = resolveTraitOriginV2(genome, false).find((r) => r.locus === 'stemForm')!;
    expect(row.origin).toBe('pollen');
  });

  it('мутировавший локус aura — всегда "mutation", даже если a===b', () => {
    const genome = fixtureGenomeV2(1, { aura: homo('aura_radiant') });
    const row = resolveTraitOriginV2(genome, true).find((r) => r.locus === 'aura')!;
    expect(row.origin).toBe('mutation');
  });

  it('mutated=true, но локус не aura — не помечается mutation', () => {
    const genome = fixtureGenomeV2(1);
    const rows = resolveTraitOriginV2(genome, true);
    for (const row of rows) {
      if (row.locus !== 'aura') expect(row.origin).not.toBe('mutation');
    }
  });

  it('стабильный порядок 9 признаков — совпадает с GENOME_V2_LOCUS_KEYS', () => {
    const genome = fixtureGenomeV2(1);
    const rows = resolveTraitOriginV2(genome, false);
    expect(rows.map((r) => r.locus)).toEqual([...GENOME_V2_LOCUS_KEYS]);
  });

  it('не содержит сырых id — locus/valueLabel только из известных таблиц меток', () => {
    const genome = fixtureGenomeV2(1);
    const rows = resolveTraitOriginV2(genome, false);
    for (const row of rows) {
      expect(row.label).not.toMatch(/^(stem|leaf|flower|primary|secondary|pattern|size|aura)_/);
      expect(row.valueLabel).not.toMatch(/^(stem|leaf|flower|primary|secondary|pattern|size|aura)_/);
    }
  });
});

describe('traitOriginLabelsV2 — одновидовые/разновидовые подписи, both — оба текста', () => {
  it('одновидовые родители, origin seed/pollen — «От первого/второго растения»', () => {
    expect(traitOriginLabelsV2('seed', 1, 1)).toEqual(['От первого растения']);
    expect(traitOriginLabelsV2('pollen', 1, 1)).toEqual(['От второго растения']);
  });

  it('разновидовые родители — стрелка к названию вида', () => {
    const seedLabels = traitOriginLabelsV2('seed', 1, 2);
    const pollenLabels = traitOriginLabelsV2('pollen', 1, 2);
    expect(seedLabels[0]).toMatch(/^← /);
    expect(pollenLabels[0]).toMatch(/^← /);
    expect(seedLabels).not.toEqual(pollenLabels);
  });

  it('origin "both" — возвращает ОБА текста, не выбирает один случайно', () => {
    const labels = traitOriginLabelsV2('both', 1, 1);
    expect(labels).toHaveLength(2);
    expect(labels).toEqual(['От первого растения', 'От второго растения']);
  });

  it('origin "mutation" — фиксированный текст, без ссылки на родителя', () => {
    expect(traitOriginLabelsV2('mutation', 1, 2)).toEqual(['✦ Новый признак']);
  });
});

describe('computeNaturalRevealsV2 — естественное раскрытие затрагивает только правильный локус', () => {
  it('скрытый аллель родителя равен выраженному значению потомка — раскрывает только этот locus у этого родителя', () => {
    const seed = fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } });
    const pollen = fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } });
    const child = fixtureGenomeV2(1, { size: homo('size_large') });
    const result = computeNaturalRevealsV2(child, seed, pollen, false);
    expect(result.seedLoci).toEqual(['size']);
    expect(result.pollenLoci).toEqual(['size']);
  });

  it('раскрывает только у одного родителя, если только у него скрытый аллель совпал', () => {
    const seed = fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } });
    const pollen = fixtureGenomeV2(1, { size: homo('size_normal') }); // гомозиготен — нечего раскрывать
    // Child гомозиготен size_large — единственный способ реально выразить
    // рецессивный size_large (size_normal доминантен, rank1<rank2).
    const child = fixtureGenomeV2(1, { size: homo('size_large') });
    const result = computeNaturalRevealsV2(child, seed, pollen, false);
    expect(result.seedLoci).toEqual(['size']);
    expect(result.pollenLoci).toEqual([]);
  });

  it('гомозиготный родитель по локусу — никогда не попадает в результат (нечего раскрывать)', () => {
    const seed = fixtureGenomeV2(1, { size: homo('size_normal') });
    const pollen = fixtureGenomeV2(1, { size: homo('size_normal') });
    const child = fixtureGenomeV2(1, { size: homo('size_normal') });
    const result = computeNaturalRevealsV2(child, seed, pollen, false);
    expect(result.seedLoci).toEqual([]);
    expect(result.pollenLoci).toEqual([]);
  });

  it('скрытый аллель родителя НЕ совпадает с потомком — не раскрывается', () => {
    const seed = fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } });
    const pollen = fixtureGenomeV2(1, { size: homo('size_normal') });
    const child = fixtureGenomeV2(1, { size: homo('size_normal') }); // выражен size_normal, не скрытый size_large
    const result = computeNaturalRevealsV2(child, seed, pollen, false);
    expect(result.seedLoci).toEqual([]);
  });

  it('не затрагивает другие локусы, когда только один локус раскрывается', () => {
    const seed = fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } });
    const pollen = fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } });
    const child = fixtureGenomeV2(1, { size: homo('size_large') });
    const result = computeNaturalRevealsV2(child, seed, pollen, false);
    expect(result.seedLoci).toEqual(['size']);
    expect(result.pollenLoci).toEqual(['size']);
    expect(result.seedLoci).not.toContain('stemForm');
    expect(result.pollenLoci).not.toContain('leafForm');
  });

  // Genetics V2 — Slice 12 fix-pass (contract §4.14.14, owner review §2):
  // mutation-locus regression — a mutated locus is never natural-reveal
  // provenance, even when a parent happens to carry the exact same hidden
  // allele that the mutation produced.
  it('мутировавший aura (mutated=true) — родитель скрыто несёт aura_radiant, потомок получает aura_radiant через mutation event — natural reveal НЕ происходит ни у одного родителя', () => {
    const seed = fixtureGenomeV2(1, { aura: { a: 'aura_faint', b: 'aura_radiant' } });
    const pollen = fixtureGenomeV2(1, { aura: { a: 'aura_faint', b: 'aura_radiant' } });
    const child = fixtureGenomeV2(1, { aura: homo('aura_radiant') }); // проявилось через мутацию, не наследование
    const result = computeNaturalRevealsV2(child, seed, pollen, true);
    expect(result.seedLoci).not.toContain('aura');
    expect(result.pollenLoci).not.toContain('aura');
  });

  it('НЕ мутировавший aura (mutated=false) — тот же скрытый aura_radiant у родителя, естественно выраженный у потомка, раскрывается как обычно', () => {
    const seed = fixtureGenomeV2(1, { aura: { a: 'aura_faint', b: 'aura_radiant' } });
    const pollen = fixtureGenomeV2(1, { aura: { a: 'aura_faint', b: 'aura_radiant' } });
    const child = fixtureGenomeV2(1, { aura: homo('aura_radiant') });
    const result = computeNaturalRevealsV2(child, seed, pollen, false);
    expect(result.seedLoci).toContain('aura');
    expect(result.pollenLoci).toContain('aura');
  });

  it('mutated=true не затрагивает раскрытие ДРУГИХ локусов (только aura исключается)', () => {
    const seed = fixtureGenomeV2(1, {
      size: { a: 'size_normal', b: 'size_large' },
      aura: { a: 'aura_faint', b: 'aura_radiant' },
    });
    const pollen = fixtureGenomeV2(1, {
      size: { a: 'size_normal', b: 'size_large' },
      aura: { a: 'aura_faint', b: 'aura_radiant' },
    });
    const child = fixtureGenomeV2(1, { size: homo('size_large'), aura: homo('aura_radiant') });
    const result = computeNaturalRevealsV2(child, seed, pollen, true);
    expect(result.seedLoci).toEqual(['size']);
    expect(result.pollenLoci).toEqual(['size']);
  });
});

describe('findPendingHybridRevealV2 — pure selector over Specimen[] (Slice 12 fix-pass, contract §4.14.14)', () => {
  function fixtureSpecimen(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      genome: {} as never,
      createdAt: 0,
      genomeV2: fixtureGenomeV2(1),
      ...overrides,
    } as never;
  }

  it('null when no specimen has a pending Reveal', () => {
    const specimens = [fixtureSpecimen('a', { revealAcknowledged: true }), fixtureSpecimen('b')];
    expect(findPendingHybridRevealV2(specimens)).toBeNull();
  });

  it('finds the specimen with revealAcknowledged===false — undefined (N/A) and true (already acknowledged) are both ignored', () => {
    const pending = fixtureSpecimen('c', { revealAcknowledged: false });
    const specimens = [fixtureSpecimen('a'), fixtureSpecimen('b', { revealAcknowledged: true }), pending];
    const result = findPendingHybridRevealV2(specimens);
    expect(result?.specimen.id).toBe('c');
  });

  it('mutated/mutationTier derived from genomeV2.mutationId, not stored separately', () => {
    const specimens = [
      fixtureSpecimen('m', {
        revealAcknowledged: false,
        genomeV2: fixtureGenomeV2(1, { mutationId: 'golden_vein' }),
      }),
    ];
    const result = findPendingHybridRevealV2(specimens);
    expect(result?.mutated).toBe(true);
    expect(result?.mutationTier).toBe('Minor');
  });

  it('falls back to genomeV2.speciesId for both seed/pollen species when revealParentSpecies is missing', () => {
    const specimens = [fixtureSpecimen('x', { revealAcknowledged: false })];
    const result = findPendingHybridRevealV2(specimens);
    expect(result?.seedSpeciesId).toBe(1);
    expect(result?.pollenSpeciesId).toBe(1);
  });

  it('uses the captured revealParentSpecies when present', () => {
    const specimens = [fixtureSpecimen('y', { revealAcknowledged: false, revealParentSpecies: [1, 2] })];
    const result = findPendingHybridRevealV2(specimens);
    expect(result?.seedSpeciesId).toBe(1);
    expect(result?.pollenSpeciesId).toBe(2);
  });

  it('defaults naturalReveal to empty when revealNaturalReveal is missing', () => {
    const specimens = [fixtureSpecimen('z', { revealAcknowledged: false })];
    const result = findPendingHybridRevealV2(specimens);
    expect(result?.naturalReveal).toEqual({ seedLoci: [], pollenLoci: [] });
  });
});

describe('buildRevealCardViewModel / buildRevealWhyViewModel — без утечки сырых id', () => {
  it('view-model не содержит сырых allele/species id как значения', () => {
    const genome = fixtureGenomeV2(1);
    const vm = buildRevealCardViewModel(genome, 1, 1, false, 'Обычная', null);
    expect(vm.speciesName).not.toMatch(/^species_/);
    for (const t of vm.traits) {
      expect(t.valueLabel).not.toMatch(/_/);
    }
  });

  it('Why-экран показывает только фактически выраженные в потомке признаки (то же множество, что card)', () => {
    const genome = fixtureGenomeV2(1);
    const naturalReveal = { seedLoci: [], pollenLoci: [] };
    const why = buildRevealWhyViewModel(genome, 1, 1, false, null, naturalReveal);
    expect(why.traits).toHaveLength(GENOME_V2_LOCUS_KEYS.length);
    expect(why.mutationTierDescription).toBeNull();
    expect(why.hasNaturalReveal).toBe(false);
  });

  it('hasNaturalReveal true, если хотя бы один локус раскрылся у любого родителя', () => {
    const genome = fixtureGenomeV2(1);
    const why = buildRevealWhyViewModel(genome, 1, 1, false, null, { seedLoci: ['size'], pollenLoci: [] });
    expect(why.hasNaturalReveal).toBe(true);
  });
});
