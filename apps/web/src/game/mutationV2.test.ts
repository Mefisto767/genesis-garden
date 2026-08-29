import { describe, expect, it } from 'vitest';
import {
  applyMutationAlleleToAura,
  breedV2,
  mutationEventChance,
  rollAuraMutationSide,
  rollMutationId,
  rollMutationTier,
  type BreedV2Result,
} from './mutationV2';
import { rarityOfV2, type MutationTierV2 } from './rarityV2';
import type { AllelePair, GenomeV2, MutationIdV2 } from './geneticsV2';
import { mulberry32 } from './rng';
import type { RngFn } from './rng';

// ============================================================================
// Genetics V2 — Slice 4 (mutation roll, pity, `breedV2`). Обязательные тесты
// из задания владельца (2026-08-28, пакетный проход Slice 3-4), поверх
// коммита Slice 3 (`feat(genetics): add V2 same-species inheritance`).
// Расширено Slice 9 (contract §4.12): межвидовые пары 1×2/2×1 больше не
// отклоняются — обязательный speciesId-инвариант (никогда не отклоняется от
// Seed Parent, включая гарантированную мутацию) протестирован здесь же, где
// живёт mutation event. Nursery Tray, пыльца, переработка, микроскоп,
// родословная, Reveal/onboarding, UI — здесь не тестируется и не
// подразумевается.
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

/** Родители, различающиеся на всех 9 локусах — тот же паттерн, что и в
 * inheritanceV2.test.ts, чтобы проверять «какой конкретно аллель родителя
 * попал в потомка» и после подключения mutation roll (Slice 4), не только
 * в чистом наследовании (Slice 3). */
function distinctSeedGenome(): GenomeV2 {
  return fixtureGenomeV2(1, {
    stemForm: { a: 'stem_standard', b: 'stem_branching' },
    leafForm: { a: 'leaf_standard', b: 'leaf_broad' },
    flowerForm: { a: 'flower_standard', b: 'flower_fan' },
    primaryColor: { a: 'primary_honey', b: 'primary_amber' },
    secondaryColor: { a: 'secondary_forest', b: 'secondary_sunset' },
    leafColor: { a: 'leaf_color_meadow', b: 'leaf_color_fresh' },
    pattern: { a: 'pattern_solid', b: 'pattern_duotone' },
    size: { a: 'size_normal', b: 'size_large' },
    aura: { a: 'aura_none', b: 'aura_faint' },
  });
}

function distinctPollenGenome(): GenomeV2 {
  return fixtureGenomeV2(1, {
    stemForm: { a: 'stem_climbing', b: 'stem_branching' },
    leafForm: { a: 'leaf_narrow', b: 'leaf_frilled' },
    flowerForm: { a: 'flower_cap', b: 'flower_star' },
    primaryColor: { a: 'primary_lilac', b: 'primary_violet' },
    secondaryColor: { a: 'secondary_crimson', b: 'secondary_purple' },
    leafColor: { a: 'leaf_color_fresh', b: 'leaf_color_forest' },
    pattern: { a: 'pattern_spots', b: 'pattern_stripes' },
    size: { a: 'size_small', b: 'size_giant' },
    aura: { a: 'aura_glow', b: 'aura_faint' },
  });
}

/** Rng, отдающий заранее заданную последовательность значений по порядку —
 * бросает, если запрошено больше значений, чем есть в последовательности
 * (используется, чтобы явно зафиксировать и проверить точное число draw'ов). */
function scriptedRng(sequence: readonly number[]): RngFn {
  let i = 0;
  return () => {
    if (i >= sequence.length) {
      throw new Error(`scriptedRng exhausted after ${sequence.length} draws`);
    }
    return sequence[i++];
  };
}

function countingRng(value: number): { rng: RngFn; count: () => number } {
  let calls = 0;
  return {
    rng: () => {
      calls += 1;
      return value;
    },
    count: () => calls,
  };
}

/** Rng для тестов "без mutation event": принудительно фиксирует первый
 * draw (mutation event roll) на 0.99 — заведомо выше максимального
 * возможного pity-шанса до гарантии (§4.2: 3%..11% на попытках 1-9, 100%
 * только на 10-й) — так что mutation event гарантированно не срабатывает
 * независимо от seed/pityCounter<9. Все последующие draws (18 inheritance
 * draws) берутся из обычного mulberry32(seedValue), чтобы наследование
 * по-прежнему варьировалось по потоку.
 *
 * Fix-pass (аудит Slice 9, дефект 2): тесты «без mutation event, направление
 * 1×2/2×1» ранее вызывали mulberry32(seedValue) напрямую для ВСЕХ draws,
 * включая первый. Для части значений seed (например 7, 35 при
 * pityCounter=0, шанс 3%) первый draw оказывается меньше pity-шанса, и
 * mutation event фактически срабатывает — при этом сами тесты не
 * содержали assertion на result.mutated, так что название и заявленный
 * контракт теста не соответствовали его фактическому выполнению. */
