import { describe, expect, it } from 'vitest';
import { breedV2 } from './mutationV2';
import { mulberry32 } from './rng';
import {
  TUTORIAL_FIRST_BREED_SEED,
  TUTORIAL_SECOND_BREED_SEED,
  shouldSeedTutorialStartersV2,
  tutorialBreedRngSeed,
  tutorialReplayChildGenomeV2,
  tutorialSunflowerPollenGenomeV2,
  tutorialSunflowerSeedGenomeV2,
} from './tutorialV2';
import type { Specimen } from './types';

// ============================================================================
// Genetics V2 — Slice 12: tutorial fixtures. Проверяет, что фикстуры этого
// файла (переиспользованные store.ts) действительно производят контрактные
// результаты (§4.6.3/§4.6.4) через РЕАЛЬНЫЙ breedV2 — не переизобретает
// mutationV2.test.ts, а фиксирует именно то, что видит store: seed-функцию
// tutorialBreedRngSeed + сами геномы-фикстуры этого модуля.
// ============================================================================

function baseSpecimen(overrides: Partial<Specimen> = {}): Specimen {
  return {
    id: 'sp-1',
    genome: {} as never,
    createdAt: 0,
    ...overrides,
  };
}

describe('tutorialSunflowerSeedGenomeV2 / tutorialSunflowerPollenGenomeV2 — реальный breedV2 воспроизводит контракт §4.6.3/§4.6.4', () => {
  it('первое обучающее скрещивание (tutorialBreedRngSeed(0)) — Uncommon, без мутации', () => {
    const seed = tutorialSunflowerSeedGenomeV2();
    const pollen = tutorialSunflowerPollenGenomeV2();
    const result = breedV2(seed, pollen, 0, mulberry32(tutorialBreedRngSeed(0)));
    if (!result.ok) throw new Error('expected success');
    expect(result.mutated).toBe(false);
    expect(result.rarity).toBe('Uncommon');
    expect(result.nextPityCounter).toBe(1);
    // хотя бы один узнаваемый признак от каждого родителя
    expect(result.phenotype.primaryColor).toBe('primary_honey'); // seed
    expect(result.phenotype.secondaryColor).toBe('secondary_forest'); // pollen
  });

  it('второе обучающее скрещивание (tutorialBreedRngSeed(1)) — гарантированно раскрывает size_large у обоих родителей, без мутации', () => {
    const seed = tutorialSunflowerSeedGenomeV2();
    const pollen = tutorialSunflowerPollenGenomeV2();
    const result = breedV2(seed, pollen, 1, mulberry32(tutorialBreedRngSeed(1)));
    if (!result.ok) throw new Error('expected success');
    expect(result.mutated).toBe(false);
    expect(result.genomeV2.size).toEqual({ a: 'size_large', b: 'size_large' });
    expect(result.phenotype.size).toBe('size_large');
    expect(result.nextPityCounter).toBe(2);
  });

  it('tutorialBreedRngSeed — константы соответствуют шагам 0/1', () => {
    expect(tutorialBreedRngSeed(0)).toBe(TUTORIAL_FIRST_BREED_SEED);
    expect(tutorialBreedRngSeed(1)).toBe(TUTORIAL_SECOND_BREED_SEED);
  });
});

describe('tutorialReplayChildGenomeV2 — литеральные геномы демо-повтора совпадают с реальным breedV2 (не переизобретают его)', () => {
  it('шаг 0 — size не раскрыт (size_normal/size_normal)', () => {
    const genome = tutorialReplayChildGenomeV2(0);
    expect(genome.size).toEqual({ a: 'size_normal', b: 'size_normal' });
    expect(genome.mutationId).toBeNull();
  });

  it('шаг 1 — size раскрыт (size_large/size_large), совпадает с реальным breedV2 второго шага', () => {
    const real = breedV2(
      tutorialSunflowerSeedGenomeV2(),
      tutorialSunflowerPollenGenomeV2(),
      1,
      mulberry32(tutorialBreedRngSeed(1))
    );
    if (!real.ok) throw new Error('expected success');
    const replay = tutorialReplayChildGenomeV2(1);
    expect(replay.size).toEqual(real.genomeV2.size);
  });
});

describe('shouldSeedTutorialStartersV2 — только честно новая игра', () => {
  const freshState = {
    specimens: [baseSpecimen({ id: 'a' }), baseSpecimen({ id: 'b' })],
    pityCounter: 0,
    geneticDust: 0,
    firstBreedFreeClaimed: false,
    geneticsTutorialStartersSeeded: false,
  };

  it('свежая игра с ровно 2 специменами без родословной/мутаций — true', () => {
    expect(shouldSeedTutorialStartersV2(freshState)).toBe(true);
  });

  it('уже засеяно ранее — false (одноразовость)', () => {
    expect(shouldSeedTutorialStartersV2({ ...freshState, geneticsTutorialStartersSeeded: true })).toBe(false);
  });

  it('уже было бесплатное скрещивание (ветеранский признак) — false', () => {
    expect(shouldSeedTutorialStartersV2({ ...freshState, firstBreedFreeClaimed: true })).toBe(false);
  });

  it('pityCounter > 0 (уже скрещивались) — false', () => {
    expect(shouldSeedTutorialStartersV2({ ...freshState, pityCounter: 3 })).toBe(false);
  });

  it('geneticDust > 0 (уже перерабатывали) — false', () => {
    expect(shouldSeedTutorialStartersV2({ ...freshState, geneticDust: 1 })).toBe(false);
  });

  it('не ровно 2 специмена — false', () => {
    expect(shouldSeedTutorialStartersV2({ ...freshState, specimens: [baseSpecimen()] })).toBe(false);
    expect(
      shouldSeedTutorialStartersV2({
        ...freshState,
        specimens: [baseSpecimen({ id: 'a' }), baseSpecimen({ id: 'b' }), baseSpecimen({ id: 'c' })],
      })
    ).toBe(false);
  });

  it('специмен уже с parentIds (не «нетронутый» стартовый набор) — false', () => {
    expect(
      shouldSeedTutorialStartersV2({
        ...freshState,
        specimens: [baseSpecimen({ id: 'a', parentIds: ['x', 'y'] }), baseSpecimen({ id: 'b' })],
      })
    ).toBe(false);
  });
});
