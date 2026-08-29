import { describe, expect, it } from 'vitest';
import {
  breedSupportedSpeciesV2,
  inheritAlleleV2,
  inheritGenomeV2,
  isSupportedParentSpeciesV2,
  validateSupportedParentsV2,
  type BreedRejectionReasonV2,
} from './inheritanceV2';
import { expressPhenotype, DOMINANCE_TABLE } from './phenotypeV2';
import type { AllelePair, GenomeV2, GenomeV2LocusKey } from './geneticsV2';
import { mulberry32 } from './rng';

// ============================================================================
// Genetics V2 — Slice 3 (одновидовое наследование), расширено Slice 9
// (contract §4.12): `validateSupportedParentsV2`/`breedSupportedSpeciesV2`
// (переименованы из `validateSameSpeciesParentsV2`/`breedSameSpeciesV2`)
// теперь успешны и для пар 1×2/2×1, не только 1×1/2×2 — `interspecies_locked`
// удалена целиком. Mutation roll/pity (Slice 4, mutationV2.test.ts — включая
// обязательный speciesId-инвариант с гарантированной мутацией), Nursery Tray,
// пыльца, микроскоп, UI — здесь не тестируется и не подразумевается — только
// чистое наследование (без mutation) + рабочая `rarityOfV2` (отдельный файл
// rarityV2.test.ts).
// ============================================================================

const LOCI: readonly GenomeV2LocusKey[] = [
  'stemForm',
  'leafForm',
  'flowerForm',
  'primaryColor',
  'secondaryColor',
  'leafColor',
  'pattern',
  'size',
  'aura',
];

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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Родители, гетерозиготные и РАЗЛИЧНЫЕ на всех 9 локусах — так, чтобы по
 * каждому локусу было видно, откуда именно взялся `a` (Seed) и `b` (Pollen)
 * потомка, без совпадений, маскирующих источник. */
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
    aura: { a: 'aura_glow', b: 'aura_radiant' },
  });
}

describe('inheritAlleleV2 — один диплоидный коинфлип', () => {
  it('rng < 0.5 -> a', () => {
    expect(inheritAlleleV2({ a: 'X', b: 'Y' }, () => 0.1)).toBe('X');
  });

  it('rng >= 0.5 -> b', () => {
    expect(inheritAlleleV2({ a: 'X', b: 'Y' }, () => 0.9)).toBe('Y');
  });

  it('никогда не возвращает третье значение — только один из двух переданных аллелей', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const result = inheritAlleleV2({ a: 'X', b: 'Y' }, rng);
      expect(['X', 'Y']).toContain(result);
    }
  });
});

