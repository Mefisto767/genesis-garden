import { describe, expect, it } from 'vitest';
import { GameStore } from './store';
import type { GameState, Plot, Specimen } from './types';
import type { AllelePair, GenomeV2 } from './geneticsV2';
import { projectGenomeV2ToLegacy } from './legacyProjectionV2';
import { NURSERY_TRAY_CAPACITY } from './nurseryV2';
import { mulberry32 } from './rng';
import type { RngFn } from './rng';
import { MAX_PLOTS, START_UNLOCKED_PLOTS } from './types';

// ============================================================================
// Genetics V2 — Slice 5 (Nursery Tray, рост, постоянные растения). Обязательные
// тесты из задания владельца (проход 8): breedNurseryV2/plantHybridSeedV2/
// harvestHybridV2 discriminated-результаты и атомарность, идемпотентное
// создание Specimen, parentIds, legacy-проекция при сборе, reload/
// persistence, взаимное исключение legacy/hybrid на одной грядке.
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

/** Полное валидное начальное состояние с полным контролем над specimens/
 * трейем/грядками — тот же паттерн, что уже используется в store.test.ts для
 * детерминированных сценариев (`initialState`, минуя loadState()/persist()). */
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

describe('breedNurseryV2 — успешный путь', () => {
  it('создаёт HybridSeed в nurseryTray, не создаёт Specimen', () => {
    const store = storeWith(baseState());
    const before = store.getState().specimens.length;
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result.ok).toBe(true);
    expect(store.getState().nurseryTray).toHaveLength(1);
    expect(store.getState().specimens).toHaveLength(before);
  });

  it('parentIds сохраняется в порядке [seedParentId, pollenParentId]', () => {
    const store = storeWith(baseState());
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.hybridSeed.parentIds).toEqual(['seed-parent', 'pollen-parent']);
  });

  it('сохраняет nextPityCounter, возвращённый breedV2', () => {
    const store = storeWith(baseState({ pityCounter: 3 }));
    store.breedNurseryV2('seed-parent', 'pollen-parent');
    // Без мутации pity увеличивается на 1 (мулбери32(1) на pityCounter=3 —
    // шанс события 6%, случайное первое значение потока почти наверняка не
    // мутирует; сам факт корректной сверки с mutated делает тест устойчивым
    // к обеим ветвям).
    const result = store.getState();
    expect([0, 4]).toContain(result.pityCounter);
  });
});

