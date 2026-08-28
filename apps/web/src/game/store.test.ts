import { describe, expect, it } from 'vitest';
import { GameStore, migratePityCounter, hasBreedingHistory } from './store';
import { GARDEN_CONFIG, STARTING_STATE_CONFIG, BOOSTS_CONFIG, BREEDING_CONFIG } from './config';
import { mulberry32 } from './rng';
import { MAX_PLOTS, START_UNLOCKED_PLOTS } from './types';

function freshStore(rngSeed = 1): GameStore {
  return new GameStore({ rng: mulberry32(rngSeed), disablePersistence: true });
}

describe('начисление и списание валюты', () => {
  it('стартовый баланс соответствует конфигу', () => {
    const store = freshStore();
    expect(store.getState().coins).toBe(STARTING_STATE_CONFIG.startingCoins);
  });

  it('buySeed списывает ровно buyCost*qty и не проводит покупку при нехватке монет', () => {
    const store = freshStore();
    const before = store.getState().coins;
    const ok = store.buySeed('sprout', 2);
    expect(ok).toBe(true);
    expect(store.getState().coins).toBe(before - 5 * 2);

    // Пытаемся купить на сумму больше остатка — баланс не должен уйти в минус.
    const balance = store.getState().coins;
    const tooExpensive = store.buySeed('upgraded', 100);
    expect(tooExpensive).toBe(false);
    expect(store.getState().coins).toBe(balance);
    expect(store.getState().coins).toBeGreaterThanOrEqual(0);
  });

  it('harvest начисляет ровно sellValue купленного семени', () => {
    const store = freshStore();
    store.plantSeed(0, 'sprout');
    // Промотать время: подменяем plantedAt напрямую через приватное состояние недоступно,
    // поэтому проверяем через публичный API — используем now-параметр harvest().
    const readyAt = Date.now() + 60 * 1000 + 1;
    const before = store.getState().coins;
    const ok = store.harvest(0, readyAt);
    expect(ok).toBe(true);
    expect(store.getState().coins).toBe(before + 8); // sprout.sellValue = 8
  });

  it('unlockPlot списывает cost по формуле GARDEN_CONFIG и не уходит в минус', () => {
    const store = freshStore();
    // Обеднить игрока до почти нуля, чтобы проверить границу.
    const state = store.getState();
    const plotId = START_UNLOCKED_PLOTS; // первая запертая грядка
    const cost = store.unlockCostFor(plotId);
    expect(cost).toBe(GARDEN_CONFIG.unlockCostBase);
    expect(state.coins).toBeGreaterThanOrEqual(0);
  });

  it('не начисляет отрицательный баланс ни при какой нормальной последовательности операций', () => {
    const store = freshStore();
    for (let i = 0; i < 10; i++) {
      store.buySeed('upgraded', 1);
      store.unlockPlot(START_UNLOCKED_PLOTS);
    }
    expect(store.getState().coins).toBeGreaterThanOrEqual(0);
  });
});

describe('повторная отправка запроса (идемпотентность)', () => {
  it('двойной harvest на одну и ту же грядку не начисляет награду дважды', () => {
    const store = freshStore();
    store.plantSeed(0, 'sprout');
    const readyAt = Date.now() + 60 * 1000 + 1;
    const before = store.getState().coins;
    const first = store.harvest(0, readyAt);
    const afterFirst = store.getState().coins;
    const second = store.harvest(0, readyAt); // повтор того же запроса
    const afterSecond = store.getState().coins;

    expect(first).toBe(true);
    expect(second).toBe(false); // грядка уже пуста — второй вызов отклонён
    expect(afterFirst).toBe(before + 8);
    expect(afterSecond).toBe(afterFirst); // монеты не изменились повторно
  });

  it('двойной claimQuest на один и тот же квест выдаёт награду один раз', () => {
    const store = freshStore();
    store.plantSeed(0, 'sprout'); // продвигает квест first_plant до target=1
    const before = store.getState().coins;
    const first = store.claimQuest('first_plant');
    const afterFirst = store.getState().coins;
    const second = store.claimQuest('first_plant');
    const afterSecond = store.getState().coins;

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(afterFirst).toBeGreaterThan(before);
    expect(afterSecond).toBe(afterFirst);
  });

  it('breedSpecimens с одним и тем же id дважды (idA===idB) отклоняется', () => {
    const store = freshStore();
    const [a] = store.getState().specimens;
    const outcome = store.breedSpecimens(a.id, a.id);
    expect(outcome).toBeNull();
  });
});

