import { describe, expect, it, vi } from 'vitest';
import { GameApi, type RpcCallResult, type RpcCaller, type RpcName } from './gameApi';
import { OfflineQueue } from './offlineQueue';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

function fakeCaller(handler: (name: RpcName, args: Record<string, unknown>) => RpcCallResult): RpcCaller {
  return { call: vi.fn(async (name, args) => handler(name, args)) };
}

describe('GameApi', () => {
  it('успешный вызов не трогает очередь', async () => {
    const caller = fakeCaller(() => ({ ok: true, data: { ok: true }, isNetworkError: false }));
    const queue = new OfflineQueue(memoryStorage());
    const api = new GameApi(caller, queue);

    const result = await api.harvest(0);
    expect(result.ok).toBe(true);
    expect(api.queueSize()).toBe(0);
  });

  it('сетевая ошибка кладёт действие в очередь с request_id', async () => {
    const caller = fakeCaller(() => ({ ok: false, isNetworkError: true, errorMessage: 'network' }));
    const queue = new OfflineQueue(memoryStorage());
    const api = new GameApi(caller, queue);

    await api.plant(3, 'sprout');
    expect(api.queueSize()).toBe(1);
    expect(queue.list()[0].kind).toBe('plant');
    expect(queue.list()[0].args.p_plot_index).toBe(3);
    expect(typeof queue.list()[0].args.p_request_id).toBe('string');
  });

  it('бизнес-отказ (не сеть) НЕ кладёт действие в очередь — повтор ничего не изменит', async () => {
    const caller = fakeCaller(() => ({ ok: false, isNetworkError: false, errorMessage: 'insufficient_coins' }));
    const queue = new OfflineQueue(memoryStorage());
    const api = new GameApi(caller, queue);

    await api.buySeed('upgraded', 5);
    expect(api.queueSize()).toBe(0);
  });

  it('каждый вызов получает СВОЙ request_id — повторный клик не переиспользует чужой id', async () => {
    const seenIds: string[] = [];
    const caller = fakeCaller((_name, args) => {
      seenIds.push(args.p_request_id as string);
      return { ok: false, isNetworkError: true };
    });
    const api = new GameApi(caller, new OfflineQueue(memoryStorage()));

    await api.harvest(0);
    await api.harvest(0);
    expect(seenIds).toHaveLength(2);
    expect(seenIds[0]).not.toBe(seenIds[1]);
  });

  it('drainQueue повторяет очередь и очищает её при успехе', async () => {
    const queue = new OfflineQueue(memoryStorage());
    let calls = 0;
    const caller = fakeCaller(() => {
      calls += 1;
      return calls === 1
        ? { ok: false, isNetworkError: true } // первая попытка сразу — сеть недоступна
        : { ok: true, data: {}, isNetworkError: false }; // после восстановления сети — успех
    });
    const api = new GameApi(caller, queue);

    await api.harvest(0); // уходит в очередь
    expect(api.queueSize()).toBe(1);

    const drainResult = await api.drainQueue();
    expect(drainResult.processed).toBe(1);
    expect(drainResult.remaining).toBe(0);
    expect(api.queueSize()).toBe(0);
  });
});