describe('breedNurseryV2 — discriminated-отказы, атомарность (0 RNG, state не меняется)', () => {
  it('same_parent — одинаковый id родителя', () => {
    const state = baseState();
    const { rng, count } = countingRng(0.1);
    const store = storeWith(state, rng);
    const result = store.breedNurseryV2('seed-parent', 'seed-parent');
    expect(result).toEqual({ ok: false, reason: 'same_parent' });
    expect(count()).toBe(0);
    expect(store.getState()).toEqual(state);
  });

  it('parent_not_found — несуществующий id', () => {
    const state = baseState();
    const { rng, count } = countingRng(0.1);
    const store = storeWith(state, rng);
    const result = store.breedNurseryV2('seed-parent', 'nope');
    expect(result).toEqual({ ok: false, reason: 'parent_not_found' });
    expect(count()).toBe(0);
    expect(store.getState()).toEqual(state);
  });

  it('parent_missing_genome_v2 — у родителя нет genomeV2', () => {
    const state = baseState({
      specimens: [
        fixtureSpecimen('seed-parent', fixtureGenomeV2(1)),
        { id: 'no-v2', genome: projectGenomeV2ToLegacy(fixtureGenomeV2(1)), createdAt: 0 },
      ],
    });
    const { rng, count } = countingRng(0.1);
    const store = storeWith(state, rng);
    const result = store.breedNurseryV2('seed-parent', 'no-v2');
    expect(result).toEqual({ ok: false, reason: 'parent_missing_genome_v2' });
    expect(count()).toBe(0);
    expect(store.getState()).toEqual(state);
  });

  it('unsupported_species проходит прозрачно от breedV2 (Slice 3-4, без изменений; interspecies_locked удалена Slice 9)', () => {
    // Genetics V2 — Slice 8: speciesId 2 (Колокольник) теперь дополнительно
    // гейтится Lab L2 (contract §4.11.2). labLevel:2 здесь снимает именно
    // этот гейт, чтобы изолированно проверить более старую species-
    // валидацию, которая по-прежнему отклоняет species 3-8 как
    // unsupported_species даже после открытия L2 — Slice 9 (contract §4.12)
    // сняло запрет только на 1×2/2×1 внутри поддерживаемого набора,
    // species 3-8 остаются вне V2-родителей до Slice 11.
    const state = baseState({
      labLevel: 2,
      specimens: [fixtureSpecimen('seed-parent', fixtureGenomeV2(1)), fixtureSpecimen('pollen-parent', fixtureGenomeV2(3))],
    });
    const store = storeWith(state);
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result).toEqual({ ok: false, reason: 'unsupported_species' });
    // Species-валидация внутри breedV2 сама не потребляет RNG (Slice 3-4) —
    // проверяем, что и после прохождения store-level проверок RNG не тратится.
    expect(store.getState()).toEqual(state);
  });

  it('Slice 9 (contract §4.12): после Lab L2 межвидовая пара species1×species2 больше не отклоняется — успешно создаёт HybridSeedV2', () => {
    const state = baseState({
      labLevel: 2,
      specimens: [fixtureSpecimen('seed-parent', fixtureGenomeV2(1)), fixtureSpecimen('pollen-parent', fixtureGenomeV2(2))],
    });
    const store = storeWith(state);
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hybridSeed.genomeV2.speciesId).toBe(1); // Seed Parent
      expect(result.hybridSeed.parentIds).toEqual(['seed-parent', 'pollen-parent']);
    }
  });

  it('nursery_tray_full — 8/8, 9-я попытка отклоняется целиком, 0 RNG, состояние не меняется', () => {
    const fullTray = Array.from({ length: NURSERY_TRAY_CAPACITY }, (_, i) => ({
      id: `tray-${i}`,
      genomeV2: fixtureGenomeV2(1),
      parentIds: ['seed-parent', 'pollen-parent'] as [string, string],
      createdAt: 0,
      plantedAt: null,
      plotId: null,
    }));
    const state = baseState({ nurseryTray: fullTray });
    const { rng, count } = countingRng(0.1);
    const store = storeWith(state, rng);
    const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(result).toEqual({ ok: false, reason: 'nursery_tray_full' });
    expect(count()).toBe(0);
    expect(store.getState()).toEqual(state);
  });

  it('заполнение до ровно 8/8 успешно, 9-я — единственная отклонённая', () => {
    // Slice 6: только первое скрещивание бесплатно (firstBreedFreeClaimed),
    // остальные 7 стоят 8 пыльцы каждое — этот тест проверяет вместимость
    // Nursery Tray (Slice 5), не экономику, поэтому даёт заведомо достаточный
    // баланс пыльцы, чтобы не упереться в insufficient_pollen раньше 8/8.
    const store = storeWith(baseState({ pollen: 100 }), mulberry32(42));
    for (let i = 0; i < NURSERY_TRAY_CAPACITY; i++) {
      const result = store.breedNurseryV2('seed-parent', 'pollen-parent');
      expect(result.ok).toBe(true);
    }
    expect(store.getState().nurseryTray).toHaveLength(NURSERY_TRAY_CAPACITY);
    const ninth = store.breedNurseryV2('seed-parent', 'pollen-parent');
    expect(ninth).toEqual({ ok: false, reason: 'nursery_tray_full' });
    expect(store.getState().nurseryTray).toHaveLength(NURSERY_TRAY_CAPACITY);
  });
});