function noMutationSeededRng(seedValue: number): RngFn {
  const inner = mulberry32(seedValue);
  let first = true;
  return () => {
    if (first) {
      first = false;
      return 0.99;
    }
    return inner();
  };
}

const EIGHTEEN_NEUTRAL_DRAWS = new Array(18).fill(0.5) as number[];

function expectSuccess(result: BreedV2Result): asserts result is BreedV2Result & { ok: true } {
  expect(result.ok).toBe(true);
}

describe('mutationEventChance — полная 10-шаговая pity-кривая (delta doc §4.2)', () => {
  const expected: Array<[pityCounter: number, chance: number]> = [
    [0, 0.03],
    [1, 0.04],
    [2, 0.05],
    [3, 0.06],
    [4, 0.07],
    [5, 0.08],
    [6, 0.09],
    [7, 0.1],
    [8, 0.11],
    [9, 1],
  ];

  for (const [pityCounter, chance] of expected) {
    it(`pityCounter=${pityCounter} -> ${chance * 100}%`, () => {
      expect(mutationEventChance(pityCounter)).toBeCloseTo(chance, 10);
    });
  }

  it('десятая попытка (pityCounter=9) гарантирует mutation event при ЛЮБОМ значении rng < 1', () => {
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(1);
    for (const eventDraw of [0, 0.0001, 0.5, 0.999999]) {
      // pityCounter=9 -> mutated гарантированно true -> потребляются ещё 3
      // mutation-selection draw'а (tier/id/side) до 18 inheritance draws.
      const result = breedV2(
        seed,
        pollen,
        9,
        scriptedRng([eventDraw, 0.1, 0.1, 0.1, ...EIGHTEEN_NEUTRAL_DRAWS])
      );
      expectSuccess(result);
      expect(result.mutated).toBe(true);
    }
  });
});

describe('breedV2 — pity увеличивается при неудаче, сбрасывается при успехе', () => {
  it('неудачное mutation event: nextPityCounter = pityCounter + 1', () => {
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(1);
    // pityCounter=3 -> chance=6%; eventDraw=0.5 (>=0.06) -> событие не срабатывает.
    const result = breedV2(seed, pollen, 3, scriptedRng([0.5, ...EIGHTEEN_NEUTRAL_DRAWS]));
    expectSuccess(result);
    expect(result.mutated).toBe(false);
    expect(result.mutationId).toBeNull();
    expect(result.nextPityCounter).toBe(4);
  });

  it('успешное mutation event: nextPityCounter = 0, независимо от исходного pityCounter', () => {
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(1);
    const result = breedV2(
      seed,
      pollen,
      7, // chance=10%
      scriptedRng([0.01, 0.1 /* Minor */, 0.1 /* id */, 0.1 /* side */, ...EIGHTEEN_NEUTRAL_DRAWS])
    );
    expectSuccess(result);
    expect(result.mutated).toBe(true);
    expect(result.nextPityCounter).toBe(0);
  });

  it('pityCounter клампится к 9 сверху (нет неограниченного роста)', () => {
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(1);
    const result = breedV2(
      seed,
      pollen,
      9,
      scriptedRng([0.9999 /* ниже 100% невозможно, но проверяем clamp входа */, 0.1, 0.1, 0.1, ...EIGHTEEN_NEUTRAL_DRAWS])
    );
    expectSuccess(result);
    // pityCounter=9 гарантирует mutation event -> nextPityCounter=0, не 10.
    expect(result.nextPityCounter).toBe(0);
  });
});

describe('среднее ожидание числа попыток на mutation event близко к 7.851 (delta doc §4.2)', () => {
  it('большая seeded серия, реальный breedV2 в цикле', () => {
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(1);
    const rng = mulberry32(555444333);

    let pityCounter = 0;
    let attemptsSinceLastMutation = 0;
    let totalAttempts = 0;
    let mutationEvents = 0;
    const TARGET_EVENTS = 8000;

    while (mutationEvents < TARGET_EVENTS) {
      attemptsSinceLastMutation += 1;
      const result = breedV2(seed, pollen, pityCounter, rng);
      if (!result.ok) throw new Error('unexpected rejection');
      pityCounter = result.nextPityCounter;
      if (result.mutated) {
        totalAttempts += attemptsSinceLastMutation;
        attemptsSinceLastMutation = 0;
        mutationEvents += 1;
      }
    }

    const average = totalAttempts / mutationEvents;
    expect(average).toBeGreaterThan(7.851 - 0.2);
    expect(average).toBeLessThan(7.851 + 0.2);
  });
});

