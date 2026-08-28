import { describe, expect, it } from 'vitest';
import {
  DOMINANCE_TABLE,
  expressPhenotype,
  resolveExtendedCard,
  resolvePhenotypeV2,
  resolveSimpleCard,
  type ExtendedLocusView,
  type PhenotypeV2,
} from './phenotypeV2';
import { migrateGenomeToV2 } from './geneticsV2';
import type { AllelePair, GenomeV2, GenomeV2LocusKey, RevealedLocusEntry } from './geneticsV2';
import type { Genome } from './genetics';

// ============================================================================
// Genetics V2 — Slice 2 (Genome V2 phenotype resolver). Обязательные тесты
// из задания владельца (2026-08-28), поверх коммита 76af2bd8 (Slice 1
// принят). Ничего из Slice 3+ (breedV2/наследование/RNG/mutation
// roll/pity/rarityOfV2/Nursery Tray/пыльца/микроскоп как операция/UI) здесь
// не тестируется и не подразумевается — только чистые data-resolver
// функции над уже существующей схемой GenomeV2.
// ============================================================================

/** Независимо от реализации `DOMINANCE_TABLE` — точная копия каталога
 * контракта (`GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md` §4.2), по одному
 * массиву ID на локус в порядке возрастания dominance rank (индекс+1 = rank
 * этого аллеля). Используется как независимый эталон, а не как пересказ
 * `Object.keys(DOMINANCE_TABLE...)` самого себя. */
const EXPECTED_ALLELES_BY_RANK: Record<GenomeV2LocusKey, string[]> = {
  stemForm: ['stem_standard', 'stem_branching', 'stem_climbing'],
  leafForm: ['leaf_standard', 'leaf_broad', 'leaf_narrow', 'leaf_frilled'],
  flowerForm: ['flower_standard', 'flower_fan', 'flower_cap', 'flower_star'],
  primaryColor: [
    'primary_honey',
    'primary_amber',
    'primary_sunset',
    'primary_coral',
    'primary_lilac',
    'primary_violet',
    'primary_leaf',
    'primary_frost',
  ],
  secondaryColor: [
    'secondary_forest',
    'secondary_sunset',
    'secondary_amber',
    'secondary_crimson',
    'secondary_purple',
    'secondary_sky',
    'secondary_ochre',
  ],
  leafColor: ['leaf_color_meadow', 'leaf_color_fresh', 'leaf_color_forest'],
  pattern: ['pattern_solid', 'pattern_duotone', 'pattern_spots', 'pattern_stripes', 'pattern_veins'],
  size: ['size_normal', 'size_large', 'size_small', 'size_giant'],
  aura: ['aura_none', 'aura_faint', 'aura_glow', 'aura_radiant'],
};

const LOCI = Object.keys(EXPECTED_ALLELES_BY_RANK) as GenomeV2LocusKey[];

function homo<T extends string>(value: T): AllelePair<T> {
  return { a: value, b: value };
}

/** Полностью гомозиготный (нейтральный, всё видимое) фикстурный геном —
 * удобная база для точечных `overrides` в отдельных тестах. */
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('тест 1: полная проверка DOMINANCE_TABLE — все аллели всех 9 локусов присутствуют ровно один раз', () => {
  it('DOMINANCE_TABLE содержит ровно эти девять локусов, ни одним больше/меньше', () => {
    expect(Object.keys(DOMINANCE_TABLE).sort()).toEqual(LOCI.slice().sort());
  });

  it.each(LOCI)('локус %s: набор ID совпадает с эталоном контракта §4.2 без пропусков и дублей', (locus) => {
    const table = DOMINANCE_TABLE[locus] as Record<string, { rank: number }>;
    const expectedAlleles = EXPECTED_ALLELES_BY_RANK[locus];
    expect(Object.keys(table).sort()).toEqual(expectedAlleles.slice().sort());
    // Ни одной записи без числового rank (никакого fallback/default).
    for (const allele of expectedAlleles) {
      expect(table[allele]).toBeDefined();
      expect(typeof table[allele].rank).toBe('number');
    }
  });

  it.each(LOCI)('локус %s: ранги — контурная последовательность 1..N без пропусков и дублей', (locus) => {
    const table = DOMINANCE_TABLE[locus] as Record<string, { rank: number }>;
    const expectedAlleles = EXPECTED_ALLELES_BY_RANK[locus];
    const ranks = Object.values(table).map((entry) => entry.rank).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: expectedAlleles.length }, (_, i) => i + 1));
  });

  it.each(LOCI)('локус %s: порядок эталонного массива совпадает с возрастанием rank (индекс+1 = rank)', (locus) => {
    const table = DOMINANCE_TABLE[locus] as Record<string, { rank: number }>;
    EXPECTED_ALLELES_BY_RANK[locus].forEach((allele, index) => {
      expect(table[allele].rank).toBe(index + 1);
    });
  });
});

