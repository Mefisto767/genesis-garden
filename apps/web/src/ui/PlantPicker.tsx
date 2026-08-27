import { SEED_CATALOG, seedThumb } from '../game/seedCatalog';
import { gameStore } from '../game/store';
import type { GameState } from '../game/types';
import { gardenEvents } from '../game/events';
import { track } from '../analytics/track';

interface PlantPickerProps {
  plotId: number;
  inventory: GameState['inventory'];
  onClose: () => void;
  onOpenShop: () => void;
}

export function PlantPicker({ plotId, inventory, onClose, onOpenShop }: PlantPickerProps) {
  const owned = SEED_CATALOG.filter((seed) => (inventory[seed.id] ?? 0) > 0);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Что посадить?</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>
        {owned.length === 0 ? (
          <div className="sheet-empty-block sheet-empty-centered">
            <img className="mascot-img" src="assets/ui/mascot_neutral.png" alt="" />
            <p className="sheet-empty">Нет семян в инвентаре.</p>
            <button
              className="sheet-buy-btn"
              onClick={() => {
                onClose();
                onOpenShop();
              }}
            >
              Открыть магазин
            </button>
          </div>
        ) : (
          <div className="sheet-list">
            {owned.map((seed) => (
              <button
                key={seed.id}
                className="sheet-row sheet-row-clickable"
                onClick={() => {
                  const ok = gameStore.plantSeed(plotId, seed.id);
                  if (ok) {
                    track('plant_planted', { plotId, seedId: seed.id });
                    onClose();
                  } else gardenEvents.emit('toast', { text: 'Не получилось посадить' });
                }}
              >
                <div className="sheet-row-info">
                  <img className="sheet-thumb" src={seedThumb(seed)} alt="" />
                  <div className="sheet-row-title">{seed.name}</div>
                </div>
                <div className="sheet-row-count">×{inventory[seed.id]}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