describe('rollMutationTier — границы 70/25/5 (delta doc §4.3/§11 п.1), детерминированно', () => {
  it('draw чуть ниже 0.70 -> Minor', () => {
    expect(rollMutationTier(() => 0.6999)).toBe('Minor');
  });
  it('draw = 0.70 -> Major (Minor — строго [0, 0.70))', () => {
    expect(rollMutationTier(() => 0.7)).toBe('Major');
  });
  it('draw чуть ниже 0.95 -> Major', () => {
    expect(rollMutationTier(() => 0.9499)).toBe('Major');
  });
  it('draw = 0.95 -> Signature (Major — строго [0.70, 0.95))', () => {
    expect(rollMutationTier(() => 0.95)).toBe('Signature');
  });
  it('draw около 0.999999 -> Signature', () => {
    expect(rollMutationTier(() => 0.999999)).toBe('Signature');
  });
  it('draw = 0 -> Minor (нижняя граница диапазона)', () => {
    expect(rollMutationTier(() => 0)).toBe('Minor');
  });
});

describe('rollMutationTier — статистическое распределение тиров близко к 70/25/5 на большой выборке', () => {
  it('20000 испытаний, детерминированный seed — не flaky (тот же seed = тот же результат при каждом прогоне)', () => {
    const rng = mulberry32(2026828);
    const TRIALS = 20000;
    const counts: Record<MutationTierV2, number> = { Minor: 0, Major: 0, Signature: 0 };
    for (let i = 0; i < TRIALS; i++) {
      counts[rollMutationTier(rng)] += 1;
    }
    expect(counts.Minor / TRIALS).toBeGreaterThan(0.7 - 0.02);
    expect(counts.Minor / TRIALS).toBeLessThan(0.7 + 0.02);
    expect(counts.Major / TRIALS).toBeGreaterThan(0.25 - 0.02);
    expect(counts.Major / TRIALS).toBeLessThan(0.25 + 0.02);
    expect(counts.Signature / TRIALS).toBeGreaterThan(0.05 - 0.015);
    expect(counts.Signature / TRIALS).toBeLessThan(0.05 + 0.015);
  });
});

describe('rollMutationId — выбор ID строго внутри переданного тира (нельзя выбрать ID другого тира)', () => {
  const MINOR_IDS: MutationIdV2[] = ['golden_vein', 'double_bloom'];
  const MAJOR_IDS: MutationIdV2[] = ['stardust', 'prism', 'luminous_edge'];
  const SIGNATURE_IDS: MutationIdV2[] = ['phoenix'];

  it('Minor — только golden_vein/double_bloom на всём диапазоне rng', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 500; i++) {
      expect(MINOR_IDS).toContain(rollMutationId('Minor', rng));
    }
  });

  it('Major — только stardust/prism/luminous_edge на всём диапазоне rng', () => {
    const rng = mulberry32(22);
    for (let i = 0; i < 500; i++) {
      expect(MAJOR_IDS).toContain(rollMutationId('Major', rng));
    }
  });

  it('Signature — только phoenix', () => {
    const rng = mulberry32(33);
    for (let i = 0; i < 500; i++) {
      expect(SIGNATURE_IDS).toContain(rollMutationId('Signature', rng));
    }
  });

  it('каждый ID своего тира достижим (равновероятный выбор не вырожден в один ID)', () => {
    const rng = mulberry32(44);
    const seen = new Set<MutationIdV2>();
    for (let i = 0; i < 500; i++) {
      seen.add(rollMutationId('Major', rng));
    }
    expect(seen).toEqual(new Set(MAJOR_IDS));
  });
});

