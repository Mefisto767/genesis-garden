import type { GameState } from '../game/types';
import { gameStore } from '../game/store';
import { gardenEvents } from '../game/events';
import { rarityOf, mutationName } from '../game/genetics';
import { SpecimenThumbnail } from './SpecimenThumbnail';
import { RARITY_LABEL } from '../game/specimenRender';

interface AlbumPanelProps {
  specimens: GameState['specimens'];
  geneticDust: number;
  onClose: () => void;
}

export function AlbumPanel({ specimens, geneticDust, onClose }: AlbumPanelProps) {
  const sorted = [...specimens].sort((a, b) => b.createdAt - a.createdAt);

  function sell(id: string) {
    const ok = gameStore.sellSpecimen(id);
    if (ok) gardenEvents.emit('toast', { text: 'Продано за 15' });
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
                  <SpecimenThumbnail genome={s.genome} size={88} />
                  <div className={`album-card-rarity rarity-${rarity}`}>{RARITY_LABEL[rarity]}</div>
                  {mutation && <div className="album-card-mutation">✦ {mutation}</div>}
                  <button className="album-card-sell" onClick={() => sell(s.id)}>
                    Продать · 15
                    <img className="coin-icon coin-icon-sm" src="assets/ui/icon_coin.png" alt="монет" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
