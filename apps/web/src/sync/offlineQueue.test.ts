import { describe, expect, it } from 'vitest';
import { OfflineQueue, type ExecuteResult, type QueuedAction } from './offlineQueue';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('OfflineQueue', () => {
  it('enqueue добавляет действие и size() растёт', () => {
    const q = new OfflineQueue(memoryStorage());
    q.enqueue('harvest', { plotIndex: 0 }, 'req-1');
    expect(q.size()).toBe(1);
  });

  it('повторный enqueue с тем же requestId не дублирует запись', () => {
    const q = new OfflineQueue(memoryStorage());
    q.enqueue('harvest', { plotIndex: 0 }, 'req-1');
    q.enqueue('harvest', { plotIndex: 0 }, 'req-1');
    expect(q.size()).toBe(1);
  });

  it('drain убирает успешные действия из очереди', async () => {
    const q = new OfflineQueue(memoryStorage());
    q.enqueue('harvest', { plotIndex: 0 }, 'req-1');
    q.enqueue('plant', { plotIndex: 1, seedId: 'sprout' }, 'req-2');

    const result = await q.drain(async () => ({ done: true, networkError: false }));
    expect(result.processed).toBe(2);
    expect(result.remaining).toBe(0);
    expect(q.size()).toBe(0);
  });

  it('drain останавливается на первой сетевой ошибке, не теряя порядок', async () => {
    const q = new OfflineQueue(memoryStorage());
    q.enqueue('buy_seed', {}, 'req-1');
    q.enqueue('plant', {}, 'req-2');
    q.enqueue('harvest', {}, 'req-3');

    const seen: string[] = [];
    const result = await q.drain(async (action: QueuedAction): Promise<ExecuteResult> => {
      seen.push(action.requestId);
      if (action.requestId === 'req-2') return { done: false, networkError: true };
      return { done: true, networkError: false };
    });

    // req-1 обработан, req-2 упал по сети -> дренаж остановился, req-3 не тронут.
    expect(seen).toEqual(['req-1', 'req-2']);
    expect(result.processed).toBe(1);
    expect(result.remaining).toBe(2);
    expect(q.list().map((a) => a.requestId)).toEqual(['req-2', 'req-3']);
  });

  it('окончательный business-отказ (done=true, networkError=false) тоже убирает действие из очереди', async () => {
    const q = new OfflineQueue(memoryStorage());
    q.enqueue('harvest', {}, 'req-1'); // например, плод уже собран другим клиентом

    const result = await q.drain(async () => ({ done: true, networkError: false }));
    expect(result.remaining).toBe(0);
  });

  it('повтор того же requestId после сетевого сбоя переиспользует id (идемпотентность на сервере это покрывает)', async () => {
    const q = new OfflineQueue(memoryStorage());
    q.enqueue('harvest', { plotIndex: 0 }, 'req-1');

    let attemptsSeen: number[] = [];
    await q.drain(async (action) => {
      attemptsSeen.push(action.attempts);
      return { done: false, networkError: true };
    });
    expect(attemptsSeen).toEqual([1]);
    expect(q.list()[0].requestId).toBe('req-1'); // id не поменялся между попытками

    attemptsSeen = [];
    await q.drain(async (action) => {
      attemptsSeen.push(action.attempts);
      return { done: true, networkError: false };
    });
    expect(attemptsSeen).toEqual([2]); // вторая попытка того же действия
  });

  it('persist переживает пересоздание очереди с тем же storage (переживает перезагрузку страницы)', () => {
    const storage = memoryStorage();
    const q1 = new OfflineQueue(storage);
    q1.enqueue('harvest', { plotIndex: 0 }, 'req-1');

    const q2 = new OfflineQueue(storage);
    expect(q2.size()).toBe(1);
  });

  it('без доступного storage работает как no-op, не крашится', async () => {
    const q = new OfflineQueue(null);
    q.enqueue('harvest', {}, 'req-1');
    expect(q.size()).toBe(0); // без persistence нечего хранить
    const result = await q.drain(async () => ({ done: true, networkError: false }));
    expect(result).toEqual({ processed: 0, remaining: 0 });
  });
});