describe('applyMutationAlleleToAura — три случая (contract §4.7.2)', () => {
  it('ни один слот не aura_radiant -> выбранный draw\'ом слот заменяется', () => {
    const pair = { a: 'aura_none' as const, b: 'aura_faint' as const };
    expect(applyMutationAlleleToAura(pair, 'a')).toEqual({ a: 'aura_radiant', b: 'aura_faint' });
    expect(applyMutationAlleleToAura(pair, 'b')).toEqual({ a: 'aura_none', b: 'aura_radiant' });
  });

  it('ровно один слот уже aura_radiant -> заменяется ВТОРОЙ (гомозигота), сторона draw\'а не важна', () => {
    const aRadiant = { a: 'aura_radiant' as const, b: 'aura_glow' as const };
    expect(applyMutationAlleleToAura(aRadiant, 'a')).toEqual({ a: 'aura_radiant', b: 'aura_radiant' });
    expect(applyMutationAlleleToAura(aRadiant, 'b')).toEqual({ a: 'aura_radiant', b: 'aura_radiant' });

    const bRadiant = { a: 'aura_faint' as const, b: 'aura_radiant' as const };
    expect(applyMutationAlleleToAura(bRadiant, 'a')).toEqual({ a: 'aura_radiant', b: 'aura_radiant' });
    expect(applyMutationAlleleToAura(bRadiant, 'b')).toEqual({ a: 'aura_radiant', b: 'aura_radiant' });
  });

  it('оба слота уже aura_radiant -> пара не меняется', () => {
    const bothRadiant = { a: 'aura_radiant' as const, b: 'aura_radiant' as const };
    expect(applyMutationAlleleToAura(bothRadiant, 'a')).toEqual(bothRadiant);
    expect(applyMutationAlleleToAura(bothRadiant, 'b')).toEqual(bothRadiant);
  });
});

describe('rollAuraMutationSide', () => {
  it('rng < 0.5 -> a, rng >= 0.5 -> b', () => {
    expect(rollAuraMutationSide(() => 0.1)).toBe('a');
    expect(rollAuraMutationSide(() => 0.9)).toBe('b');
  });
});

describe('breedV2 — точное число и порядок RNG-вызовов (contract §4.7.3)', () => {
  it('неудачное mutation event: ровно 19 draws (1 event + 18 inheritance)', () => {
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(1);
    const { rng, count } = countingRng(0.99); // всегда >= любого chance < 1 -> событие не срабатывает
    const result = breedV2(seed, pollen, 0, rng);
    expectSuccess(result);
    expect(result.mutated).toBe(false);
    expect(count()).toBe(19);
  });

  it('успешное mutation event: ровно 22 draws (1 event + 3 mutation-selection + 18 inheritance)', () => {
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(1);
    let calls = 0;
    const rng: RngFn = () => {
      calls += 1;
      return calls === 1 ? 0.001 : 0.4; // draw1 (event) всегда < любой ненулевой chance -> mutated
    };
    const result = breedV2(seed, pollen, 0, rng);
    expectSuccess(result);
    expect(result.mutated).toBe(true);
    expect(calls).toBe(22);
  });

  it('отклонённое валидацией родителей скрещивание (unsupported_species) — 0 draws (наследуется из Slice 3)', () => {
    // Species 3 не входит в поддерживаемый набор (1-2) — Slice 9 (contract
    // §4.12) сняло запрет только на межвидовые пары ВНУТРИ поддерживаемого
    // набора (1×2/2×1), species 3-8 по-прежнему unsupported_species.
    const seed = fixtureGenomeV2(3);
    const pollen = fixtureGenomeV2(3);
    const { rng, count } = countingRng(0.5);
    const result = breedV2(seed, pollen, 0, rng);
    expect(result).toEqual({ ok: false, reason: 'unsupported_species' });
    expect(count()).toBe(0);
  });

  it('Slice 9 (contract §4.12): межвидовая пара 1×2 больше НЕ отклоняется — успешное mutation event на такой паре тоже потребляет ровно 22 draws', () => {
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(2);
    let calls = 0;
    const rng: RngFn = () => {
      calls += 1;
      return calls === 1 ? 0.001 : 0.4; // draw1 (event) всегда < любой ненулевой chance -> mutated
    };
    const result = breedV2(seed, pollen, 0, rng);
    expectSuccess(result);
    expect(result.mutated).toBe(true);
    expect(result.genomeV2.speciesId).toBe(1); // Seed Parent, не Pollen
    expect(calls).toBe(22);
  });

  it('Slice 9 (contract §4.12): межвидовая пара 2×1 без mutation event потребляет ровно 19 draws', () => {
    const seed = fixtureGenomeV2(2);
    const pollen = fixtureGenomeV2(1);
    const { rng, count } = countingRng(0.99); // всегда >= chance < 1 -> событие не срабатывает
    const result = breedV2(seed, pollen, 0, rng);
    expectSuccess(result);
    expect(result.mutated).toBe(false);
    expect(result.genomeV2.speciesId).toBe(2); // Seed Parent
    expect(count()).toBe(19);
  });
});

