import { describe, expect, it } from 'vitest';
import { projectGenomeV2ToLegacy, __TEST_ONLY__ } from './legacyProjectionV2';
import { PRIMARY_HEX_TO_ID, SECONDARY_HEX_TO_ID, LEAF_COLOR_HEX_TO_ID } from './geneticsV2';
import type { AllelePair, GenomeV2, MutationIdV2 } from './geneticsV2';

// ============================================================================
// Genetics V2 — Slice 5 (legacy-совместимая проекция, contract §4.8.6).
// Обязательные тесты из задания владельца (проход 8, pre-Slice-5
// contract-lock pass): корректность по каждому каталогу, инвариант
// solid->secondary=primary, отсутствие geometric-локусов в результате,
// отсутствие мутации исходного genomeV2.
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

describe('round-trip согласованность обратных таблиц с прямыми geneticsV2.ts', () => {
  it('PRIMARY_COLOR_TO_HEX — инверсия PRIMARY_HEX_TO_ID без расхождений', () => {
    for (const [hex, id] of Object.entries(PRIMARY_HEX_TO_ID)) {
      expect(__TEST_ONLY__.PRIMARY_COLOR_TO_HEX[id]).toBe(hex);
    }
    expect(Object.keys(__TEST_ONLY__.PRIMARY_COLOR_TO_HEX)).toHaveLength(Object.keys(PRIMARY_HEX_TO_ID).length);
  });

  it('SECONDARY_COLOR_TO_HEX — инверсия SECONDARY_HEX_TO_ID без расхождений', () => {
    for (const [hex, id] of Object.entries(SECONDARY_HEX_TO_ID)) {
      expect(__TEST_ONLY__.SECONDARY_COLOR_TO_HEX[id]).toBe(hex);
    }
    expect(Object.keys(__TEST_ONLY__.SECONDARY_COLOR_TO_HEX)).toHaveLength(Object.keys(SECONDARY_HEX_TO_ID).length);
  });

  it('LEAF_COLOR_TO_HEX — инверсия LEAF_COLOR_HEX_TO_ID без расхождений', () => {
    for (const [hex, id] of Object.entries(LEAF_COLOR_HEX_TO_ID)) {
      expect(__TEST_ONLY__.LEAF_COLOR_TO_HEX[id]).toBe(hex);
    }
    expect(Object.keys(__TEST_ONLY__.LEAF_COLOR_TO_HEX)).toHaveLength(Object.keys(LEAF_COLOR_HEX_TO_ID).length);
  });
});

describe('projectGenomeV2ToLegacy — базовые поля', () => {
  it('shape = speciesId', () => {
    expect(projectGenomeV2ToLegacy(fixtureGenomeV2({ speciesId: 2 })).shape).toBe(2);
  });

  it('mutationId копируется строкой как есть (включая null)', () => {
    expect(projectGenomeV2ToLegacy(fixtureGenomeV2({ mutationId: null })).mutationId).toBeNull();
  });

  const ALL_MUTATION_IDS: MutationIdV2[] = ['golden_vein', 'double_bloom', 'stardust', 'prism', 'luminous_edge', 'phoenix'];
  for (const id of ALL_MUTATION_IDS) {
    it(`mutationId '${id}' (включая ID, недостижимые через legacy-код) копируется как есть`, () => {
      expect(projectGenomeV2ToLegacy(fixtureGenomeV2({ mutationId: id })).mutationId).toBe(id);
    });
  }

  it('результат не содержит geometric-локусов stemForm/leafForm/flowerForm', () => {
    const result = projectGenomeV2ToLegacy(fixtureGenomeV2()) as unknown as Record<string, unknown>;
    expect(result).not.toHaveProperty('stemForm');
    expect(result).not.toHaveProperty('leafForm');
    expect(result).not.toHaveProperty('flowerForm');
  });

  it('не мутирует и не сохраняет ссылку на переданный genomeV2', () => {
    const genomeV2 = fixtureGenomeV2({ primaryColor: { a: 'primary_honey', b: 'primary_frost' } });
    const snapshot = JSON.parse(JSON.stringify(genomeV2));
    projectGenomeV2ToLegacy(genomeV2);
    expect(genomeV2).toEqual(snapshot);
  });

  it('чистая/детерминированная — повторный вызов на том же геноме даёт тот же результат', () => {
    const genomeV2 = fixtureGenomeV2({ aura: { a: 'aura_none', b: 'aura_radiant' } });
    expect(projectGenomeV2ToLegacy(genomeV2)).toEqual(projectGenomeV2ToLegacy(genomeV2));
  });
});

describe('projectGenomeV2ToLegacy — primaryColor -> hex (все 8 аллелей)', () => {
  for (const [hex, id] of Object.entries(PRIMARY_HEX_TO_ID)) {
    it(`${id} -> ${hex}`, () => {
      // pattern гетерозиготный duotone-эквивалент, чтобы secondary НЕ
      // перезаписывался solid-инвариантом и primary тестировался изолированно.
      const genome = fixtureGenomeV2({ primaryColor: homo(id), pattern: homo('pattern_duotone') });
      expect(projectGenomeV2ToLegacy(genome).primary).toBe(hex);
    });
  }
});

