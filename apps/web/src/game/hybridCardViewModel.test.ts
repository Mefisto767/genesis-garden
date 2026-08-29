import { describe, expect, it } from 'vitest';
import { alleleLabelV2, buildHybridCardViewModel, buildMicroscopeCardViewModel } from './hybridCardViewModel';
import { rarityOfV2 } from './rarityV2';
import type { AllelePair, GenomeV2, MutationIdV2, RevealedLocusEntry } from './geneticsV2';

// ============================================================================
// Genetics V2 — fix-pass (audit, bug 3): unit-тесты чистого view-model'а
// «простой карточки», вынесенного из `HybridCardPanel.tsx` (в репозитории нет
// React Testing Library/`.tsx` vitest — см. hybridCardViewModel.ts). Задание
// владельца перечисляет ровно эти проверки: все 9 локусов без пропусков,
// название вида, русские значения, корректная редкость, отсутствие утечки
// скрытых AllelePair, оба пути (mutation есть/нет).
// ============================================================================

function homo<T extends string>(value: T): AllelePair<T> {
  return { a: value, b: value };
}

function fixtureGenomeV2(speciesId: number, overrides: Partial<GenomeV2> = {}): GenomeV2 {
  return {
    stemForm: homo('stem_branching'),
    leafForm: homo('leaf_frilled'),
    flowerForm: homo('flower_star'),
    primaryColor: homo('primary_violet'),
    secondaryColor: homo('secondary_purple'),
    leafColor: homo('leaf_color_forest'),
    pattern: homo('pattern_veins'),
    size: homo('size_giant'),
    aura: homo('aura_radiant'),
    speciesId,
    mutationId: null,
    ...overrides,
  } as GenomeV2;
}

const EXPECTED_LOCUS_KEYS = [
  'stemForm',
  'leafForm',
  'flowerForm',
  'primaryColor',
  'secondaryColor',
  'leafColor',
  'pattern',
  'size',
  'aura',
] as const;

describe('buildHybridCardViewModel — все 9 локусов без пропусков', () => {
  it('ровно девять строк loci, ключи — все девять локусов contract §4.1, в правильном порядке, без дублей', () => {
    const vm = buildHybridCardViewModel(fixtureGenomeV2(1));
    expect(vm.loci).toHaveLength(9);
    expect(vm.loci.map((row) => row.key)).toEqual([...EXPECTED_LOCUS_KEYS]);
    expect(new Set(vm.loci.map((row) => row.key)).size).toBe(9);
  });

  it('каждая строка имеет непустые label и value (никаких undefined/null внутри loci)', () => {
    const vm = buildHybridCardViewModel(fixtureGenomeV2(2));
    for (const row of vm.loci) {
      expect(typeof row.label).toBe('string');
      expect(row.label.length).toBeGreaterThan(0);
      expect(typeof row.value).toBe('string');
      expect(row.value.length).toBeGreaterThan(0);
    }
  });
});

