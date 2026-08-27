import { describe, expect, it } from 'vitest';
import { breed, randomGenome, rarityOf, sizeScale, mutationName, MUTATIONS, type Genome } from './genetics';
import { GENETICS_CONFIG } from './config';
import { mulberry32 } from './rng';

function genomeA(): Genome {
  return {
    shape: 1,
    primary: '#111111',
    secondary: '#222222',
    leaf: '#333333',
    pattern: 'duotone',
    size: 'small',
    aura: 'none',
    mutationId: null,
  };
}

function genomeB(): Genome {
  return {
    shape: 8,
    primary: '#999999',
    secondary: '#888888',
    leaf: '#777777',
    pattern: 'solid',
    size: 'giant',
    aura: 'radiant',
    mutationId: null,
  };
}

describe('rng determinism', () => {
  it('одинаковый seed -> одинаковая последовательность', () => {
    const seq1 = Array.from({ length: 10 }, () => mulberry32(42)());
    const seq2 = Array.from({ length: 10 }, () => mulberry32(42)());
    expect(seq1).toEqual(seq2);
  });

  it('разный seed -> разная последовательность', () => {
    const rngA = mulberry32(1);
    const rngB = mulberry32(2);
    const seqA = Array.from({ length: 5 }, () => rngA());
    const seqB = Array.from({ length: 5 }, () => rngB());
    expect(seqA).not.toEqual(seqB);
  });
});

describe('randomGenome — seeded воспроизводимость', () => {
  it('один и тот же seed даёт один и тот же геном', () => {
    const g1 = randomGenome(mulberry32(7));
    const g2 = randomGenome(mulberry32(7));
    expect(g1).toEqual(g2);
  });

  it('solid паттерн всегда даёт secondary === primary', () => {
    // Прогоняем много seed'ов, чтобы точно поймать хотя бы один solid-результат.
    for (let seed = 0; seed < 200; seed++) {
      const g = randomGenome(mulberry32(seed));
      if (g.pattern === 'solid') {
        expect(g.secondary).toBe(g.primary);
      }
    }
  });
});

describe('наследование генов при скрещивании', () => {
  it('без мутации каждый ген наследуется строго от одного из родителей', () => {
    // rng, который никогда не проходит порог мутации (всегда возвращает 0.99),
    // кроме как для выбора 50/50 между родителями — используем составной rng.
    const a = genomeA();
    const b = genomeB();
    let call = 0;
    // Чередуем: высокое значение (не мутирует) / низкое (наследует от A) —
    // gene() дергает rng дважды в худшем случае (mutate-check, затем inherit).
    const rng = () => {
      call += 1;
      // Всегда > geneMutateChance, чтобы не мутировать; используем 0.5 для inherit-выбора.
      return call % 2 === 0 ? 0.1 : 0.99;
    };
    const result = breed(a, b, 0, rng);
    const g = result.genome;
    expect([a.shape, b.shape]).toContain(g.shape);
    expect([a.primary, b.primary]).toContain(g.primary);
    expect([a.leaf, b.leaf]).toContain(g.leaf);
    expect([a.size, b.size]).toContain(g.size);
    expect([a.aura, b.aura]).toContain(g.aura);
  });

  it('rng < GENE_MUTATE_CHANCE заставляет ген сорваться в случайное значение пула', () => {
    const a = genomeA();
    const b = genomeB();
    // rng всегда 0 -> все гены точно мутируют (0 < GENE_MUTATE_CHANCE).
    const result = breed(a, b, 0, () => 0);
    expect(result.mutated).toBe(true);
  });
});

