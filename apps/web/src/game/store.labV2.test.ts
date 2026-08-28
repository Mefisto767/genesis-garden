import { describe, expect, it } from 'vitest';
import { GameStore } from './store';
import type { GameState, Plot, Specimen } from './types';
import { MAX_PLOTS, START_UNLOCKED_PLOTS } from './types';
import type { AllelePair, GenomeV2 } from './geneticsV2';
import { projectGenomeV2ToLegacy } from './legacyProjectionV2';
import { pollenRewardV2 } from './pollenV2';
import { FIRST_HYBRID_POLLEN_GRANT, GATED_SPECIES_ID_V2, LAB_LEVEL_2 } from './labV2';
import { mulberry32 } from './rng';
import type { RngFn } from './rng';

// ============================================================================
// Genetics V2 — Slice 8: store-level интеграция обучающего гранта
// (harvestHybridV2, contract §4.11.1) и гейта Колокольника (buySeedV2/
// plantSeedV2/breedNurseryV2, contract §4.11.2). Чистая логика гейта/констант
// — labV2.test.ts. Микроскоп — store.microscopeV2.test.ts.
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

function storeWith(state: GameState, rng: RngFn = mulberry32(1)): GameStore {
  return new GameStore({ rng, disablePersistence: true, initialState: state });
}

/** Растущий на грядке 0 V2-гибрид, готовый к сбору к отметке 5 минут (тот же
 * тайминг, что store.pollenV2.test.ts/store.nurseryV2.test.ts). */
function plantedState(genomeV2: GenomeV2, overrides: Partial<GameState> = {}): GameState {
  const hybrid = {
    id: 'hybrid-1',
    genomeV2,
    parentIds: ['seed-parent', 'pollen-parent'] as [string, string],
    createdAt: 0,
    plantedAt: 0,
    plotId: 0,
  };
  const plots = fixturePlots().map((p) => (p.id === 0 ? { ...p, hybridV2: { phase: 'growing' as const, hybrid } } : p));
  return baseState({ plots, ...overrides });
}

const READY_AT = 5 * 60 * 1000;
const REGROW_READY_AT = READY_AT + 20 * 60 * 1000;

