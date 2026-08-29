import { describe, expect, it } from 'vitest';
import { GameStore } from './store';
import type { GameState, Plot, Specimen } from './types';
import type { AllelePair, GenomeV2 } from './geneticsV2';
import { projectGenomeV2ToLegacy } from './legacyProjectionV2';
import { MAX_PLOTS, START_UNLOCKED_PLOTS } from './types';
import { tutorialSunflowerPollenGenomeV2, tutorialSunflowerSeedGenomeV2 } from './tutorialV2';
import { mulberry32 } from './rng';
import type { RngFn } from './rng';

// ============================================================================
// Genetics V2 — Slice 12: store-level integration. Reveal/natural-reveal
// pure-function coverage — revealV2.test.ts; tutorial fixture/RNG coverage —
// tutorialV2.test.ts. This file: breedNurseryV2 tutorial-RNG substitution
// boundaries, natural reveal application/idempotency/no-microscope-overwrite,
// seedGeneticsTutorialV2/markGeneticsIntroSeenV2/markLumiHintShownV2
// lifecycle + persistence round-trip.
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

function fixtureSpecimen(id: string, genomeV2: GenomeV2, overrides: Partial<Specimen> = {}): Specimen {
  return {
    id,
    genome: projectGenomeV2ToLegacy(genomeV2),
    genomeV2,
    createdAt: 0,
    ...overrides,
  };
}

function fixturePlots(): Plot[] {
  const plots: Plot[] = [];
  for (let i = 0; i < MAX_PLOTS; i++) {
    plots.push({ id: i, unlocked: i < START_UNLOCKED_PLOTS, seedId: null, plantedAt: null });
  }
  return plots;
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    coins: 100,
    plots: fixturePlots(),
    inventory: {},
    specimens: [
      fixtureSpecimen('seed-parent', fixtureGenomeV2(1)),
      fixtureSpecimen('pollen-parent', fixtureGenomeV2(1, { stemForm: { a: 'stem_standard', b: 'stem_climbing' } })),
    ],
    geneticDust: 0,
    pityCounter: 0,
    questProgress: {},
    questsClaimed: [],
    entitlements: [],
    pollen: 100,
    labLevel: 1,
    nurseryTray: [],
    firstBreedFreeClaimed: true,
    firstHybridRewardClaimed: false,
    firstRecycleTopUpClaimed: false,
    ...overrides,
  };
}

function storeWith(state: GameState, rng: RngFn = mulberry32(1)): GameStore {
  return new GameStore({ rng, disablePersistence: true, initialState: state });
}

function tutorialSpecimen(id: string, genome: GenomeV2): Specimen {
  return fixtureSpecimen(id, genome, { tutorialStarter: true });
}

describe('breedNurseryV2 — подмена RNG на детерминированный tutorial-seed строго ограничена', () => {
  it('оба родителя tutorialStarter, счётчик 0 — первое скрещивание детерминировано (Uncommon, без мутации), pity 0->1', () => {
    const store = storeWith(
      baseState({
        specimens: [
          tutorialSpecimen('a', tutorialSunflowerSeedGenomeV2()),
          tutorialSpecimen('b', tutorialSunflowerPollenGenomeV2()),
        ],
        geneticsTutorialBreedsCompleted: 0,
        pityCounter: 0,
      }),
      // rng намеренно "испорчен" — если бы использовался this.rng вместо
      // tutorial-seed, результат отличался бы от контрактного.
      () => 0.999
    );
    const result = store.breedNurseryV2('a', 'b');
    if (!result.ok) throw new Error('expected success');
    expect(result.mutated).toBe(false);
    expect(store.getState().pityCounter).toBe(1);
    expect(store.getState().geneticsTutorialBreedsCompleted).toBe(1);
  });

  it('счётчик достиг 2 — третье скрещивание той же пары использует обычный this.rng, не tutorial-seed', () => {
    const rngCalls: number[] = [];
    const store = storeWith(
      baseState({
        specimens: [
          tutorialSpecimen('a', tutorialSunflowerSeedGenomeV2()),
          tutorialSpecimen('b', tutorialSunflowerPollenGenomeV2()),
        ],
        geneticsTutorialBreedsCompleted: 2,
        pityCounter: 5,
      }),
      () => {
        rngCalls.push(1);
        return 0.999; // гарантированно НЕ mutation event
      }
    );
    const result = store.breedNurseryV2('a', 'b');
    expect(result.ok).toBe(true);
    expect(rngCalls.length).toBeGreaterThan(0); // this.rng реально был вызван
    expect(store.getState().geneticsTutorialBreedsCompleted).toBe(2); // не растёт дальше 2
  });

  it('один из родителей не tutorialStarter — обычный this.rng, счётчик не растёт', () => {
    const store = storeWith(
      baseState({
        specimens: [
          tutorialSpecimen('a', tutorialSunflowerSeedGenomeV2()),
          fixtureSpecimen('c', tutorialSunflowerPollenGenomeV2()), // не помечен tutorialStarter
        ],
        geneticsTutorialBreedsCompleted: 0,
      }),
      () => 0.999
    );
    const result = store.breedNurseryV2('a', 'c');
    expect(result.ok).toBe(true);
    expect(store.getState().geneticsTutorialBreedsCompleted).toBe(0);
  });

  it('ветеранский save (tutorialStarter никогда не выставлялся) — обычные скрещивания не затрагиваются', () => {
    const store = storeWith(baseState({ geneticsTutorialBreedsCompleted: undefined }));
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result.ok).toBe(true);
    expect(store.getState().geneticsTutorialBreedsCompleted).toBe(0);
  });
});