describe('тест 2: все гомозиготные варианты выражаются напрямую', () => {
  it.each(LOCI)('локус %s: expressPhenotype({a:X,b:X}) === X для каждого X', (locus) => {
    const table = DOMINANCE_TABLE[locus] as Record<string, { rank: number }>;
    for (const allele of EXPECTED_ALLELES_BY_RANK[locus]) {
      expect(expressPhenotype({ a: allele, b: allele }, table)).toBe(allele);
    }
  });
});

describe('тест 3: все возможные гетерозиготные пары каждого локуса выбирают правильный dominance rank', () => {
  it.each(LOCI)('локус %s: для каждой упорядоченной пары (i,j), i!==j — выражается аллель с меньшим rank', (locus) => {
    const table = DOMINANCE_TABLE[locus] as Record<string, { rank: number }>;
    const alleles = EXPECTED_ALLELES_BY_RANK[locus];
    for (const a of alleles) {
      for (const b of alleles) {
        if (a === b) continue;
        const expected = table[a].rank < table[b].rank ? a : b;
        expect(expressPhenotype({ a, b }, table)).toBe(expected);
      }
    }
  });
});

describe('тест 4: перестановка a/b не меняет фенотип', () => {
  it.each(LOCI)('локус %s: expressPhenotype({a,b}) === expressPhenotype({b,a}) для всех пар', (locus) => {
    const table = DOMINANCE_TABLE[locus] as Record<string, { rank: number }>;
    const alleles = EXPECTED_ALLELES_BY_RANK[locus];
    for (const a of alleles) {
      for (const b of alleles) {
        expect(expressPhenotype({ a, b }, table)).toBe(expressPhenotype({ a: b, b: a }, table));
      }
    }
  });
});

describe('тест 5: полный GenomeV2 резолвится во все 9 выраженных признаков', () => {
  it('resolvePhenotypeV2 возвращает выраженный аллель по каждому локусу — смесь гомо/гетерозигот', () => {
    const genome = fixtureGenomeV2({
      // Гетерозиготы — ожидание считается вручную по таблице рангов.
      leafForm: { a: 'leaf_frilled', b: 'leaf_broad' }, // broad(2) < frilled(4) -> broad
      primaryColor: { a: 'primary_frost', b: 'primary_amber' }, // amber(2) < frost(8) -> amber
      size: { a: 'size_giant', b: 'size_normal' }, // normal(1) < giant(4) -> normal
      speciesId: 7,
      mutationId: 'stardust',
    });

    const phenotype = resolvePhenotypeV2(genome);

    expect(phenotype).toEqual({
      stemForm: 'stem_standard',
      leafForm: 'leaf_broad',
      flowerForm: 'flower_standard',
      primaryColor: 'primary_amber',
      secondaryColor: 'secondary_forest',
      leafColor: 'leaf_color_meadow',
      pattern: 'pattern_solid',
      size: 'size_normal',
      aura: 'aura_none',
      speciesId: 7,
      mutationId: 'stardust',
    } satisfies PhenotypeV2);
  });

  it('охватывает гетерозиготу на каждом из 9 локусов по отдельности (по одному тесту на локус)', () => {
    for (const locus of LOCI) {
      const alleles = EXPECTED_ALLELES_BY_RANK[locus];
      if (alleles.length < 2) continue;
      const dominant = alleles[0]; // rank 1
      const recessive = alleles[alleles.length - 1]; // максимальный rank в этом локусе
      const genome = fixtureGenomeV2({ [locus]: { a: recessive, b: dominant } } as Partial<GenomeV2>);
      const phenotype = resolvePhenotypeV2(genome) as unknown as Record<string, string>;
      expect(phenotype[locus]).toBe(dominant);
    }
  });
});