describe('inheritGenomeV2 — каждый из 9 локусов наследует ровно по одному аллелю каждого родителя', () => {
  const seed = distinctSeedGenome();
  const pollen = distinctPollenGenome();

  for (const locus of LOCI) {
    it(`локус "${locus}": a === аллель Seed Parent, b === аллель Pollen Parent (известный rng)`, () => {
      // rng < 0.5 всегда -> оба draw'а локуса выбирают ПЕРВЫЙ аллель пары
      // соответствующего родителя (seed.locus.a, pollen.locus.a).
      const childLow = inheritGenomeV2(seed, pollen, () => 0.1);
      expect(childLow[locus]).toEqual({ a: seed[locus].a, b: pollen[locus].a });

      // rng >= 0.5 всегда -> оба draw'а выбирают ВТОРОЙ аллель пары.
      const childHigh = inheritGenomeV2(seed, pollen, () => 0.9);
      expect(childHigh[locus]).toEqual({ a: seed[locus].b, b: pollen[locus].b });
    });

    it(`локус "${locus}": результат — всегда один из двух аллелей каждого родителя, не третье значение`, () => {
      const rng = mulberry32(7 + LOCI.indexOf(locus));
      for (let i = 0; i < 100; i++) {
        const child = inheritGenomeV2(seed, pollen, rng);
        expect([seed[locus].a, seed[locus].b]).toContain(child[locus].a);
        expect([pollen[locus].a, pollen[locus].b]).toContain(child[locus].b);
      }
    });
  }

  it('известный поток rng выбирает ожидаемую комбинацию a/b по ВСЕМ локусам одновременно', () => {
    // Чередующийся поток: чётные draw'а (Seed-слот) < 0.5, нечётные
    // (Pollen-слот) >= 0.5 — по два draw'а на локус, 9 локусов = 18 draws.
    let call = 0;
    const rng = () => (call++ % 2 === 0 ? 0.2 : 0.8);
    const child = inheritGenomeV2(seed, pollen, rng);
    for (const locus of LOCI) {
      expect(child[locus]).toEqual({ a: seed[locus].a, b: pollen[locus].b });
    }
    expect(call).toBe(18);
  });

  it('speciesId потомка всегда равен speciesId Seed Parent, независимо от rng', () => {
    const childLow = inheritGenomeV2(seed, pollen, () => 0.01);
    const childHigh = inheritGenomeV2(seed, pollen, () => 0.99);
    expect(childLow.speciesId).toBe(seed.speciesId);
    expect(childHigh.speciesId).toBe(seed.speciesId);
  });

  it('перестановка Seed/Pollen меняет источник speciesId и порядок происхождения аллелей, но не сами правила наследования', () => {
    // Константный rng (не зависящий от позиции вызова в потоке) — так
    // «какой аллель пары выбран» зависит только от того, ЧЕЙ это слот
    // (seed/pollen), а не от порядкового номера draw'а. Это делает
    // инвариант «swapped.a === original.b» проверяемым точно, а не только
    // «в среднем»: с любым позиционно-зависимым потоком (например, общий
    // mulberry32-поток на оба вызова) draw'а `a`-слота и `b`-слота при
    // перестановке родителей занимают РАЗНЫЕ позиции потока и в общем
    // случае получают разные значения — сравнивать их напрямую было бы
    // некорректно.
    const constantRng = () => 0.1; // всегда < 0.5 -> всегда выбирается pair.a
    const original = inheritGenomeV2(seed, pollen, constantRng);
    const swapped = inheritGenomeV2(pollen, seed, constantRng);

    expect(swapped.speciesId).toBe(pollen.speciesId);
    expect(original.speciesId).toBe(seed.speciesId);

    // swapped.a (взято от нового Seed = pollen) равно original.b (взято от
    // старого Pollen = тот же pollen), и наоборот — сама логика наследования
    // (какой слот пары выбирается) не изменилась, изменился только источник.
    for (const locus of LOCI) {
      expect(swapped[locus].a).toBe(original[locus].b);
      expect(swapped[locus].b).toBe(original[locus].a);
    }
  });

  it('родительский mutationId не наследуется — потомок без mutation event всегда получает null', () => {
    const mutatedSeed = { ...seed, mutationId: 'golden_vein' as const };
    const mutatedPollen = { ...pollen, mutationId: 'stardust' as const };
    const child = inheritGenomeV2(mutatedSeed, mutatedPollen, mulberry32(1));
    expect(child.mutationId).toBeNull();
  });

  it('aura_radiant, уже существующий у носителя-родителя, наследуется как обычный аллель', () => {
    const radiantSeed = fixtureGenomeV2(1, { aura: homo('aura_radiant') });
    const plainPollen = fixtureGenomeV2(1, { aura: homo('aura_faint') });
    const childLow = inheritGenomeV2(radiantSeed, plainPollen, () => 0.1);
    expect(childLow.aura).toEqual({ a: 'aura_radiant', b: 'aura_faint' });

    // rng неважен для гомозиготного локуса родителя — оба возможных выбора
    // от radiantSeed дают одно и то же значение 'aura_radiant'.
    const childHigh = inheritGenomeV2(radiantSeed, plainPollen, () => 0.9);
    expect(childHigh.aura.a).toBe('aura_radiant');
  });

  it('engine не мутирует родителей', () => {
    const frozenSeed = deepFreeze(distinctSeedGenome());
    const frozenPollen = deepFreeze(distinctPollenGenome());
    expect(() => inheritGenomeV2(frozenSeed, frozenPollen, mulberry32(5))).not.toThrow();
  });
});

