import { describe, expect, it } from 'vitest';
import {
  NURSERY_TRAY_CAPACITY,
  SPECIES_GROWTH_V2,
  hybridGrowthStatusV2,
  nurseryTrayFullHint,
  nurseryTrayLabel,
  regrowStatusV2,
  speciesGrowthV2,
} from './nurseryV2';
import type { AllelePair, GenomeV2 } from './geneticsV2';

// ============================================================================
// Genetics V2 — Slice 5 (growth timing, contract §4.8.3). Обязательные тесты
// из задания владельца: точные границы первого роста (5/8 минут) и
// повторного цикла (20/30 минут) для species 1/2, чуть меньше/чуть больше
// порога.
// ============================================================================

function homo<T extends string>(value: T): AllelePair<T> {
  return { a: value, b: value };
}

function fixtureGenomeV2(speciesId: number): GenomeV2 {
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
  } as GenomeV2;
}

describe('NURSERY_TRAY_CAPACITY', () => {
  it('вместимость трея — 8 (delta doc §6 п.1)', () => {
    expect(NURSERY_TRAY_CAPACITY).toBe(8);
  });
});

describe('SPECIES_GROWTH_V2 — точные значения из delta doc §2.1', () => {
  it('Солнечник (speciesId 1) — первый рост 5 мин, повторный цикл 20 мин', () => {
    expect(SPECIES_GROWTH_V2[1]).toEqual({ firstGrowMs: 5 * 60 * 1000, regrowMs: 20 * 60 * 1000 });
  });

  it('Колокольник (speciesId 2) — первый рост 8 мин, повторный цикл 30 мин', () => {
    expect(SPECIES_GROWTH_V2[2]).toEqual({ firstGrowMs: 8 * 60 * 1000, regrowMs: 30 * 60 * 1000 });
  });

  it('неподдерживаемый species (3-8) не имеет V2-конфигурации роста', () => {
    expect(speciesGrowthV2(3)).toBeUndefined();
    expect(speciesGrowthV2(8)).toBeUndefined();
  });
});

describe('hybridGrowthStatusV2 — первый рост', () => {
  it('null, если ещё не посажено (plantedAt=null)', () => {
    const genomeV2 = fixtureGenomeV2(1);
    expect(hybridGrowthStatusV2({ genomeV2, plantedAt: null })).toBeNull();
  });

  it('null для неподдерживаемого species', () => {
    const genomeV2 = fixtureGenomeV2(3);
    expect(hybridGrowthStatusV2({ genomeV2, plantedAt: 0 }, 1000)).toBeNull();
  });

  it('Солнечник: на 1мс меньше 5 минут — ещё не готово', () => {
    const genomeV2 = fixtureGenomeV2(1);
    const plantedAt = 0;
    const now = 5 * 60 * 1000 - 1;
    const status = hybridGrowthStatusV2({ genomeV2, plantedAt }, now);
    expect(status?.ready).toBe(false);
    expect(status?.remainingMs).toBe(1);
  });

  it('Солнечник: ровно 5 минут — готово', () => {
    const genomeV2 = fixtureGenomeV2(1);
    const status = hybridGrowthStatusV2({ genomeV2, plantedAt: 0 }, 5 * 60 * 1000);
    expect(status?.ready).toBe(true);
    expect(status?.progress).toBe(1);
    expect(status?.remainingMs).toBe(0);
  });

  it('Колокольник: на 1мс меньше 8 минут — ещё не готово', () => {
    const genomeV2 = fixtureGenomeV2(2);
    const now = 8 * 60 * 1000 - 1;
    const status = hybridGrowthStatusV2({ genomeV2, plantedAt: 0 }, now);
    expect(status?.ready).toBe(false);
  });

  it('Колокольник: ровно 8 минут — готово', () => {
    const genomeV2 = fixtureGenomeV2(2);
    const status = hybridGrowthStatusV2({ genomeV2, plantedAt: 0 }, 8 * 60 * 1000);
    expect(status?.ready).toBe(true);
  });

  it('progress — доля прошедшего времени, ограничена [0,1]', () => {
    const genomeV2 = fixtureGenomeV2(1);
    const half = hybridGrowthStatusV2({ genomeV2, plantedAt: 0 }, 2.5 * 60 * 1000);
    expect(half?.progress).toBeCloseTo(0.5, 5);
    const overgrown = hybridGrowthStatusV2({ genomeV2, plantedAt: 0 }, 999 * 60 * 1000);
    expect(overgrown?.progress).toBe(1);
  });
});