describe('harvestHybridV2 — обучающий грант «первый гибрид» (Slice 8, contract §4.11.1)', () => {
  it('грант равен обычной награде плюс ровно 8, поверх, не вместо неё', () => {
    const genome = fixtureGenomeV2(1);
    const store = storeWith(plantedState(genome, { pollen: 0, firstHybridRewardClaimed: false }));
    store.harvestHybridV2(0, READY_AT);
    expect(store.getState().pollen).toBe(pollenRewardV2(genome) + FIRST_HYBRID_POLLEN_GRANT);
  });

  it('флаг, Lab L2 и грант выставляются одним атомарным обновлением (один emit, все поля согласованы уже в нём)', () => {
    const genome = fixtureGenomeV2(1);
    const store = storeWith(plantedState(genome, { pollen: 0, labLevel: 1, firstHybridRewardClaimed: false }));
    let seenSnapshots: GameState[] = [];
    store.subscribe(() => seenSnapshots.push(store.getState()));
    store.harvestHybridV2(0, READY_AT);
    expect(seenSnapshots).toHaveLength(1); // ровно один emit — не отдельные шаги
    const snapshot = seenSnapshots[0];
    expect(snapshot.firstHybridRewardClaimed).toBe(true);
    expect(snapshot.labLevel).toBe(LAB_LEVEL_2);
    expect(snapshot.pollen).toBe(pollenRewardV2(genome) + FIRST_HYBRID_POLLEN_GRANT);
  });

  it('повторный сбор (growing→mature уже состоялся) не выдаёт грант второй раз', () => {
    const genome = fixtureGenomeV2(1);
    const store = storeWith(plantedState(genome, { pollen: 0, firstHybridRewardClaimed: false }));
    store.harvestHybridV2(0, READY_AT); // первый сбор -> базовая награда + 8
    const afterFirst = store.getState().pollen;
    store.harvestHybridV2(0, REGROW_READY_AT); // повторный готовый цикл
    expect(store.getState().pollen).toBe(afterFirst + pollenRewardV2(genome)); // без второго +8
    expect(store.getState().firstHybridRewardClaimed).toBe(true);
  });

  it('reload (JSON round-trip) не выдаёт грант повторно на следующем сборе', () => {
    const genome = fixtureGenomeV2(1);
    const store = storeWith(plantedState(genome, { pollen: 0, firstHybridRewardClaimed: false }));
    store.harvestHybridV2(0, READY_AT);
    const persisted = JSON.parse(JSON.stringify(store.getState())) as GameState;
    expect(persisted.firstHybridRewardClaimed).toBe(true);

    const reloaded = storeWith(persisted);
    reloaded.harvestHybridV2(0, REGROW_READY_AT);
    expect(reloaded.getState().pollen).toBe(persisted.pollen + pollenRewardV2(genome)); // только обычная награда
  });

  it('ранний сбор (растение ещё не готово) — no-op, грант не выдаётся', () => {
    const genome = fixtureGenomeV2(1);
    const state = plantedState(genome, { pollen: 0, firstHybridRewardClaimed: false });
    const store = storeWith(state);
    const ok = store.harvestHybridV2(0, READY_AT - 1);
    expect(ok).toBe(false);
    expect(store.getState()).toEqual(state);
  });

  it('повреждённые данные (mature-грядка ссылается на несуществующий specimen) — no-op, грант не выдаётся', () => {
    const plots = fixturePlots().map((p) =>
      p.id === 0 ? { ...p, hybridV2: { phase: 'mature' as const, specimenId: 'ghost', lastHarvestAt: 0 } } : p
    );
    const state = baseState({ plots, firstHybridRewardClaimed: false, pollen: 0 });
    const store = storeWith(state);
    const ok = store.harvestHybridV2(0, REGROW_READY_AT);
    expect(ok).toBe(false);
    expect(store.getState()).toEqual(state);
  });

  it('повреждённые данные (mature-грядка, specimen существует, но без genomeV2) — no-op, грант не выдаётся', () => {
    const legacySpecimen: Specimen = { id: 'legacy-1', genome: projectGenomeV2ToLegacy(fixtureGenomeV2(1)), createdAt: 0 };
    const plots = fixturePlots().map((p) =>
      p.id === 0 ? { ...p, hybridV2: { phase: 'mature' as const, specimenId: 'legacy-1', lastHarvestAt: 0 } } : p
    );
    const state = baseState({ plots, specimens: [legacySpecimen], firstHybridRewardClaimed: false, pollen: 0 });
    const store = storeWith(state);
    const ok = store.harvestHybridV2(0, REGROW_READY_AT);
    expect(ok).toBe(false);
    expect(store.getState()).toEqual(state);
  });

  it('firstHybridRewardClaimed уже true — грант не выдаётся повторно даже на первом growing→mature переходе этого стора', () => {
    const genome = fixtureGenomeV2(1);
    const store = storeWith(plantedState(genome, { pollen: 0, firstHybridRewardClaimed: true, labLevel: 2 }));
    store.harvestHybridV2(0, READY_AT);
    expect(store.getState().pollen).toBe(pollenRewardV2(genome)); // без +8
    expect(store.getState().labLevel).toBe(2);
  });

  it('ветеранский labLevel=3 никогда не понижается миграционным грантом', () => {
    // Симулирует существующий Slice 5-7 save, где зрелый V2-гибрид уже
    // существует, но firstHybridRewardClaimed ещё false (флаг появился
    // только в Slice 8) — при этом игрок уже дошёл до Lab L3 другим путём
    // (не моделируется здесь — просто фиксируем текущее значение поля).
    const specimen = fixtureSpecimen('vet-1', fixtureGenomeV2(1));
    const plots = fixturePlots().map((p) =>
      p.id === 0 ? { ...p, hybridV2: { phase: 'mature' as const, specimenId: 'vet-1', lastHarvestAt: 0 } } : p
    );
    const store = storeWith(
      baseState({ plots, specimens: [specimen], labLevel: 3, firstHybridRewardClaimed: false, pollen: 0 })
    );
    store.harvestHybridV2(0, REGROW_READY_AT);
    expect(store.getState().labLevel).toBe(3); // Math.max(3,2) === 3, не понижается до 2
    expect(store.getState().firstHybridRewardClaimed).toBe(true);
    expect(store.getState().pollen).toBe(pollenRewardV2(fixtureGenomeV2(1)) + FIRST_HYBRID_POLLEN_GRANT);
  });

  it('legacy harvest() (плоский плоско-грядочный сбор, не V2) ничего не открывает', () => {
    const plots = fixturePlots().map((p) => (p.id === 0 ? { ...p, seedId: 'sprout', plantedAt: 0 } : p));
    const store = storeWith(baseState({ plots, firstHybridRewardClaimed: false, labLevel: 1, pollen: 0 }));
    store.harvest(0, 10 * 60 * 1000); // 'sprout' growMs=60_000, точно готов
    expect(store.getState().firstHybridRewardClaimed).toBe(false);
    expect(store.getState().labLevel).toBe(1);
    expect(store.getState().pollen).toBe(0);
  });
});