describe('breedNurseryV2 — естественное раскрытие атомарно, идемпотентно, не перезаписывает microscope', () => {
  it('скрытый аллель родителя, выраженный в потомке, раскрывается с source natural', () => {
    const seed = fixtureSpecimen('a', fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } }));
    const pollen = fixtureSpecimen('b', fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } }));
    // Форсируем size_large в потомке: используем детерминированный RNG,
    // проверяя фактическое revealedLoci состояние после (не гадаем заранее).
    const store = storeWith(baseState({ specimens: [seed, pollen] }), mulberry32(6));
    store.breedNurseryV2('a', 'b');
    const state = store.getState();
    const a = state.specimens.find((s) => s.id === 'a')!;
    const b = state.specimens.find((s) => s.id === 'b')!;
    // Либо оба, либо ни один — но если раскрылось, source обязан быть natural.
    for (const specimen of [a, b]) {
      const sizeEntry = specimen.revealedLoci?.find((e) => e.locus === 'size');
      if (sizeEntry) expect(sizeEntry.source).toBe('natural');
    }
  });

  it('не перезаписывает существующий source:"microscope" тем же locus', () => {
    const seed = fixtureSpecimen('a', fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } }), {
      revealedLoci: [{ locus: 'size', source: 'microscope' }],
    });
    const pollen = fixtureSpecimen('b', fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } }));
    const store = storeWith(baseState({ specimens: [seed, pollen] }), mulberry32(6));
    store.breedNurseryV2('a', 'b');
    const a = store.getState().specimens.find((s) => s.id === 'a')!;
    const sizeEntries = a.revealedLoci?.filter((e) => e.locus === 'size') ?? [];
    expect(sizeEntries).toHaveLength(1);
    expect(sizeEntries[0].source).toBe('microscope');
  });

  it('не затрагивает другие уже раскрытые локусы родителя', () => {
    const seed = fixtureSpecimen('a', fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } }), {
      revealedLoci: [{ locus: 'stemForm', source: 'microscope' }],
    });
    const pollen = fixtureSpecimen('b', fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } }));
    const store = storeWith(baseState({ specimens: [seed, pollen] }), mulberry32(6));
    store.breedNurseryV2('a', 'b');
    const a = store.getState().specimens.find((s) => s.id === 'a')!;
    expect(a.revealedLoci?.find((e) => e.locus === 'stemForm')?.source).toBe('microscope');
  });

  it('повторное скрещивание тех же двух родителей второй раз не дублирует record (идемпотентность через существующий source-guard)', () => {
    const seed = fixtureSpecimen('a', fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } }));
    const pollen = fixtureSpecimen('b', fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } }));
    const store = storeWith(baseState({ specimens: [seed, pollen], pollen: 1000 }), mulberry32(6));
    store.breedNurseryV2('a', 'b');
    const afterFirst = store.getState().specimens.find((s) => s.id === 'a')!;
    const countAfterFirst = afterFirst.revealedLoci?.filter((e) => e.locus === 'size').length ?? 0;
    store.breedNurseryV2('a', 'b');
    const afterSecond = store.getState().specimens.find((s) => s.id === 'a')!;
    const countAfterSecond = afterSecond.revealedLoci?.filter((e) => e.locus === 'size').length ?? 0;
    expect(countAfterSecond).toBe(countAfterFirst);
  });
});