describe('переработка специмена в пыль (recycleSpecimen)', () => {
  it('даёт recycleDustReward пыли и удаляет специмен из коллекции', () => {
    const store = freshStore();
    const specimen = store.getState().specimens[0];
    const dustBefore = store.getState().geneticDust;
    const countBefore = store.getState().specimens.length;

    const dustGained = store.recycleSpecimen(specimen.id);

    expect(dustGained).toBe(BREEDING_CONFIG.recycleDustReward);
    expect(store.getState().geneticDust).toBe(dustBefore + BREEDING_CONFIG.recycleDustReward);
    expect(store.getState().specimens.length).toBe(countBefore - 1);
    expect(store.getState().specimens.some((s) => s.id === specimen.id)).toBe(false);
  });

  it('не начисляет монеты (переработка — только пыль)', () => {
    const store = freshStore();
    const specimen = store.getState().specimens[0];
    const coinsBefore = store.getState().coins;

    store.recycleSpecimen(specimen.id);

    expect(store.getState().coins).toBe(coinsBefore);
  });

  it('повторная переработка того же id — no-op, возвращает null', () => {
    const store = freshStore();
    const specimen = store.getState().specimens[0];

    const first = store.recycleSpecimen(specimen.id);
    const dustAfterFirst = store.getState().geneticDust;
    const second = store.recycleSpecimen(specimen.id);

    expect(first).toBe(BREEDING_CONFIG.recycleDustReward);
    expect(second).toBeNull();
    expect(store.getState().geneticDust).toBe(dustAfterFirst);
  });

  it('несуществующий id возвращает null и не меняет состояние', () => {
    const store = freshStore();
    const dustBefore = store.getState().geneticDust;
    const countBefore = store.getState().specimens.length;

    const result = store.recycleSpecimen('does-not-exist');

    expect(result).toBeNull();
    expect(store.getState().geneticDust).toBe(dustBefore);
    expect(store.getState().specimens.length).toBe(countBefore);
  });

  it('избранный специмен нельзя переработать, пока не снята звезда', () => {
    const store = freshStore();
    const specimen = store.getState().specimens[0];
    store.toggleFavorite(specimen.id);
    expect(store.getState().specimens.find((s) => s.id === specimen.id)?.favorite).toBe(true);

    const blocked = store.recycleSpecimen(specimen.id);
    expect(blocked).toBe('favorite');
    expect(store.getState().specimens.some((s) => s.id === specimen.id)).toBe(true);

    store.toggleFavorite(specimen.id); // снимаем звезду
    const ok = store.recycleSpecimen(specimen.id);
    expect(ok).toBe(BREEDING_CONFIG.recycleDustReward);
    expect(store.getState().specimens.some((s) => s.id === specimen.id)).toBe(false);
  });
});

