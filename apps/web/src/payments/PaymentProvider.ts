// ============================================================================
// Этап 7 — PaymentProvider: единый интерфейс checkout'а, за которым прячется
// либо песочница (MockPaymentProvider — реально начисляет entitlement через
// mock_grant_purchase RPC, см. supabase/migrations/20260827150000), либо
// настоящий Paddle (PaddlePaymentProvider — подготовлен структурно, но не
// подключён: нет ни аккаунта Paddle у владельца, ни VITE_PADDLE_CLIENT_TOKEN,
// см. "Открытые вопросы владельцу" в docs/IMPLEMENTATION_STATUS.md).
//
// Выбор провайдера — VITE_PAYMENTS_PROVIDER ('mock' | 'paddle'), сама
// платёжная секция UI скрыта если VITE_PAYMENTS_ENABLED !== 'true'
// (см. .env.example, оба флага по умолчанию безопасны/выключены).
// ============================================================================

import type { ProductId } from './catalog';
import { gameApi } from '../sync/gameApi';

export interface PurchaseResult {
  ok: boolean;
  errorMessage?: string;
}

export interface PaymentProvider {
  readonly name: 'mock' | 'paddle';
  checkout(productId: ProductId): Promise<PurchaseResult>;
}

/**
 * Песочница: НЕ настоящий платёж (деньги никогда не участвуют) — сразу
 * вызывает mock_grant_purchase, которая существует только для того, чтобы
 * прогнать покупку -> entitlement end-to-end без живого Paddle-аккаунта.
 * См. громкое предупреждение прямо в SQL-функции.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  async checkout(productId: ProductId): Promise<PurchaseResult> {
    const result = await gameApi.mockGrantPurchase(productId);
    if (result.ok) return { ok: true };
    return { ok: false, errorMessage: result.errorMessage };
  }
}

/**
 * Настоящий Paddle checkout — НЕ реализован до появления у владельца
 * реального (хотя бы sandbox) Paddle-аккаунта: без него невозможно ни
 * получить VITE_PADDLE_CLIENT_TOKEN, ни проверить хоть один платёж вживую,
 * а писать непроверенный код интеграции с реальными деньгами и выдавать его
 * за готовый — hard rule мастер-промта прямо это запрещает ("никогда не
 * выдавай непроверенный функционал за готовый"). Структура (интерфейс,
 * каталог, webhook) готова — здесь остаётся подключить Paddle.js оверлей
 * checkout'а и убрать этот throw, когда ключ появится. См. docs/PAYMENTS.md.
 */
export class PaddlePaymentProvider implements PaymentProvider {
  readonly name = 'paddle' as const;

  async checkout(_productId: ProductId): Promise<PurchaseResult> {
    return { ok: false, errorMessage: 'paddle_not_configured' };
  }
}

export function getActivePaymentProvider(): PaymentProvider {
  const provider = import.meta.env.VITE_PAYMENTS_PROVIDER as string | undefined;
  return provider === 'paddle' ? new PaddlePaymentProvider() : new MockPaymentProvider();
}

export const isPaymentsEnabled = (import.meta.env.VITE_PAYMENTS_ENABLED as string | undefined) === 'true';