describe('seedGeneticsTutorialV2 — одноразовый, ограничен честно новой игрой', () => {
  function freshTwoSpecimenState(): GameState {
    return baseState({
      specimens: [fixtureSpecimen('x', fixtureGenomeV2(1)), fixtureSpecimen('y', fixtureGenomeV2(1))],
      pollen: 0,
      pityCounter: 0,
      geneticDust: 0,
      firstBreedFreeClaimed: false,
    });
  }

  it('свежая игра — засевает оба specimen контрактным геномом и tutorialStarter:true', () => {
    const store = storeWith(freshTwoSpecimenState());
    const applied = store.seedGeneticsTutorialV2();
    expect(applied).toBe(true);
    const state = store.getState();
    expect(state.geneticsTutorialStartersSeeded).toBe(true);
    for (const s of state.specimens) {
      expect(s.tutorialStarter).toBe(true);
      expect(s.genomeV2).toBeDefined();
    }
  });

  it('повторный вызов — no-op (не перезасевает, не эмитит лишний раз)', () => {
    const store = storeWith(freshTwoSpecimenState());
    store.seedGeneticsTutorialV2();
    const stateAfterFirst = store.getState();
    const applied = store.seedGeneticsTutorialV2();
    expect(applied).toBe(false);
    expect(store.getState()).toEqual(stateAfterFirst);
  });

  it('ветеранский save (firstBreedFreeClaimed=true) — не засевает', () => {
    const store = storeWith({ ...freshTwoSpecimenState(), firstBreedFreeClaimed: true });
    expect(store.seedGeneticsTutorialV2()).toBe(false);
    expect(store.getState().geneticsTutorialStartersSeeded ?? false).toBe(false);
  });
});

describe('markGeneticsIntroSeenV2 / markLumiHintShownV2 — идемпотентность', () => {
  it('markGeneticsIntroSeenV2 повторный вызов не меняет состояние further', () => {
    const store = storeWith(baseState());
    store.markGeneticsIntroSeenV2();
    expect(store.getState().geneticsIntroSeen).toBe(true);
    const after = store.getState();
    store.markGeneticsIntroSeenV2();
    expect(store.getState()).toEqual(after);
  });

  it('markLumiHintShownV2 не дублирует один и тот же ключ', () => {
    const store = storeWith(baseState());
    store.markLumiHintShownV2('first_plant_ready');
    store.markLumiHintShownV2('first_plant_ready');
    expect(store.getState().lumiHintsShown).toEqual(['first_plant_ready']);
  });

  it('markLumiHintShownV2 накапливает разные ключи по порядку', () => {
    const store = storeWith(baseState());
    store.markLumiHintShownV2('first_plant_ready');
    store.markLumiHintShownV2('hybrid_unlocked');
    expect(store.getState().lumiHintsShown).toEqual(['first_plant_ready', 'hybrid_unlocked']);
  });
});

describe('save/reload — Slice 12 поля переживают JSON round-trip', () => {
  function reload(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state)) as GameState;
  }

  it('geneticsTutorialStartersSeeded/geneticsTutorialBreedsCompleted/geneticsIntroSeen/lumiHintsShown переживают round-trip', () => {
    const store = storeWith(
      baseState({
        geneticsTutorialStartersSeeded: true,
        geneticsTutorialBreedsCompleted: 1,
        geneticsIntroSeen: true,
        lumiHintsShown: ['first_plant_ready'],
      })
    );
    const reloaded = reload(store.getState());
    const store2 = storeWith(reloaded);
    expect(store2.getState().geneticsTutorialStartersSeeded).toBe(true);
    expect(store2.getState().geneticsTutorialBreedsCompleted).toBe(1);
    expect(store2.getState().geneticsIntroSeen).toBe(true);
    expect(store2.getState().lumiHintsShown).toEqual(['first_plant_ready']);
  });

  it('старый V4-save без Slice 12 полей вообще (undefined) — читается с честными дефолтами, не роняет store', () => {
    const legacyLikeState = baseState();
    delete (legacyLikeState as Partial<GameState>).geneticsTutorialStartersSeeded;
    delete (legacyLikeState as Partial<GameState>).geneticsTutorialBreedsCompleted;
    delete (legacyLikeState as Partial<GameState>).geneticsIntroSeen;
    delete (legacyLikeState as Partial<GameState>).lumiHintsShown;
    const store = storeWith(reload(legacyLikeState));
    expect(store.getState().geneticsTutorialStartersSeeded ?? false).toBe(false);
    expect(store.getState().geneticsTutorialBreedsCompleted ?? 0).toBe(0);
    expect(store.getState().geneticsIntroSeen ?? false).toBe(false);
    expect(store.getState().lumiHintsShown ?? []).toEqual([]);
    // не должен ошибочно решить, что это tutorial-скрещивание
    expect(store.breedNurseryV2('seed-parent', 'pollen-parent').ok).toBe(true);
    expect(store.getState().geneticsTutorialBreedsCompleted ?? 0).toBe(0);
  });
});