describe('regrowStatusV2 — повторный цикл', () => {
  it('null для неподдерживаемого species', () => {
    expect(regrowStatusV2(5, 0, 1000)).toBeNull();
  });

  it('Солнечник: на 1мс меньше 20 минут — ещё не готово', () => {
    const status = regrowStatusV2(1, 0, 20 * 60 * 1000 - 1);
    expect(status?.ready).toBe(false);
    expect(status?.remainingMs).toBe(1);
  });

  it('Солнечник: ровно 20 минут — готово', () => {
    const status = regrowStatusV2(1, 0, 20 * 60 * 1000);
    expect(status?.ready).toBe(true);
    expect(status?.remainingMs).toBe(0);
  });

  it('Колокольник: на 1мс меньше 30 минут — ещё не готово', () => {
    const status = regrowStatusV2(2, 0, 30 * 60 * 1000 - 1);
    expect(status?.ready).toBe(false);
  });

  it('Колокольник: ровно 30 минут — готово', () => {
    const status = regrowStatusV2(2, 0, 30 * 60 * 1000);
    expect(status?.ready).toBe(true);
  });

  it('считается от lastHarvestAt, не от произвольной точки отсчёта', () => {
    const status = regrowStatusV2(1, 1_000_000, 1_000_000 + 20 * 60 * 1000);
    expect(status?.ready).toBe(true);
    const notYet = regrowStatusV2(1, 1_000_000, 1_000_000 + 20 * 60 * 1000 - 1);
    expect(notYet?.ready).toBe(false);
  });
});

// ============================================================================
// Genetics V2 fix-pass (audit, bug 2) — точный текст полного Nursery Tray.
// ============================================================================

describe('nurseryTrayLabel', () => {
  it('ровно 8/8 (capacity) — дословно "Питомник заполнен: 8/8", без перестановки', () => {
    expect(nurseryTrayLabel(8, 8)).toBe('Питомник заполнен: 8/8');
  });

  it('по умолчанию capacity = NURSERY_TRAY_CAPACITY', () => {
    expect(nurseryTrayLabel(NURSERY_TRAY_CAPACITY)).toBe(`Питомник заполнен: ${NURSERY_TRAY_CAPACITY}/${NURSERY_TRAY_CAPACITY}`);
  });

  it('пустой трей — обычный формат "Питомник: 0/8", не "заполнен"', () => {
    expect(nurseryTrayLabel(0, 8)).toBe('Питомник: 0/8');
  });

  it('частично заполненный трей (1/8) — обычный формат', () => {
    expect(nurseryTrayLabel(1, 8)).toBe('Питомник: 1/8');
  });

  it('7/8 — ещё не полный, обычный формат', () => {
    expect(nurseryTrayLabel(7, 8)).toBe('Питомник: 7/8');
  });

  it('count > capacity (защитный случай) — тоже считается "заполнен"', () => {
    expect(nurseryTrayLabel(9, 8)).toBe('Питомник заполнен: 9/8');
  });
});

// ============================================================================
// Slice 7 UI-фикс (defect report bug 1) — подсказка при заполненном питомнике
// как ОТДЕЛЬНОЕ значение от nurseryTrayLabel(), не дописанное в ту же строку.
// ============================================================================

describe('nurseryTrayFullHint', () => {
  it('7/8 — ещё не полный, подсказки нет (null)', () => {
    expect(nurseryTrayFullHint(7, 8)).toBeNull();
  });

  it('ровно 8/8 (capacity) — дословный текст подсказки', () => {
    expect(nurseryTrayFullHint(8, 8)).toBe(
      'Посади одно из семян на грядку или переработай его, чтобы освободить место.'
    );
  });

  it('по умолчанию capacity = NURSERY_TRAY_CAPACITY', () => {
    expect(nurseryTrayFullHint(NURSERY_TRAY_CAPACITY)).toBe(
      'Посади одно из семян на грядку или переработай его, чтобы освободить место.'
    );
  });

  it('пустой трей (0/8) — подсказки нет', () => {
    expect(nurseryTrayFullHint(0, 8)).toBeNull();
  });

  it('count > capacity (защитный случай) — подсказка тоже показывается', () => {
    expect(nurseryTrayFullHint(9, 8)).toBe(
      'Посади одно из семян на грядку или переработай его, чтобы освободить место.'
    );
  });
});