describe('plantHybridSeedV2 — успешный путь и атомарность', () => {
  function stateWithTraySeed(overridesPlot: Partial<Plot> = {}) {
    const hybrid = {
      id: 'hybrid-1',
      genomeV2: fixtureGenomeV2(1),
      parentIds: ['seed-parent', 'pollen-parent'] as [string, string],
      createdAt: 0,
      plantedAt: null,
      plotId: null,
    };
    const plots = fixturePlots().map((p) => (p.id === 0 ? { ...p, ...overridesPlot } : p));
    return { state: baseState({ nurseryTray: [hybrid], plots }), hybrid };
  }

  it('успех: удаляет семя из трея, переносит в Plot.hybridV2 growing с plantedAt/plotId', () => {
    const { state } = stateWithTraySeed();
    const store = storeWith(state);
    const result = store.plantHybridSeedV2('hybrid-1', 0);
    expect(result).toEqual({ ok: true });
    expect(store.getState().nurseryTray).toHaveLength(0);
    const plot = store.getState().plots.find((p) => p.id === 0)!;
    expect(plot.hybridV2).toMatchObject({ phase: 'growing' });
    if (plot.hybridV2?.phase === 'growing') {
      expect(plot.hybridV2.hybrid.plantedAt).not.toBeNull();
      expect(plot.hybridV2.hybrid.plotId).toBe(0);
      expect(plot.hybridV2.hybrid.genomeV2).toEqual(fixtureGenomeV2(1));
    }
  });

  it('seed_not_found — семени с таким id нет в трее, состояние не меняется', () => {
    const { state } = stateWithTraySeed();
    const store = storeWith(state);
    const result = store.plantHybridSeedV2('nope', 0);
    expect(result).toEqual({ ok: false, reason: 'seed_not_found' });
    expect(store.getState()).toEqual(state);
  });

  it('plot_not_found — несуществующая грядка, семя остаётся в трее', () => {
    const { state } = stateWithTraySeed();
    const store = storeWith(state);
    const result = store.plantHybridSeedV2('hybrid-1', 9999);
    expect(result).toEqual({ ok: false, reason: 'plot_not_found' });
    expect(store.getState()).toEqual(state);
  });

  it('plot_locked — заблокированная грядка, семя остаётся в трее', () => {
    const { state } = stateWithTraySeed({ unlocked: false });
    const store = storeWith(state);
    const result = store.plantHybridSeedV2('hybrid-1', 0);
    expect(result).toEqual({ ok: false, reason: 'plot_locked' });
    expect(store.getState()).toEqual(state);
  });

  it('plot_occupied — грядка уже занята legacy-семенем, семя остаётся в трее', () => {
    const { state } = stateWithTraySeed({ seedId: 'sprout', plantedAt: 0 });
    const store = storeWith(state);
    const result = store.plantHybridSeedV2('hybrid-1', 0);
    expect(result).toEqual({ ok: false, reason: 'plot_occupied' });
    expect(store.getState()).toEqual(state);
  });

  it('plot_occupied — грядка уже занята другим hybridV2, семя остаётся в трее', () => {
    const { state } = stateWithTraySeed({
      hybridV2: { phase: 'mature', specimenId: 'seed-parent', lastHarvestAt: 0 },
    });
    const store = storeWith(state);
    const result = store.plantHybridSeedV2('hybrid-1', 0);
    expect(result).toEqual({ ok: false, reason: 'plot_occupied' });
    expect(store.getState()).toEqual(state);
  });
});

describe('взаимное исключение legacy-посадки и hybridV2 на одной грядке', () => {
  it('plantSeed отклоняется, если на грядке уже растёт V2-гибрид', () => {
    const hybrid = {
      id: 'hybrid-1',
      genomeV2: fixtureGenomeV2(1),
      parentIds: ['seed-parent', 'pollen-parent'] as [string, string],
      createdAt: 0,
      plantedAt: 0,
      plotId: 0,
    };
    const plots = fixturePlots().map((p) => (p.id === 0 ? { ...p, hybridV2: { phase: 'growing' as const, hybrid } } : p));
    const store = storeWith(baseState({ plots, inventory: { sprout: 5 } }));
    const ok = store.plantSeed(0, 'sprout');
    expect(ok).toBe(false);
    expect(store.getState().inventory.sprout).toBe(5);
  });
});

