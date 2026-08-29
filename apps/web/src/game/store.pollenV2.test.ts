import { describe, expect, it } from 'vitest';
import { GameStore } from './store';
import type { GameState, Plot, Specimen } from './types';
import type { AllelePair, GenomeV2 } from './geneticsV2';
import { projectGenomeV2ToLegacy } from './legacyProjectionV2';
import { NURSERY_TRAY_CAPACITY } from './nurseryV2';
import { SAME_SPECIES_BREED_COST } from './pollenV2';
import { mulberry32 } from './rng';
import type { RngFn } from './rng';
import { MAX_PLOTS, START_UNLOCKED_PLOTS } from './types';

// ============================================================================
// Genetics V2 — Slice 6: pollen economy, store-level integration (contract
// §4.9.2/§4.9.3, delta doc §0.8). breedCostV2/pollenRewardV2 pure-function
// coverage — pollenV2.test.ts. This file: breedNurseryV2/harvestHybridV2
// atomicity, insufficient_pollen, firstBreedFreeClaimed lifecycle,
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

function countingRng(value: number): { rng: RngFn; count: () => number } {
  let calls = 0;
  return {
    rng: () => {
      calls += 1;
      return value;
    },
    count: () => calls,
  };
}

function storeWith(state: GameState, rng: RngFn = mulberry32(1)): GameStore {
  return new GameStore({ rng, disablePersistence: true, initialState: state });
}

describe('breedNurseryV2 — бесплатное первое скрещивание', () => {
  it('первое успешное скрещивание при pollen=0 бесплатно (firstBreedFreeClaimed=false)', () => {
    const store = storeWith(baseState({ pollen: 0, firstBreedFreeClaimed: false }));
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result.ok).toBe(true);
    expect(store.getState().pollen).toBe(0);
  });

  it('после успеха firstBreedFreeClaimed становится true', () => {
    const store = storeWith(baseState({ pollen: 0, firstBreedFreeClaimed: false }));
    store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(store.getState().firstBreedFreeClaimed).toBe(true);
  });

  it('второе скрещивание при pollen=7 отклоняется (insufficient_pollen)', () => {
    const store = storeWith(baseState({ pollen: 7, firstBreedFreeClaimed: true }));
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result).toEqual({ ok: false, reason: 'insufficient_pollen', requiredPollen: 8, availablePollen: 7 });
    expect(store.getState().pollen).toBe(7);
  });

  it('второе скрещивание при pollen=8 успешно и оставляет ровно 0', () => {
    const store = storeWith(baseState({ pollen: 8, firstBreedFreeClaimed: true }));
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result.ok).toBe(true);
    expect(store.getState().pollen).toBe(0);
  });

  it('все последующие одновидовые скрещивания стоят SAME_SPECIES_BREED_COST=8, безусловно', () => {
    const store = storeWith(baseState({ pollen: 100, firstBreedFreeClaimed: true }));
    store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(store.getState().pollen).toBe(100 - SAME_SPECIES_BREED_COST);
  });
});

describe('breedNurseryV2 — insufficient_pollen: 0 RNG, полный no-op', () => {
  it('0 вызовов RNG, pollen/pityCounter/firstBreedFreeClaimed/nurseryTray/родители не меняются', () => {
    const state = baseState({ pollen: 3, firstBreedFreeClaimed: true, pityCounter: 2 });
    const { rng, count } = countingRng(0.1);
    const store = storeWith(state, rng);
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result).toEqual({ ok: false, reason: 'insufficient_pollen', requiredPollen: 8, availablePollen: 3 });
    expect(count()).toBe(0);
    expect(store.getState()).toEqual(state);
  });
});

