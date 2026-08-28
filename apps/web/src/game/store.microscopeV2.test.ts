import { describe, expect, it } from 'vitest';
import { GameStore } from './store';
import type { GameState, Plot, Specimen } from './types';
import { MAX_PLOTS, START_UNLOCKED_PLOTS } from './types';
import type { AllelePair, GenomeV2, RevealedLocusEntry } from './geneticsV2';
import { projectGenomeV2ToLegacy } from './legacyProjectionV2';
import { MICROSCOPE_REVEAL_COST } from './microscopeV2';
import { LAB_LEVEL_2 } from './labV2';
import { mulberry32 } from './rng';

// ============================================================================
// Genetics V2 — Slice 8: store-level `revealHiddenLocusV2` (contract
// §4.11.3) — атомарность списания/раскрытия, полный порядок отказов,
// изоляция по specimen/locus, persistence. Чистая логика выбора доступных
// локусов — microscopeV2.test.ts.
// ============================================================================

function homo<T extends string>(value: T): AllelePair<T> {
  return { a: value, b: value };
}

/** Геном с одним гомозиготным (flowerForm) и двумя гетерозиготными
 * (stemForm/leafForm) локусами — достаточно для покрытия всех веток. */
function fixtureGenomeV2(overrides: Partial<GenomeV2> = {}): GenomeV2 {
  return {
    stemForm: { a: 'stem_standard', b: 'stem_climbing' },
    leafForm: { a: 'leaf_standard', b: 'leaf_broad' },
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
    specimens: [],
    geneticDust: 10,
    pityCounter: 0,
    questProgress: {},
    questsClaimed: [],
    entitlements: [],
    pollen: 0,
    labLevel: LAB_LEVEL_2,
    nurseryTray: [],
    firstBreedFreeClaimed: false,
    firstHybridRewardClaimed: true,
    firstRecycleTopUpClaimed: false,
    ...overrides,
  };
}

function storeWith(state: GameState): GameStore {
  return new GameStore({ rng: mulberry32(1), disablePersistence: true, initialState: state });
}

describe('revealHiddenLocusV2 — порядок отказов (contract §4.11.3), каждый — полный no-op', () => {
  it('lab_locked — labLevel < 2', () => {
    const specimen = fixtureSpecimen('s1', fixtureGenomeV2());
    const state = baseState({ labLevel: 1, specimens: [specimen], geneticDust: 10 });
    const store = storeWith(state);
    const result = store.revealHiddenLocusV2('s1', 'stemForm');
    expect(result).toEqual({ ok: false, reason: 'lab_locked' });
    expect(store.getState()).toEqual(state);
  });

  it('specimen_not_found', () => {
    const state = baseState({ specimens: [] });
    const store = storeWith(state);
    const result = store.revealHiddenLocusV2('ghost', 'stemForm');
    expect(result).toEqual({ ok: false, reason: 'specimen_not_found' });
    expect(store.getState()).toEqual(state);
  });

  it('missing_genome_v2 — legacy specimen без sidecar', () => {
    const legacy: Specimen = { id: 'legacy-1', genome: projectGenomeV2ToLegacy(fixtureGenomeV2()), createdAt: 0 };
    const state = baseState({ specimens: [legacy] });
    const store = storeWith(state);
    const result = store.revealHiddenLocusV2('legacy-1', 'stemForm');
    expect(result).toEqual({ ok: false, reason: 'missing_genome_v2' });
    expect(store.getState()).toEqual(state);
  });

  it('locus_not_available — гомозиготный локус', () => {
    const specimen = fixtureSpecimen('s1', fixtureGenomeV2());
    const state = baseState({ specimens: [specimen] });
    const store = storeWith(state);
    const result = store.revealHiddenLocusV2('s1', 'flowerForm'); // гомозиготен во фикстуре
    expect(result).toEqual({ ok: false, reason: 'locus_not_available' });
    expect(store.getState()).toEqual(state);
  });

  it('locus_not_available — уже раскрытый локус (не расходует пыль повторно)', () => {
    const specimen = fixtureSpecimen('s1', fixtureGenomeV2(), {
      revealedLoci: [{ locus: 'stemForm', source: 'microscope' }],
    });
    const state = baseState({ specimens: [specimen], geneticDust: 10 });
    const store = storeWith(state);
    const result = store.revealHiddenLocusV2('s1', 'stemForm');
    expect(result).toEqual({ ok: false, reason: 'locus_not_available' });
    expect(store.getState()).toEqual(state);
  });

  it('insufficient_dust — меньше 3 пыли, точные requiredDust/availableDust', () => {
    const specimen = fixtureSpecimen('s1', fixtureGenomeV2());
    const state = baseState({ specimens: [specimen], geneticDust: 2 });
    const store = storeWith(state);
    const result = store.revealHiddenLocusV2('s1', 'stemForm');
    expect(result).toEqual({ ok: false, reason: 'insufficient_dust', requiredDust: 3, availableDust: 2 });
    expect(store.getState()).toEqual(state);
  });
});

