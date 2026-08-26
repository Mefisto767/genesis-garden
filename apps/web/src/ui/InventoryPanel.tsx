import { SEED_CATALOG } from '../game/seedCatalog';
import type { GameState } from '../game/types';

interface InventoryPanelProps {
  inventory: GameState['inventory'];
  onClose: () => void;
}

export function InventoryPanel({ inventory, onClose }: InventoryPanelProps) {
  const owned = SEED_CATALOG.filter((seed) => (inventory[seed.id] ?? 0) > 0);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Инвентарь</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>
        {owned.length === 0 ? (
          <p className="sheet-empty">Пока пусто. Загляни в магазин за семенами.</p>
        ) : (
          <div className="sheet-list">
            {owned.map((seed) => (
              <div className="sheet-row" key={seed.id}>
                <div className="sheet-row-info">
                  <span className="sheet-row-emoji">{seed.emoji}</span>
                  <div className="sheet-row-title">{seed.name}</div>
                </div>
                <div className="sheet-row-count">×{inventory[seed.id]}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