describe('inheritGenomeV2 — Slice 9 (contract §4.12): межвидовая пара наследует ровно так же, без фильтрации аллелей', () => {
  // Родители РАЗНЫХ видов (1 и 2), но геометрически различимые на всех 9
  // локусах — те же fixtures, что уже используются выше для одновидовой
  // пары, только с разными speciesId. Наследование не смотрит на speciesId
  // родителей вообще (только на сам факт "кто Seed, кто Pollen") — значит,
  // не должно вести себя иначе для межвидовой пары.
  const seed1 = { ...distinctSeedGenome(), speciesId: 1 };
  const pollen2 = { ...distinctPollenGenome(), speciesId: 2 };

  for (const locus of LOCI) {
    it(`локус "${locus}" (1×2): a от Seed(1), b от Pollen(2) — без species-фильтра`, () => {
      const child = inheritGenomeV2(seed1, pollen2, () => 0.1);
      expect(child[locus]).toEqual({ a: seed1[locus].a, b: pollen2[locus].a });
    });
  }

  it('speciesId потомка (1×2) равен speciesId Seed Parent (1), не Pollen (2), на серии RNG-потоков', () => {
    for (let seedValue = 1; seedValue <= 20; seedValue++) {
      const rng = mulberry32(seedValue);
      const child = inheritGenomeV2(seed1, pollen2, rng);
      expect(child.speciesId).toBe(1);
    }
  });

  it('speciesId потомка (2×1, обратное направление) равен speciesId нового Seed Parent (2), на серии RNG-потоков', () => {
    const seed2 = { ...distinctSeedGenome(), speciesId: 2 };
    const pollen1 = { ...distinctPollenGenome(), speciesId: 1 };
    for (let seedValue = 1; seedValue <= 20; seedValue++) {
      const rng = mulberry32(seedValue);
      const child = inheritGenomeV2(seed2, pollen1, rng);
      expect(child.speciesId).toBe(2);
    }
  });

  it('межвидовой аллель (значение локуса от родителя другого вида) — обычное значение из каталога, не подставляется нейтральным дефолтом', () => {
    const child = inheritGenomeV2(seed1, pollen2, () => 0.9); // всегда выбирает .b -> оба слота от pollen2
    for (const locus of LOCI) {
      expect(child[locus].b).toBe(pollen2[locus].b);
      // ...и это реальное каталожное значение донора, не 'stem_standard'/
      // другой нейтральный ID, кроме случаев, когда донор сам им владеет.
    }
  });
});

describe('валидация поддерживаемых родителей (Slice 9, contract §4.12) — все четыре комбинации 1×1/2×2/1×2/2×1 успешны', () => {
  it('species1 × species1 — успех', () => {
    const result = validateSupportedParentsV2(1, 1);
    expect(result.ok).toBe(true);
  });

  it('species2 × species2 — успех', () => {
    const result = validateSupportedParentsV2(2, 2);
    expect(result.ok).toBe(true);
  });

  it('species1 × species2 — успех (Slice 9 сняло interspecies_locked)', () => {
    const result = validateSupportedParentsV2(1, 2);
    expect(result).toEqual({ ok: true });
  });

  it('species2 × species1 (обратный порядок) — тоже успех', () => {
    const result = validateSupportedParentsV2(2, 1);
    expect(result).toEqual({ ok: true });
  });

  for (const unsupported of [3, 4, 5, 6, 7, 8]) {
    it(`species${unsupported} × species${unsupported} — отклонено как unsupported_species`, () => {
      const result = validateSupportedParentsV2(unsupported, unsupported);
      expect(result).toEqual({ ok: false, reason: 'unsupported_species' });
    });

    it(`species1 × species${unsupported} — отклонено как unsupported_species`, () => {
      const result = validateSupportedParentsV2(1, unsupported);
      expect(result).toEqual({ ok: false, reason: 'unsupported_species' });
    });
  }

  it('оба родителя из разных неподдерживаемых видов (3×5) — unsupported_species', () => {
    const result = validateSupportedParentsV2(3, 5);
    expect(result).toEqual({ ok: false, reason: 'unsupported_species' });
  });

  it('BreedRejectionReasonV2 больше не содержит interspecies_locked как достижимое значение (type-level regression через runtime-проверку набора причин)', () => {
    const reasons: BreedRejectionReasonV2[] = ['unsupported_species'];
    expect(reasons).toEqual(['unsupported_species']);
  });
});

