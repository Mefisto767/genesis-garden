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

  // Genetics V2 — Slice 12 fix-pass (contract §4.14.14, owner review §3):
  // the second tutorial breed is now a normal PAID breed (8 pollen) — it is
  // never free, and it is only ever treated as "the" deterministic tutorial
  // breed once `secondTutorialLessonAvailable` is actually true (owner
  // review §4 — first hybrid matured AND its Reveal acknowledged).

  it('второй tutorial-breed при выполненном условии (первый гибрид созрел и Reveal подтверждён) списывает ровно 8 пыльцы, не бесплатен', () => {
    const store = storeWith(
      baseState({
        specimens: [
          tutorialSpecimen('a', tutorialSunflowerSeedGenomeV2()),
          tutorialSpecimen('b', tutorialSunflowerPollenGenomeV2()),
          // "первый гибрид созрел и Reveal подтверждён" — единственное, что
          // secondTutorialLessonAvailable реально проверяет по specimens.
          fixtureSpecimen('child-1', tutorialSunflowerSeedGenomeV2(), {
            tutorialBreedStep: 0,
            revealAcknowledged: true,
          }),
        ],
        geneticsTutorialBreedsCompleted: 1,
        firstBreedFreeClaimed: true,
        pollen: 8,
      }),
      mulberry32(6)
    );
    const result = store.breedNurseryV2('a', 'b');
    expect(result.ok).toBe(true);
    expect(store.getState().pollen).toBe(0); // ровно 8 списано, не 0
    expect(store.getState().geneticsTutorialBreedsCompleted).toBe(2);
  });

  it('второй tutorial-breed при недостатке пыльцы (7 из 8) — полный no-op, 0 RNG, tutorial RNG не вызывается', () => {
    const rngCalls: number[] = [];
    const store = storeWith(
      baseState({
        specimens: [
          tutorialSpecimen('a', tutorialSunflowerSeedGenomeV2()),
          tutorialSpecimen('b', tutorialSunflowerPollenGenomeV2()),
          fixtureSpecimen('child-1', tutorialSunflowerSeedGenomeV2(), {
            tutorialBreedStep: 0,
            revealAcknowledged: true,
          }),
        ],
        geneticsTutorialBreedsCompleted: 1,
        firstBreedFreeClaimed: true,
        pollen: 7,
      }),
      () => {
        rngCalls.push(1);
        return 0.5;
      }
    );
    const stateBefore = store.getState();
    const result = store.breedNurseryV2('a', 'b');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('insufficient_pollen');
    if (result.reason === 'insufficient_pollen') {
      expect(result.requiredPollen).toBe(8);
      expect(result.availablePollen).toBe(7);
    }
    expect(rngCalls.length).toBe(0); // ни tutorial-seed, ни this.rng не вызывались
    expect(store.getState()).toEqual(stateBefore); // полный no-op
    expect(store.getState().geneticsTutorialBreedsCompleted).toBe(1); // не растёт при отказе
  });

  it('breeding the SAME tutorial pair a second time BEFORE the first child is revealed — normal paid breed, no tutorialBreedStep, does not increment the tutorial counter beyond what a normal breed would', () => {
    const store = storeWith(
      baseState({
        specimens: [
          tutorialSpecimen('a', tutorialSunflowerSeedGenomeV2()),
          tutorialSpecimen('b', tutorialSunflowerPollenGenomeV2()),
        ],
        // First tutorial breed already happened (counter is 1), but the
        // resulting hybrid was never planted/matured/revealed — no specimen
        // with tutorialBreedStep:0 exists yet.
        geneticsTutorialBreedsCompleted: 1,
        firstBreedFreeClaimed: true,
        pollen: 8,
      }),
      () => 0.999 // guaranteed no mutation event on this.rng
    );
    const result = store.breedNurseryV2('a', 'b');
    if (!result.ok) throw new Error('expected success');
    expect(store.getState().pollen).toBe(0); // paid at the normal price, same as any other breed
    // Not treated as the guaranteed second lesson — counter stays at 1.
    expect(store.getState().geneticsTutorialBreedsCompleted).toBe(1);
    const seed = store.getState().nurseryTray.at(-1)!;
    expect(seed.tutorialBreedStep).toBeUndefined();
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

// Genetics V2 — Slice 12 fix-pass (contract §4.14.14, owner review §1/§2):
// natural reveal is no longer applied by `breedNurseryV2` at all — it is
// deferred to first maturity (`harvestHybridV2`). The full natural-reveal
// timing/idempotency/microscope-precedence/mutation-exclusion coverage that
// used to live in this describe block now lives in
// `store.revealLifecycleV2.test.ts`, alongside the rest of the persisted
// Reveal lifecycle it belongs with. This block only asserts the new
// invariant breed itself must uphold.
describe('breedNurseryV2 — НЕ трогает revealedLoci родителей (natural reveal перенесён на harvestHybridV2)', () => {
  it('успешное скрещивание не меняет revealedLoci ни одного из двух родителей', () => {
    const seed = fixtureSpecimen('a', fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } }));
    const pollen = fixtureSpecimen('b', fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } }));
    const store = storeWith(baseState({ specimens: [seed, pollen] }), mulberry32(6));
    store.breedNurseryV2('a', 'b');
    const state = store.getState();
    expect(state.specimens.find((s) => s.id === 'a')!.revealedLoci).toBeUndefined();
    expect(state.specimens.find((s) => s.id === 'b')!.revealedLoci).toBeUndefined();
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

describe('isBrandNewGameV2 — distinguishes an actually-empty save from one merely shaped like a fresh game', () => {
  it('constructed with initialState (any test harness scenario) — never brand-new', () => {
    const store = storeWith(baseState());
    expect(store.isBrandNewGameV2()).toBe(false);
  });

  it('no save present in storage at all — brand-new (real GameStore, no initialState override)', () => {
    const store = new GameStore({ rng: mulberry32(1), disablePersistence: true });
    expect(store.isBrandNewGameV2()).toBe(true);
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
