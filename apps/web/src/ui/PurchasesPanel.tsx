import { useEffect, useState } from 'react';
import { PRODUCT_CATALOG, COMING_SOON_CATEGORIES, formatPrice, type ProductId } from '../payments/catalog';
import { getActivePaymentProvider } from '../payments/PaymentProvider';
import { fetchActiveEntitlements, fetchPurchaseHistory, type ActiveEntitlement, type PurchaseHistoryEntry } from '../sync/purchases';
import { gardenEvents } from '../game/events';

interface PurchasesPanelProps {
  onClose: () => void;
}

const ERROR_LABELS: Record<string, string> = {
  unknown_product_id: 'Этот товар недоступен',
  garden_not_found: 'Сад не найден — попробуй перезайти',
  paddle_not_configured: 'Настоящие платежи ещё не подключены (нет аккаунта Paddle) — доступен только тестовый режим',
};

function friendlyError(raw: string | undefined): string {
  if (!raw) return 'Не получилось выполнить покупку';
  return ERROR_LABELS[raw] ?? raw;
}

const ENTITLEMENT_LABEL: Record<string, string> = {
  growth_boost: 'Ускорение роста',
  season_pass: 'Сезонный пропуск',
  storage_slot: 'Слот хранилища',
  cosmetic: 'Косметика',
};

export function PurchasesPanel({ onClose }: PurchasesPanelProps) {
  const [entitlements, setEntitlements] = useState<ActiveEntitlement[]>([]);
  const [history, setHistory] = useState<PurchaseHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<ProductId | null>(null);

  const provider = getActivePaymentProvider();

  async function refresh() {
    setLoading(true);
    const [ent, hist] = await Promise.all([fetchActiveEntitlements(), fetchPurchaseHistory()]);
    setEntitlements(ent);
    setHistory(hist);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function buy(productId: ProductId) {
    setBuying(productId);
    const result = await provider.checkout(productId);
    setBuying(null);
    if (result.ok) {
      gardenEvents.emit('toast', { text: 'Покупка прошла успешно' });
      refresh();
    } else {
      gardenEvents.emit('toast', { text: friendlyError(result.errorMessage) });
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Поддержка проекта</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {provider.name === 'mock' && (
          <p className="purchases-mock-banner">
            🧪 Тестовый режим: реальные деньги не списываются, это песочница для проверки покупок в бете.
          </p>
        )}

        <div className="purchases-catalog">
          {PRODUCT_CATALOG.map((product) => (
            <div className="purchases-card" key={product.id}>
              <div className="purchases-card-name">{product.name}</div>
              <p className="purchases-card-desc">{product.description}</p>
              <div className="purchases-card-footer">
                <span className="purchases-card-price">{formatPrice(product.priceCents)}</span>
                <button
                  className="sheet-buy-btn"
                  disabled={buying === product.id}
                  onClick={() => buy(product.id)}
                >
                  {buying === product.id ? 'Покупаем…' : 'Купить'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="purchases-coming-soon">
          {COMING_SOON_CATEGORIES.map((c) => (
            <div className="purchases-coming-soon-row" key={c.id}>
              <span>{c.name}</span>
              <span className="purchases-coming-soon-tag">скоро ({c.reason})</span>
            </div>
          ))}
        </div>

        {!loading && (
          <>
            <div className="social-section">
              <h3 className="social-section-title">Активные бонусы</h3>
              {entitlements.length === 0 ? (
                <p className="sheet-empty">Пока нет активных покупок</p>
              ) : (
                <div className="social-gift-list">
                  {entitlements.map((e) => (
                    <div className="social-gift-row" key={e.id}>
                      <span>
                        {ENTITLEMENT_LABEL[e.type] ?? e.type}
                        {e.percent !== null && `: +${Math.round(e.percent * 100)}%`}
                        {e.expiresAt && ` — до ${new Date(e.expiresAt).toLocaleDateString('ru-RU')}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="social-section">
              <h3 className="social-section-title">История покупок (восстановить)</h3>
              {history.length === 0 ? (
                <p className="sheet-empty">Покупок ещё не было</p>
              ) : (
                <div className="social-gift-list">
                  {history.map((h) => (
                    <div className="social-gift-row" key={h.id}>
                      <span>
                        {h.productId} — {formatPrice(h.amountCents)} ({h.status})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