describe('breedV2 — Slice 9 (contract §4.12): speciesId никогда не отклоняется от Seed Parent при межвидовом скрещивании', () => {
  // Обязательный прямой инвариантный тест (delta doc §12 п.9): без mutation
  // event, с гарантированной мутацией (pityCounter=9), на серии разных
  // RNG-потоков/seed, в обоих направлениях (1×2 и 2×1). Mutation event
  // (contract §4.1/§4.2) никогда не меняет speciesId и никогда не выбирает
  // species 3-8 — genomeV2.speciesId присваивается в inheritGenomeV2 (Seed
  // Parent) до применения mutation-аллеля, а mutation-шаг трогает только
  // aura/mutationId.

  it('без mutation event (гарантированно — первый draw принудительно 0.99), направление 1×2: speciesId потомка всегда 1, на 50 разных RNG-потоках', () => {
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(2);
    for (let seedValue = 1; seedValue <= 50; seedValue++) {
      const result = breedV2(seed, pollen, 0, noMutationSeededRng(seedValue));
      expectSuccess(result);
      expect(result.mutated).toBe(false);
      expect(result.genomeV2.speciesId).toBe(1);
      expect([3, 4, 5, 6, 7, 8]).not.toContain(result.genomeV2.speciesId);
    }
  });

  it('без mutation event (гарантированно — первый draw принудительно 0.99), направление 2×1: speciesId потомка всегда 2, на 50 разных RNG-потоках', () => {
    const seed = fixtureGenomeV2(2);
    const pollen = fixtureGenomeV2(1);
    for (let seedValue = 1; seedValue <= 50; seedValue++) {
      const result = breedV2(seed, pollen, 0, noMutationSeededRng(seedValue));
      expectSuccess(result);
      expect(result.mutated).toBe(false);
      expect(result.genomeV2.speciesId).toBe(2);
    }
  });

  it('с ГАРАНТИРОВАННОЙ мутацией (pityCounter=9), направление 1×2: speciesId потомка всегда 1, на 50 разных RNG-потоках', () => {
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(2);
    for (let seedValue = 1; seedValue <= 50; seedValue++) {
      const result = breedV2(seed, pollen, 9, mulberry32(seedValue));
      expectSuccess(result);
      expect(result.mutated).toBe(true);
      expect(result.genomeV2.speciesId).toBe(1);
    }
  });

  it('с ГАРАНТИРОВАННОЙ мутацией (pityCounter=9), направление 2×1: speciesId потомка всегда 2, на 50 разных RNG-потоках', () => {
    const seed = fixtureGenomeV2(2);
    const pollen = fixtureGenomeV2(1);
    for (let seedValue = 1; seedValue <= 50; seedValue++) {
      const result = breedV2(seed, pollen, 9, mulberry32(seedValue));
      expectSuccess(result);
      expect(result.mutated).toBe(true);
      expect(result.genomeV2.speciesId).toBe(2);
    }
  });

  it('с гарантированной мутацией и различными родителями на всех 9 локусах (1×2): mutation-аллель применяется только к aura, speciesId не затронут', () => {
    const seed = { ...distinctSeedGenome(), speciesId: 1 };
    const pollen = { ...distinctPollenGenome(), speciesId: 2 };
    for (let seedValue = 1; seedValue <= 20; seedValue++) {
      const result = breedV2(seed, pollen, 9, mulberry32(seedValue));
      expectSuccess(result);
      expect(result.mutated).toBe(true);
      expect(result.genomeV2.speciesId).toBe(1);
    }
  });
});

describe('breedV2 — неуспешное событие не создаёт мутацию самопроизвольно', () => {
  it('mutationId=null, aura остаётся результатом обычного наследования (никакого aura_radiant без mutation event)', () => {
    const seed = distinctSeedGenome(); // aura: none/faint
    const pollen = distinctPollenGenome(); // aura: glow/faint
    const { rng } = countingRng(0.99); // событие не срабатывает
    const result = breedV2(seed, pollen, 0, rng);
    expectSuccess(result);
    expect(result.mutated).toBe(false);
    expect(result.mutationId).toBeNull();
    expect(result.mutationTier).toBeNull();
    // aura потомка — buквально один из аллелей seed.aura и один из pollen.aura,
    // aura_radiant не входит ни в одну из этих пар, значит не может появиться.
    expect(['aura_none', 'aura_faint']).toContain(result.genomeV2.aura.a);
    expect(['aura_glow', 'aura_faint']).toContain(result.genomeV2.aura.b);
  });
});

