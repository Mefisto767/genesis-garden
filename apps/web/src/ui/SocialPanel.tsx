import { useEffect, useState } from 'react';
import { gameApi } from '../sync/gameApi';
import { gardenEvents } from '../game/events';
import {
  fetchOwnPublicCode,
  fetchPendingGifts,
  fetchRecentContacts,
  fetchBlockedUsers,
  type PendingGift,
  type BlockedContact,
} from '../sync/social';
import { track } from '../analytics/track';

interface SocialPanelProps {
  onClose: () => void;
}

/** Переводит серверные RAISE EXCEPTION-коды в понятный игроку текст (см. supabase/migrations/20260827140000_social_stage6.sql). */
const ERROR_LABELS: Record<string, string> = {
  recipient_not_found: 'Игрок с таким кодом не найден',
  cannot_gift_self: 'Нельзя подарить самому себе',
  gift_blocked: 'Обмен с этим игроком закрыт (блокировка)',
  account_too_new: 'Аккаунт ещё слишком новый для подарков — попробуй чуть позже',
  daily_gift_limit_reached: 'Дневной лимит подарков исчерпан — попробуй завтра',
  insufficient_dust: 'Не хватает пыли',
  cannot_block_self: 'Нельзя заблокировать самого себя',
  supabase_not_configured: 'Облако сейчас недоступно',
};

function friendlyError(raw: string | undefined): string {
  if (!raw) return 'Не получилось выполнить действие';
  return ERROR_LABELS[raw] ?? raw;
}

const ITEM_LABEL: Record<string, string> = {
  dust: 'пыль',
  plant: 'растение',
  pollen: 'пыльца',
  cutting: 'черенок',
};

export function SocialPanel({ onClose }: SocialPanelProps) {
  const [ownCode, setOwnCode] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingGift[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<BlockedContact[]>([]);
  const [loading, setLoading] = useState(true);

  const [recipientCode, setRecipientCode] = useState('');
  const [dustAmount, setDustAmount] = useState(5);
  const [sending, setSending] = useState(false);

  async function refresh() {
    setLoading(true);
    const [code, gifts, contacts, blockedList] = await Promise.all([
      fetchOwnPublicCode(),
      fetchPendingGifts(),
      fetchRecentContacts(),
      fetchBlockedUsers(),
    ]);
    setOwnCode(code);
    setPending(gifts);
    setRecent(contacts);
    setBlocked(blockedList);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copyCode() {
    if (!ownCode) return;
    try {
      await navigator.clipboard.writeText(ownCode);
      gardenEvents.emit('toast', { text: 'Код скопирован' });
    } catch {
      gardenEvents.emit('toast', { text: `Твой код: ${ownCode}` });
    }
  }

  async function sendDustGift() {
    const code = recipientCode.trim();
    if (!code || dustAmount <= 0) return;
    setSending(true);
    const result = await gameApi.sendGift(code, 'dust', { amount: dustAmount });
    setSending(false);
    if (result.ok) {
      gardenEvents.emit('toast', { text: 'Подарок отправлен' });
      track('gift_sent', { itemType: 'dust', amount: dustAmount });
      setRecipientCode('');
      refresh();
    } else {
      gardenEvents.emit('toast', { text: friendlyError(result.errorMessage) });
    }
  }

  async function acceptGift(giftId: string) {
    const result = await gameApi.claimGift(giftId);
    if (result.ok) {
      gardenEvents.emit('toast', { text: 'Подарок получен' });
      track('gift_claimed', { giftId });
      refresh();
    } else {
      gardenEvents.emit('toast', { text: friendlyError(result.errorMessage) });
    }
  }

  async function declineGift(giftId: string) {
    const result = await gameApi.declineGift(giftId);
    if (result.ok) {
      gardenEvents.emit('toast', { text: 'Подарок отклонён' });
      refresh();
    } else {
      gardenEvents.emit('toast', { text: friendlyError(result.errorMessage) });
    }
  }

  async function blockContact(code: string) {
    const result = await gameApi.blockUser(code);
    if (result.ok) {
      gardenEvents.emit('toast', { text: `${code} заблокирован` });
      refresh();
    } else {
      gardenEvents.emit('toast', { text: friendlyError(result.errorMessage) });
    }
  }

  async function unblockContact(code: string) {
    const result = await gameApi.unblockUser(code);
    if (result.ok) {
      gardenEvents.emit('toast', { text: `${code} разблокирован` });
      refresh();
    } else {
      gardenEvents.emit('toast', { text: friendlyError(result.errorMessage) });
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Друзья</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {loading ? (
          <p className="sheet-empty">Загружаем…</p>
        ) : (
          <>
            <div className="social-own-code">
              <span>Твой код: {ownCode ?? '—'}</span>
              {ownCode && (
                <button className="social-copy-btn" onClick={copyCode}>
                  Скопировать
                </button>
              )}
            </div>

            <div className="social-section">
              <h3 className="social-section-title">Подарить пыль</h3>
              <div className="social-send-form">
                <input
                  className="social-input"
                  placeholder="код друга"
                  value={recipientCode}
                  onChange={(e) => setRecipientCode(e.target.value.toUpperCase())}
                />
                <input
                  className="social-input social-input-amount"
                  type="number"
                  min={1}
                  value={dustAmount}
                  onChange={(e) => setDustAmount(Math.max(1, Number(e.target.value) || 1))}
                />
                <button
                  className="sheet-buy-btn"
                  disabled={sending || !recipientCode.trim()}
                  onClick={sendDustGift}
                >
                  Подарить
                </button>
              </div>
              {recent.length > 0 && (
                <div className="social-recent">
                  {recent.map((code) => (
                    <button key={code} className="social-recent-chip" onClick={() => setRecipientCode(code)}>
                      {code}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="social-section">
              <h3 className="social-section-title">Входящие подарки</h3>
              {pending.length === 0 ? (
                <p className="sheet-empty">Пока пусто</p>
              ) : (
                <div className="social-gift-list">
                  {pending.map((gift) => (
                    <div className="social-gift-row" key={gift.id}>
                      <span>
                        {gift.senderPublicCode ?? '?'} дарит {ITEM_LABEL[gift.itemType] ?? gift.itemType}
                        {gift.itemType === 'dust' && `: ${gift.itemPayload.amount}`}
                      </span>
                      <div className="social-gift-actions">
                        <button className="sheet-buy-btn" onClick={() => acceptGift(gift.id)}>
                          Принять
                        </button>
                        <button className="social-decline-btn" onClick={() => declineGift(gift.id)}>
                          Отклонить
                        </button>
                        {gift.senderPublicCode && (
                          <button className="social-decline-btn" onClick={() => blockContact(gift.senderPublicCode!)}>
                            Заблокировать
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {blocked.length > 0 && (
              <div className="social-section">
                <h3 className="social-section-title">Заблокированные</h3>
                <div className="social-recent">
                  {blocked.map((b) => (
                    <button
                      key={b.profileId}
                      className="social-recent-chip"
                      onClick={() => unblockContact(b.publicCode)}
                      title="Нажми, чтобы разблокировать"
                    >
                      {b.publicCode} ✕
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="social-hint">
              Дарить растения из коллекции пока нельзя — эта коллекция ещё живёт только на этом устройстве, серверная
              синхронизация игровых действий подключается отдельным шагом. Пылью делиться уже можно по-настоящему.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
