import { describe, expect, it } from 'vitest';
import { buildParentageViewModel } from './parentageV2';
import type { AllelePair, GenomeV2 } from './geneticsV2';
import type { Specimen } from './types';
import { projectGenomeV2ToLegacy } from './legacyProjectionV2';

// ============================================================================
// Genetics V2 — Slice 10 (contract §4.13.2, delta doc §0.12 п.1-2): unit-тесты
// чистой view-model'и блока «Родители». Тот же принцип, что
// hybridCardViewModel.test.ts — репозиторий не имеет React Testing Library,
// поэтому вся содержательная логика тестируется на уровне `.ts`, не рендера
// компонента.
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

function fixtureSpecimen(id: string, genomeV2: GenomeV2 | undefined, overrides: Partial<Specimen> = {}): Specimen {
  return {
    id,
    genome: genomeV2 ? projectGenomeV2ToLegacy(genomeV2) : projectGenomeV2ToLegacy(fixtureGenomeV2(1)),
    genomeV2,
    createdAt: 0,
    ...overrides,
  };
}

describe('buildParentageViewModel — visibility', () => {
  it('parentIds === undefined → блок полностью отсутствует', () => {
    const vm = buildParentageViewModel(undefined, []);
    expect(vm.visible).toBe(false);
    expect(vm.rows).toEqual([]);
  });

  it('parentIds === null → блок полностью отсутствует', () => {
    const vm = buildParentageViewModel(null, []);
    expect(vm.visible).toBe(false);
    expect(vm.rows).toEqual([]);
  });
});

describe('buildParentageViewModel — порядок и русские названия видов', () => {
  it('первый элемент parentIds -> «Первый родитель» (Seed, Солнечник), второй -> «Второй родитель» (Pollen, Колокольник)', () => {
    const seed = fixtureSpecimen('seed-1', fixtureGenomeV2(1));
    const pollen = fixtureSpecimen('pollen-1', fixtureGenomeV2(2));
    const vm = buildParentageViewModel(['seed-1', 'pollen-1'], [seed, pollen]);

    expect(vm.visible).toBe(true);
    expect(vm.rows).toHaveLength(2);
    expect(vm.rows[0].roleLabel).toBe('Первый родитель');
    expect(vm.rows[0].available).toBe(true);
    expect(vm.rows[0].speciesName).toBe('Солнечник');
    expect(vm.rows[1].roleLabel).toBe('Второй родитель');
    expect(vm.rows[1].available).toBe(true);
    expect(vm.rows[1].speciesName).toBe('Колокольник');
  });

  it('перестановка parentIds меняет местами роли (не сортируется по id/порядку в allSpecimens)', () => {
    const seed = fixtureSpecimen('a', fixtureGenomeV2(2));
    const pollen = fixtureSpecimen('b', fixtureGenomeV2(1));
    // allSpecimens в порядке [pollen, seed] — не должно влиять на роли.
    const vm = buildParentageViewModel(['b', 'a'], [pollen, seed]);
    expect(vm.rows[0].speciesName).toBe('Солнечник'); // b -> species 1
    expect(vm.rows[1].speciesName).toBe('Колокольник'); // a -> species 2
  });
});

describe('buildParentageViewModel — недоступные родители', () => {
  it('один родитель удалён/переработан (не найден в allSpecimens) -> «available: false», вторая строка не затронута', () => {
    const seed = fixtureSpecimen('seed-1', fixtureGenomeV2(1));
    const vm = buildParentageViewModel(['seed-1', 'missing-pollen'], [seed]);

    expect(vm.rows[0].available).toBe(true);
    expect(vm.rows[0].speciesName).toBe('Солнечник');
    expect(vm.rows[1].available).toBe(false);
    expect(vm.rows[1].speciesName).toBeUndefined();
    expect(vm.rows[1].genome).toBeUndefined();
  });

  it('оба родителя удалены -> обе строки available: false', () => {
    const vm = buildParentageViewModel(['missing-seed', 'missing-pollen'], []);
    expect(vm.rows[0].available).toBe(false);
    expect(vm.rows[1].available).toBe(false);
  });

  it('родитель найден, но повреждён (нет genomeV2) -> available: false, как и для не найденного', () => {
    const corrupted = fixtureSpecimen('corrupted', undefined);
    const vm = buildParentageViewModel(['corrupted', 'also-missing'], [corrupted]);
    expect(vm.rows[0].available).toBe(false);
    expect(vm.rows[1].available).toBe(false);
  });
});