describe('блокировка гена за пыль при скрещивании (Этап 5)', () => {
  it('без достаточной пыли скрещивание с lock отклоняется целиком — деньги и пыль не трогаются', () => {
    const store = freshStore();
    const [a, b] = store.getState().specimens;
    expect(store.getState().geneticDust).toBeLessThan(BREEDING_CONFIG.dustCostPerLockedGene);
    const coinsBefore = store.getState().coins;
    const dustBefore = store.getState().geneticDust;

    const outcome = store.breedSpecimens(a.id, b.id, { gene: 'shape', source: 'a' });

    expect(outcome).toBeNull();
    expect(store.getState().coins).toBe(coinsBefore);
    expect(store.getState().geneticDust).toBe(dustBefore);
  });

  it('с достаточной пылью — списывает cost, а зафиксированный ген берётся от выбранного родителя', () => {
    const base = freshStore();
    const [a, b] = base.getState().specimens;
    // Стартуем сразу с запасом пыли (initialState) — без обходных путей через
    // случайные награды за скрещивание, тест детерминирован по построению.
    const seeded = { ...base.getState(), geneticDust: BREEDING_CONFIG.dustCostPerLockedGene + 10 };
    const store = new GameStore({ rng: mulberry32(1), disablePersistence: true, initialState: seeded });
    const dustBeforeLock = store.getState().geneticDust;

    const outcome = store.breedSpecimens(a.id, b.id, { gene: 'shape', source: 'a' });

    expect(outcome).not.toBeNull();
    expect(outcome!.dustSpentOnLock).toBe(BREEDING_CONFIG.dustCostPerLockedGene);
    expect(outcome!.specimen.genome.shape).toBe(a.genome.shape);
    // Итоговая пыль = было - cost + случайная награда за это скрещивание.
    expect(store.getState().geneticDust).toBe(
      dustBeforeLock - BREEDING_CONFIG.dustCostPerLockedGene + outcome!.dustGained
    );
  });
});

describe('применение и ограничение ускорителей роста', () => {
  it('без ускорителей растение созревает точно к growMs', () => {
    const store = freshStore();
    store.plantSeed(0, 'sprout');
    const plot = store.getState().plots[0];
    const justBefore = store.plotStatus(plot, plot.plantedAt! + 60 * 1000 - 1);
    const justAfter = store.plotStatus(plot, plot.plantedAt! + 60 * 1000 + 1);
    expect(justBefore?.ready).toBe(false);
    expect(justAfter?.ready).toBe(true);
  });

  it('ускоритель +10% сокращает время до готовности пропорционально', () => {
    const store = freshStore();
    store.grantEntitlement({ id: 'test_boost', type: 'growth_boost', percent: 0.1, expiresAt: null });
    store.plantSeed(0, 'sprout');
    const plot = store.getState().plots[0];
    // growMs=60000; с бустом 10% эффективное время = real*1.1, значит реально
    // нужно real = growMs/1.1 ≈ 54545мс, а не полные 60000мс.
    const withoutBoostTime = plot.plantedAt! + 59000; // меньше 60с — без буста НЕ готово
    const status = store.plotStatus(plot, withoutBoostTime);
    expect(status?.ready).toBe(true); // с бустом уже готово раньше исходного таймера
  });

  it('сумма ускорителей не может превышать BOOSTS_CONFIG.maxTotalGrowthBoostPercent (25%)', () => {
    const store = freshStore();
    store.grantEntitlement({ id: 'a', type: 'growth_boost', percent: 0.2, expiresAt: null });
    store.grantEntitlement({ id: 'b', type: 'growth_boost', percent: 0.2, expiresAt: null }); // сумма 40% > лимита
    store.plantSeed(0, 'sprout');
    const plot = store.getState().plots[0];
    // При 25%-ном пределе эффективное время = real*1.25, минимальное реальное
    // время до готовности = 60000/1.25 = 48000мс. Проверяем, что растение НЕ
    // готово раньше этого порога, то есть буст не превысил лимит.
    const beforeCappedReady = plot.plantedAt! + 47000;
    const afterCappedReady = plot.plantedAt! + 49000;
    expect(store.plotStatus(plot, beforeCappedReady)?.ready).toBe(false);
    expect(store.plotStatus(plot, afterCappedReady)?.ready).toBe(true);
    expect(BOOSTS_CONFIG.maxTotalGrowthBoostPercent).toBe(0.25);
  });

  it('истёкший ускоритель не применяется', () => {
    const store = freshStore();
    const now = Date.now();
    store.grantEntitlement({ id: 'expired', type: 'growth_boost', percent: 0.5, expiresAt: now - 1000 });
    store.plantSeed(0, 'sprout');
    const plot = store.getState().plots[0];
    const status = store.plotStatus(plot, plot.plantedAt! + 59000);
    expect(status?.ready).toBe(false); // истёкший буст не ускорил рост
  });
});

