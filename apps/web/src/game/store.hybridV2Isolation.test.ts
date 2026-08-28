import { beforeEach, describe, expect, it } from 'vitest';
import { GameStore } from './store';
import type { GameState, Plot, PlotHybridV2, Specimen } from './types';
import type { AllelePair, GenomeV2 } from './geneticsV2';
import { projectGenomeV2ToLegacy } from './legacyProjectionV2';
import { MAX_PLOTS, START_UNLOCKED_PLOTS } from './types';
import { mulberry32 } from './rng';

// ============================================================================
// Genetics V2 — fix-pass (audit, bug 1): "Overhaul + Legacy Genetics с уже
// существующим plot.hybridV2" — сценарий, который реально ловит дефект.
//
// `GENETICS_V2_ENABLED` — чисто UI-флаг (game/featureFlags.ts); он нигде не
// читается внутри store.ts. Mutual-exclusion guard в `plantSeed()`/
// `plantHybridSeedV2()` (проверка `plot.hybridV2 != null`) и вся V2-логика
// движка (`hybridPlotStatusV2`/`harvestHybridV2`) работают ОДИНАКОВО
// независимо от значения флага — это и есть та самая гарантия "данные не
// теряются/не перезаписываются при переключении V2 -> Legacy -> V2",
// которую требует задание владельца. Этот файл проверяет её напрямую на
// уровне store/persistence (без Phaser/React) — отдельный e2e
// (test-e2e-genetics-v2-legacy-isolation.mjs) проверяет то же самое на
// уровне реального UI (Overhaul+Legacy build, порт 4174): что клик по такой
// грядке не открывает ни HybridCard, ни PlantPicker.
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

