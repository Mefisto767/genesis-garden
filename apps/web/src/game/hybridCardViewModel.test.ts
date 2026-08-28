import { describe, expect, it } from 'vitest';
import { buildHybridCardViewModel } from './hybridCardViewModel';
import { rarityOfV2 } from './rarityV2';
import type { AllelePair, GenomeV2, MutationIdV2 } from './geneticsV2';

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