describe('breedNurseryV2 — отказы не расходуют бесплатную попытку', () => {
  const cases: Array<[string, Partial<GameState>, string, string]> = [
    ['same_parent', {}, 'seed-parent', 'seed-parent'],
    ['parent_not_found', {}, 'seed-parent', 'nope'],
  ];

  cases.forEach(([label, overrides, a, b]) => {
    it(`${label} не переключает firstBreedFreeClaimed`, () => {
      const store = storeWith(baseState({ firstBreedFreeClaimed: false, ...overrides }));
      const result = store.breedNurseryV2(a, b);
      expect(result.ok).toBe(false);
      expect(store.getState().firstBreedFreeClaimed).toBe(false);
    });
  });

  it('parent_missing_genome_v2 не переключает firstBreedFreeClaimed', () => {
    const state = baseState({
      firstBreedFreeClaimed: false,
      specimens: [
        fixtureSpecimen('seed-parent', fixtureGenomeV2(1)),
        { id: 'no-v2', genome: projectGenomeV2ToLegacy(fixtureGenomeV2(1)), createdAt: 0 },
      ],
    });
    const store = storeWith(state);
    const result = store.breedNurseryV2('seed-parent', 'no-v2');
    expect(result.ok).toBe(false);
    expect(store.getState().firstBreedFreeClaimed).toBe(false);
  });

  it('nursery_tray_full не переключает firstBreedFreeClaimed', () => {
    const fullTray = Array.from({ length: NURSERY_TRAY_CAPACITY }, (_, i) => ({
      id: `tray-${i}`,
      genomeV2: fixtureGenomeV2(1),
      parentIds: ['seed-parent', 'pollen-parent'] as [string, string],
      createdAt: 0,
      plantedAt: null,
      plotId: null,
    }));
    const store = storeWith(baseState({ firstBreedFreeClaimed: false, nurseryTray: fullTray }));
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result).toEqual({ ok: false, reason: 'nursery_tray_full' });
    expect(store.getState().firstBreedFreeClaimed).toBe(false);
  });

  it('unsupported_species не переключает firstBreedFreeClaimed', () => {
    const state = baseState({
      firstBreedFreeClaimed: false,
      specimens: [fixtureSpecimen('seed-parent', fixtureGenomeV2(3)), fixtureSpecimen('pollen-parent', fixtureGenomeV2(3))],
    });
    const store = storeWith(state);
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result).toEqual({ ok: false, reason: 'unsupported_species' });
    expect(store.getState().firstBreedFreeClaimed).toBe(false);
  });

  it('Slice 9 (contract §4.12): межвидовая пара 1×2 после L2 успешно скрещивается бесплатно и переключает firstBreedFreeClaimed', () => {
    // Genetics V2 — Slice 8: speciesId 2 (Колокольник) дополнительно гейтится
    // Lab L2 (contract §4.11.2) — labLevel:2 снимает этот гейт. Slice 9
    // (contract §4.12) сняло прежнюю species-валидацию (Slice 3-4)
    // `interspecies_locked` для поддерживаемых пар — эта пара теперь успешна.
    const state = baseState({
      firstBreedFreeClaimed: false,
      labLevel: 2,
      specimens: [fixtureSpecimen('seed-parent', fixtureGenomeV2(1)), fixtureSpecimen('pollen-parent', fixtureGenomeV2(2))],
    });
    const store = storeWith(state);
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result.ok).toBe(true);
    expect(store.getState().firstBreedFreeClaimed).toBe(true);
  });

  it('unsupported_species (species 3-8) отклоняется раньше денежной проверки — не маскируется insufficient_pollen даже при pollen=0', () => {
    // Species 3 не гейтится Lab L2 (isSpeciesUnlockedV2 гейтит только
    // speciesId 2) — доходит до species-валидации Slice 3-4/9 (шаг 6),
    // раньше денежной проверки (шаг 7).
    const state = baseState({
      firstBreedFreeClaimed: true, // платный режим — insufficient_pollen был бы правдоподобен, если бы species-проверка не шла раньше
      pollen: 0,
      specimens: [fixtureSpecimen('seed-parent', fixtureGenomeV2(3)), fixtureSpecimen('pollen-parent', fixtureGenomeV2(3))],
    });
    const store = storeWith(state);
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result).toEqual({ ok: false, reason: 'unsupported_species' });
  });

  it('Slice 9 (contract §4.12): платная межвидовая пара с pollen=11 отклоняется insufficient_pollen (requiredPollen:12), 0 RNG, полный no-op', () => {
    // Fix-pass (аудит Slice 9, дефект 3): предыдущая версия этого теста
    // проверяла результат и неизменность состояния, но не подтверждала
    // фактическое число вызовов RNG — countingRng делает это явным, тем же
    // паттерном, что уже используется в describe-блоке
    // "breedNurseryV2 — insufficient_pollen: 0 RNG, полный no-op" выше
    // (строка 133) для одновидовой пары.
    const state = baseState({
      firstBreedFreeClaimed: true,
      pollen: 11,
      labLevel: 2,
      specimens: [fixtureSpecimen('seed-parent', fixtureGenomeV2(1)), fixtureSpecimen('pollen-parent', fixtureGenomeV2(2))],
    });
    const { rng, count } = countingRng(0.1);
    const store = storeWith(state, rng);
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result).toEqual({ ok: false, reason: 'insufficient_pollen', requiredPollen: 12, availablePollen: 11 });
    expect(count()).toBe(0);
    expect(store.getState()).toEqual(state);
  });

  it('Slice 9 (contract §4.12): платная межвидовая пара с pollen=12 успешна и списывает ровно 12', () => {
    const state = baseState({
      firstBreedFreeClaimed: true,
      pollen: 12,
      labLevel: 2,
      specimens: [fixtureSpecimen('seed-parent', fixtureGenomeV2(1)), fixtureSpecimen('pollen-parent', fixtureGenomeV2(2))],
    });
    const store = storeWith(state);
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result.ok).toBe(true);
    expect(store.getState().pollen).toBe(0);
  });

  it('отмена на уровне UI (breedNurseryV2 вообще не вызывается) не меняет флаг', () => {
    const store = storeWith(baseState({ firstBreedFreeClaimed: false }));
    // Симуляция "игрок закрыл экран подтверждения" — store-метод просто не
    // вызывается. Прямое следствие store-level контракта: единственный
    // способ поменять firstBreedFreeClaimed — успешный breedNurseryV2.
    expect(store.getState().firstBreedFreeClaimed).toBe(false);
  });
});

