import { SEED_CATALOG, seedThumb } from '../game/seedCatalog';
import { gameStore } from '../game/store';
import { gardenEvents } from '../game/events';

interface ShopPanelProps {
  coins: number;
  onClose: () => void;
}

export function ShopPanel({ coins, onClose }: ShopPanelProps) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Магазин семян</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="sheet-list">
          {SEED_CATALOG.map((seed) => (
            <div className="sheet-row" key={seed.id}>
              <div className="sheet-row-info">
                <img className="sheet-thumb" src={seedThumb(seed)} alt="" />
                <div>
                  <div className="sheet-row-title">{seed.name}</div>
                  <div className="sheet-row-sub">
                    рост: {formatGrow(seed.growMs)} · продажа: {seed.sellValue}
                    <img className="coin-icon coin-icon-sm" src="assets/ui/icon_coin.png" alt="монет" />
                  </div>
                </div>
              </div>
              <button
                className="sheet-buy-btn"
                disabled={coins < seed.buyCost}
                onClick={() => {
                  const ok = gameStore.buySeed(seed.id, 1);
                  if (!ok) gardenEvents.emit('toast', { text: 'Не хватает монет' });
                  else gardenEvents.emit('toast', { text: `Куплено: ${seed.name}` });
                }}
              >
                {seed.buyCost}
                <img className="coin-icon coin-icon-sm" src="assets/ui/icon_coin.png" alt="монет" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatGrow(ms: number): string {
  const min = ms / 60000;
  if (min < 1) return `${Math.round(ms / 1000)} сек`;
  if (min < 60) return `${Math.round(min)} мин`;
  return `${Math.round((min / 60) * 10) / 10} ч`;
}
