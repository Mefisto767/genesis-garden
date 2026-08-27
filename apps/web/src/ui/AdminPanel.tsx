import { useEffect, useState } from 'react';
import { fetchAdminOverview, type AdminOverview } from '../admin/adminData';
import { formatPrice } from '../payments/catalog';

interface AdminPanelProps {
  onClose: () => void;
}

const EVENT_LABEL: Record<string, string> = {
  session_started: 'Сессии начаты',
  tutorial_started: 'Обучение начато',
  tutorial_completed: 'Обучение завершено',
  seed_bought: 'Семена куплены',
  plant_planted: 'Посадки',
  plant_harvested: 'Сборы урожая',
  first_breed_started: 'Первое скрещивание начато',
  first_breed_completed: 'Первое скрещивание завершено',
  breed_completed: 'Скрещиваний всего',
  plant_recycled: 'Переработок',
  share_clicked: 'Нажатий «Поделиться»',
  gift_sent: 'Подарков отправлено',
  gift_claimed: 'Подарков получено',
  store_opened: 'Открытий магазина/поддержки',
  product_viewed: 'Просмотров товара',
  checkout_started: 'Оформлений покупки начато',
  checkout_completed: 'Покупок завершено',
  purchase_failed: 'Покупок с ошибкой',
  day_1_return: 'Возвраты день 1',
  day_7_return: 'Возвраты день 7',
};

function eventLabel(name: string): string {
  return EVENT_LABEL[name] ?? name;
}

export function AdminPanel({ onClose }: AdminPanelProps) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAdminOverview().then((res) => {
      if (cancelled) return;
      setData(res);
      setFailed(res === null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const eventRows = data ? Object.entries(data.eventCounts).sort((a, b) => b[1] - a[1]) : [];
  const activation =
    data && data.breedFunnel.firstBreedStarted > 0
      ? Math.round((data.breedFunnel.firstBreedCompleted / data.breedFunnel.firstBreedStarted) * 100)
      : null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Admin: обзор беты</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {loading && <p className="sheet-empty">Загружаем…</p>}
        {!loading && failed && (
          <p className="sheet-empty">Не удалось загрузить данные (нет доступа или облако недоступно).</p>
        )}

        {!loading && data && (
          <>
            <div className="admin-stat-grid">
              <div className="admin-stat">
                <div className="admin-stat-value">{data.totalProfiles}</div>
                <div className="admin-stat-label">Аккаунтов всего</div>
              </div>
              <div className="admin-stat">
                <div className="admin-stat-value">{data.totalGardens}</div>
                <div className="admin-stat-label">Садов создано</div>
              </div>
              <div className="admin-stat">
                <div className="admin-stat-value">{data.day1Returns}</div>
                <div className="admin-stat-label">Вернулись на день 1</div>
              </div>
              <div className="admin-stat">
                <div className="admin-stat-value">{data.day7Returns}</div>
                <div className="admin-stat-label">Вернулись на день 7</div>
              </div>
            </div>

            <div className="social-section">
              <h3 className="social-section-title">Воронка первого скрещивания</h3>
              <p className="sheet-empty admin-funnel-line">
                Начали: {data.breedFunnel.firstBreedStarted} → Завершили:{' '}
                {data.breedFunnel.firstBreedCompleted}
                {activation !== null && ` (${activation}%)`}. Всего скрещиваний: {data.breedFunnel.breedCompleted}.
              </p>
            </div>

            <div className="social-section">
              <h3 className="social-section-title">Подарки</h3>
              <p className="sheet-empty admin-funnel-line">
                Отправлено: {data.giftsSent}, получено: {data.giftsClaimed}
              </p>
            </div>

            <div className="social-section">
              <h3 className="social-section-title">Покупки</h3>
              <p className="sheet-empty admin-funnel-line">
                Всего: {data.purchases.total}, успешно: {data.purchases.completed}, с ошибкой:{' '}
                {data.purchases.failed}. Выручка: {formatPrice(data.purchases.revenueCents)}.
              </p>
              {Object.keys(data.purchases.byProduct).length > 0 && (
                <div className="social-gift-list">
                  {Object.entries(data.purchases.byProduct).map(([productId, stat]) => (
                    <div className="admin-event-row" key={productId}>
                      <span>{productId}</span>
                      <span>
                        {stat.count} шт. · {formatPrice(stat.revenueCents)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="social-section">
              <h3 className="social-section-title">Все события</h3>
              {eventRows.length === 0 ? (
                <p className="sheet-empty">Событий ещё нет</p>
              ) : (
                <div className="social-gift-list">
                  {eventRows.map(([name, count]) => (
                    <div className="admin-event-row" key={name}>
                      <span>{eventLabel(name)}</span>
                      <span>{count}</span>
                    </div>
                  ))}
                </div>
              )}
              {data.eventsSampleTruncated && (
                <p className="admin-truncated-note">
                  Показана выборка последних событий (лимит выгрузки достигнут) — счётчики приблизительные.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