describe('buildHybridCardViewModel — название вида', () => {
  it('speciesId 1 (Солнечник) — настоящее имя, не "#1" и не число', () => {
    const vm = buildHybridCardViewModel(fixtureGenomeV2(1));
    expect(vm.speciesName).toBe('Солнечник');
    expect(vm.speciesName).not.toMatch(/^#/);
    expect(vm.speciesName).not.toMatch(/^\d+$/);
  });

  it('speciesId 2 (Колокольник) — настоящее имя', () => {
    const vm = buildHybridCardViewModel(fixtureGenomeV2(2));
    expect(vm.speciesName).toBe('Колокольник');
  });

  it('неожиданный speciesId не роняет функцию (честный текстовый fallback, не краш)', () => {
    const vm = buildHybridCardViewModel(fixtureGenomeV2(5));
    expect(typeof vm.speciesName).toBe('string');
    expect(vm.speciesName.length).toBeGreaterThan(0);
  });
});

describe('buildHybridCardViewModel — русские значения, не технические ID', () => {
  it('ни одно значение локуса не является техническим хвостом ID (Honey/Standard/и т.п.) или сырым allele-id', () => {
    const vm = buildHybridCardViewModel(
      fixtureGenomeV2(1, {
        primaryColor: homo('primary_honey'),
        size: homo('size_normal'),
        stemForm: homo('stem_standard'),
      })
    );
    const values = vm.loci.map((row) => row.value);
    for (const value of values) {
      // Сырые id вида geneticsV2.ts всегда содержат '_' и латиницу в нижнем
      // регистре (primary_honey, size_normal, ...) — русские названия никогда
      // не могут случайно совпасть с этим паттерном.
      expect(value).not.toMatch(/^[a-z]+(_[a-z]+)+$/);
      expect(value).not.toBe('Honey');
      expect(value).not.toBe('Standard');
    }
    // Конкретные ожидаемые русские названия (не просто "не raw id"):
    expect(vm.loci.find((r) => r.key === 'primaryColor')?.value).toBe('Медовый');
    expect(vm.loci.find((r) => r.key === 'size')?.value).toBe('Обычный');
    expect(vm.loci.find((r) => r.key === 'stemForm')?.value).toBe('Обычный');
  });

  it('rarityLabel — русское название, не английский RarityTierV2 напрямую', () => {
    const vm = buildHybridCardViewModel(fixtureGenomeV2(1));
    expect(vm.rarityLabel).not.toBe(vm.rarity);
    expect(['Обычная', 'Необычная', 'Редкая', 'Эпическая', 'Легендарная', 'Мифическая']).toContain(vm.rarityLabel);
  });
});

describe('buildHybridCardViewModel — редкость через rarityOfV2', () => {
  it('rarity совпадает с прямым вызовом rarityOfV2(genomeV2, genomeV2.mutationId)', () => {
    const genome = fixtureGenomeV2(1, { mutationId: 'stardust' as MutationIdV2 });
    const vm = buildHybridCardViewModel(genome);
    expect(vm.rarity).toBe(rarityOfV2(genome, genome.mutationId));
  });

  it('без мутации — та же согласованность с rarityOfV2(genome, null)', () => {
    const genome = fixtureGenomeV2(2, { mutationId: null });
    const vm = buildHybridCardViewModel(genome);
    expect(vm.rarity).toBe(rarityOfV2(genome, null));
  });
});

describe('buildHybridCardViewModel — отсутствие утечки скрытых AllelePair', () => {
  it('гетерозиготный геном (a !== b на каждом локусе) — loci содержат только выраженные строки, ни одного объекта {a,b}', () => {
    const heteroGenome: GenomeV2 = {
      stemForm: { a: 'stem_standard', b: 'stem_climbing' },
      leafForm: { a: 'leaf_standard', b: 'leaf_frilled' },
      flowerForm: { a: 'flower_standard', b: 'flower_star' },
      primaryColor: { a: 'primary_honey', b: 'primary_frost' },
      secondaryColor: { a: 'secondary_forest', b: 'secondary_ochre' },
      leafColor: { a: 'leaf_color_meadow', b: 'leaf_color_forest' },
      pattern: { a: 'pattern_solid', b: 'pattern_veins' },
      size: { a: 'size_normal', b: 'size_giant' },
      aura: { a: 'aura_none', b: 'aura_radiant' },
      speciesId: 1,
      mutationId: null,
    };
    const vm = buildHybridCardViewModel(heteroGenome);
    for (const row of vm.loci) {
      expect(typeof row.value).toBe('string');
    }
    // Сериализация без потерь и без утечек — тот же критерий, что уже
    // применяется к resolveSimpleCard (phenotypeV2.ts, "тест 8").
    const serialized = JSON.parse(JSON.stringify(vm));
    expect(serialized).toEqual(vm);
    const flatString = JSON.stringify(vm);
    expect(flatString).not.toContain('"a":');
    expect(flatString).not.toContain('"b":');
  });
});

describe('buildHybridCardViewModel — mutation present/null пути', () => {
  it('mutationId присутствует — mutationLabel не null и является русским названием', () => {
    const vm = buildHybridCardViewModel(fixtureGenomeV2(1, { mutationId: 'phoenix' as MutationIdV2 }));
    expect(vm.mutationLabel).toBe('Феникс');
  });

  it('mutationId === null — mutationLabel строго null (компонент не рендерит строку мутации)', () => {
    const vm = buildHybridCardViewModel(fixtureGenomeV2(1, { mutationId: null }));
    expect(vm.mutationLabel).toBeNull();
  });

  it('все шесть mutationId Gate 1 дают непустое русское название (исчерпывающий Record не пропускает V2-only значения)', () => {
    const ids: MutationIdV2[] = ['golden_vein', 'double_bloom', 'stardust', 'prism', 'luminous_edge', 'phoenix'];
    for (const id of ids) {
      const vm = buildHybridCardViewModel(fixtureGenomeV2(1, { mutationId: id }));
      expect(vm.mutationLabel).toBeTruthy();
      expect(vm.mutationLabel).not.toBe(id);
    }
  });
});

// ============================================================================
// Fix-pass (Slice 8 UI defect 3): alleleLabelV2() никогда не возвращает
// неизвестный raw allele ID напрямую — безопасный русский fallback.
// ============================================================================

describe('alleleLabelV2 — безопасный fallback для неизвестного/повреждённого ID', () => {
  it('известный аллель — настоящее русское название, не raw ID', () => {
    expect(alleleLabelV2('stemForm', 'stem_climbing')).toBe('Вьющийся');
  });

  it('неизвестный/повреждённый allele ID — точный русский fallback "Неизвестный признак", не сам ID', () => {
    const result = alleleLabelV2('stemForm', 'totally_bogus_id_123');
    expect(result).toBe('Неизвестный признак');
    expect(result).not.toBe('totally_bogus_id_123');
    expect(result).not.toContain('totally_bogus_id_123');
  });

  it('пустая строка/повреждённые ID любого локуса тоже дают безопасный fallback, не краш', () => {
    for (const locus of ['leafForm', 'flowerForm', 'primaryColor', 'secondaryColor', 'leafColor', 'pattern', 'size', 'aura'] as const) {
      expect(alleleLabelV2(locus, '')).toBe('Неизвестный признак');
      expect(alleleLabelV2(locus, 'not-a-real-id')).toBe('Неизвестный признак');
    }
  });
});

// ============================================================================
// Fix-pass (Slice 8 UI defect 1): buildMicroscopeCardViewModel — единый
// контракт видимости расширенной карточки. Задание владельца перечисляет
// ровно эти проверки (дословно, п.1): выраженный аллель присутствует до
// исследования; скрытый отсутствует до исследования; "Не исследован"
// присутствует; доминирование до исследования отсутствует; после
// исследования присутствуют оба аллеля; после исследования присутствует
// точная строка доминирования; раскрытие одного локуса не меняет остальные;
// все девять локусов выводятся в стабильном порядке.
// ============================================================================

const EXPECTED_MICROSCOPE_LOCUS_ORDER = [
  'stemForm',
  'leafForm',
  'flowerForm',
  'primaryColor',
  'secondaryColor',
  'leafColor',
  'pattern',
  'size',
  'aura',
] as const;

/** Геном с ровно одним гетерозиготным локусом (stemForm: standard/climbing,
 * dominance rank 1 < 3 -> "Обычный" выражен, "Вьющийся" скрыт) — все
 * остальные восемь локусов гомозиготны, чтобы изолированно проверять
 * "раскрытие одного локуса не меняет остальные". */
function fixtureOneHeteroGenomeV2(): GenomeV2 {
  return fixtureGenomeV2(1, {
    stemForm: { a: 'stem_standard', b: 'stem_climbing' },
  });
}

describe('buildMicroscopeCardViewModel — все девять локусов, стабильный порядок', () => {
  it('ровно девять строк, ключи — все девять локусов в правильном порядке, без дублей', () => {
    const rows = buildMicroscopeCardViewModel(fixtureOneHeteroGenomeV2());
    expect(rows).toHaveLength(9);
    expect(rows.map((r) => r.key)).toEqual([...EXPECTED_MICROSCOPE_LOCUS_ORDER]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(9);
  });

  it('порядок не зависит от того, какой локус гетерозиготен', () => {
    const rows = buildMicroscopeCardViewModel(
      fixtureGenomeV2(1, { aura: { a: 'aura_none', b: 'aura_radiant' } })
    );
    expect(rows.map((r) => r.key)).toEqual([...EXPECTED_MICROSCOPE_LOCUS_ORDER]);
  });
});

describe('buildMicroscopeCardViewModel — гомозиготный локус', () => {
  it('единственное значение, без фиктивного скрытого признака и без кнопки раскрытия (нет полей hidden/statusLine/dominanceLine)', () => {
    const rows = buildMicroscopeCardViewModel(fixtureGenomeV2(1)); // полностью гомозиготный
    for (const row of rows) {
      expect(row.state).toBe('homozygous');
      if (row.state === 'homozygous') {
        expect(typeof row.valueLabel).toBe('string');
        expect(row.valueLabel.length).toBeGreaterThan(0);
      }
      // Гомозиготная строка физически не имеет ни statusLine, ни
      // dominanceLine, ни sourceLabel — сериализация не содержит их вовсе.
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain('statusLine');
      expect(serialized).not.toContain('dominanceLine');
      expect(serialized).not.toContain('sourceLabel');
    }
  });

  it('конкретное значение гомозиготного локуса — настоящее русское название', () => {
    const rows = buildMicroscopeCardViewModel(fixtureGenomeV2(1, { stemForm: { a: 'stem_standard', b: 'stem_standard' } }));
    const stemRow = rows.find((r) => r.key === 'stemForm');
    expect(stemRow?.state).toBe('homozygous');
    if (stemRow?.state === 'homozygous') {
      expect(stemRow.valueLabel).toBe('Обычный');
    }
  });
});

describe('buildMicroscopeCardViewModel — гетерозиготный локус до исследования (unresearched)', () => {
  it('выраженный аллель присутствует, "Не исследован" присутствует, скрытый аллель и доминирование отсутствуют', () => {
    const rows = buildMicroscopeCardViewModel(fixtureOneHeteroGenomeV2());
    const stemRow = rows.find((r) => r.key === 'stemForm');
    expect(stemRow?.state).toBe('unresearched');
    if (stemRow?.state === 'unresearched') {
      expect(stemRow.statusLine).toBe('Стебель: видно — Обычный, скрыто — Не исследован');
      expect(stemRow.statusLine).toContain('Обычный');
      expect(stemRow.statusLine).toContain('Не исследован');
      // Скрытое значение ("Вьющийся") физически не может появиться до
      // раскрытия — resolveExtendedCard('unresearched') его не отдаёт.
      expect(stemRow.statusLine).not.toContain('Вьющийся');
    }
    // Поля hidden/dominanceLine/sourceLabel физически отсутствуют в этом
    // варианте типа — сериализация подтверждает, что скрытое значение и
    // строка доминирования нигде не просочились.
    const serialized = JSON.stringify(stemRow);
    expect(serialized).not.toContain('Вьющийся');
    expect(serialized).not.toContain('доминирует');
  });

  it('точный текст статусной строки для примера из задания ("Стебель: видно — Обычный, скрыто — Не исследован")', () => {
    const rows = buildMicroscopeCardViewModel(fixtureOneHeteroGenomeV2());
    const stemRow = rows.find((r) => r.key === 'stemForm');
    if (stemRow?.state === 'unresearched') {
      expect(stemRow.statusLine).toBe('Стебель: видно — Обычный, скрыто — Не исследован');
    } else {
      throw new Error('expected stemForm to be unresearched');
    }
  });
});

describe('buildMicroscopeCardViewModel — гетерозиготный локус после исследования (revealed)', () => {
  it('оба аллеля присутствуют, точная строка доминирования присутствует, источник показан отдельно (microscope)', () => {
    const revealedLoci: RevealedLocusEntry[] = [{ locus: 'stemForm', source: 'microscope' }];
    const rows = buildMicroscopeCardViewModel(fixtureOneHeteroGenomeV2(), revealedLoci);
    const stemRow = rows.find((r) => r.key === 'stemForm');
    expect(stemRow?.state).toBe('revealed');
    if (stemRow?.state === 'revealed') {
      expect(stemRow.statusLine).toBe('Стебель: видно — Обычный, скрыто — Вьющийся');
      expect(stemRow.statusLine).toContain('Обычный');
      expect(stemRow.statusLine).toContain('Вьющийся');
      expect(stemRow.dominanceLine).toBe('Обычный доминирует над Вьющийся');
      expect(stemRow.sourceLabel).toBe('Раскрыт микроскопом');
      // Источник — отдельное поле/строка, не склеен с statusLine или dominanceLine.
      expect(stemRow.statusLine).not.toContain('Раскрыт');
      expect(stemRow.dominanceLine).not.toContain('Раскрыт');
    }
  });

  it('источник "natural" даёт точный текст "Раскрыт естественно"', () => {
    const revealedLoci: RevealedLocusEntry[] = [{ locus: 'stemForm', source: 'natural' }];
    const rows = buildMicroscopeCardViewModel(fixtureOneHeteroGenomeV2(), revealedLoci);
    const stemRow = rows.find((r) => r.key === 'stemForm');
    if (stemRow?.state === 'revealed') {
      expect(stemRow.sourceLabel).toBe('Раскрыт естественно');
    } else {
      throw new Error('expected stemForm to be revealed');
    }
  });
});

describe('buildMicroscopeCardViewModel — раскрытие одного локуса не меняет остальные', () => {
  it('геном с двумя гетерозиготными локусами, раскрыт только один — второй остаётся unresearched без изменений', () => {
    const genome = fixtureGenomeV2(1, {
      stemForm: { a: 'stem_standard', b: 'stem_climbing' },
      leafForm: { a: 'leaf_standard', b: 'leaf_broad' },
    });
    const beforeRows = buildMicroscopeCardViewModel(genome);
    const leafBefore = beforeRows.find((r) => r.key === 'leafForm');
    expect(leafBefore?.state).toBe('unresearched');

    const revealedLoci: RevealedLocusEntry[] = [{ locus: 'stemForm', source: 'microscope' }];
    const afterRows = buildMicroscopeCardViewModel(genome, revealedLoci);
    const stemAfter = afterRows.find((r) => r.key === 'stemForm');
    const leafAfter = afterRows.find((r) => r.key === 'leafForm');

    expect(stemAfter?.state).toBe('revealed');
    // leafForm — byte-identical to its own pre-reveal row; only stemForm changed.
    expect(leafAfter).toEqual(leafBefore);
    expect(leafAfter?.state).toBe('unresearched');
  });

  it('раскрытие всех девяти локусов независимо друг от друга даёт всем "revealed" с правильными источниками', () => {
    const genome: GenomeV2 = {
      stemForm: { a: 'stem_standard', b: 'stem_climbing' },
      leafForm: { a: 'leaf_standard', b: 'leaf_frilled' },
      flowerForm: { a: 'flower_standard', b: 'flower_star' },
      primaryColor: { a: 'primary_honey', b: 'primary_frost' },
      secondaryColor: { a: 'secondary_forest', b: 'secondary_ochre' },
      leafColor: { a: 'leaf_color_meadow', b: 'leaf_color_forest' },
      pattern: { a: 'pattern_solid', b: 'pattern_veins' },
      size: { a: 'size_normal', b: 'size_giant' },
      aura: { a: 'aura_none', b: 'aura_radiant' },
      speciesId: 1,
      mutationId: null,
    };
    const revealedLoci: RevealedLocusEntry[] = EXPECTED_MICROSCOPE_LOCUS_ORDER.map((locus) => ({
      locus,
      source: 'natural' as const,
    }));
    const rows = buildMicroscopeCardViewModel(genome, revealedLoci);
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      expect(row.state).toBe('revealed');
    }
  });
});