describe('buildParentageViewModel — не раскрывает raw ID и скрытые данные', () => {
  it('raw parentId (длинная уникальная строка) отсутствует в любом строковом значении view-model', () => {
    const uniqueSeedId = 'seed-unique-marker-9f3c1a';
    const uniquePollenId = 'pollen-unique-marker-7b2e4d';
    const seed = fixtureSpecimen(uniqueSeedId, fixtureGenomeV2(1));
    const pollen = fixtureSpecimen(uniquePollenId, fixtureGenomeV2(2));
    const vm = buildParentageViewModel([uniqueSeedId, uniquePollenId], [seed, pollen]);

    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain(uniqueSeedId);
    expect(serialized).not.toContain(uniquePollenId);
  });

  it('view-model не содержит genomeV2/AllelePair-подобных полей ({a, b}) ни в одной строке', () => {
    const seed = fixtureSpecimen('seed-1', fixtureGenomeV2(1));
    const pollen = fixtureSpecimen('pollen-1', fixtureGenomeV2(2));
    const vm = buildParentageViewModel(['seed-1', 'pollen-1'], [seed, pollen]);

    for (const row of vm.rows) {
      expect(row).not.toHaveProperty('genomeV2');
      expect(row).not.toHaveProperty('alleles');
      expect(row).not.toHaveProperty('parentIds');
      if (row.genome) {
        // legacy Genome — плоский объект, не AllelePair-структура.
        expect(row.genome).not.toHaveProperty('a');
        expect(row.genome).not.toHaveProperty('b');
      }
    }
  });
});

describe('buildParentageViewModel — не реконструирует родословную и не меняется при переработке родителя', () => {
  it('specimen без parentIds (создан до Slice 5) -> visible всегда false, ничего не восстанавливается', () => {
    const vm = buildParentageViewModel(undefined, [fixtureSpecimen('lonely', fixtureGenomeV2(1))]);
    expect(vm.visible).toBe(false);
  });

  it('переработка/удаление родителя из allSpecimens не меняет исходный parentIds потомка — только делает соответствующую строку недоступной', () => {
    const seed = fixtureSpecimen('seed-1', fixtureGenomeV2(1));
    const pollen = fixtureSpecimen('pollen-1', fixtureGenomeV2(2));
    const parentIds: [string, string] = ['seed-1', 'pollen-1'];

    const before = buildParentageViewModel(parentIds, [seed, pollen]);
    expect(before.rows[1].available).toBe(true);

    // Родитель "переработан" — исчезает из allSpecimens, parentIds потомка
    // (владелец этого массива — store.ts, не эта функция) не трогается.
    const afterRecycle = buildParentageViewModel(parentIds, [seed]);
    expect(parentIds).toEqual(['seed-1', 'pollen-1']);
    expect(afterRecycle.rows[0].available).toBe(true);
    expect(afterRecycle.rows[1].available).toBe(false);
  });
});

describe('buildParentageViewModel — JSON round-trip', () => {
  it('JSON.parse(JSON.stringify(parentIds)) сохраняет порядок Seed/Pollen на выходе view-model', () => {
    const seed = fixtureSpecimen('seed-1', fixtureGenomeV2(1));
    const pollen = fixtureSpecimen('pollen-1', fixtureGenomeV2(2));
    const original: [string, string] = ['seed-1', 'pollen-1'];
    const roundTripped = JSON.parse(JSON.stringify(original)) as [string, string];

    const vm = buildParentageViewModel(roundTripped, [seed, pollen]);
    expect(vm.rows[0].roleLabel).toBe('Первый родитель');
    expect(vm.rows[0].speciesName).toBe('Солнечник');
    expect(vm.rows[1].roleLabel).toBe('Второй родитель');
    expect(vm.rows[1].speciesName).toBe('Колокольник');
  });
});
