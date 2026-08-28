import { describe, expect, it } from 'vitest';
import { GameStore } from './store';
import type { GameState, Plot, Specimen } from './types';
import type { AllelePair, GenomeV2 } from './geneticsV2';
import { projectGenomeV2ToLegacy } from './legacyProjectionV2';
import { mulberry32 } from './rng';
import { MAX_PLOTS, START_UNLOCKED_PLOTS } from './types';

// ============================================================================
// Genetics V2 — Slice 7: recycling economy, store-level integration (contract
// §4.10.2/§4.10.3, delta doc §0.9). grownRecycleDustV2/nurseryRecycleDustV2/
// firstRecycleTopUpV2 pure-function coverage — recyclingV2.test.ts. This
// file: recycleNurserySeedV2/recycleSpecimenV2 atomicity, unified
// firstRecycleTopUpClaimed lifecycle, ambiguous_plot_reference safety,
// persistence/round-trip, V2<->Legacy toggle safety.
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

function fixtureSeed(id: string, genomeV2: GenomeV2) {
  return {
    id,
    genomeV2,
    parentIds: ['seed-parent', 'pollen-parent'] as [string, string],
    createdAt: 0,
    plantedAt: null,
    plotId: null,
  };
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
    pollen: 0,
    labLevel: 1,
    nurseryTray: [],
    firstBreedFreeClaimed: false,
    firstHybridRewardClaimed: false,
    firstRecycleTopUpClaimed: false,
    ...overrides,
  };
}

function storeWith(state: GameState): GameStore {
  return new GameStore({ rng: mulberry32(1), disablePersistence: true, initialState: state });
}

// Rare через golden_vein (Minor floor) даёт grownRecycleDustV2=5 — уже >=3,
// удобно как "база уже достаточна" фикстура для тестов компенсации.
const RARE_GENOME = fixtureGenomeV2(1, { mutationId: 'golden_vein' });

describe('recycleNurserySeedV2 — успешный путь', () => {
  it('удаляет только выбранное семя из nurseryTray, остальные не трогает', () => {
    const seedA = fixtureSeed('seed-A', fixtureGenomeV2(1));
    const seedB = fixtureSeed('seed-B', fixtureGenomeV2(1));
    const store = storeWith(baseState({ nurseryTray: [seedA, seedB] }));
    const result = store.recycleNurserySeedV2('seed-A');
    expect(result.ok).toBe(true);
    const tray = store.getState().nurseryTray;
    expect(tray).toHaveLength(1);
    expect(tray[0].id).toBe('seed-B');
  });

  it('seed_not_found — полный no-op', () => {
    const state = baseState({ nurseryTray: [fixtureSeed('seed-A', fixtureGenomeV2(1))] });
    const store = storeWith(state);
    const result = store.recycleNurserySeedV2('nope');
    expect(result).toEqual({ ok: false, reason: 'seed_not_found' });
    expect(store.getState()).toEqual(state);
  });

  it('посаженный (growing) гибрид недоступен этой операции — он уже не в nurseryTray', () => {
    const seed = fixtureSeed('seed-A', fixtureGenomeV2(1));
    const plots = fixturePlots().map((p) =>
      p.id === 0 ? { ...p, hybridV2: { phase: 'growing' as const, hybrid: { ...seed, plantedAt: 0, plotId: 0 } } } : p
    );
    const store = storeWith(baseState({ nurseryTray: [], plots }));
    const result = store.recycleNurserySeedV2('seed-A');
    expect(result).toEqual({ ok: false, reason: 'seed_not_found' });
  });

  it('первая переработка (base<3) дополняется до ровно 3, флаг становится true', () => {
    const seed = fixtureSeed('seed-A', fixtureGenomeV2(1)); // Common -> nurseryRecycleDustV2=1
    const store = storeWith(baseState({ nurseryTray: [seed], firstRecycleTopUpClaimed: false }));
    const result = store.recycleNurserySeedV2('seed-A');
    expect(result).toEqual({ ok: true, baseDust: 1, topUpDust: 2, dustGained: 3 });
    expect(store.getState().geneticDust).toBe(3);
    expect(store.getState().firstRecycleTopUpClaimed).toBe(true);
  });

  it('первая переработка с base>=3 не получает компенсацию, выдаёт обычную сумму', () => {
    const seed = fixtureSeed('seed-A', RARE_GENOME); // Rare -> nurseryRecycleDustV2=2 ...still <3
    // Используем Epic (mutationId=stardust) чтобы гарантировать base>=3 на половинном тарифе.
    const epicSeed = fixtureSeed('seed-B', fixtureGenomeV2(1, { mutationId: 'stardust' }));
    const store = storeWith(baseState({ nurseryTray: [seed, epicSeed], firstRecycleTopUpClaimed: false }));
    const result = store.recycleNurserySeedV2('seed-B');
    expect(result).toEqual({ ok: true, baseDust: 6, topUpDust: 0, dustGained: 6 });
  });

  it('последующие переработки (флаг уже true) не получают компенсацию — только тариф', () => {
    const seed = fixtureSeed('seed-A', fixtureGenomeV2(1)); // Common -> 1
    const store = storeWith(baseState({ nurseryTray: [seed], firstRecycleTopUpClaimed: true }));
    const result = store.recycleNurserySeedV2('seed-A');
    expect(result).toEqual({ ok: true, baseDust: 1, topUpDust: 0, dustGained: 1 });
  });

  it('повторный вызов с тем же id после удаления — no-op, не выдаёт пыль второй раз', () => {
    const seed = fixtureSeed('seed-A', fixtureGenomeV2(1));
    const store = storeWith(baseState({ nurseryTray: [seed], firstRecycleTopUpClaimed: false }));
    store.recycleNurserySeedV2('seed-A');
    const dustAfterFirst = store.getState().geneticDust;
    const result2 = store.recycleNurserySeedV2('seed-A');
    expect(result2).toEqual({ ok: false, reason: 'seed_not_found' });
    expect(store.getState().geneticDust).toBe(dustAfterFirst);
  });

  it('pollen/coins/pityCounter/labLevel/firstBreedFreeClaimed/firstHybridRewardClaimed не меняются', () => {
    const seed = fixtureSeed('seed-A', fixtureGenomeV2(1));
    const store = storeWith(baseState({ nurseryTray: [seed], pollen: 42, coins: 100, pityCounter: 3, labLevel: 1 }));
    const before = store.getState();
    store.recycleNurserySeedV2('seed-A');
    const after = store.getState();
    expect(after.pollen).toBe(before.pollen);
    expect(after.coins).toBe(before.coins);
    expect(after.pityCounter).toBe(before.pityCounter);
    expect(after.labLevel).toBe(before.labLevel);
    expect(after.firstBreedFreeClaimed).toBe(before.firstBreedFreeClaimed);
    expect(after.firstHybridRewardClaimed).toBe(before.firstHybridRewardClaimed);
  });
});

