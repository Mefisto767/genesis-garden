import type { GameState } from '../game/types';
import { gameStore } from '../game/store';
import { gardenEvents } from '../game/events';
import { rarityOf, mutationName } from '../game/genetics';
import { SpecimenThumbnail } from './SpecimenThumbnail';
import { RARITY_LABEL } from '../game/specimenRender';
import { BREEDING_CONFIG } from '../game/config';

interface AlbumPanelProps {
  specimens: GameState['specimens'];
  geneticDust: number;
  onClose: () => void;
}

export function AlbumPanel({ specimens, geneticDust, onClose }: AlbumPanelProps) {
  // Избранное — сверху, дальше по дате (новые первыми).
  const sorted = [...specimens].sort((a, b) => {
    if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
    return b.createdAt - a.createdAt;
  });

  function recycle(id: string) {
    const outcome = gameStore.recycleSpecimen(id);
    if (outcome === 'favorite') {
      gardenEvents.emit('toast', { text: 'В избранном — сними звезду, чтобы переработать' });
      return;
    }
    if (outcome !== null) gardenEvents.emit('toast', { text: `Переработано: +${outcome} пыли` });
  }

  function toggleFavorite(id: string) {
    gameStore.toggleFavorite(id);
  }

  async function share(rarity: string, mutation: string | null) {
    const text = mutation
      ? `Смотри, какое растение я вырастил в Genesis Garden: ${rarity}, мутация «${mutation}»! 🌱`
      : `Смотри, какое растение я вырастил в Genesis Garden: ${rarity}! 🌱`;
    // Честная оговорка (Этап 5): без Supabase (Этап 6) шарить можно только
    // текстовым описанием — публичной картинки/ссылки на профиль пока нет,
    // это задел под Этап 6 (социальный обмен).
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch {
      // пользователь отменил системный шаринг — тихо откатываемся к копированию
    }
    try {
      await navigator.clipboard.writeText(text);
      gardenEvents.emit('toast', { text: 'Текст скопирован в буфер обмена' });
    } catch {
      gardenEvents.emit('toast', { text: 'Не удалось поделиться — попробуй скопировать вручную' });
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Альбом коллекции</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="album-dust">
          Генетическая пыль: {geneticDust}
          <img className="coin-icon coin-icon-sm" src="assets/ui/icon_dust.png" alt="пыльца" />
        </div>
        {sorted.length === 0 ? (
          <div className="sheet-empty-block sheet-empty-centered">
            <img className="mascot-img" src="assets/ui/mascot_neutral.png" alt="" />
            <p className="sheet-empty">Коллекция пуста. Скрести первую пару в лаборатории.</p>
          </div>
        ) : (
          <div className="album-grid">
            {sorted.map((s) => {
              const rarity = rarityOf(s.genome);
              const mutation = mutationName(s.genome.mutationId);
              return (
                <div className="album-card" key={s.id}>
                  <button
                    type="button"
                    className={`album-card-favorite ${s.favorite ? 'is-favorite' : ''}`}
                    onClick={() => toggleFavorite(s.id)}
                    aria-label={s.favorite ? 'Убрать из избранного' : 'Добавить в избранное'}
                    aria-pressed={!!s.favorite}
                  >
                    {s.favorite ? '★' : '☆'}
                  </button>
                  <SpecimenThumbnail genome={s.genome} size={88} />
                  <div className={`album-card-rarity rarity-${rarity}`}>{RARITY_LABEL[rarity]}</div>
                  {mutation && <div className="album-card-mutation">✦ {mutation}</div>}
                  <div className="album-card-actions">
                    <button className="album-card-sell" onClick={() => recycle(s.id)}>
                      Переработать · {BREEDING_CONFIG.recycleDustReward}
                      <img className="coin-icon coin-icon-sm" src="assets/ui/icon_dust.png" alt="пыли" />
                    </button>
                    <button className="album-card-share" onClick={() => share(RARITY_LABEL[rarity], mutation)}>
                      Поделиться
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
