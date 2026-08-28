import { useState } from 'react';
import type { GameState } from '../game/types';
import { gameStore, type BreedNurseryV2RejectionReason } from '../game/store';
import { NURSERY_TRAY_CAPACITY, nurseryTrayLabel } from '../game/nurseryV2';
import { breedCostV2 } from '../game/pollenV2';
import { SpecimenThumbnail } from './SpecimenThumbnail';

/**
 * Genetics V2 — Slice 5 minimal UI (contract §4.8, delta doc §0.7 п.11),
 * расширено Slice 6 пыльцевой экономикой (contract §4.9.5, delta doc §0.8
 * п.7): текущий баланс пыльцы, "Первое скрещивание: бесплатно" до первого
 * успеха, стоимость выбранной операции после, дословный текст при недостатке
 * пыльцы, disabled кнопка платного скрещивания при недостатке.
 *
 * Отдельный компонент для Overhaul+V2 (GENETICS_V2_ENABLED) — НЕ замена
 * `LabPanel.tsx`, который остаётся нетронутым для Classic/Overhaul+Legacy
 * (owner decision, "не трогать существующий LabPanel/PlantPicker").
 *
 * Показывает ровно то, что решено в Slice 5+6: счётчик Питомника (X/8),
 * выбор двух родителей с уже существующим `genomeV2`, стоимость/бесплатность
 * и кнопку скрещивания. После успешного `breedNurseryV2` — только факт
 * «гибридное семя появилось», БЕЗ генома/фенотипа нового семени (contract
 * §4.8.7, delta doc §0.7 п.11: "геном/фенотип не показывается до
 * созревания"). Переработка/микроскоп/межвидовое скрещивание/учебные флаги
 * (кроме `firstBreedFreeClaimed`) — вне Slice 6 (Slice 7/8/9).
 */

interface LabPanelV2Props {
  specimens: GameState['specimens'];
  nurseryTray: GameState['nurseryTray'];
  pollen: number;
  firstBreedFreeClaimed: boolean;
  onClose: () => void;
}

const REJECTION_MESSAGE: Record<BreedNurseryV2RejectionReason, string> = {
  same_parent: 'Нужны две разные особи.',
  parent_not_found: 'Один из родителей не найден.',
  parent_missing_genome_v2: 'У одного из родителей нет диплоидного генома.',
  nursery_tray_full: 'Питомник заполнен — сначала посади или дождись места.',
  unsupported_species: 'Этот вид пока не поддерживает V2-скрещивание.',
  interspecies_locked: 'Скрещивание между разными видами пока закрыто.',
  insufficient_pollen: '', // текст строится из requiredPollen/availablePollen на месте, см. doBreed/costLabel ниже.
};

export function LabPanelV2({ specimens, nurseryTray, pollen, firstBreedFreeClaimed, onClose }: LabPanelV2Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const candidates = specimens.filter((s) => !!s.genomeV2);
  const trayFull = nurseryTray.length >= NURSERY_TRAY_CAPACITY;

  function toggle(id: string) {
    setNotice(null);
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  const selectedSpecimens = selected
    .map((id) => candidates.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s && !!s.genomeV2);
  // Стоимость выбранной пары (contract §4.9.5) — 0, пока бесплатная первая
  // попытка ещё не использована; иначе `breedCostV2` по видам выбранной
  // пары (8 одновидовое; 12 межвидовое — недостижимо в проде до Slice 9,
  // но UI честно показывает цифру, если игрок такую пару всё же выберет,
  // отказ придёт как `interspecies_locked`, не как денежная ошибка).
  const selectedCost =
    !firstBreedFreeClaimed || selectedSpecimens.length !== 2
      ? 0
      : breedCostV2(selectedSpecimens[0]!.genomeV2!.speciesId, selectedSpecimens[1]!.genomeV2!.speciesId);
  const insufficientForSelection = firstBreedFreeClaimed && selected.length === 2 && pollen < selectedCost;

  function doBreed() {
    if (selected.length !== 2) return;
    const result = gameStore.breedNurseryV2(selected[0], selected[1]);
    if (!result.ok) {
      if (result.reason === 'insufficient_pollen') {
        setNotice(`Не хватает пыльцы: нужно ${result.requiredPollen}, есть ${result.availablePollen}`);
      } else {
        setNotice(REJECTION_MESSAGE[result.reason]);
      }
      return;
    }
    // Намеренно НЕ показываем result.hybridSeed.genomeV2 — только факт.
    setNotice('Гибридное семя появилось в Питомнике! Посади его на грядку, чтобы увидеть, каким оно вырастет.');
    setSelected([]);
  }

  const canBreed = selected.length === 2 && !trayFull && !insufficientForSelection;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Лаборатория — V2 скрещивание</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="sheet-empty lab-hint">
          Выбери двух особей с диплоидным геномом, чтобы скрестить их. Родители остаются в коллекции.
        </p>

        <div className={trayFull ? 'lab-gene-lock-warning' : 'album-dust'}>
          {nurseryTrayLabel(nurseryTray.length, NURSERY_TRAY_CAPACITY)}
        </div>

        <div className="album-dust">Пыльца: {pollen}</div>

        {notice && <p className="sheet-empty lab-hint">{notice}</p>}

        {candidates.length < 2 ? (
          <div className="sheet-empty-block sheet-empty-centered">
            <p className="sheet-empty">Нужно как минимум две особи с диплоидным геномом.</p>
          </div>
        ) : (
          <div className="specimen-grid">
            {candidates.map((s) => {
              const isSelected = selected.includes(s.id);
              return (
                <button
                  key={s.id}
                  className={`specimen-card ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => toggle(s.id)}
                >
                  <SpecimenThumbnail genome={s.genome} size={72} />
                  {s.favorite && <span className="specimen-card-favorite">★</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="lab-footer">
          <div className="lab-footer-cost">
            {!firstBreedFreeClaimed
              ? 'Первое скрещивание: бесплатно'
              : selected.length !== 2
                ? 'Выбери двух родителей, чтобы увидеть стоимость'
                : insufficientForSelection
                  ? `Не хватает пыльцы: нужно ${selectedCost}, есть ${pollen}`
                  : `Стоимость: ${selectedCost} пыльцы`}
          </div>
          <button className="sheet-buy-btn" disabled={!canBreed} onClick={doBreed}>
            Скрестить
          </button>
        </div>
      </div>
    </div>
  );
}