describe('recycleSpecimenV2 — успешный путь и защитные отказы', () => {
  it('удаляет только выбранный specimen из коллекции', () => {
    const target = fixtureSpecimen('target', fixtureGenomeV2(1));
    const state = baseState({ specimens: [...baseState().specimens, target] });
    const store = storeWith(state);
    const result = store.recycleSpecimenV2('target');
    expect(result.ok).toBe(true);
    const specimens = store.getState().specimens;
    expect(specimens.find((s) => s.id === 'target')).toBeUndefined();
    expect(specimens.find((s) => s.id === 'seed-parent')).toBeDefined();
    expect(specimens.find((s) => s.id === 'pollen-parent')).toBeDefined();
  });

  it('specimen_not_found — полный no-op', () => {
    const state = baseState();
    const store = storeWith(state);
    const result = store.recycleSpecimenV2('nope');
    expect(result).toEqual({ ok: false, reason: 'specimen_not_found' });
    expect(store.getState()).toEqual(state);
  });

  it('missing_genome_v2 — полный no-op (legacy specimen без sidecar)', () => {
    const legacySpecimen: Specimen = { id: 'legacy-1', genome: projectGenomeV2ToLegacy(fixtureGenomeV2(1)), createdAt: 0 };
    const state = baseState({ specimens: [...baseState().specimens, legacySpecimen] });
    const store = storeWith(state);
    const result = store.recycleSpecimenV2('legacy-1');
    expect(result).toEqual({ ok: false, reason: 'missing_genome_v2' });
    expect(store.getState()).toEqual(state);
  });

  it('favorite — полный no-op', () => {
    const favSpecimen = fixtureSpecimen('fav', fixtureGenomeV2(1), { favorite: true });
    const state = baseState({ specimens: [...baseState().specimens, favSpecimen] });
    const store = storeWith(state);
    const result = store.recycleSpecimenV2('fav');
    expect(result).toEqual({ ok: false, reason: 'favorite' });
    expect(store.getState()).toEqual(state);
  });

  it('specimen вне грядки — plots не меняются вообще', () => {
    const target = fixtureSpecimen('target', fixtureGenomeV2(1));
    const state = baseState({ specimens: [...baseState().specimens, target] });
    const store = storeWith(state);
    const before = store.getState().plots;
    store.recycleSpecimenV2('target');
    expect(store.getState().plots).toEqual(before);
  });

  it('mature specimen на одной грядке — специмен удаляется, грядка освобождается (hybridV2 -> null)', () => {
    const target = fixtureSpecimen('target', fixtureGenomeV2(1));
    const plots = fixturePlots().map((p) =>
      p.id === 2 ? { ...p, hybridV2: { phase: 'mature' as const, specimenId: 'target', lastHarvestAt: 0 } } : p
    );
    const state = baseState({ specimens: [...baseState().specimens, target], plots });
    const store = storeWith(state);
    const result = store.recycleSpecimenV2('target');
    expect(result.ok).toBe(true);
    const plot = store.getState().plots.find((p) => p.id === 2);
    expect(plot?.hybridV2).toBeNull();
    expect(store.getState().specimens.find((s) => s.id === 'target')).toBeUndefined();
  });

  it('growing (посаженный, не выращенный) гибрид — не Specimen, недоступен этой операции', () => {
    const seed = fixtureSeed('hybrid-1', fixtureGenomeV2(1));
    const plots = fixturePlots().map((p) =>
      p.id === 0 ? { ...p, hybridV2: { phase: 'growing' as const, hybrid: { ...seed, plantedAt: 0, plotId: 0 } } } : p
    );
    const store = storeWith(baseState({ plots }));
    // hybrid-1 никогда не был Specimen — id не встречается в state.specimens вообще.
    const result = store.recycleSpecimenV2('hybrid-1');
    expect(result).toEqual({ ok: false, reason: 'specimen_not_found' });
  });

  it('несколько mature-грядок ссылаются на один specimenId (повреждённый save) — ambiguous_plot_reference, полный no-op', () => {
    const target = fixtureSpecimen('target', fixtureGenomeV2(1));
    const plots = fixturePlots().map((p) => {
      if (p.id === 2 || p.id === 3) {
        return { ...p, hybridV2: { phase: 'mature' as const, specimenId: 'target', lastHarvestAt: 0 } };
      }
      return p;
    });
    const state = baseState({ specimens: [...baseState().specimens, target], plots });
    const store = storeWith(state);
    const result = store.recycleSpecimenV2('target');
    expect(result).toEqual({ ok: false, reason: 'ambiguous_plot_reference' });
    expect(store.getState()).toEqual(state); // ничего не удалено — ни ноль, ни оба растения
  });

  it('повторный recycle того же specimen — no-op, не выдаёт пыль второй раз', () => {
    const target = fixtureSpecimen('target', fixtureGenomeV2(1));
    const state = baseState({ specimens: [...baseState().specimens, target] });
    const store = storeWith(state);
    store.recycleSpecimenV2('target');
    const dustAfterFirst = store.getState().geneticDust;
    const result2 = store.recycleSpecimenV2('target');
    expect(result2).toEqual({ ok: false, reason: 'specimen_not_found' });
    expect(store.getState().geneticDust).toBe(dustAfterFirst);
  });

  it('первая переработка (base<3, Common=1) дополняется до ровно 3', () => {
    const target = fixtureSpecimen('target', fixtureGenomeV2(1));
    const state = baseState({ specimens: [...baseState().specimens, target], firstRecycleTopUpClaimed: false });
    const store = storeWith(state);
    const result = store.recycleSpecimenV2('target');
    expect(result).toEqual({ ok: true, baseDust: 1, topUpDust: 2, dustGained: 3 });
    expect(store.getState().firstRecycleTopUpClaimed).toBe(true);
  });

  it('первая переработка с base>=3 (Rare=5) не получает компенсацию', () => {
    const target = fixtureSpecimen('target', RARE_GENOME);
    const state = baseState({ specimens: [...baseState().specimens, target], firstRecycleTopUpClaimed: false });
    const store = storeWith(state);
    const result = store.recycleSpecimenV2('target');
    expect(result).toEqual({ ok: true, baseDust: 5, topUpDust: 0, dustGained: 5 });
    expect(store.getState().firstRecycleTopUpClaimed).toBe(true);
  });

  it('parentIds других specimens не переписываются переработкой родителя', () => {
    const child = fixtureSpecimen('child', fixtureGenomeV2(1), { parentIds: ['seed-parent', 'pollen-parent'] });
    const state = baseState({ specimens: [...baseState().specimens, child] });
    const store = storeWith(state);
    store.recycleSpecimenV2('seed-parent');
    const childAfter = store.getState().specimens.find((s) => s.id === 'child');
    expect(childAfter?.parentIds).toEqual(['seed-parent', 'pollen-parent']);
    // "seed-parent" удалён из коллекции, но ссылка на его ID у ребёнка не переписана и не удалена.
    expect(store.getState().specimens.find((s) => s.id === 'seed-parent')).toBeUndefined();
  });

  it('pollen/coins/pityCounter/nurseryTray/labLevel не меняются', () => {
    const target = fixtureSpecimen('target', fixtureGenomeV2(1));
    const seed = fixtureSeed('seed-A', fixtureGenomeV2(1));
    const state = baseState({
      specimens: [...baseState().specimens, target],
      nurseryTray: [seed],
      pollen: 42,
      coins: 100,
      pityCounter: 3,
      labLevel: 1,
    });
    const store = storeWith(state);
    const before = store.getState();
    store.recycleSpecimenV2('target');
    const after = store.getState();
    expect(after.pollen).toBe(before.pollen);
    expect(after.coins).toBe(before.coins);
    expect(after.pityCounter).toBe(before.pityCounter);
    expect(after.nurseryTray).toEqual(before.nurseryTray);
    expect(after.labLevel).toBe(before.labLevel);
  });
});