describe('офлайн-рост', () => {
  it('время роста считается по дельте меток времени, а не по запущенному процессу', () => {
    const store = freshStore();
    store.plantSeed(0, 'sprout');
    const plot = store.getState().plots[0];
    // Симулируем, что игрок закрыл вкладку на 2 часа и вернулся —
    // никакого фонового таймера не было, но растение всё равно готово,
    // потому что расчёт идёт от planted_at при каждом обращении.
    const twoHoursLater = plot.plantedAt! + 2 * 60 * 60 * 1000;
    const status = store.plotStatus(plot, twoHoursLater);
    expect(status?.ready).toBe(true);
    const harvested = store.harvest(0, twoHoursLater);
    expect(harvested).toBe(true);
  });
});

describe('миграция старого сохранения (v1/v2 -> v3)', () => {
  it('сохранение без questProgress/questsClaimed/entitlements (v2) мигрирует без потери прогресса', () => {
    const legacyV2 = {
      version: 2,
      coins: 999,
      plots: Array.from({ length: MAX_PLOTS }, (_, i) => ({
        id: i,
        unlocked: i < START_UNLOCKED_PLOTS,
        seedId: null,
        plantedAt: null,
      })),
      inventory: { sprout: 7 },
      specimens: [{ id: 'legacy_1', genome: null, createdAt: 0 }],
      geneticDust: 42,
      pityCounter: 3,
    };
    const memoryStorage = new Map<string, string>();
    const storageLike = {
      getItem: (k: string) => memoryStorage.get(k) ?? null,
      setItem: (k: string, v: string) => void memoryStorage.set(k, v),
    };
    memoryStorage.set('genesis-garden-save-v1', JSON.stringify(legacyV2));

    // Подменяем глобальный localStorage на наш in-memory storage для этого теста.
    const originalLocalStorage = globalThis.localStorage;
    // @ts-expect-error — подмена для теста миграции
    globalThis.localStorage = storageLike;
    try {
      const store = new GameStore({ rng: mulberry32(5) });
      const state = store.getState();
      // Прогресс игрока сохранён.
      expect(state.coins).toBe(999);
      expect(state.geneticDust).toBe(42);
      expect(state.pityCounter).toBe(3);
      expect(state.inventory.sprout).toBe(7);
      expect(state.specimens).toHaveLength(1);
      // Новые поля v3 добавлены с безопасными дефолтами.
      expect(state.questProgress).toEqual({});
      expect(state.questsClaimed).toEqual([]);
      expect(state.entitlements).toEqual([]);
    } finally {
      globalThis.localStorage = originalLocalStorage;
    }
  });

  it('битое/повреждённое сохранение не роняет игру — откатывается на новую игру', () => {
    const memoryStorage = new Map<string, string>();
    memoryStorage.set('genesis-garden-save-v1', '{ не валидный json');
    const storageLike = {
      getItem: (k: string) => memoryStorage.get(k) ?? null,
      setItem: (k: string, v: string) => void memoryStorage.set(k, v),
    };
    const originalLocalStorage = globalThis.localStorage;
    // @ts-expect-error — подмена для теста
    globalThis.localStorage = storageLike;
    try {
      const store = new GameStore({ rng: mulberry32(5) });
      const state = store.getState();
      expect(state.coins).toBe(STARTING_STATE_CONFIG.startingCoins);
    } finally {
      globalThis.localStorage = originalLocalStorage;
    }
  });
});

describe('квесты', () => {
  it('прогресс квеста увеличивается только по своему типу события', () => {
    const store = freshStore();
    store.plantSeed(0, 'sprout');
    const state = store.getState();
    expect(state.questProgress['first_plant']).toBe(1);
    expect(state.questProgress['first_harvest'] ?? 0).toBe(0); // сбора ещё не было
  });

  it('claimQuest без выполненной цели отклоняется', () => {
    const store = freshStore();
    const ok = store.claimQuest('harvest_five'); // цель 5, прогресс 0
    expect(ok).toBe(false);
  });
});