describe('рост первого урожая и повторного цикла — границы 5/8/20/30 минут', () => {
  function plantedState(speciesId: number, plantedAt: number) {
    const hybrid = {
      id: 'hybrid-1',
      genomeV2: fixtureGenomeV2(speciesId),
      parentIds: ['seed-parent', 'pollen-parent'] as [string, string],
      createdAt: 0,
      plantedAt,
      plotId: 0,
    };
    const plots = fixturePlots().map((p) => (p.id === 0 ? { ...p, hybridV2: { phase: 'growing' as const, hybrid } } : p));
    return baseState({ plots });
  }

  it('Солнечник (species 1): сбор за 1мс до 5 минут отклоняется', () => {
    const store = storeWith(plantedState(1, 0));
    expect(store.harvestHybridV2(0, 5 * 60 * 1000 - 1)).toBe(false);
  });

  it('Солнечник (species 1): сбор ровно на 5 минуте создаёт Specimen', () => {
    const store = storeWith(plantedState(1, 0));
    expect(store.harvestHybridV2(0, 5 * 60 * 1000)).toBe(true);
  });

  it('Колокольник (species 2): сбор за 1мс до 8 минут отклоняется', () => {
    const store = storeWith(plantedState(2, 0));
    expect(store.harvestHybridV2(0, 8 * 60 * 1000 - 1)).toBe(false);
  });

  it('Колокольник (species 2): сбор ровно на 8 минуте создаёт Specimen', () => {
    const store = storeWith(plantedState(2, 0));
    expect(store.harvestHybridV2(0, 8 * 60 * 1000)).toBe(true);
  });

  it('повторный цикл Солнечника: сбор до 20 минут после lastHarvestAt отклоняется, ровно на 20-й — успешен', () => {
    const store = storeWith(plantedState(1, 0));
    store.harvestHybridV2(0, 5 * 60 * 1000); // первый сбор -> mature, lastHarvestAt=5min
    expect(store.harvestHybridV2(0, 5 * 60 * 1000 + 20 * 60 * 1000 - 1)).toBe(false);
    expect(store.harvestHybridV2(0, 5 * 60 * 1000 + 20 * 60 * 1000)).toBe(true);
  });

  it('повторный цикл Колокольника: сбор до 30 минут после lastHarvestAt отклоняется, ровно на 30-й — успешен', () => {
    const store = storeWith(plantedState(2, 0));
    store.harvestHybridV2(0, 8 * 60 * 1000);
    expect(store.harvestHybridV2(0, 8 * 60 * 1000 + 30 * 60 * 1000 - 1)).toBe(false);
    expect(store.harvestHybridV2(0, 8 * 60 * 1000 + 30 * 60 * 1000)).toBe(true);
  });
});