describe('breedV2 — успешное событие устанавливает mutationId и применяет aura-правило', () => {
  it('mutationId установлен (не null) при успешном событии', () => {
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(1);
    const result = breedV2(
      seed,
      pollen,
      0,
      scriptedRng([0.001, 0.1, 0.1, 0.1, ...EIGHTEEN_NEUTRAL_DRAWS])
    );
    expectSuccess(result);
    expect(result.mutated).toBe(true);
    expect(result.mutationId).not.toBeNull();
  });

  it('ни одного aura_radiant у родителей -> появляется ровно в одном из двух слотов потомка', () => {
    const seed = fixtureGenomeV2(1, { aura: homo('aura_none') });
    const pollen = fixtureGenomeV2(1, { aura: homo('aura_faint') });
    const result = breedV2(
      seed,
      pollen,
      0,
      scriptedRng([0.001, 0.1 /* Minor */, 0.1, 0.1 /* side=a */, ...EIGHTEEN_NEUTRAL_DRAWS])
    );
    expectSuccess(result);
    expect(result.mutated).toBe(true);
    const { a, b } = result.genomeV2.aura;
    const radiantCount = [a, b].filter((v) => v === 'aura_radiant').length;
    expect(radiantCount).toBe(1);
  });

  it('один родитель уже несёт aura_radiant -> потомок гомозиготен по aura_radiant после мутации', () => {
    const seed = fixtureGenomeV2(1, { aura: homo('aura_radiant') });
    const pollen = fixtureGenomeV2(1, { aura: homo('aura_faint') });
    // Унаследованная пара до мутации: {a: aura_radiant (от seed), b: aura_faint (от pollen)}
    // — ровно один слот уже radiant -> второй заменяется, независимо от side draw.
    const result = breedV2(
      seed,
      pollen,
      0,
      scriptedRng([0.001, 0.1, 0.1, 0.9 /* side не важен в этом случае */, ...EIGHTEEN_NEUTRAL_DRAWS])
    );
    expectSuccess(result);
    expect(result.mutated).toBe(true);
    expect(result.genomeV2.aura).toEqual({ a: 'aura_radiant', b: 'aura_radiant' });
  });

  it('оба родителя гомозиготны aura_radiant -> пара сохраняется без изменений', () => {
    const seed = fixtureGenomeV2(1, { aura: homo('aura_radiant') });
    const pollen = fixtureGenomeV2(1, { aura: homo('aura_radiant') });
    const result = breedV2(
      seed,
      pollen,
      0,
      scriptedRng([0.001, 0.1, 0.1, 0.5, ...EIGHTEEN_NEUTRAL_DRAWS])
    );
    expectSuccess(result);
    expect(result.mutated).toBe(true);
    expect(result.genomeV2.aura).toEqual({ a: 'aura_radiant', b: 'aura_radiant' });
  });

  it('успешная мутация не меняет остальные 8 локусов — их значения всегда буквально одна из двух аллелей соответствующего родителя (большая серия, pityCounter=9 гарантирует mutated=true каждый раз)', () => {
    const seed = distinctSeedGenome();
    const pollen = distinctPollenGenome();
    const rng = mulberry32(2026);
    const NON_AURA_LOCI = [
      'stemForm',
      'leafForm',
      'flowerForm',
      'primaryColor',
      'secondaryColor',
      'leafColor',
      'pattern',
      'size',
    ] as const;

    for (let i = 0; i < 300; i++) {
      const result = breedV2(seed, pollen, 9, rng); // chance=100% -> mutated всегда true
      expectSuccess(result);
      expect(result.mutated).toBe(true);
      for (const locus of NON_AURA_LOCI) {
        expect([seed[locus].a, seed[locus].b]).toContain(result.genomeV2[locus].a);
        expect([pollen[locus].a, pollen[locus].b]).toContain(result.genomeV2[locus].b);
      }
    }
  });

  it('speciesId не меняется на большой серии успешных мутаций', () => {
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(1);
    const rng = mulberry32(4242);
    for (let i = 0; i < 300; i++) {
      const result = breedV2(seed, pollen, 9, rng);
      expectSuccess(result);
      expect(result.mutated).toBe(true);
      expect(result.genomeV2.speciesId).toBe(1);
    }
  });
});

describe('breedV2 — родительский mutationId никогда не наследуется', () => {
  it('родители несут mutationId от собственного прошлого события — потомок без нового события получает null', () => {
    const seed = { ...fixtureGenomeV2(1), mutationId: 'golden_vein' as MutationIdV2 };
    const pollen = { ...fixtureGenomeV2(1), mutationId: 'stardust' as MutationIdV2 };
    const result = breedV2(seed, pollen, 0, scriptedRng([0.99, ...EIGHTEEN_NEUTRAL_DRAWS]));
    expectSuccess(result);
    expect(result.mutated).toBe(false);
    expect(result.mutationId).toBeNull();
  });
});