describe('isSupportedParentSpeciesV2 — Slice 11 (contract §4.13.1), единый predicate', () => {
  it('species 1 и 2 — true', () => {
    expect(isSupportedParentSpeciesV2(1)).toBe(true);
    expect(isSupportedParentSpeciesV2(2)).toBe(true);
  });

  for (const unsupported of [3, 4, 5, 6, 7, 8]) {
    it(`species ${unsupported} — false`, () => {
      expect(isSupportedParentSpeciesV2(unsupported)).toBe(false);
    });
  }

  it('неизвестные/повреждённые числовые значения — false (0, 9, -1, NaN, дробное)', () => {
    expect(isSupportedParentSpeciesV2(0)).toBe(false);
    expect(isSupportedParentSpeciesV2(9)).toBe(false);
    expect(isSupportedParentSpeciesV2(-1)).toBe(false);
    expect(isSupportedParentSpeciesV2(Number.NaN)).toBe(false);
    expect(isSupportedParentSpeciesV2(1.5)).toBe(false);
  });

  it('validateSupportedParentsV2 после рефакторинга на predicate даёт тот же результат на всех восьми species + паре неизвестных значений (regression)', () => {
    const allInputs = [1, 2, 3, 4, 5, 6, 7, 8, 0, -1];
    for (const seed of allInputs) {
      for (const pollen of allInputs) {
        const expected =
          isSupportedParentSpeciesV2(seed) && isSupportedParentSpeciesV2(pollen)
            ? { ok: true }
            : { ok: false, reason: 'unsupported_species' as const };
        expect(validateSupportedParentsV2(seed, pollen)).toEqual(expected);
      }
    }
  });
});

describe('breedSupportedSpeciesV2 — полный engine (валидация + наследование), Slice 9: все четыре комбинации', () => {
  it('species1×1 — успешно наследует геном', () => {
    const seed = distinctSeedGenome();
    const pollen = { ...distinctPollenGenome(), speciesId: 1 };
    const result = breedSupportedSpeciesV2(seed, pollen, mulberry32(1));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.genomeV2.speciesId).toBe(1);
    }
  });

  it('species2×2 — успешно наследует геном', () => {
    const seed = fixtureGenomeV2(2);
    const pollen = fixtureGenomeV2(2);
    const result = breedSupportedSpeciesV2(seed, pollen, mulberry32(2));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.genomeV2.speciesId).toBe(2);
    }
  });

  it('species1×2 (межвидовое) — успешно наследует геном, speciesId потомка = 1 (Seed)', () => {
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(2);
    const result = breedSupportedSpeciesV2(seed, pollen, mulberry32(3));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.genomeV2.speciesId).toBe(1);
    }
  });

  it('species2×1 (межвидовое, обратный порядок) — успешно наследует геном, speciesId потомка = 2 (Seed)', () => {
    const seed = fixtureGenomeV2(2);
    const pollen = fixtureGenomeV2(1);
    const result = breedSupportedSpeciesV2(seed, pollen, mulberry32(3));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.genomeV2.speciesId).toBe(2);
    }
  });

  it('species3×3 — отклонено с reason=unsupported_species', () => {
    const seed = fixtureGenomeV2(3);
    const pollen = fixtureGenomeV2(3);
    const result = breedSupportedSpeciesV2(seed, pollen, mulberry32(4));
    expect(result).toEqual({ ok: false, reason: 'unsupported_species' });
  });

  it('отклонённая операция не потребляет RNG (счётчик вызовов = 0)', () => {
    let calls = 0;
    const countingRng = () => {
      calls += 1;
      return 0.5;
    };
    const seed = fixtureGenomeV2(3);
    const pollen = fixtureGenomeV2(5);
    const result = breedSupportedSpeciesV2(seed, pollen, countingRng);
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });

  it('успешная межвидовая операция (1×2) тоже потребляет ровно 18 draws (2 на локус × 9 локусов) — снятие interspecies_locked не меняет RNG-контракт', () => {
    let calls = 0;
    const countingRng = () => {
      calls += 1;
      return 0.5;
    };
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(2);
    const result = breedSupportedSpeciesV2(seed, pollen, countingRng);
    expect(result.ok).toBe(true);
    expect(calls).toBe(18);
  });

  it('успешная одновидовая операция потребляет ровно 18 draws (2 на локус × 9 локусов)', () => {
    let calls = 0;
    const countingRng = () => {
      calls += 1;
      return 0.5;
    };
    const seed = fixtureGenomeV2(1);
    const pollen = fixtureGenomeV2(1);
    const result = breedSupportedSpeciesV2(seed, pollen, countingRng);
    expect(result.ok).toBe(true);
    expect(calls).toBe(18);
  });
});