function fixturePlots(plot0Overrides: Partial<Plot> = {}): Plot[] {
  const plots: Plot[] = [];
  for (let i = 0; i < MAX_PLOTS; i++) {
    plots.push({ id: i, unlocked: i < START_UNLOCKED_PLOTS, seedId: null, plantedAt: null });
  }
  plots[0] = { ...plots[0], ...plot0Overrides };
  return plots;
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    coins: 100,
    plots: fixturePlots(),
    inventory: { sprout: 5 },
    specimens: [],
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

beforeEach(() => {
  localStorage.clear();
});

describe('Overhaul + Legacy Genetics: сохранённый растущий plot.hybridV2 (bug 1)', () => {
  function growingState(): GameState {
    const growing: PlotHybridV2 = {
      phase: 'growing',
      hybrid: {
        id: 'hybrid-1',
        genomeV2: fixtureGenomeV2(1),
        parentIds: ['seed-parent', 'pollen-parent'],
        createdAt: 0,
        plantedAt: Date.now(),
        plotId: 0,
      },
    };
    return baseState({ plots: fixturePlots({ hybridV2: growing }) });
  }

  it('обычная посадка (plantSeed) не может перезаписать растущий hybridV2', () => {
    const state = growingState();
    const before = state.plots[0].hybridV2;
    const store = new GameStore({ rng: mulberry32(1), disablePersistence: true, initialState: state });

    const ok = store.plantSeed(0, 'sprout');

    expect(ok).toBe(false);
    expect(store.getState().plots[0].hybridV2).toEqual(before);
    expect(store.getState().plots[0].seedId).toBeNull();
  });

  it('растущий hybridV2 переживает полный JSON save/load round-trip без единого изменения', () => {
    const state = growingState();
    const before = state.plots[0].hybridV2;
    localStorage.setItem('genesis-garden-save-v1', JSON.stringify({ ...state, version: 4 }));

    // "Переключение флага" на уровне store не существует — GENETICS_V2_ENABLED
    // читается только UI-слоем (OverhaulApp/EstateScene), поэтому эмулируем
    // именно то, что реально происходит при выключенном V2: обычная загрузка
    // save через loadState(), которая не трогает plots вообще (см. store.ts
    // loadState — миграции затрагивают только save-уровневые поля и
    // specimens, не plots/hybridV2).
    const storeAsLegacy = new GameStore({ rng: mulberry32(1) });
    expect(storeAsLegacy.getState().plots[0].hybridV2).toEqual(before);

    // Повторная загрузка ("вернули V2 обратно") — то же самое, без потери данных.
    const storeAsV2Again = new GameStore({ rng: mulberry32(1) });
    expect(storeAsV2Again.getState().plots[0].hybridV2).toEqual(before);
  });

  it('после round-trip рост продолжает считаться корректно (hybridPlotStatusV2 не зависит от флага)', () => {
    const growing: PlotHybridV2 = {
      phase: 'growing',
      hybrid: {
        id: 'hybrid-1',
        genomeV2: fixtureGenomeV2(1),
        parentIds: ['seed-parent', 'pollen-parent'],
        createdAt: 0,
        plantedAt: Date.now() - (5 * 60 * 1000 + 5000), // species 1: 5 минут первого роста, уже готово
        plotId: 0,
      },
    };
    const state = baseState({ plots: fixturePlots({ hybridV2: growing }) });
    localStorage.setItem('genesis-garden-save-v1', JSON.stringify({ ...state, version: 4 }));

    const store = new GameStore({ rng: mulberry32(1) });
    const plot = store.getState().plots[0];
    const status = store.hybridPlotStatusV2(plot);
    expect(status?.ready).toBe(true);

    const harvested = store.harvestHybridV2(0);
    expect(harvested).toBe(true);
    expect(store.getState().plots[0].hybridV2?.phase).toBe('mature');
  });
});

describe('Overhaul + Legacy Genetics: сохранённый зрелый (mature) plot.hybridV2 (bug 1)', () => {
  function matureState(): GameState {
    const specimen = fixtureSpecimen('hybrid-specimen-1', fixtureGenomeV2(2));
    const mature: PlotHybridV2 = { phase: 'mature', specimenId: specimen.id, lastHarvestAt: Date.now() };
    return baseState({
      specimens: [specimen],
      plots: fixturePlots({ hybridV2: mature }),
    });
  }

  it('обычная посадка (plantSeed) не может перезаписать mature-грядку', () => {
    const state = matureState();
    const before = state.plots[0].hybridV2;
    const store = new GameStore({ rng: mulberry32(1), disablePersistence: true, initialState: state });

    const ok = store.plantSeed(0, 'sprout');

    expect(ok).toBe(false);
    expect(store.getState().plots[0].hybridV2).toEqual(before);
  });

  it('mature hybridV2 и связанный Specimen переживают JSON round-trip без потерь (specimenId/genomeV2 не теряются)', () => {
    const state = matureState();
    const beforePlotHybrid = state.plots[0].hybridV2;
    const beforeSpecimen = state.specimens.find((s) => s.id === 'hybrid-specimen-1');
    localStorage.setItem('genesis-garden-save-v1', JSON.stringify({ ...state, version: 4 }));

    const store = new GameStore({ rng: mulberry32(1) });
    const afterState = store.getState();

    expect(afterState.plots[0].hybridV2).toEqual(beforePlotHybrid);
    const afterSpecimen = afterState.specimens.find((s) => s.id === 'hybrid-specimen-1');
    expect(afterSpecimen).toBeDefined();
    expect(afterSpecimen?.genomeV2).toEqual(beforeSpecimen?.genomeV2);
    expect(afterSpecimen?.genome).toEqual(beforeSpecimen?.genome);
  });

  it('после round-trip повторный цикл mature-растения продолжает работать (regrow -> harvestHybridV2 не создаёт второй Specimen)', () => {
    const specimen = fixtureSpecimen('hybrid-specimen-1', fixtureGenomeV2(2));
    // species 2: 30 минут повторного цикла — lastHarvestAt в прошлом достаточно давно.
    const mature: PlotHybridV2 = {
      phase: 'mature',
      specimenId: specimen.id,
      lastHarvestAt: Date.now() - (30 * 60 * 1000 + 5000),
    };
    const state = baseState({ specimens: [specimen], plots: fixturePlots({ hybridV2: mature }) });
    localStorage.setItem('genesis-garden-save-v1', JSON.stringify({ ...state, version: 4 }));

    const store = new GameStore({ rng: mulberry32(1) });
    const plot = store.getState().plots[0];
    expect(store.hybridPlotStatusV2(plot)?.ready).toBe(true);

    const ok = store.harvestHybridV2(0);
    expect(ok).toBe(true);
    // Идемпотентный guard (contract §4.8.4): всё ещё РОВНО один specimen с этим id.
    expect(store.getState().specimens.filter((s) => s.id === 'hybrid-specimen-1')).toHaveLength(1);
    expect(store.getState().plots[0].hybridV2).toMatchObject({ phase: 'mature', specimenId: 'hybrid-specimen-1' });
  });
});

describe('Overhaul + Legacy Genetics: обычная посадка на ДРУГИХ грядках не затронута', () => {
  it('plantSeed продолжает нормально работать на грядке без hybridV2, пока соседняя грядка занята V2-данными', () => {
    const specimen = fixtureSpecimen('hybrid-specimen-1', fixtureGenomeV2(1));
    const mature: PlotHybridV2 = { phase: 'mature', specimenId: specimen.id, lastHarvestAt: Date.now() };
    const state = baseState({ specimens: [specimen], plots: fixturePlots({ hybridV2: mature }) });
    const store = new GameStore({ rng: mulberry32(1), disablePersistence: true, initialState: state });

    const ok = store.plantSeed(1, 'sprout');

    expect(ok).toBe(true);
    expect(store.getState().plots[1].seedId).toBe('sprout');
    expect(store.getState().plots[0].hybridV2).toEqual(mature);
  });
});