describe('тест 6: speciesId и mutationId сохраняются 1:1', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('speciesId=%i передаётся без изменений', (speciesId) => {
    const genome = fixtureGenomeV2({ speciesId });
    expect(resolvePhenotypeV2(genome).speciesId).toBe(speciesId);
    expect(resolveSimpleCard(genome).speciesId).toBe(speciesId);
    expect(resolveExtendedCard(genome).speciesId).toBe(speciesId);
  });

  it.each(['golden_vein', 'double_bloom', 'stardust', 'prism', 'luminous_edge', 'phoenix', null] as const)(
    'mutationId=%s передаётся без изменений',
    (mutationId) => {
      const genome = fixtureGenomeV2({ mutationId });
      expect(resolvePhenotypeV2(genome).mutationId).toBe(mutationId);
      expect(resolveSimpleCard(genome).mutationId).toBe(mutationId);
      expect(resolveExtendedCard(genome).mutationId).toBe(mutationId);
    }
  );
});

describe('тест 7: мигрировавший гомозиготный legacy specimen сохраняет прежние визуальные значения', () => {
  it('legacy Genome -> migrateGenomeToV2 (Slice 1) -> resolvePhenotypeV2 (Slice 2) даёт те же визуальные значения, что и исходный legacy-геном', () => {
    const legacyGenome: Genome = {
      shape: 4,
      primary: '#FFC85C', // -> primary_honey (contract §4.2)
      secondary: '#57993A', // -> secondary_forest
      leaf: '#89D65C', // -> leaf_color_meadow
      pattern: 'duotone', // -> pattern_duotone
      size: 'large', // -> size_large
      aura: 'glow', // -> aura_glow
      mutationId: 'golden_vein',
    };

    const genomeV2 = migrateGenomeToV2(legacyGenome);
    // Миграция гомозиготна на каждом локусе (Slice 1, delta doc §7 п.1) —
    // резолвер не должен ничего пересчитывать сверх выбора a===b.
    for (const locus of LOCI) {
      const pair = genomeV2[locus] as AllelePair<string>;
      expect(pair.a).toBe(pair.b);
    }

    const phenotype = resolvePhenotypeV2(genomeV2);

    expect(phenotype.primaryColor).toBe('primary_honey');
    expect(phenotype.secondaryColor).toBe('secondary_forest');
    expect(phenotype.leafColor).toBe('leaf_color_meadow');
    expect(phenotype.pattern).toBe('pattern_duotone');
    expect(phenotype.size).toBe('size_large');
    expect(phenotype.aura).toBe('aura_glow');
    expect(phenotype.speciesId).toBe(4);
    expect(phenotype.mutationId).toBe('golden_vein');
    // Новые геометрические локусы без legacy-аналога — нейтральный дефолт,
    // визуально совпадающий со "стандартным" (Slice 1, delta doc §7 п.3).
    expect(phenotype.stemForm).toBe('stem_standard');
    expect(phenotype.leafForm).toBe('leaf_standard');
    expect(phenotype.flowerForm).toBe('flower_standard');
  });

  it('охватывает species 3-8 (legacy, не Солнечник/Колокольник) — резолвер не запрещает и не меняет их фенотип', () => {
    const legacyGenome: Genome = {
      shape: 6,
      primary: '#B678D9',
      secondary: '#A9D4E2',
      leaf: '#6FBE44',
      pattern: 'solid',
      size: 'small',
      aura: 'none',
      mutationId: null,
    };
    const genomeV2 = migrateGenomeToV2(legacyGenome);
    const phenotype = resolvePhenotypeV2(genomeV2);
    expect(phenotype.speciesId).toBe(6);
    expect(phenotype.primaryColor).toBe('primary_violet');
    expect(phenotype.secondaryColor).toBe('secondary_sky');
    expect(phenotype.leafColor).toBe('leaf_color_fresh');
    expect(phenotype.size).toBe('size_small');
  });
});