describe('статистический тест — генотипы Aa×Aa и фенотипы (полное доминирование), раздельные проверки', () => {
  // Оба родителя гетерозиготны на locus `stemForm` с одинаковой парой
  // аллелей: stem_standard (rank 1, доминантный) / stem_branching (rank 2).
  // Классический Aa×Aa: генотип потомка AA/Aa/aA/aa с вероятностью 25/25/25/25
  // (25/50/25 для "Aa" объединённо), фенотип (полное доминирование, Slice 2
  // `expressPhenotype`) — 75/25 (A выражен всегда, когда присутствует хотя бы
  // один stem_standard).
  const seed = fixtureGenomeV2(1, { stemForm: { a: 'stem_standard', b: 'stem_branching' } });
  const pollen = fixtureGenomeV2(1, { stemForm: { a: 'stem_standard', b: 'stem_branching' } });

  const TRIALS = 20000;
  const rng = mulberry32(20260828);

  let AA = 0; // stem_standard/stem_standard
  let Aa = 0; // ровно один stem_standard
  let aa = 0; // stem_branching/stem_branching
  let dominantPhenotype = 0; // expressPhenotype === stem_standard

  for (let i = 0; i < TRIALS; i++) {
    const result = breedSupportedSpeciesV2(seed, pollen, rng);
    if (!result.ok) throw new Error('unexpected rejection in statistical test');
    const pair = result.genomeV2.stemForm;
    const countStandard = (pair.a === 'stem_standard' ? 1 : 0) + (pair.b === 'stem_standard' ? 1 : 0);
    if (countStandard === 2) AA += 1;
    else if (countStandard === 1) Aa += 1;
    else aa += 1;

    if (expressPhenotype(pair, DOMINANCE_TABLE.stemForm) === 'stem_standard') {
      dominantPhenotype += 1;
    }
  }

  it('генотип AA (stem_standard/stem_standard) близок к 25%', () => {
    expect(AA / TRIALS).toBeGreaterThan(0.25 - 0.03);
    expect(AA / TRIALS).toBeLessThan(0.25 + 0.03);
  });

  it('генотип Aa (ровно один stem_standard) близок к 50%', () => {
    expect(Aa / TRIALS).toBeGreaterThan(0.5 - 0.03);
    expect(Aa / TRIALS).toBeLessThan(0.5 + 0.03);
  });

  it('генотип aa (stem_branching/stem_branching) близок к 25%', () => {
    expect(aa / TRIALS).toBeGreaterThan(0.25 - 0.03);
    expect(aa / TRIALS).toBeLessThan(0.25 + 0.03);
  });

  it('фенотип: доля с выраженным stem_standard (полное доминирование) близка к 75%, отдельная проверка от генотипов', () => {
    expect(dominantPhenotype / TRIALS).toBeGreaterThan(0.75 - 0.03);
    expect(dominantPhenotype / TRIALS).toBeLessThan(0.75 + 0.03);
  });
});