describe('breedNurseryV2 — стоимость списывается атомарно вместе с HybridSeed/pity/флагом', () => {
  it('успех: pollen, nurseryTray, pityCounter и firstBreedFreeClaimed меняются одним обновлением', () => {
    const store = storeWith(baseState({ pollen: 8, firstBreedFreeClaimed: true, pityCounter: 3 }));
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result.ok).toBe(true);
    const after = store.getState();
    expect(after.pollen).toBe(0);
    expect(after.nurseryTray).toHaveLength(1);
    expect(after.firstBreedFreeClaimed).toBe(true);
    expect([0, 4]).toContain(after.pityCounter); // mutated или nextPityCounter=prev+1, зависит от rng — обе ветки валидны
  });

  it('родители не расходуются, coins/geneticDust не меняются', () => {
    const store = storeWith(baseState({ pollen: 8, firstBreedFreeClaimed: true }));
    const before = store.getState();
    store.breedNurseryV2('seed-parent', 'pollen-parent');
    const after = store.getState();
    expect(after.specimens.find((s) => s.id === 'seed-parent')).toBeDefined();
    expect(after.specimens.find((s) => s.id === 'pollen-parent')).toBeDefined();
    expect(after.coins).toBe(before.coins);
    expect(after.geneticDust).toBe(before.geneticDust);
  });
});

