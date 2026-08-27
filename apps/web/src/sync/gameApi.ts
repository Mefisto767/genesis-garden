// ============================================================================
// Этап 4 — типизированная обёртка над серверными RPC (см. supabase/migrations
// /20260827120200_functions.sql) + офлайн-очередь. Инжектируемый `rpcCaller`
// вместо прямой зависимости от supabase-js делает модуль тестируемым без
// сети и без реального проекта (см. gameApi.test.ts) — реальная связка с
// supabase-js — в createSupabaseRpcCaller() ниже, включается только когда
// облако сконфигурировано (isCloudSyncEnabled).
// ============================================================================

import type { Database } from '../lib/database.types';
import { getSupabaseClient, newRequestId } from '../lib/supabaseClient';
import { OfflineQueue, type ExecuteResult } from './offlineQueue';

export type RpcName = keyof Database['public']['Functions'];

export interface RpcCaller {
  call(name: RpcName, args: Record<string, unknown>): Promise<RpcCallResult>;
}

export interface RpcCallResult {
  ok: boolean;
  data?: unknown;
  /** true — похоже на сетевую проблему (стоит положить в очередь и повторить), а не на бизнес-отказ сервера. */
  isNetworkError: boolean;
  errorMessage?: string;
}

/** Реальная реализация поверх supabase-js — используется только когда облако включено. */
export function createSupabaseRpcCaller(): RpcCaller {
  return {
    async call(name, args) {
      const supabase = getSupabaseClient();
      if (!supabase) return { ok: false, isNetworkError: false, errorMessage: 'supabase_not_configured' };
      try {
        const { data, error } = await supabase.rpc(name, args as never);
        if (error) {
          // PostgREST отдаёт сетевые/таймаут ошибки без структурированного кода,
          // а бизнес-исключения (RAISE EXCEPTION в PL/pgSQL) — с сообщением
          // вроде 'insufficient_coins'. Грубая эвристика: если есть код ошибки
          // класса PostgREST/сеть — считаем сетевой; иначе бизнес-отказ.
          const isNetworkError = !error.code || error.code === 'PGRST000' || error.message.includes('fetch');
          return { ok: false, isNetworkError, errorMessage: error.message };
        }
        return { ok: true, data, isNetworkError: false };
      } catch (e) {
        // fetch сам бросил (offline, DNS, timeout) — точно сетевая ошибка.
        return { ok: false, isNetworkError: true, errorMessage: String(e) };
      }
    },
  };
}

export class GameApi {
  private rpc: RpcCaller;
  private queue: OfflineQueue;

  constructor(rpc: RpcCaller, queue: OfflineQueue = new OfflineQueue()) {
    this.rpc = rpc;
    this.queue = queue;
  }

  queueSize(): number {
    return this.queue.size();
  }

  /**
   * Выполняет действие сразу; при сетевой ошибке кладёт его в офлайн-очередь
   * с тем же request_id (сгенерированным один раз здесь) для последующего
   * drain() — тогда повтор безопасен благодаря идемпотентности RPC на сервере.
   */
  private async performOrQueue(kind: RpcName, args: Record<string, unknown>): Promise<RpcCallResult> {
    const requestId = newRequestId();
    const fullArgs = { ...args, p_request_id: requestId };
    const result = await this.rpc.call(kind, fullArgs);
    if (!result.ok && result.isNetworkError) {
      this.queue.enqueue(kind, fullArgs, requestId);
    }
    return result;
  }

  plant(plotIndex: number, seedId: string) {
    return this.performOrQueue('plant', { p_plot_index: plotIndex, p_seed_id: seedId });
  }

  harvest(plotIndex: number) {
    return this.performOrQueue('harvest', { p_plot_index: plotIndex });
  }

  expandPlot(plotIndex: number) {
    return this.performOrQueue('expand_plot', { p_plot_index: plotIndex });
  }

  buySeed(seedId: string, qty: number) {
    return this.performOrQueue('buy_seed', { p_seed_id: seedId, p_qty: qty });
  }

  breed(parentA: string, parentB: string) {
    return this.performOrQueue('breed', { p_parent_a: parentA, p_parent_b: parentB });
  }

  recyclePlant(plantId: string) {
    return this.performOrQueue('recycle_plant', { p_plant_id: plantId });
  }

  claimQuest(questId: string) {
    return this.performOrQueue('claim_quest', { p_quest_id: questId });
  }

  // --- Этап 6 — социальный обмен (см. supabase/migrations/20260827140000_social_stage6.sql) ---

  sendGift(recipientPublicCode: string, itemType: 'plant' | 'dust', itemPayload: Record<string, unknown>) {
    return this.performOrQueue('send_gift', {
      p_recipient_public_code: recipientPublicCode,
      p_item_type: itemType,
      p_item_payload: itemPayload,
    });
  }

  claimGift(giftId: string) {
    return this.performOrQueue('claim_gift', { p_gift_id: giftId });
  }

  declineGift(giftId: string) {
    return this.performOrQueue('decline_gift', { p_gift_id: giftId });
  }

  blockUser(targetPublicCode: string) {
    return this.performOrQueue('block_user', { p_target_public_code: targetPublicCode });
  }

  unblockUser(targetPublicCode: string) {
    return this.performOrQueue('unblock_user', { p_target_public_code: targetPublicCode });
  }

  /** Дренирует офлайн-очередь — вызывать по событию 'online' и при старте приложения. */
  async drainQueue(): Promise<{ processed: number; remaining: number }> {
    return this.queue.drain(async (action): Promise<ExecuteResult> => {
      const result = await this.rpc.call(action.kind as RpcName, action.args);
      if (result.ok) return { done: true, networkError: false };
      if (result.isNetworkError) return { done: false, networkError: true };
      // Бизнес-отказ (например, состояние с тех пор изменилось так, что
      // действие больше не имеет смысла) — не повторяем бесконечно.
      return { done: true, networkError: false };
    });
  }
}

/**
 * Общий инстанс поверх реального supabase-js — используется первым делом
 * Этапом 6 (социальный обмен), у которого в принципе нет локального
 * эквивалента (нужен настоящий аккаунт другого игрока). Другие игровые
 * действия (plant/harvest/breed/...) остаются на локальном gameStore —
 * это следующий отдельный шаг интеграции, см. docs/IMPLEMENTATION_STATUS.md.
 * Безопасно создавать даже когда облако выключено: createSupabaseRpcCaller()
 * проверяет getSupabaseClient() лениво при каждом вызове, а не здесь.
 */
export const gameApi = new GameApi(createSupabaseRpcCaller());
