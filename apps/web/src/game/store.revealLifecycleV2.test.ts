import { describe, expect, it } from 'vitest';
import { GameStore } from './store';
import type { GameState, Plot, Specimen } from './types';
import type { AllelePair, GenomeV2, HybridSeedV2 } from './geneticsV2';
import { projectGenomeV2ToLegacy } from './legacyProjectionV2';
import { findPendingHybridRevealV2 } from './revealV2';
import { MAX_PLOTS, START_UNLOCKED_PLOTS } from './types';
import { mulberry32 } from './rng';
import type { RngFn } from './rng';

// ============================================================================
// Genetics V2 — Slice 12 fix-pass (contract §4.14.14, owner review §1/§2/§6):
// the persisted Reveal lifecycle —
//   bred unknown seed -> planted/growing -> mature pending Reveal
//   -> Reveal acknowledged
// — and the natural reveal timing/idempotency this fix-pass moved from
// `breedNurseryV2` to `harvestHybridV2` (first maturity). Does NOT duplicate
// `store.nurseryV2.test.ts` (nursery growth timings, discriminated results,
// idempotent Specimen creation) or `store.tutorialV2.test.ts` (tutorial RNG/
// economics gating) — this file is specifically about the Reveal lifecycle
// fields (`revealAcknowledged`/`revealParentSpecies`/`revealNaturalReveal`)
// and natural reveal's new timing.
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
      fixtureSpecimen('seed-parent', fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } })),
      fixtureSpecimen('pollen-parent', fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } })),
    ],
    geneticDust: 0,
    pityCounter: 0,
    questProgress: {},
    questsClaimed: [],
    entitlements: [],
    pollen: 0,
    labLevel: 1,
    nurseryTray: [],
    firstBreedFreeClaimed: false,
    firstHybridRewardClaimed: false,
    firstRecycleTopUpClaimed: false,
    ...overrides,
  };
}

function storeWith(state: GameState, rng: RngFn = mulberry32(1)): GameStore {
  return new GameStore({ rng, disablePersistence: true, initialState: state });
}