describe('breedV2 — первые два обучающих скрещивания (зафиксированные фикстуры/seed, delta doc §6.3, contract §4.6)', () => {
  // Оба стартовых Солнечника — contract §4.6.1/§4.6.2. Это прямые вызовы
  // реального breedV2 с обычными данными — никакой tutorial-UI и никакой
  // подмены результата здесь нет и быть не может: движок не знает, что это
  // «обучающее» скрещивание, он просто получил два конкретных генома и seed.
  function sunflower1(): GenomeV2 {
    return fixtureGenomeV2(1, {
      leafForm: homo('leaf_broad'),
      flowerForm: homo('flower_fan'),
      primaryColor: homo('primary_honey'),
      secondaryColor: homo('secondary_sunset'),
      leafColor: homo('leaf_color_fresh'),
      size: { a: 'size_normal', b: 'size_large' },
      aura: homo('aura_faint'),
    });
  }

  function sunflower2(): GenomeV2 {
    return {
      ...sunflower1(),
      primaryColor: homo('primary_coral'),
      secondaryColor: homo('secondary_forest'),
    };
  }

  it('первое скрещивание — mulberry32(20260828) (contract §4.6.3): mutation event не срабатывает (первое значение потока ≈0.452 > 3%), результат — Uncommon (score 4), pity 0->1', () => {
    const result = breedV2(sunflower1(), sunflower2(), 0, mulberry32(20260828));
    expectSuccess(result);
    expect(result.mutated).toBe(false);
    expect(result.mutationId).toBeNull();
    expect(result.nextPityCounter).toBe(1);
    expect(result.naturalScore).toBe(4);
    expect(result.rarity).toBe('Uncommon');
    expect(result.phenotype.primaryColor).toBe('primary_honey'); // от первого растения, rank1<rank4
    expect(result.phenotype.secondaryColor).toBe('secondary_forest'); // от второго растения, rank1<rank2
    expect(result.phenotype.size).toBe('size_normal');
  });

  it('второе скрещивание (pityCounter=1, те же родители): не мутирует, естественно раскрывает скрытый size_large, pity 1->2', () => {
    // Contract §4.6.4 фиксирует ТРЕБУЕМЫЕ свойства этого скрещивания (без
    // мутации; локус size гомозиготно раскрывает скрытый size_large), но
    // прямо указывает, что точное числовое значение потока для второго
    // скрещивания фиксируется отдельно на этапе Slice 12 (tutorial UI/RNG
    // wiring, вне объёма этого пакета) — сам контракт ещё не называет
    // конкретный seed. seed=6 здесь подобран так, чтобы РЕАЛЬНЫЙ breedV2
    // (без каких-либо подмен) удовлетворял именно этим двум обязательным
    // свойствам — это не заявка на канонический seed продукта, только
    // диагностическая проверка, что движок способен произвести
    // требуемый контрактом результат на настоящих входных данных.
    const result = breedV2(sunflower1(), sunflower2(), 1, mulberry32(6));
    expectSuccess(result);
    expect(result.mutated).toBe(false);
    expect(result.mutationId).toBeNull();
    expect(result.nextPityCounter).toBe(2);
    expect(result.genomeV2.size).toEqual({ a: 'size_large', b: 'size_large' });
    expect(result.phenotype.size).toBe('size_large');
  });

  it('pity прогрессия после обоих обучающих скрещиваний подряд: 0 -> 1 -> 2', () => {
    const first = breedV2(sunflower1(), sunflower2(), 0, mulberry32(20260828));
    expectSuccess(first);
    expect(first.nextPityCounter).toBe(1);

    const second = breedV2(sunflower1(), sunflower2(), first.nextPityCounter, mulberry32(6));
    expectSuccess(second);
    expect(second.nextPityCounter).toBe(2);
  });
});

describe('rarityOfV2 внутри breedV2 не использует RNG (уже покрыто rarityV2.test.ts, здесь — прямая проверка на реальном результате)', () => {
  it('rarityOfV2, вызванный дважды с теми же аргументами из результата breedV2, детерминирован', () => {
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(1);
    const result = breedV2(seed, pollen, 0, scriptedRng([0.99, ...EIGHTEEN_NEUTRAL_DRAWS]));
    expectSuccess(result);
    expect(rarityOfV2(result.genomeV2, result.mutationId)).toBe(result.rarity);
    expect(rarityOfV2(result.genomeV2, result.mutationId)).toBe(result.rarity); // повторный вызов — тот же результат
  });
});

