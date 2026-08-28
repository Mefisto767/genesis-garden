import { SEED_CATALOG, seedThumb } from '../game/seedCatalog';
import { gameStore } from '../game/store';
import { gardenEvents } from '../game/events';
import { track } from '../analytics/track';
import { isSpeciesUnlockedV2, COLOKOLNIK_LOCKED_TEXT_V2 } from '../game/labV2';

/**
 * Genetics V2 — Slice 8 minimal UI (contract §4.11.2, delta doc §0.10):
 * отдельный от legacy `ShopPanel.tsx` магазин для Overhaul+V2
 * (GENETICS_V2_ENABLED) — тот же список `SEED_CATALOG`, тот же `buyCost`/
 * `sellValue`/тайминги, но покупка идёт через `gameStore.buySeedV2()`
 * (owner decision: не менять общий `ShopPanel`/`buySeed`, чтобы не задеть
 * Classic/Overhaul+Legacy поведение). Единственное отличие от legacy —
 * Колокольник (`speciesId:2`) до открытия Lab L2 показан ЗАБЛОКИРОВАННЫМ
 * вариантом с точным текстом (contract §4.11.2), кнопка покупки недоступна.
 * После открытия L2 ряд Колокольника неотличим от обычного.
 */

interface ShopPanelV2Props {
  coins: number;
  labLevel: number;
  onClose: () => void;
}

export function ShopPanelV2({ coins, labLevel, onClose }: ShopPanelV2Props) {
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
          {SEED_CATALOG.map((seed) => {
            const unlocked = isSpeciesUnlockedV2(seed.speciesId, labLevel);
            return (
              <div className={`sheet-row ${unlocked ? '' : 'is-locked'}`} key={seed.id}>
                <div className="sheet-row-info">
                  <img className="sheet-thumb" src={seedThumb(seed)} alt="" />
                  <div>
                    <div className="sheet-row-title">{seed.name}</div>
                    {unlocked ? (
                      <div className="sheet-row-sub">
                        рост: {formatGrow(seed.growMs)} · продажа: {seed.sellValue}
                        <img className="coin-icon coin-icon-sm" src="assets/ui/icon_coin.png" alt="монет" />
                      </div>
                    ) : (
                      <div className="sheet-row-sub">{COLOKOLNIK_LOCKED_TEXT_V2}</div>
                    )}
                  </div>
                </div>
                <button
                  className="sheet-buy-btn"
                  disabled={!unlocked || coins < seed.buyCost}
                  onClick={() => {
                    const result = gameStore.buySeedV2(seed.id, 1);
                    if (!result.ok) {
                      gardenEvents.emit('toast', {
                        text: result.reason === 'species_locked' ? COLOKOLNIK_LOCKED_TEXT_V2 : 'Не хватает монет',
                      });
                    } else {
                      gardenEvents.emit('toast', { text: `Куплено: ${seed.name}` });
                      track('seed_bought', { seedId: seed.id, cost: seed.buyCost });
                    }
                  }}
                >
                  {seed.buyCost}
                  <img className="coin-icon coin-icon-sm" src="assets/ui/icon_coin.png" alt="монет" />
                </button>
              </div>
            );
          })}
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
