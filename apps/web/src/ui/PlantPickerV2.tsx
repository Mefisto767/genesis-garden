import { SEED_CATALOG, seedThumb } from '../game/seedCatalog';
import { gameStore } from '../game/store';
import type { GameState } from '../game/types';
import { gardenEvents } from '../game/events';
import { track } from '../analytics/track';
import { isSpeciesUnlockedV2, COLOKOLNIK_LOCKED_TEXT_V2 } from '../game/labV2';

/**
 * Genetics V2 — Slice 5 minimal UI (contract §4.8.2, delta doc §0.7 п.11).
 *
 * Отдельный компонент для Overhaul+V2 — воспроизводит существующий legacy-
 * список семян `PlantPicker.tsx` НЕТРОНУТЫМ (owner decision: не менять
 * ClassicApp/GardenScene/существующий PlantPicker) и добавляет второй
 * раздел — гибридные семена из Nursery Tray. Геном/фенотип гибридного семени
 * НЕ показывается здесь ни в каком виде (только порядковый номер) — раскрытие
 * происходит только через рост на грядке (contract §4.8.2/§4.8.3).
 */

interface PlantPickerV2Props {
  plotId: number;
  inventory: GameState['inventory'];
  nurseryTray: GameState['nurseryTray'];
  /** Genetics V2 — Slice 8 (contract §4.11.2): гейт посадки Колокольника из
   * инвентаря (редкий путь — семя туда могло попасть только через
   * legacy-миграцию до открытия Lab L2). */
  labLevel: number;
  onClose: () => void;
  onOpenShop: () => void;
}

export function PlantPickerV2({ plotId, inventory, nurseryTray, labLevel, onClose, onOpenShop }: PlantPickerV2Props) {
  const owned = SEED_CATALOG.filter((seed) => (inventory[seed.id] ?? 0) > 0);

  function plantHybrid(hybridId: string) {
    const result = gameStore.plantHybridSeedV2(hybridId, plotId);
    if (result.ok) {
      track('plant_planted', { plotId, seedId: 'hybrid_v2' });
      onClose();
    } else {
      gardenEvents.emit('toast', { text: 'Не получилось посадить гибридное семя' });
    }
  }

  function plantLegacy(seedId: string) {
    // Genetics V2 — Slice 8: `plantSeedV2` — та же логика `plantSeed()`, плюс
    // одна дополнительная проверка гейта Колокольника (contract §4.11.2).
    const result = gameStore.plantSeedV2(plotId, seedId);
    if (result.ok) {
      track('plant_planted', { plotId, seedId });
      onClose();
    } else {
      gardenEvents.emit('toast', {
        text: result.reason === 'species_locked' ? COLOKOLNIK_LOCKED_TEXT_V2 : 'Не получилось посадить',
      });
    }
  }

  const nothingToPlant = owned.length === 0 && nurseryTray.length === 0;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Что посадить?</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {nothingToPlant ? (
          <div className="sheet-empty-block sheet-empty-centered">
            <img className="mascot-img" src="assets/ui/mascot_neutral.png" alt="" />
            <p className="sheet-empty">Нет семян в инвентаре и пусто в Питомнике.</p>
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
          <>
            {nurseryTray.length > 0 && (
              <>
                <p className="sheet-empty lab-hint">Гибридные семена из Питомника (геном раскроется при созревании):</p>
                <div className="sheet-list">
                  {nurseryTray.map((hybrid, index) => (
                    <button
                      key={hybrid.id}
                      className="sheet-row sheet-row-clickable"
                      onClick={() => plantHybrid(hybrid.id)}
                    >
                      <div className="sheet-row-info">
                        <div className="sheet-row-title">Гибридное семя #{index + 1}</div>
                      </div>
                      <div className="sheet-row-count">Посадить</div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {owned.length > 0 && (
              <>
                <p className="sheet-empty lab-hint">Обычные семена:</p>
                <div className="sheet-list">
                  {owned.map((seed) => {
                    const unlocked = isSpeciesUnlockedV2(seed.speciesId, labLevel);
                    return (
                      <button
                        key={seed.id}
                        className={`sheet-row sheet-row-clickable ${unlocked ? '' : 'is-locked'}`}
                        disabled={!unlocked}
                        onClick={() => plantLegacy(seed.id)}
                      >
                        <div className="sheet-row-info">
                          <img className="sheet-thumb" src={seedThumb(seed)} alt="" />
                          <div>
                            <div className="sheet-row-title">{seed.name}</div>
                            {!unlocked && <div className="sheet-row-sub">{COLOKOLNIK_LOCKED_TEXT_V2}</div>}
                          </div>
                        </div>
                        <div className="sheet-row-count">×{inventory[seed.id]}</div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