function reload(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

/** Plants a growing hybrid on plot 0, forced to express `size_large` (the
 * heterozygous locus both fixture parents above carry hidden) so natural
 * reveal has something real to do. */
function plantedGrowingState(overrides: Partial<GameState> = {}): GameState {
  const hybrid: HybridSeedV2 = {
    id: 'hybrid-1',
    genomeV2: fixtureGenomeV2(1, { size: homo('size_large') }),
    parentIds: ['seed-parent', 'pollen-parent'],
    createdAt: 0,
    plantedAt: 0,
    plotId: 0,
  };
  const plots = fixturePlots().map((p) => (p.id === 0 ? { ...p, hybridV2: { phase: 'growing' as const, hybrid } } : p));
  return baseState({ plots, ...overrides });
}

const FIRST_GROW_MS = 5 * 60 * 1000; // species 1

describe('Reveal lifecycle — breed -> planted/growing -> mature pending Reveal -> Reveal acknowledged', () => {
  it('unknown seed (nurseryTray) переживает JSON/save/reload без изменений', () => {
    const store = storeWith(baseState({ pollen: 100 }), mulberry32(6));
    store.breedNurseryV2('seed-parent', 'pollen-parent');
    const before = store.getState();
    const after = reload(before);
    expect(after.nurseryTray).toEqual(before.nurseryTray);
    expect(after.nurseryTray[0].genomeV2).toBeDefined(); // seed itself still fully known internally...
    expect(after.specimens.find((s) => s.revealAcknowledged !== undefined)).toBeUndefined(); // ...but no Reveal exists yet
  });

  it('growing hybrid переживает reload: остаётся growing, ни один Specimen ещё не создан', () => {
    const store = storeWith(plantedGrowingState());
    const before = store.getState();
    const after = reload(before);
    const plot0 = after.plots.find((p) => p.id === 0)!;
    expect(plot0.hybridV2?.phase).toBe('growing');
    expect(after.specimens).toHaveLength(2); // still just the two original parents
  });

  it('первое mature взаимодействие (harvestHybridV2 на готовности) создаёт Specimen с revealAcknowledged:false — "mature pending Reveal"', () => {
    const store = storeWith(plantedGrowingState());
    const ok = store.harvestHybridV2(0, FIRST_GROW_MS);
    expect(ok).toBe(true);
    const plot0 = store.getState().plots.find((p) => p.id === 0)!;
    expect(plot0.hybridV2?.phase).toBe('mature');
    const hybridV2 = plot0.hybridV2!;
    const specimenId = hybridV2.phase === 'mature' ? hybridV2.specimenId : null;
    const specimen = store.getState().specimens.find((s) => s.id === specimenId)!;
    expect(specimen.revealAcknowledged).toBe(false);
  });

  it('natural reveal применяется РОВНО в момент первого maturity, не раньше', () => {
    const store = storeWith(plantedGrowingState());
    // Before maturity — parents untouched (breed already happened before
    // this test even starts, conceptually, but here there is no breed step
    // at all — the hybrid is injected directly — so this also proves nothing
    // implicitly triggers natural reveal before harvestHybridV2 runs).
    expect(store.getState().specimens.find((s) => s.id === 'seed-parent')!.revealedLoci).toBeUndefined();
    store.harvestHybridV2(0, FIRST_GROW_MS);
    const state = store.getState();
    const seedParent = state.specimens.find((s) => s.id === 'seed-parent')!;
    const pollenParent = state.specimens.find((s) => s.id === 'pollen-parent')!;
    expect(seedParent.revealedLoci?.find((e) => e.locus === 'size')?.source).toBe('natural');
    expect(pollenParent.revealedLoci?.find((e) => e.locus === 'size')?.source).toBe('natural');
    // ...and captured on the new specimen for the Reveal screen to render later.
    const child = state.specimens.find((s) => s.genomeV2?.mutationId === null && s.parentIds)!;
    expect(child.revealNaturalReveal?.seedLoci).toContain('size');
    expect(child.revealNaturalReveal?.pollenLoci).toContain('size');
  });

  it('естественное раскрытие не перезаписывает существующий source:"microscope"', () => {
    const store = storeWith(
      plantedGrowingState({
        specimens: [
          fixtureSpecimen('seed-parent', fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } }), {
            revealedLoci: [{ locus: 'size', source: 'microscope' }],
          }),
          fixtureSpecimen('pollen-parent', fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } })),
        ],
      })
    );
    store.harvestHybridV2(0, FIRST_GROW_MS);
    const seedParent = store.getState().specimens.find((s) => s.id === 'seed-parent')!;
    const sizeEntries = seedParent.revealedLoci?.filter((e) => e.locus === 'size') ?? [];
    expect(sizeEntries).toHaveLength(1);
    expect(sizeEntries[0].source).toBe('microscope');
  });

  it('родитель, переработанный/удалённый до maturity — natural reveal просто не применяется к отсутствующей стороне, без падения', () => {
    const hybrid: HybridSeedV2 = {
      id: 'hybrid-1',
      genomeV2: fixtureGenomeV2(1, { size: homo('size_large') }),
      parentIds: ['seed-parent', 'gone'], // 'gone' no longer exists
      createdAt: 0,
      plantedAt: 0,
      plotId: 0,
    };
    const plots = fixturePlots().map((p) => (p.id === 0 ? { ...p, hybridV2: { phase: 'growing' as const, hybrid } } : p));
    const store = storeWith(
      baseState({
        plots,
        specimens: [fixtureSpecimen('seed-parent', fixtureGenomeV2(1, { size: { a: 'size_normal', b: 'size_large' } }))],
      })
    );
    expect(() => store.harvestHybridV2(0, FIRST_GROW_MS)).not.toThrow();
    const state = store.getState();
    expect(state.plots.find((p) => p.id === 0)!.hybridV2?.phase).toBe('mature');
    // Still honestly recorded on the child that only one side was ever known.
    const child = state.specimens.find((s) => s.parentIds?.[1] === 'gone')!;
    expect(child.revealNaturalReveal).toEqual({ seedLoci: ['size'], pollenLoci: [] });
  });

  it('mutated aura at harvest — natural reveal excludes aura even if a parent happens to carry the same hidden allele', () => {
    const hybrid: HybridSeedV2 = {
      id: 'hybrid-1',
      genomeV2: fixtureGenomeV2(1, { aura: homo('aura_radiant'), mutationId: 'golden_vein' }),
      parentIds: ['seed-parent', 'pollen-parent'],
      createdAt: 0,
      plantedAt: 0,
      plotId: 0,
    };
    const plots = fixturePlots().map((p) => (p.id === 0 ? { ...p, hybridV2: { phase: 'growing' as const, hybrid } } : p));
    const store = storeWith(
      baseState({
        plots,
        specimens: [
          fixtureSpecimen('seed-parent', fixtureGenomeV2(1, { aura: { a: 'aura_faint', b: 'aura_radiant' } })),
          fixtureSpecimen('pollen-parent', fixtureGenomeV2(1, { aura: { a: 'aura_faint', b: 'aura_radiant' } })),
        ],
      })
    );
    store.harvestHybridV2(0, FIRST_GROW_MS);
    const state = store.getState();
    expect(state.specimens.find((s) => s.id === 'seed-parent')!.revealedLoci?.find((e) => e.locus === 'aura')).toBeUndefined();
    expect(state.specimens.find((s) => s.id === 'pollen-parent')!.revealedLoci?.find((e) => e.locus === 'aura')).toBeUndefined();
  });

  it('закрытие Reveal (acknowledgeRevealV2) ставит persisted acknowledged-state', () => {
    const store = storeWith(plantedGrowingState());
    store.harvestHybridV2(0, FIRST_GROW_MS);
    const specimenId = store.getState().specimens.find((s) => s.revealAcknowledged === false)!.id;
    store.acknowledgeRevealV2(specimenId);
    expect(store.getState().specimens.find((s) => s.id === specimenId)!.revealAcknowledged).toBe(true);
  });

  it('acknowledgeRevealV2 идемпотентен — повторный вызов не эмитит и не меняет состояние', () => {
    const store = storeWith(plantedGrowingState());
    store.harvestHybridV2(0, FIRST_GROW_MS);
    const specimenId = store.getState().specimens.find((s) => s.revealAcknowledged === false)!.id;
    store.acknowledgeRevealV2(specimenId);
    const afterFirst = store.getState();
    store.acknowledgeRevealV2(specimenId);
    expect(store.getState()).toEqual(afterFirst);
  });

  it('acknowledgeRevealV2 на неизвестном id — no-op, не бросает', () => {
    const store = storeWith(plantedGrowingState());
    store.harvestHybridV2(0, FIRST_GROW_MS);
    const before = store.getState();
    expect(() => store.acknowledgeRevealV2('does-not-exist')).not.toThrow();
    expect(store.getState()).toEqual(before);
  });

  it('повторный mature-клик (repeat harvest на готовности) не открывает Reveal заново — revealAcknowledged не сбрасывается', () => {
    const store = storeWith(plantedGrowingState());
    store.harvestHybridV2(0, FIRST_GROW_MS);
    const specimenId = store.getState().specimens.find((s) => s.revealAcknowledged === false)!.id;
    store.acknowledgeRevealV2(specimenId);
    // Repeat cycle: regrow (species 1: 20 min) then harvest again.
    store.harvestHybridV2(0, FIRST_GROW_MS + 20 * 60 * 1000);
    expect(store.getState().specimens.find((s) => s.id === specimenId)!.revealAcknowledged).toBe(true);
  });

  it('повторные урожаи продолжают работать (pollen начисляется, lastHarvestAt обновляется) независимо от reveal-состояния', () => {
    const store = storeWith(plantedGrowingState());
    store.harvestHybridV2(0, FIRST_GROW_MS);
    const pollenAfterFirst = store.getState().pollen;
    const ok = store.harvestHybridV2(0, FIRST_GROW_MS + 20 * 60 * 1000);
    expect(ok).toBe(true);
    expect(store.getState().pollen).toBeGreaterThan(pollenAfterFirst);
  });

  it('pollen reward не дублируется одним и тем же maturity timestamp — повторный вызов той же ready-грядки до regrow отклоняется, 0 доп. пыльцы', () => {
    const store = storeWith(plantedGrowingState());
    store.harvestHybridV2(0, FIRST_GROW_MS);
    const pollenAfterFirst = store.getState().pollen;
    // Same instant, regrow not elapsed — must be a full no-op.
    const ok = store.harvestHybridV2(0, FIRST_GROW_MS);
    expect(ok).toBe(false);
    expect(store.getState().pollen).toBe(pollenAfterFirst);
  });

  it('reload при pending Reveal не теряет его — findPendingHybridRevealV2 всё ещё находит specimen после round-trip', () => {
    const store = storeWith(plantedGrowingState());
    store.harvestHybridV2(0, FIRST_GROW_MS);
    const reloaded = reload(store.getState());
    const pending = findPendingHybridRevealV2(reloaded.specimens);
    expect(pending).not.toBeNull();
  });

  it('reload после acknowledged Reveal НЕ показывает его снова', () => {
    const store = storeWith(plantedGrowingState());
    store.harvestHybridV2(0, FIRST_GROW_MS);
    const specimenId = store.getState().specimens.find((s) => s.revealAcknowledged === false)!.id;
    store.acknowledgeRevealV2(specimenId);
    const reloaded = reload(store.getState());
    expect(findPendingHybridRevealV2(reloaded.specimens)).toBeNull();
  });

  it('Specimen создаётся идемпотентно даже если harvestHybridV2 вызван дважды подряд на одной готовности (второй вызов — no-op на mature-ветке)', () => {
    const store = storeWith(plantedGrowingState());
    store.harvestHybridV2(0, FIRST_GROW_MS);
    const countAfterFirst = store.getState().specimens.length;
    store.harvestHybridV2(0, FIRST_GROW_MS); // same instant — mature branch, regrow not elapsed
    expect(store.getState().specimens.length).toBe(countAfterFirst);
  });
});