describe('revealHiddenLocusV2 — успех: атомарное списание и раскрытие', () => {
  it('списывает ровно 3 geneticDust и добавляет { locus, source: "microscope" }', () => {
    const specimen = fixtureSpecimen('s1', fixtureGenomeV2());
    const store = storeWith(baseState({ specimens: [specimen], geneticDust: 10 }));
    const result = store.revealHiddenLocusV2('s1', 'stemForm');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.locus).toBe('stemForm');
    expect(result.dustSpent).toBe(MICROSCOPE_REVEAL_COST);
    expect(result.revealedAllele).toBe('stem_climbing'); // stem_standard — доминантный/выраженный во фикстуре

    const after = store.getState();
    expect(after.geneticDust).toBe(7);
    const updated = after.specimens.find((s) => s.id === 's1')!;
    expect(updated.revealedLoci).toEqual([{ locus: 'stemForm', source: 'microscope' }]);
  });

  it('одно атомарное обновление — ровно один emit', () => {
    const specimen = fixtureSpecimen('s1', fixtureGenomeV2());
    const store = storeWith(baseState({ specimens: [specimen], geneticDust: 10 }));
    let emits = 0;
    store.subscribe(() => (emits += 1));
    store.revealHiddenLocusV2('s1', 'stemForm');
    expect(emits).toBe(1);
  });

  it('повторная попытка раскрыть тот же локус — no-op, пыль не списывается дважды', () => {
    const specimen = fixtureSpecimen('s1', fixtureGenomeV2());
    const store = storeWith(baseState({ specimens: [specimen], geneticDust: 10 }));
    store.revealHiddenLocusV2('s1', 'stemForm');
    const afterFirst = store.getState();
    const result = store.revealHiddenLocusV2('s1', 'stemForm');
    expect(result).toEqual({ ok: false, reason: 'locus_not_available' });
    expect(store.getState()).toEqual(afterFirst); // ни пыль, ни revealedLoci не изменились
  });

  it('не перезаписывает существующую запись source:"natural" — попытка раскрыть тот же локус отклоняется', () => {
    const specimen = fixtureSpecimen('s1', fixtureGenomeV2(), {
      revealedLoci: [{ locus: 'stemForm', source: 'natural' }],
    });
    const state = baseState({ specimens: [specimen], geneticDust: 10 });
    const store = storeWith(state);
    const result = store.revealHiddenLocusV2('s1', 'stemForm');
    expect(result).toEqual({ ok: false, reason: 'locus_not_available' });
    expect(store.getState()).toEqual(state); // source:'natural' нетронут, ничего не изменилось
  });

  it('раскрытие второго локуса не трогает уже раскрытый natural-локус того же specimen', () => {
    const natural: RevealedLocusEntry = { locus: 'stemForm', source: 'natural' };
    const specimen = fixtureSpecimen('s1', fixtureGenomeV2(), { revealedLoci: [natural] });
    const store = storeWith(baseState({ specimens: [specimen], geneticDust: 10 }));
    const result = store.revealHiddenLocusV2('s1', 'leafForm');
    expect(result.ok).toBe(true);
    const updated = store.getState().specimens.find((s) => s.id === 's1')!;
    expect(updated.revealedLoci).toEqual([natural, { locus: 'leafForm', source: 'microscope' }]);
  });

  it('раскрывает только выбранный specimen — второй specimen с идентичным геномом не затрагивается', () => {
    const genome = fixtureGenomeV2();
    const s1 = fixtureSpecimen('s1', genome);
    const s2 = fixtureSpecimen('s2', genome);
    const store = storeWith(baseState({ specimens: [s1, s2], geneticDust: 10 }));
    store.revealHiddenLocusV2('s1', 'stemForm');
    const after = store.getState();
    expect(after.specimens.find((s) => s.id === 's1')!.revealedLoci).toEqual([{ locus: 'stemForm', source: 'microscope' }]);
    expect(after.specimens.find((s) => s.id === 's2')!.revealedLoci ?? []).toEqual([]);
  });

  it('не меняет остальные поля Specimen/GameState (pollen/coins/labLevel/флаги/favorite)', () => {
    const specimen = fixtureSpecimen('s1', fixtureGenomeV2(), { favorite: true, createdAt: 12345 });
    const store = storeWith(baseState({ specimens: [specimen], geneticDust: 10, coins: 42, pollen: 7, labLevel: 2 }));
    store.revealHiddenLocusV2('s1', 'stemForm');
    const after = store.getState();
    expect(after.coins).toBe(42);
    expect(after.pollen).toBe(7);
    expect(after.labLevel).toBe(2);
    expect(after.firstHybridRewardClaimed).toBe(true);
    expect(after.firstRecycleTopUpClaimed).toBe(false);
    const updated = after.specimens.find((s) => s.id === 's1')!;
    expect(updated.favorite).toBe(true);
    expect(updated.createdAt).toBe(12345);
    expect(updated.genomeV2).toEqual(fixtureGenomeV2());
  });

  it('JSON/save/reload round-trip сохраняет revealedLoci — раскрытие персистентно навсегда', () => {
    const specimen = fixtureSpecimen('s1', fixtureGenomeV2());
    const store = storeWith(baseState({ specimens: [specimen], geneticDust: 10 }));
    store.revealHiddenLocusV2('s1', 'stemForm');
    const persisted = JSON.parse(JSON.stringify(store.getState())) as GameState;
    expect(persisted.specimens.find((s) => s.id === 's1')!.revealedLoci).toEqual([
      { locus: 'stemForm', source: 'microscope' },
    ]);

    const reloaded = new GameStore({ rng: mulberry32(1), disablePersistence: true, initialState: persisted });
    // Повторная попытка после reload — тот же локус того же specimen всё ещё недоступен.
    const result = reloaded.revealHiddenLocusV2('s1', 'stemForm');
    expect(result).toEqual({ ok: false, reason: 'locus_not_available' });
    expect(reloaded.getState().geneticDust).toBe(7); // не списано повторно
  });
});