describe('harvestHybridV2 — награда пыльцы (Slice 6)', () => {
  function plantedState(genomeV2: GenomeV2, plantedAt = 0, overrides: Partial<GameState> = {}) {
    const hybrid = {
      id: 'hybrid-1',
      genomeV2,
      parentIds: ['seed-parent', 'pollen-parent'] as [string, string],
      createdAt: 0,
      plantedAt,
      plotId: 0,
    };
    const plots = fixturePlots().map((p) => (p.id === 0 ? { ...p, hybridV2: { phase: 'growing' as const, hybrid } } : p));
    return baseState({ plots, ...overrides });
  }

  // Genetics V2 — Slice 8 (contract §4.11.1): все фикстуры ниже явно
  // устанавливают `firstHybridRewardClaimed: true`, чтобы изолированно
  // проверять только математику награды пыльцы (Slice 6) — без наложения
  // одноразового Slice-8-бонуса "+8 пыльцы за первого гибрида". Сам
  // Slice-8-грант проверяется отдельным набором тестов
  // (`store.labV2.test.ts`), не здесь.

  it('первый сбор начисляет правильную пыльцу (species 1, Common) — pollen += 2', () => {
    const store = storeWith(plantedState(fixtureGenomeV2(1), 0, { pollen: 10, firstHybridRewardClaimed: true }));
    store.harvestHybridV2(0, 5 * 60 * 1000);
    expect(store.getState().pollen).toBe(12);
  });

  it('repeat harvest начисляет правильную пыльцу (второй готовый цикл)', () => {
    const store = storeWith(plantedState(fixtureGenomeV2(1), 0, { pollen: 0, firstHybridRewardClaimed: true }));
    store.harvestHybridV2(0, 5 * 60 * 1000); // первый сбор -> +2
    expect(store.getState().pollen).toBe(2);
    store.harvestHybridV2(0, 5 * 60 * 1000 + 20 * 60 * 1000); // повторный цикл -> ещё +2
    expect(store.getState().pollen).toBe(4);
  });

  it('сбор до готовности (ранний вызов) не начисляет пыльцу', () => {
    const store = storeWith(plantedState(fixtureGenomeV2(1), 0, { pollen: 5, firstHybridRewardClaimed: true }));
    const ok = store.harvestHybridV2(0, 5 * 60 * 1000 - 1);
    expect(ok).toBe(false);
    expect(store.getState().pollen).toBe(5);
  });

  it('повторный сбор до готовности повторного цикла не начисляет пыльцу второй раз', () => {
    const store = storeWith(plantedState(fixtureGenomeV2(1), 0, { pollen: 0, firstHybridRewardClaimed: true }));
    store.harvestHybridV2(0, 5 * 60 * 1000);
    expect(store.getState().pollen).toBe(2);
    const ok = store.harvestHybridV2(0, 5 * 60 * 1000 + 1000); // задолго до 20 минут
    expect(ok).toBe(false);
    expect(store.getState().pollen).toBe(2);
  });

  it('разные rarity дают 2/3/4 пыльцы (Common/Rare(Minor)/Legendary(Signature))', () => {
    const commonStore = storeWith(plantedState(fixtureGenomeV2(1), 0, { pollen: 0, firstHybridRewardClaimed: true }));
    commonStore.harvestHybridV2(0, 5 * 60 * 1000);
    expect(commonStore.getState().pollen).toBe(2);

    const rareStore = storeWith(
      plantedState(fixtureGenomeV2(1, { mutationId: 'golden_vein' }), 0, { pollen: 0, firstHybridRewardClaimed: true })
    );
    rareStore.harvestHybridV2(0, 5 * 60 * 1000);
    expect(rareStore.getState().pollen).toBe(3);

    const legendaryStore = storeWith(
      plantedState(fixtureGenomeV2(1, { mutationId: 'phoenix' }), 0, { pollen: 0, firstHybridRewardClaimed: true })
    );
    legendaryStore.harvestHybridV2(0, 5 * 60 * 1000);
    expect(legendaryStore.getState().pollen).toBe(4);
  });

  it('первый сбор остаётся идемпотентным по Specimen — повторный вызов на готовности не начисляет пыльцу дважды за один и тот же mature-переход', () => {
    const store = storeWith(plantedState(fixtureGenomeV2(1), 0, { pollen: 0, firstHybridRewardClaimed: true }));
    const ok1 = store.harvestHybridV2(0, 5 * 60 * 1000);
    expect(ok1).toBe(true);
    expect(store.getState().pollen).toBe(2);
    const specimensBefore = store.getState().specimens.length;
    // Повторный вызов сразу же (грядка уже mature, повторный цикл ещё не готов) — no-op.
    const ok2 = store.harvestHybridV2(0, 5 * 60 * 1000 + 1);
    expect(ok2).toBe(false);
    expect(store.getState().specimens).toHaveLength(specimensBefore);
    expect(store.getState().pollen).toBe(2);
  });

  it('firstHybridRewardClaimed/firstRecycleTopUpClaimed/labLevel/geneticDust не меняются повторным сбором (грант уже выдан ранее)', () => {
    // Genetics V2 — Slice 8: сбор ПОСЛЕ того, как одноразовый грант уже
    // выдан (firstHybridRewardClaimed:true в фикстуре), не должен снова
    // трогать эти поля — обычный Slice 6/7 сбор пыльцы не должен иметь
    // побочных эффектов на обучающие флаги/лаб/пыль.
    const store = storeWith(plantedState(fixtureGenomeV2(1), 0, { pollen: 0, firstHybridRewardClaimed: true }));
    const before = store.getState();
    store.harvestHybridV2(0, 5 * 60 * 1000);
    const after = store.getState();
    expect(after.firstHybridRewardClaimed).toBe(before.firstHybridRewardClaimed);
    expect(after.firstRecycleTopUpClaimed).toBe(before.firstRecycleTopUpClaimed);
    expect(after.labLevel).toBe(before.labLevel);
    expect(after.geneticDust).toBe(before.geneticDust);
  });
});