describe('pity-система', () => {
  it('до достижения порога pity не форсирует мутацию гена', () => {
    const a = genomeA();
    const b = genomeB();
    // rng всегда 0.99 -> ни один ген не мутирует по обычному шансу.
    const belowThreshold = GENETICS_CONFIG.pityThreshold - 1;
    const result = breed(a, b, belowThreshold, () => 0.99);
    expect(result.mutated).toBe(false);
    expect(result.nextPityCounter).toBe(belowThreshold + 1);
  });

  it('на пороге pity гарантированно форсирует мутацию хотя бы одного гена', () => {
    const a = genomeA();
    const b = genomeB();
    // rng: обычный шанс мутации не проходит (0.99), но форс-проверка
    // (rng() < pityMutationChance=0.7) проходит на первом гене (0.1 < 0.7),
    // остальные вызовы rng — высокие, чтобы не переопределить другие гены случайно.
    let call = 0;
    const rng = () => {
      call += 1;
      return call === 2 ? 0.1 : 0.99; // 1й вызов — mutate-check гена shape (0.99, не по чистому шансу), 2й — форс-проверка
    };
    const result = breed(a, b, GENETICS_CONFIG.pityThreshold, rng);
    expect(result.mutated).toBe(true);
    expect(result.pityTriggered).toBe(true);
    expect(result.nextPityCounter).toBe(0); // счётчик сбрасывается после мутации
  });

  it('счётчик pity растёт на 1 при каждом скрещивании без мутации', () => {
    const a = genomeA();
    const b = genomeB();
    let counter = 0;
    for (let i = 0; i < 5; i++) {
      const result = breed(a, b, counter, () => 0.99); // никогда не мутирует
      counter = result.nextPityCounter;
    }
    expect(counter).toBe(5);
  });
});

describe('таблица вероятностей мутации — статистическая проверка', () => {
  it('доля мутировавших скрещиваний близка к ожидаемой при большой выборке', () => {
    const a = genomeA();
    const b = genomeB();
    const rng = mulberry32(123456);
    const trials = 4000;
    let mutatedCount = 0;
    for (let i = 0; i < trials; i++) {
      const result = breed(a, b, 0, rng);
      if (result.mutated) mutatedCount += 1;
    }
    // 7 генов, каждый мутирует независимо с GENE_MUTATE_CHANCE=0.08 =>
    // P(хотя бы один мутировал) = 1 - (1-0.08)^7 ≈ 0.44
    const expectedRate = 1 - Math.pow(1 - GENETICS_CONFIG.geneMutateChance, 7);
    const observedRate = mutatedCount / trials;
    expect(observedRate).toBeGreaterThan(expectedRate - 0.05);
    expect(observedRate).toBeLessThan(expectedRate + 0.05);
  });
});

describe('границы редкости rarityOf', () => {
  it('минимальный геном (мелкий, без ауры, duotone=0) -> common', () => {
    const g: Genome = { ...genomeA(), size: 'small', aura: 'none', pattern: 'solid', mutationId: null };
    expect(rarityOf(g)).toBe('common');
  });

  it('faint aura даёт ровно uncommon (граница 1 очко)', () => {
    const g: Genome = { ...genomeA(), size: 'small', aura: 'faint', pattern: 'solid', mutationId: null };
    expect(rarityOf(g)).toBe('uncommon');
  });

  it('giant + duotone (3 очка) даёт rare (граница снизу)', () => {
    const g: Genome = { ...genomeA(), size: 'giant', aura: 'none', pattern: 'duotone', mutationId: null };
    expect(rarityOf(g)).toBe('rare');
  });

  it('giant + radiant (5 очков) даёт epic (граница снизу)', () => {
    const g: Genome = { ...genomeA(), size: 'giant', aura: 'radiant', pattern: 'solid', mutationId: null };
    expect(rarityOf(g)).toBe('epic');
  });

  it('именная мутация форсирует минимальную редкость независимо от очков', () => {
    const phoenix = MUTATIONS.find((m) => m.id === 'phoenix')!;
    const g: Genome = { ...genomeA(), size: 'small', aura: 'none', pattern: 'solid', mutationId: phoenix.id };
    expect(rarityOf(g)).toBe('legendary');
  });

  it('mutationName возвращает читаемое имя или null', () => {
    expect(mutationName('golden_vein')).toBe('Золотая жилка');
    expect(mutationName(null)).toBeNull();
    expect(mutationName('unknown_id')).toBeNull();
  });
});

describe('sizeScale', () => {
  it('монотонно растёт small < normal < large < giant', () => {
    expect(sizeScale('small')).toBeLessThan(sizeScale('normal'));
    expect(sizeScale('normal')).toBeLessThan(sizeScale('large'));
    expect(sizeScale('large')).toBeLessThan(sizeScale('giant'));
  });
});