describe('firstRecycleTopUpClaimed — единый флаг для обеих целей', () => {
  it('первая переработка НАСТОЯЩЕГО specimen выставляет флаг, следующая переработка семени компенсации уже не получает', () => {
    const target = fixtureSpecimen('target', fixtureGenomeV2(1)); // Common -> 1, top-up до 3
    const seed = fixtureSeed('seed-A', fixtureGenomeV2(1)); // Common -> nursery=1
    const state = baseState({
      specimens: [...baseState().specimens, target],
      nurseryTray: [seed],
      firstRecycleTopUpClaimed: false,
    });
    const store = storeWith(state);
    const specimenResult = store.recycleSpecimenV2('target');
    expect(specimenResult).toEqual({ ok: true, baseDust: 1, topUpDust: 2, dustGained: 3 });
    expect(store.getState().firstRecycleTopUpClaimed).toBe(true);

    const seedResult = store.recycleNurserySeedV2('seed-A');
    expect(seedResult).toEqual({ ok: true, baseDust: 1, topUpDust: 0, dustGained: 1 });
  });
});

describe('save/reload сохраняет geneticDust/firstRecycleTopUpClaimed и удаление цели/очищенную грядку', () => {
  function roundTrip(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state)) as GameState;
  }

  it('recycleNurserySeedV2: dust/флаг/удаление семени переживают JSON round-trip', () => {
    const seed = fixtureSeed('seed-A', fixtureGenomeV2(1));
    const store1 = storeWith(baseState({ nurseryTray: [seed], firstRecycleTopUpClaimed: false }));
    store1.recycleNurserySeedV2('seed-A');
    const afterRecycle = store1.getState();
    expect(afterRecycle.geneticDust).toBe(3);
    expect(afterRecycle.nurseryTray).toHaveLength(0);

    const reloaded = roundTrip(afterRecycle);
    const store2 = storeWith(reloaded);
    expect(store2.getState().geneticDust).toBe(3);
    expect(store2.getState().firstRecycleTopUpClaimed).toBe(true);
    expect(store2.getState().nurseryTray).toHaveLength(0);
  });

  it('recycleSpecimenV2 (mature на грядке): удаление specimen и очищенная грядка переживают round-trip', () => {
    const target = fixtureSpecimen('target', fixtureGenomeV2(1));
    const plots = fixturePlots().map((p) =>
      p.id === 2 ? { ...p, hybridV2: { phase: 'mature' as const, specimenId: 'target', lastHarvestAt: 0 } } : p
    );
    const store1 = storeWith(baseState({ specimens: [...baseState().specimens, target], plots }));
    store1.recycleSpecimenV2('target');
    const afterRecycle = store1.getState();

    const reloaded = roundTrip(afterRecycle);
    const store2 = storeWith(reloaded);
    expect(store2.getState().specimens.find((s) => s.id === 'target')).toBeUndefined();
    expect(store2.getState().plots.find((p) => p.id === 2)?.hybridV2).toBeNull();
  });

  it('переключение V2 -> Legacy -> V2 не возвращает переработанные данные и не сбрасывает флаг', () => {
    const target = fixtureSpecimen('target', fixtureGenomeV2(1));
    const store1 = storeWith(baseState({ specimens: [...baseState().specimens, target], firstRecycleTopUpClaimed: false }));
    store1.recycleSpecimenV2('target');
    const stateAfterRecycle = store1.getState();
    expect(stateAfterRecycle.geneticDust).toBe(3);

    localStorage.setItem('genesis-garden-save-v1', JSON.stringify({ ...stateAfterRecycle, version: 4 }));
    const storeAsLegacy = new GameStore({ rng: mulberry32(1) });
    expect(storeAsLegacy.getState().specimens.find((s) => s.id === 'target')).toBeUndefined();
    expect(storeAsLegacy.getState().geneticDust).toBe(3);
    expect(storeAsLegacy.getState().firstRecycleTopUpClaimed).toBe(true);

    const storeAsV2Again = new GameStore({ rng: mulberry32(1) });
    expect(storeAsV2Again.getState().specimens.find((s) => s.id === 'target')).toBeUndefined();
    expect(storeAsV2Again.getState().geneticDust).toBe(3);
    expect(storeAsV2Again.getState().firstRecycleTopUpClaimed).toBe(true);

    localStorage.clear();
  });
});