describe('breedV2 — mutation floors и Mythic работают на РЕАЛЬНОМ результате скрещивания, не на изолированном вызове rarityOfV2', () => {
  // Оба родителя гомозиготны stem_climbing (rarity points 5) — единственный
  // источник ненулевого naturalScore в этой фикстуре, остальные локусы
  // нейтральны (points 0). Поскольку локус гомозиготен у ОБОИХ родителей,
  // 18 inheritance draws не влияют на итоговый геном вообще — значения
  // "нейтральных" draws в EIGHTEEN_NEUTRAL_DRAWS ниже не имеют значения.
  function highScoreParent(): GenomeV2 {
    return fixtureGenomeV2(1, { stemForm: homo('stem_climbing') });
  }

  it('Minor mutation (реальный breedV2) -> floor Rare применяется к naturalScore=5 (Uncommon без мутации)', () => {
    const seed = highScoreParent();
    const pollen = highScoreParent();
    const result = breedV2(
      seed,
      pollen,
      0,
      scriptedRng([0.001, 0.1 /* Minor */, 0.1 /* golden_vein */, 0.1 /* side */, ...EIGHTEEN_NEUTRAL_DRAWS])
    );
    expectSuccess(result);
    expect(result.mutated).toBe(true);
    expect(result.mutationTier).toBe('Minor');
    expect(result.naturalScore).toBe(5); // aura остаётся гетерозиготной (none/radiant), выражен none -> 0 очков
    expect(result.rarity).toBe('Rare'); // higherOf(Uncommon, floor Rare) = Rare
  });

  it('Major mutation (реальный breedV2) -> floor Epic применяется', () => {
    const seed = highScoreParent();
    const pollen = highScoreParent();
    const result = breedV2(
      seed,
      pollen,
      0,
      scriptedRng([0.001, 0.8 /* Major */, 0.1 /* stardust */, 0.1 /* side */, ...EIGHTEEN_NEUTRAL_DRAWS])
    );
    expectSuccess(result);
    expect(result.mutated).toBe(true);
    expect(result.mutationTier).toBe('Major');
    expect(result.rarity).toBe('Epic');
  });

  it('Signature mutation (реальный breedV2) с naturalScore>=5 -> Mythic', () => {
    const seed = highScoreParent();
    const pollen = highScoreParent();
    const result = breedV2(
      seed,
      pollen,
      0,
      scriptedRng([0.001, 0.99 /* Signature */, 0.5 /* phoenix (единственный) */, 0.3 /* side */, ...EIGHTEEN_NEUTRAL_DRAWS])
    );
    expectSuccess(result);
    expect(result.mutated).toBe(true);
    expect(result.mutationTier).toBe('Signature');
    expect(result.mutationId).toBe('phoenix');
    expect(result.naturalScore).toBeGreaterThanOrEqual(5);
    expect(result.rarity).toBe('Mythic');
  });

  it('Signature mutation с naturalScore < 5 -> Legendary floor, НЕ Mythic', () => {
    const seed = fixtureGenomeV2(1); // naturalScore = 0 без мутации
    const pollen = fixtureGenomeV2(1);
    const result = breedV2(
      seed,
      pollen,
      0,
      scriptedRng([0.001, 0.99, 0.5, 0.3, ...EIGHTEEN_NEUTRAL_DRAWS])
    );
    expectSuccess(result);
    expect(result.mutated).toBe(true);
    expect(result.mutationTier).toBe('Signature');
    expect(result.naturalScore).toBeLessThan(5);
    expect(result.rarity).toBe('Legendary');
  });
});

describe('breedV2 — engine не мутирует родителей и не читает лишнего', () => {
  function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value as Record<string, unknown>).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }

  it('замороженные родители не вызывают исключений — breedV2 не пишет в них', () => {
    const seed = deepFreeze(distinctSeedGenome());
    const pollen = deepFreeze(distinctPollenGenome());
    expect(() => breedV2(seed, pollen, 0, mulberry32(1))).not.toThrow();
    expect(() => breedV2(seed, pollen, 9, mulberry32(2))).not.toThrow();
  });

  it('входной pityCounter (число) не может быть мутирован — примитив, но проверяем, что повторный вызов с тем же числом даёт тот же chance', () => {
    const pityCounter = 5;
    expect(mutationEventChance(pityCounter)).toBe(mutationEventChance(pityCounter));
    expect(pityCounter).toBe(5);
  });
});