describe('тест 8: простая карточка не содержит скрытых значений даже после сериализации', () => {
  it('resolveSimpleCard: только строки/числа выраженного фенотипа, никакого AllelePair', () => {
    const genome = fixtureGenomeV2({
      size: { a: 'size_giant', b: 'size_normal' }, // гетерозигота — скрытый size_giant не должен утечь
      aura: { a: 'aura_radiant', b: 'aura_none' },
    });
    const card = resolveSimpleCard(genome);

    expect(Object.keys(card).sort()).toEqual(
      [
        'stemForm', 'leafForm', 'flowerForm', 'primaryColor', 'secondaryColor',
        'leafColor', 'pattern', 'size', 'aura', 'speciesId', 'mutationId',
      ].sort()
    );
    for (const locus of LOCI) {
      expect(typeof (card as unknown as Record<string, unknown>)[locus]).toBe('string');
    }
    // size выражается как normal (rank 1 < rank 4) — скрытый giant не виден.
    expect(card.size).toBe('size_normal');
    expect(card.aura).toBe('aura_none');

    const roundTripped = JSON.parse(JSON.stringify(card));
    expect(roundTripped).toEqual(card);
    const serialized = JSON.stringify(card);
    // Сырые скрытые значения не появляются в сериализованном виде нигде.
    expect(serialized).not.toContain('size_giant');
    expect(serialized).not.toContain('aura_radiant');
    expect(serialized).not.toContain('"a":');
    expect(serialized).not.toContain('"b":');
  });
});

describe('тест 9: нераскрытая гетерозигота возвращает только unresearched', () => {
  it('resolveExtendedCard без revealedLoci: state=unresearched, expressed присутствует, hidden/rank/source отсутствуют', () => {
    const genome = fixtureGenomeV2({
      size: { a: 'size_giant', b: 'size_normal' },
    });
    const card = resolveExtendedCard(genome, []);
    const view = card.size as ExtendedLocusView<string>;

    expect(view.state).toBe('unresearched');
    expect((view as { expressed: string }).expressed).toBe('size_normal');
    expect(Object.keys(view).sort()).toEqual(['expressed', 'state']);
    expect('hidden' in view).toBe(false);
    expect('hiddenRank' in view).toBe(false);
    expect('source' in view).toBe(false);

    // Сериализация тоже не содержит скрытого значения.
    expect(JSON.stringify(view)).not.toContain('size_giant');
  });
});

describe('тест 10: раскрытие microscope и natural показывает скрытое значение и правильный источник', () => {
  it.each(['microscope', 'natural'] as const)('source=%s — hidden/hiddenRank/source корректны', (source) => {
    const genome = fixtureGenomeV2({
      size: { a: 'size_giant', b: 'size_normal' },
    });
    const revealedLoci: RevealedLocusEntry[] = [{ locus: 'size', source }];
    const card = resolveExtendedCard(genome, revealedLoci);
    const view = card.size as Extract<ExtendedLocusView<string>, { state: 'revealed' }>;

    expect(view.state).toBe('revealed');
    expect(view.expressed).toBe('size_normal');
    expect(view.hidden).toBe('size_giant');
    expect(view.hiddenRank).toBe(4); // size_giant rank (contract §4.2)
    expect(view.source).toBe(source);
  });

  it('раскрытие одного локуса не раскрывает другой нераскрытый гетерозиготный локус того же specimen', () => {
    const genome = fixtureGenomeV2({
      size: { a: 'size_giant', b: 'size_normal' },
      aura: { a: 'aura_radiant', b: 'aura_none' },
    });
    const card = resolveExtendedCard(genome, [{ locus: 'size', source: 'microscope' }]);
    expect((card.size as { state: string }).state).toBe('revealed');
    expect((card.aura as { state: string }).state).toBe('unresearched');
  });
});