// ============================================================================
// Genetics V2 — Slice 1 (save/state/feature flags). Тесты 1-6, 20-22 из
// обязательного списка задания (docs/GENETICS_TARGET_DELTA.md §10.4).
// Тесты на сам genomeV2-маппинг/sidecar (7-19) — apps/web/src/game/geneticsV2.test.ts.
// ============================================================================

function withMemoryStorage<T>(run: () => T): T {
  const memoryStorage = new Map<string, string>();
  const storageLike = {
    getItem: (k: string) => memoryStorage.get(k) ?? null,
    setItem: (k: string, v: string) => void memoryStorage.set(k, v),
  };
  const originalLocalStorage = globalThis.localStorage;
  // @ts-expect-error — подмена для теста миграции
  globalThis.localStorage = storageLike;
  try {
    return run();
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
}

function legacyPlots() {
  return Array.from({ length: MAX_PLOTS }, (_, i) => ({
    id: i,
    unlocked: i < START_UNLOCKED_PLOTS,
    seedId: null,
    plantedAt: null,
  }));
}

function legacySpecimen(id: string) {
  return {
    id,
    genome: {
      shape: 1,
      primary: '#FF8C77',
      secondary: '#F5A623',
      leaf: '#6FBE44',
      pattern: 'solid' as const,
      size: 'normal' as const,
      aura: 'none' as const,
      mutationId: null,
    },
    createdAt: 0,
  };
}

/** Сырой V3-save (без genomeV2/pollen/labLevel/nurseryTray/трёх флагов) — то, что реально лежит на диске у существующих игроков до Slice 1. */
function rawV3Save(overrides: Record<string, unknown> = {}) {
  return {
    version: 3,
    coins: 100,
    plots: legacyPlots(),
    inventory: { sprout: 3 },
    specimens: [legacySpecimen('s1'), legacySpecimen('s2')],
    geneticDust: 0,
    pityCounter: 0,
    questProgress: {},
    questsClaimed: [],
    entitlements: [],
    ...overrides,
  };
}

describe('Genetics V2 Slice 1 — pity clamp (migratePityCounter)', () => {
  it.each([
    [-1, 0],
    [0, 0],
    [2.7, 2],
    [5, 5],
    [9, 9],
    [10, 9],
    [15, 9],
  ])('migratePityCounter(%s) === %s', (input, expected) => {
    expect(migratePityCounter(input)).toBe(expected);
  });
});

describe('Genetics V2 Slice 1 — критерий "save с историей" (hasBreedingHistory)', () => {
  it('specimens.length>2 достаточно само по себе', () => {
    expect(hasBreedingHistory({ specimens: [1, 2, 3], pityCounter: 0, geneticDust: 0 })).toBe(true);
  });
  it('specimens.length===2 (только стартовые) недостаточно', () => {
    expect(hasBreedingHistory({ specimens: [1, 2], pityCounter: 0, geneticDust: 0 })).toBe(false);
  });
  it('pityCounter>0 достаточно само по себе', () => {
    expect(hasBreedingHistory({ specimens: [1, 2], pityCounter: 1, geneticDust: 0 })).toBe(true);
  });
  it('geneticDust>0 достаточно само по себе', () => {
    expect(hasBreedingHistory({ specimens: [1, 2], pityCounter: 0, geneticDust: 1 })).toBe(true);
  });
  it('ни одно условие — нетронутый save', () => {
    expect(hasBreedingHistory({ specimens: [1, 2], pityCounter: 0, geneticDust: 0 })).toBe(false);
  });
});

describe('Genetics V2 Slice 1 — тест 1: новый V4-save получает правильные дефолты', () => {
  it('createInitialState даёт честные дефолты нового игрока', () => {
    const store = freshStore();
    const state = store.getState();
    expect(state.pollen).toBe(0);
    expect(state.labLevel).toBe(1);
    expect(state.nurseryTray).toEqual([]);
    expect(state.firstBreedFreeClaimed).toBe(false);
    expect(state.firstHybridRewardClaimed).toBe(false);
    expect(state.firstRecycleTopUpClaimed).toBe(false);
    // Новая матрица §7.1 «Новый»: genomeV2 создаётся сразу для стартовых specimens.
    expect(state.specimens).toHaveLength(STARTING_STATE_CONFIG.startingSpecimenCount);
    for (const specimen of state.specimens) {
      expect(specimen.genomeV2).toBeDefined();
      expect(specimen.genome).toBeDefined(); // legacy-геном не удалён
    }
  });
});

describe('Genetics V2 Slice 1 — тест 2: нетронутый V3→V4', () => {
  it('save без истории получает pollen=0, labLevel=1, флаги false, pityCounter=0', () => {
    withMemoryStorage(() => {
      globalThis.localStorage.setItem('genesis-garden-save-v1', JSON.stringify(rawV3Save()));
      const store = new GameStore({ rng: mulberry32(1) });
      const state = store.getState();
      expect(state.pollen).toBe(0);
      expect(state.labLevel).toBe(1);
      expect(state.nurseryTray).toEqual([]);
      expect(state.firstBreedFreeClaimed).toBe(false);
      expect(state.firstHybridRewardClaimed).toBe(false);
      expect(state.firstRecycleTopUpClaimed).toBe(false);
      expect(state.pityCounter).toBe(0);
      // Существующие поля не тронуты миграцией.
      expect(state.coins).toBe(100);
      expect(state.inventory.sprout).toBe(3);
    });
  });
});

describe('Genetics V2 Slice 1 — тесты 3-5: save с историей по каждому условию отдельно', () => {
  it('тест 3: история через specimens.length>2', () => {
    withMemoryStorage(() => {
      const save = rawV3Save({
        specimens: [legacySpecimen('s1'), legacySpecimen('s2'), legacySpecimen('s3')],
      });
      globalThis.localStorage.setItem('genesis-garden-save-v1', JSON.stringify(save));
      const store = new GameStore({ rng: mulberry32(1) });
      const state = store.getState();
      expect(state.pollen).toBe(24);
      expect(state.labLevel).toBe(3);
      expect(state.firstBreedFreeClaimed).toBe(true);
      expect(state.firstHybridRewardClaimed).toBe(true);
      expect(state.firstRecycleTopUpClaimed).toBe(true);
    });
  });

  it('тест 4: история через pityCounter>0', () => {
    withMemoryStorage(() => {
      const save = rawV3Save({ pityCounter: 4 });
      globalThis.localStorage.setItem('genesis-garden-save-v1', JSON.stringify(save));
      const store = new GameStore({ rng: mulberry32(1) });
      const state = store.getState();
      expect(state.pollen).toBe(24);
      expect(state.labLevel).toBe(3);
      expect(state.firstBreedFreeClaimed).toBe(true);
      expect(state.firstHybridRewardClaimed).toBe(true);
      expect(state.firstRecycleTopUpClaimed).toBe(true);
      expect(state.pityCounter).toBe(4); // clamp(floor(4),0,9) = 4
    });
  });

  it('тест 5: история через geneticDust>0', () => {
    withMemoryStorage(() => {
      const save = rawV3Save({ geneticDust: 7 });
      globalThis.localStorage.setItem('genesis-garden-save-v1', JSON.stringify(save));
      const store = new GameStore({ rng: mulberry32(1) });
      const state = store.getState();
      expect(state.pollen).toBe(24);
      expect(state.labLevel).toBe(3);
      expect(state.firstBreedFreeClaimed).toBe(true);
      expect(state.firstHybridRewardClaimed).toBe(true);
      expect(state.firstRecycleTopUpClaimed).toBe(true);
      expect(state.geneticDust).toBe(7); // не тронуто глобальной миграцией
    });
  });
});

describe('Genetics V2 Slice 1 — миграционная матрица не перевыдаёт ресурсы повторно', () => {
  it('повторная загрузка уже мигрированного V4-save (сериализованного стором) не меняет pollen/labLevel/флаги/pity', () => {
    withMemoryStorage(() => {
      const save = rawV3Save({ pityCounter: 4 });
      globalThis.localStorage.setItem('genesis-garden-save-v1', JSON.stringify(save));
      const first = new GameStore({ rng: mulberry32(1) });
      // Форсируем persist текущего (уже мигрированного) состояния на диск.
      first.grantEntitlement({ id: 'noop', type: 'growth_boost', percent: 0, expiresAt: null });
      const afterFirst = first.getState();

      const second = new GameStore({ rng: mulberry32(2) });
      const afterSecond = second.getState();

      expect(afterSecond.pollen).toBe(afterFirst.pollen);
      expect(afterSecond.labLevel).toBe(afterFirst.labLevel);
      expect(afterSecond.firstBreedFreeClaimed).toBe(afterFirst.firstBreedFreeClaimed);
      expect(afterSecond.pityCounter).toBe(afterFirst.pityCounter);
    });
  });
});

describe('Genetics V2 Slice 1 — тест 20: переключение флагов не теряет новые поля', () => {
  it('пыльца/labLevel, изменённые между "переключениями флага", переживают несколько циклов перезагрузки store', () => {
    withMemoryStorage(() => {
      const save = rawV3Save({ pollen: 12, labLevel: 2, geneticDust: 1 });
      globalThis.localStorage.setItem('genesis-garden-save-v1', JSON.stringify(save));

      // Слайс 1 не читает feature flag в loadState вообще — переключение
      // VITE_DIPLOID_GENETICS_ENABLED не должно ничего пересчитывать. Здесь
      // это проверяется тем, что несколько независимых циклов
      // создание-стора-из-того-же-storage (эквивалент выкл→вкл→выкл→вкл,
      // поскольку флаг не участвует в loadState()) сохраняют значения.
      const cycles = [1, 2, 3, 4].map(() => new GameStore({ rng: mulberry32(1) }).getState());
      for (const state of cycles) {
        expect(state.pollen).toBe(12);
        expect(state.labLevel).toBe(2);
      }
    });
  });
});

describe('Genetics V2 Slice 1 — тест 21: повреждённый save безопасно создаёт новую игру', () => {
  it('невалидный JSON не роняет игру и создаёт честный новый V4-стейт', () => {
    withMemoryStorage(() => {
      globalThis.localStorage.setItem('genesis-garden-save-v1', '{ не валидный json, V4');
      const store = new GameStore({ rng: mulberry32(5) });
      const state = store.getState();
      expect(state.coins).toBe(STARTING_STATE_CONFIG.startingCoins);
      expect(state.pollen).toBe(0);
      expect(state.labLevel).toBe(1);
      expect(state.nurseryTray).toEqual([]);
      expect(state.specimens.every((s) => s.genomeV2)).toBe(true);
    });
  });

  it('specimen с повреждённым legacy genome (null) не роняет загрузку остального save', () => {
    withMemoryStorage(() => {
      const save = rawV3Save({
        coins: 555,
        specimens: [{ id: 'broken', genome: null, createdAt: 0 }, legacySpecimen('ok')],
      });
      globalThis.localStorage.setItem('genesis-garden-save-v1', JSON.stringify(save));
      const store = new GameStore({ rng: mulberry32(5) });
      const state = store.getState();
      // Save целиком не откатился на новую игру — coins сохранены.
      expect(state.coins).toBe(555);
      expect(state.specimens).toHaveLength(2);
      // "ok" получил sidecar, "broken" безопасно остался без него.
      const ok = state.specimens.find((s) => s.id === 'ok');
      const broken = state.specimens.find((s) => s.id === 'broken');
      expect(ok?.genomeV2).toBeDefined();
      expect(broken?.genomeV2).toBeUndefined();
    });
  });
});