describe('save/reload сохраняет pollen и firstBreedFreeClaimed', () => {
  function roundTrip(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state)) as GameState;
  }

  it('pollen и firstBreedFreeClaimed переживают JSON round-trip без изменений', () => {
    const store1 = storeWith(baseState({ pollen: 8, firstBreedFreeClaimed: true }));
    store1.breedNurseryV2('seed-parent', 'pollen-parent');
    const afterBreed = store1.getState();
    expect(afterBreed.pollen).toBe(0);

    const reloaded = roundTrip(afterBreed);
    expect(reloaded.pollen).toBe(0);
    expect(reloaded.firstBreedFreeClaimed).toBe(true);

    const store2 = storeWith(reloaded);
    expect(store2.getState().pollen).toBe(0);
    expect(store2.getState().firstBreedFreeClaimed).toBe(true);
  });

  it('переключение V2 -> Legacy -> V2 ничего не сбрасывает (store-level не читает GENETICS_V2_ENABLED — тот же принцип, что store.hybridV2Isolation.test.ts)', () => {
    const store1 = storeWith(baseState({ pollen: 50, firstBreedFreeClaimed: true, pityCounter: 3 }));
    store1.breedNurseryV2('seed-parent', 'pollen-parent'); // тратит 8 -> 42
    const stateAfterBreed = store1.getState();
    expect(stateAfterBreed.pollen).toBe(42);

    // "Выключение V2" на уровне store не существует — GENETICS_V2_ENABLED
    // читается только UI-слоем; эмулируем реальный эффект: обычная загрузка
    // save через localStorage (loadState не трогает pollen/firstBreedFreeClaimed
    // за пределами Slice 1 глобальной миграции, которая здесь уже не
    // применяется, т.к. version уже 4).
    localStorage.setItem('genesis-garden-save-v1', JSON.stringify({ ...stateAfterBreed, version: 4 }));
    const storeAsLegacy = new GameStore({ rng: mulberry32(1) });
    expect(storeAsLegacy.getState().pollen).toBe(42);
    expect(storeAsLegacy.getState().firstBreedFreeClaimed).toBe(true);

    const storeAsV2Again = new GameStore({ rng: mulberry32(1) });
    expect(storeAsV2Again.getState().pollen).toBe(42);
    expect(storeAsV2Again.getState().firstBreedFreeClaimed).toBe(true);

    localStorage.clear();
  });
});