describe('тест 11: гомозигота никогда не считается имеющей скрытый аллель', () => {
  it('гомозиготный локус — всегда state=homozygous, даже если revealedLoci ошибочно содержит запись для него', () => {
    const genome = fixtureGenomeV2(); // все локусы гомозиготны
    const bogusRevealed: RevealedLocusEntry[] = [{ locus: 'size', source: 'microscope' }];
    const card = resolveExtendedCard(genome, bogusRevealed);
    const view = card.size as ExtendedLocusView<string>;

    expect(view.state).toBe('homozygous');
    expect((view as { allele: string }).allele).toBe('size_normal');
    expect(Object.keys(view).sort()).toEqual(['allele', 'state']);
  });

  it.each(LOCI)('локус %s: гомозигота на каждом отдельном аллеле — всегда homozygous', (locus) => {
    for (const allele of EXPECTED_ALLELES_BY_RANK[locus]) {
      const genome = fixtureGenomeV2({ [locus]: homo(allele) } as Partial<GenomeV2>);
      const card = resolveExtendedCard(genome) as unknown as Record<string, { state: string }>;
      expect(card[locus].state).toBe('homozygous');
    }
  });
});

describe('тест 12: резолверы не мутируют входной GenomeV2/Specimen/revealedLoci', () => {
  it('resolvePhenotypeV2 / resolveSimpleCard / resolveExtendedCard не изменяют замороженный genomeV2', () => {
    const genome = deepFreeze(
      fixtureGenomeV2({
        size: { a: 'size_giant', b: 'size_normal' },
      })
    );
    const revealedLoci = deepFreeze([{ locus: 'size', source: 'microscope' }] as RevealedLocusEntry[]);
    const before = JSON.parse(JSON.stringify(genome));
    const revealedBefore = JSON.parse(JSON.stringify(revealedLoci));

    expect(() => resolvePhenotypeV2(genome)).not.toThrow();
    expect(() => resolveSimpleCard(genome)).not.toThrow();
    expect(() => resolveExtendedCard(genome, revealedLoci)).not.toThrow();

    expect(genome).toEqual(before);
    expect(revealedLoci).toEqual(revealedBefore);
  });

  it('resolveExtendedCard возвращает новый объект каждый раз, не переиспользует/не мутирует revealedLoci между вызовами', () => {
    const genome = fixtureGenomeV2({ size: { a: 'size_giant', b: 'size_normal' } });
    const revealedLoci: RevealedLocusEntry[] = [{ locus: 'size', source: 'natural' }];
    const revealedLociSnapshot = JSON.parse(JSON.stringify(revealedLoci));

    resolveExtendedCard(genome, revealedLoci);
    resolveExtendedCard(genome, revealedLoci);

    expect(revealedLoci).toEqual(revealedLociSnapshot);
    expect(revealedLoci).toHaveLength(1);
  });
});

describe('тест 13: отсутствие кодоминантных результатов — каждый локус всегда выражает ровно один аллель', () => {
  it.each(LOCI)('локус %s: результат expressPhenotype всегда строго равен pair.a или pair.b, никогда третье значение', (locus) => {
    const table = DOMINANCE_TABLE[locus] as Record<string, { rank: number }>;
    const alleles = EXPECTED_ALLELES_BY_RANK[locus];
    for (const a of alleles) {
      for (const b of alleles) {
        const result = expressPhenotype({ a, b }, table);
        expect(result === a || result === b).toBe(true);
      }
    }
  });

  it('resolvePhenotypeV2: ни одно из 9 полей не является объектом/массивом (никакого "смешанного" значения)', () => {
    const genome = fixtureGenomeV2({
      leafForm: { a: 'leaf_frilled', b: 'leaf_broad' },
      pattern: { a: 'pattern_veins', b: 'pattern_solid' },
    });
    const phenotype = resolvePhenotypeV2(genome) as unknown as Record<string, unknown>;
    for (const locus of LOCI) {
      expect(typeof phenotype[locus]).toBe('string');
    }
  });
});