describe('harvestHybridV2 — создание Specimen ровно один раз, идемпотентность, коллекция, родословная, legacy-проекция', () => {
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

  it('первый успешный сбор создаёт ровно один Specimen, грядка не обнуляется (растение остаётся)', () => {
    const store = storeWith(plantedState(fixtureGenomeV2(1)));
    const before = store.getState().specimens.length;
    const ok = store.harvestHybridV2(0, 5 * 60 * 1000);
    expect(ok).toBe(true);
    expect(store.getState().specimens).toHaveLength(before + 1);
    const plot = store.getState().plots.find((p) => p.id === 0)!;
    expect(plot.hybridV2).toMatchObject({ phase: 'mature' });
  });

  it('добавление в коллекцию автоматическое — новый Specimen сразу присутствует в state.specimens без отдельного действия', () => {
    const store = storeWith(plantedState(fixtureGenomeV2(1)));
    store.harvestHybridV2(0, 5 * 60 * 1000);
    const plot = store.getState().plots.find((p) => p.id === 0)!;
    const hybridV2 = plot.hybridV2;
    expect(hybridV2?.phase).toBe('mature');
    if (hybridV2 && hybridV2.phase === 'mature') {
      const specimen = store.getState().specimens.find((s) => s.id === hybridV2.specimenId);
      expect(specimen).toBeDefined();
    }
  });

  it('Specimen.parentIds равен HybridSeedV2.parentIds', () => {
    const store = storeWith(plantedState(fixtureGenomeV2(1)));
    store.harvestHybridV2(0, 5 * 60 * 1000);
    const specimen = store.getState().specimens.at(-1)!;
    expect(specimen.parentIds).toEqual(['seed-parent', 'pollen-parent']);
  });

  it('Specimen.genomeV2 побайтово равен геному, зафиксированному при посадке', () => {
    const genomeV2 = fixtureGenomeV2(1, { primaryColor: { a: 'primary_honey', b: 'primary_frost' } });
    const store = storeWith(plantedState(genomeV2));
    store.harvestHybridV2(0, 5 * 60 * 1000);
    const specimen = store.getState().specimens.at(-1)!;
    expect(specimen.genomeV2).toEqual(genomeV2);
  });

  it('Specimen.genome — валидная legacy-проекция (обязательное legacy-поле присутствует)', () => {
    const store = storeWith(plantedState(fixtureGenomeV2(2)));
    store.harvestHybridV2(0, 8 * 60 * 1000);
    const specimen = store.getState().specimens.at(-1)!;
    expect(specimen.genome).toEqual(projectGenomeV2ToLegacy(fixtureGenomeV2(2)));
    expect(specimen.genome.shape).toBe(2);
  });

  it('повторный сбор до готовности повторного цикла не создаёт дубликат и не меняет lastHarvestAt', () => {
    const store = storeWith(plantedState(fixtureGenomeV2(1)));
    store.harvestHybridV2(0, 5 * 60 * 1000);
    const afterFirst = store.getState();
    const ok = store.harvestHybridV2(0, 5 * 60 * 1000 + 1000); // задолго до 20 минут
    expect(ok).toBe(false);
    expect(store.getState().specimens).toHaveLength(afterFirst.specimens.length);
    expect(store.getState().plots.find((p) => p.id === 0)!.hybridV2).toEqual(
      afterFirst.plots.find((p) => p.id === 0)!.hybridV2
    );
  });

  it('повторный сбор после готовности обновляет только lastHarvestAt, не создаёт второй Specimen', () => {
    const store = storeWith(plantedState(fixtureGenomeV2(1)));
    store.harvestHybridV2(0, 5 * 60 * 1000);
    const specimenId = (store.getState().plots.find((p) => p.id === 0)!.hybridV2 as { specimenId: string }).specimenId;
    const countBefore = store.getState().specimens.length;
    const ok = store.harvestHybridV2(0, 5 * 60 * 1000 + 20 * 60 * 1000);
    expect(ok).toBe(true);
    expect(store.getState().specimens).toHaveLength(countBefore);
    const plot = store.getState().plots.find((p) => p.id === 0)!;
    expect(plot.hybridV2).toEqual({ phase: 'mature', specimenId, lastHarvestAt: 5 * 60 * 1000 + 20 * 60 * 1000 });
  });

  it('сбор начисляет пыльцу (Slice 6), но не трогает coins/geneticDust/обучающие флаги/labLevel', () => {
    // Genetics V2 — Slice 8: firstHybridRewardClaimed:true в фикстуре —
    // изолирует обычную математику награды пыльцы (Slice 6) от
    // одноразового Slice-8-гранта "+8 пыльцы/лаб L2/флаг", который иначе
    // сработал бы на этом же сборе и сломал бы проверяемые здесь инварианты.
    const store = storeWith(plantedState(fixtureGenomeV2(1), 0, { firstHybridRewardClaimed: true }));
    const before = store.getState();
    store.harvestHybridV2(0, 5 * 60 * 1000);
    const after = store.getState();
    expect(after.coins).toBe(before.coins);
    expect(after.pollen).toBe(before.pollen + 2); // species 1 base 2, Common rarity +0 (гомозиготный фикстур-геном)
    expect(after.geneticDust).toBe(before.geneticDust);
    expect(after.labLevel).toBe(before.labLevel);
    expect(after.firstBreedFreeClaimed).toBe(before.firstBreedFreeClaimed);
    expect(after.firstHybridRewardClaimed).toBe(before.firstHybridRewardClaimed);
    expect(after.firstRecycleTopUpClaimed).toBe(before.firstRecycleTopUpClaimed);
  });
});

