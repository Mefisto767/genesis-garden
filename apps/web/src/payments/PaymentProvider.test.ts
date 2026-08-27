import { describe, expect, it, vi, beforeEach } from 'vitest';
import { formatPrice, findProduct, PRODUCT_CATALOG } from './catalog';

// gameApi — реальный singleton поверх supabase-js; мокаем модуль целиком,
// чтобы протестировать MockPaymentProvider.checkout() без сети/сессии.
vi.mock('../sync/gameApi', () => ({
  gameApi: { mockGrantPurchase: vi.fn() },
}));

import { gameApi } from '../sync/gameApi';
import { MockPaymentProvider, PaddlePaymentProvider, getActivePaymentProvider } from './PaymentProvider';

describe('catalog', () => {
  it('formatPrice форматирует центы в доллары с двумя знаками', () => {
    expect(formatPrice(799)).toBe('$7.99');
    expect(formatPrice(199)).toBe('$1.99');
    expect(formatPrice(0)).toBe('$0.00');
  });

  it('findProduct находит товар по id, неизвестный id -> undefined', () => {
    expect(findProduct('season_pass')?.priceCents).toBe(799);
    expect(findProduct('does_not_exist')).toBeUndefined();
  });

  it('каталог не пуст и все цены положительные', () => {
    expect(PRODUCT_CATALOG.length).toBeGreaterThan(0);
    for (const p of PRODUCT_CATALOG) {
      expect(p.priceCents).toBeGreaterThan(0);
    }
  });
});

describe('MockPaymentProvider', () => {
  beforeEach(() => {
    vi.mocked(gameApi.mockGrantPurchase).mockReset();
  });

  it('успешный ответ RPC -> ok:true, без errorMessage', async () => {
    vi.mocked(gameApi.mockGrantPurchase).mockResolvedValue({ ok: true, isNetworkError: false });
    const provider = new MockPaymentProvider();

    const result = await provider.checkout('season_pass');

    expect(result.ok).toBe(true);
    expect(gameApi.mockGrantPurchase).toHaveBeenCalledWith('season_pass');
  });

  it('бизнес-отказ RPC пробрасывает errorMessage игроку', async () => {
    vi.mocked(gameApi.mockGrantPurchase).mockResolvedValue({
      ok: false,
      isNetworkError: false,
      errorMessage: 'unknown_product_id',
    });
    const provider = new MockPaymentProvider();

    const result = await provider.checkout('greenhouse_boost');

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe('unknown_product_id');
  });
});

describe('PaddlePaymentProvider', () => {
  it('checkout всегда отказывает с paddle_not_configured — интеграция не подключена (нет реального аккаунта)', async () => {
    const provider = new PaddlePaymentProvider();
    const result = await provider.checkout('season_pass');
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe('paddle_not_configured');
  });
});

describe('getActivePaymentProvider', () => {
  it('по умолчанию (без VITE_PAYMENTS_PROVIDER=paddle) отдаёт mock-провайдер', () => {
    expect(getActivePaymentProvider().name).toBe('mock');
  });
});