describe('Колокольник — гейт Lab L2 (Slice 8, contract §4.11.2)', () => {
  it('buySeedV2: покупка Колокольника до L2 отклоняется без изменения coins/inventory', () => {
    const state = baseState({ coins: 100, labLevel: 1, inventory: {} });
    const store = storeWith(state);
    const result = store.buySeedV2('common', 1); // 'common' — seedId с speciesId 2 (Колокольник)
    expect(result).toEqual({ ok: false, reason: 'species_locked' });
    expect(store.getState()).toEqual(state);
  });

  it('buySeedV2: покупка Колокольника после L2 проходит как обычная покупка', () => {
    const store = storeWith(baseState({ coins: 100, labLevel: 2, inventory: {} }));
    const result = store.buySeedV2('common', 1);
    expect(result).toEqual({ ok: true });
    expect(store.getState().inventory.common).toBe(1);
  });

  it('plantSeedV2: посадка уже имеющегося семени Колокольника до L2 отклоняется без изменений', () => {
    const plots = fixturePlots();
    const state = baseState({ plots, labLevel: 1, inventory: { common: 1 } });
    const store = storeWith(state);
    const result = store.plantSeedV2(0, 'common');
    expect(result).toEqual({ ok: false, reason: 'species_locked' });
    expect(store.getState()).toEqual(state);
  });

  it('plantSeedV2: посадка Колокольника после L2 проходит как обычная посадка', () => {
    const store = storeWith(baseState({ labLevel: 2, inventory: { common: 1 } }));
    const result = store.plantSeedV2(0, 'common');
    expect(result).toEqual({ ok: true });
    expect(store.getState().plots.find((p) => p.id === 0)!.seedId).toBe('common');
  });

  it('breedNurseryV2: Колокольник как родитель до L2 отклоняется species_locked без RNG и без изменений', () => {
    const state = baseState({
      labLevel: 1,
      specimens: [
        fixtureSpecimen('seed-parent', fixtureGenomeV2(GATED_SPECIES_ID_V2)),
        fixtureSpecimen('pollen-parent', fixtureGenomeV2(GATED_SPECIES_ID_V2, { stemForm: { a: 'stem_standard', b: 'stem_climbing' } })),
      ],
    });
    let rngCalls = 0;
    const store = storeWith(state, () => {
      rngCalls += 1;
      return 0.5;
    });
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result).toEqual({ ok: false, reason: 'species_locked' });
    expect(rngCalls).toBe(0);
    expect(store.getState()).toEqual(state);
  });

  it('breedNurseryV2: одновидовая пара Колокольник×Колокольник разрешена после L2', () => {
    const state = baseState({
      labLevel: 2,
      firstBreedFreeClaimed: false,
      specimens: [
        fixtureSpecimen('seed-parent', fixtureGenomeV2(GATED_SPECIES_ID_V2)),
        fixtureSpecimen('pollen-parent', fixtureGenomeV2(GATED_SPECIES_ID_V2, { stemForm: { a: 'stem_standard', b: 'stem_climbing' } })),
      ],
    });
    const store = storeWith(state);
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result.ok).toBe(true);
  });

  it('breedNurseryV2: межвидовая пара (Солнечник×Колокольник) после L2 всё ещё interspecies_locked — это Slice 9, не Slice 8', () => {
    const state = baseState({
      labLevel: 2,
      specimens: [
        fixtureSpecimen('seed-parent', fixtureGenomeV2(1)),
        fixtureSpecimen('pollen-parent', fixtureGenomeV2(GATED_SPECIES_ID_V2)),
      ],
    });
    const store = storeWith(state);
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result).toEqual({ ok: false, reason: 'interspecies_locked' });
  });
});