describe('projectGenomeV2ToLegacy — secondaryColor -> hex (все 7 аллелей, pattern не solid)', () => {
  for (const [hex, id] of Object.entries(SECONDARY_HEX_TO_ID)) {
    it(`${id} -> ${hex}`, () => {
      const genome = fixtureGenomeV2({ secondaryColor: homo(id), pattern: homo('pattern_duotone') });
      expect(projectGenomeV2ToLegacy(genome).secondary).toBe(hex);
    });
  }
});

describe('projectGenomeV2ToLegacy — leafColor -> hex (все 3 аллеля)', () => {
  for (const [hex, id] of Object.entries(LEAF_COLOR_HEX_TO_ID)) {
    it(`${id} -> ${hex}`, () => {
      const genome = fixtureGenomeV2({ leafColor: homo(id) });
      expect(projectGenomeV2ToLegacy(genome).leaf).toBe(hex);
    });
  }
});

describe('projectGenomeV2ToLegacy — size -> legacy size (все 4 аллеля)', () => {
  const cases: Array<[string, string]> = [
    ['size_small', 'small'],
    ['size_normal', 'normal'],
    ['size_large', 'large'],
    ['size_giant', 'giant'],
  ];
  for (const [id, expected] of cases) {
    it(`${id} -> ${expected}`, () => {
      const genome = fixtureGenomeV2({ size: homo(id as GenomeV2['size']['a']) });
      expect(projectGenomeV2ToLegacy(genome).size).toBe(expected);
    });
  }
});

describe('projectGenomeV2ToLegacy — aura -> legacy aura (все 4 аллеля)', () => {
  const cases: Array<[string, string]> = [
    ['aura_none', 'none'],
    ['aura_faint', 'faint'],
    ['aura_glow', 'glow'],
    ['aura_radiant', 'radiant'],
  ];
  for (const [id, expected] of cases) {
    it(`${id} -> ${expected}`, () => {
      const genome = fixtureGenomeV2({ aura: homo(id as GenomeV2['aura']['a']) });
      expect(projectGenomeV2ToLegacy(genome).aura).toBe(expected);
    });
  }
});

describe('projectGenomeV2ToLegacy — pattern (5 V2-аллелей -> 2 legacy значения)', () => {
  it('pattern_solid -> solid', () => {
    const genome = fixtureGenomeV2({ pattern: homo('pattern_solid') });
    expect(projectGenomeV2ToLegacy(genome).pattern).toBe('solid');
  });

  const NON_SOLID = ['pattern_duotone', 'pattern_spots', 'pattern_stripes', 'pattern_veins'] as const;
  for (const id of NON_SOLID) {
    it(`${id} -> duotone (нет legacy-эквивалента)`, () => {
      const genome = fixtureGenomeV2({ pattern: homo(id) });
      expect(projectGenomeV2ToLegacy(genome).pattern).toBe('duotone');
    });
  }
});

describe('projectGenomeV2ToLegacy — solid-инвариант (contract §4.8.6)', () => {
  it('при итоговом legacy pattern=solid secondary принудительно равен primary, независимо от secondaryColor генотипа', () => {
    const genome = fixtureGenomeV2({
      pattern: homo('pattern_solid'),
      primaryColor: homo('primary_frost'),
      secondaryColor: homo('secondary_ochre'), // намеренно другой цвет — должен быть проигнорирован
    });
    const legacy = projectGenomeV2ToLegacy(genome);
    expect(legacy.pattern).toBe('solid');
    expect(legacy.secondary).toBe(legacy.primary);
    expect(legacy.primary).toBe('#CBE9F2');
  });

  it('при итоговом legacy pattern=duotone secondary соответствует собственному secondaryColor, не primary', () => {
    const genome = fixtureGenomeV2({
      pattern: homo('pattern_veins'), // -> duotone
      primaryColor: homo('primary_frost'),
      secondaryColor: homo('secondary_ochre'),
    });
    const legacy = projectGenomeV2ToLegacy(genome);
    expect(legacy.pattern).toBe('duotone');
    expect(legacy.primary).toBe('#CBE9F2');
    expect(legacy.secondary).toBe('#D98C12');
    expect(legacy.secondary).not.toBe(legacy.primary);
  });
});

describe('projectGenomeV2ToLegacy — использует выраженный (доминантный), не скрытый аллель', () => {
  it('гетерозиготный локус проецирует только выраженное значение', () => {
    // stem/leaf/flower не проецируются вовсе, но primaryColor — проецируется:
    // primary_honey (rank1) доминирует над primary_frost (rank8).
    const genome = fixtureGenomeV2({
      primaryColor: { a: 'primary_honey', b: 'primary_frost' },
      pattern: homo('pattern_duotone'),
    });
    expect(projectGenomeV2ToLegacy(genome).primary).toBe('#FFC85C');
  });
});