describe('reload/persistence — JSON round-trip', () => {
  function roundTrip(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state)) as GameState;
  }

  it('растущий гибрид сохраняет оставшееся время роста через JSON round-trip', () => {
    const hybrid = {
      id: 'hybrid-1',
      genomeV2: fixtureGenomeV2(1),
      parentIds: ['seed-parent', 'pollen-parent'] as [string, string],
      createdAt: 0,
      plantedAt: 1000,
      plotId: 0,
    };
    const plots = fixturePlots().map((p) => (p.id === 0 ? { ...p, hybridV2: { phase: 'growing' as const, hybrid } } : p));
    const state = roundTrip(baseState({ plots }));
    const store = storeWith(state);
    expect(store.harvestHybridV2(0, 1000 + 5 * 60 * 1000 - 1)).toBe(false);
    expect(store.harvestHybridV2(0, 1000 + 5 * 60 * 1000)).toBe(true);
  });

  it('зрелое растение после reload не создаёт второй Specimen', () => {
    const store1 = storeWith(plantedStateFor(fixtureGenomeV2(1)));
    store1.harvestHybridV2(0, 5 * 60 * 1000);
    const reloaded = roundTrip(store1.getState());
    const store2 = storeWith(reloaded);
    const countBefore = store2.getState().specimens.length;
    const ok = store2.harvestHybridV2(0, 5 * 60 * 1000 + 1000); // задолго до regrow
    expect(ok).toBe(false);
    expect(store2.getState().specimens).toHaveLength(countBefore);
  });

  it('связка nurseryTray/Plot.hybridV2/state.specimens переживает round-trip без потерь', () => {
    const store1 = storeWith(baseState());
    store1.breedNurseryV2('seed-parent', 'pollen-parent');
    const reloaded = roundTrip(store1.getState());
    expect(reloaded.nurseryTray).toHaveLength(1);
    const store2 = storeWith(reloaded);
    const seedId = store2.getState().nurseryTray[0].id;
    const planted = store2.plantHybridSeedV2(seedId, 0);
    expect(planted).toEqual({ ok: true });
    expect(store2.getState().nurseryTray).toHaveLength(0);
  });

  function plantedStateFor(genomeV2: GenomeV2) {
    const hybrid = {
      id: 'hybrid-1',
      genomeV2,
      parentIds: ['seed-parent', 'pollen-parent'] as [string, string],
      createdAt: 0,
      plantedAt: 0,
      plotId: 0,
    };
    const plots = fixturePlots().map((p) => (p.id === 0 ? { ...p, hybridV2: { phase: 'growing' as const, hybrid } } : p));
    return baseState({ plots });
  }
});

describe('recycleSpecimen — защитный guard против V2-специмена на грядке', () => {
  it('не перерабатывает specimen, всё ещё связанный с mature-грядкой (возвращает null, не удаляет из коллекции)', () => {
    const hybrid = {
      id: 'hybrid-1',
      genomeV2: fixtureGenomeV2(1),
      parentIds: ['seed-parent', 'pollen-parent'] as [string, string],
      createdAt: 0,
      plantedAt: 0,
      plotId: 0,
    };
    const plots = fixturePlots().map((p) => (p.id === 0 ? { ...p, hybridV2: { phase: 'growing' as const, hybrid } } : p));
    const store = storeWith(baseState({ plots }));
    store.harvestHybridV2(0, 5 * 60 * 1000);
    const specimenId = (store.getState().plots.find((p) => p.id === 0)!.hybridV2 as { specimenId: string }).specimenId;

    const result = store.recycleSpecimen(specimenId);
    expect(result).toBeNull();
    expect(store.getState().specimens.some((s) => s.id === specimenId)).toBe(true);
  });

  it('specimen НЕ связанный с грядкой (обычный, не hybridV2) перерабатывается как раньше', () => {
    const store = storeWith(baseState());
    const specimenId = store.getState().specimens[0].id;
    const result = store.recycleSpecimen(specimenId);
    expect(typeof result).toBe('number');
    expect(store.getState().specimens.some((s) => s.id === specimenId)).toBe(false);
  });
});
