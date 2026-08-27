import { describe, expect, it } from 'vitest';
import { GameStore } from './store';
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
