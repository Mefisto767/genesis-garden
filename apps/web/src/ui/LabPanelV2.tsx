import { useState } from 'react';
import type { GameState } from '../game/types';
import { gameStore, type BreedNurseryV2RejectionReason } from '../game/store';
import { NURSERY_TRAY_CAPACITY, nurseryTrayLabel, nurseryTrayFullHint } from '../game/nurseryV2';
import { breedCostV2 } from '../game/pollenV2';
import { recycleNoticeLines, type RecycleNoticeLines } from '../game/recyclingV2';
import { isSpeciesUnlockedV2, COLOKOLNIK_LOCKED_TEXT_V2 } from '../game/labV2';
import { isSupportedParentSpeciesV2 } from '../game/inheritanceV2';
import { SpecimenThumbnail } from './SpecimenThumbnail';

/**
 * Genetics V2 — Slice 5 minimal UI (contract §4.8, delta doc §0.7 п.11),
 * расширено Slice 6 пыльцевой экономикой (contract §4.9.5, delta doc §0.8
 * п.7), Slice 7 переработкой Nursery Tray (contract §4.10.5, delta doc §0.9
 * п.6), Slice 8 гейтом Колокольника (contract §4.11.5, delta doc §0.10 п.6)
 * и Slice 9 межвидовым V2-скрещиванием (contract §4.12.5, delta doc §0.11
 * п.6): текущий баланс пыльцы, "Первое скрещивание: бесплатно" до первого
 * успеха, стоимость выбранной операции после (8 одновидовое / 12 межвидовое),
 * дословный текст при недостатке пыльцы, disabled кнопка платного
 * скрещивания при недостатке, явные подписанные слоты «Первый родитель»/
 * «Второй родитель» (Seed/Pollen Parent, в порядке выбора), список семян
 * Nursery Tray с действием "Переработать" (двухшаговое подтверждение перед
 * удалением).
 *
 * Отдельный компонент для Overhaul+V2 (GENETICS_V2_ENABLED) — НЕ замена
 * `LabPanel.tsx`, который остаётся нетронутым для Classic/Overhaul+Legacy
 * (owner decision, "не трогать существующий LabPanel/PlantPicker").
 *
 * Показывает ровно то, что решено в Slice 5-9: счётчик Питомника (X/8),
 * выбор двух родителей с уже существующим `genomeV2` (включая межвидовые пары
 * 1×2/2×1 после Lab L2, Slice 9), стоимость/бесплатность и кнопку
 * скрещивания. После успешного `breedNurseryV2` — только факт «гибридное
 * семя появилось», БЕЗ генома/фенотипа нового семени (contract §4.8.7, delta
 * doc §0.7 п.11: "геном/фенотип не показывается до созревания") — то же
 * самое верно и для семян в списке переработки ниже: только безопасный
 * номер, никогда геном/фенотип/редкость/размер будущей награды. Учебная
 * подсказка про роль первого/второго родителя (Slice 12, полный онбординг) —
 * вне этого slice, здесь только простые подписи слотов. Микроскоп — отдельный
 * `MicroscopePanel`, не этот компонент.
 *
 * Slice 11 (contract §4.13.3): список кандидатов дополнительно фильтруется
 * через `isSupportedParentSpeciesV2` — species 3-8 полностью исключаются из
 * `specimen-grid` (не показываются ни активной, ни заблокированной
 * карточкой). Species 2 (Колокольник) до Lab L2 остаётся в списке —
 * заблокированной карточкой через уже существующий `isSpeciesUnlockedV2`
 * (Slice 8) — два независимых механизма, не путаются друг с другом.
 */

interface LabPanelV2Props {
  specimens: GameState['specimens'];
  nurseryTray: GameState['nurseryTray'];
  pollen: number;
  firstBreedFreeClaimed: boolean;
  /** Genetics V2 — Slice 8 (contract §4.11.2): нужен, чтобы показать
   * Колокольник-специмены заблокированными до открытия Lab L2 (не только
   * store-level defence-in-depth, но и понятная визуальная причина). */
  labLevel: number;
  onClose: () => void;
}

const REJECTION_MESSAGE: Record<BreedNurseryV2RejectionReason, string> = {
  same_parent: 'Нужны две разные особи.',
  parent_not_found: 'Один из родителей не найден.',
  parent_missing_genome_v2: 'У одного из родителей нет диплоидного генома.',
  species_locked: COLOKOLNIK_LOCKED_TEXT_V2,
  nursery_tray_full: 'Питомник заполнен — сначала посади или переработай семя.',
  unsupported_species: 'Этот вид пока не поддерживает V2-скрещивание.',
  insufficient_pollen: '', // текст строится из requiredPollen/availablePollen на месте, см. doBreed/costLabel ниже.
};

export function LabPanelV2({ specimens, nurseryTray, pollen, firstBreedFreeClaimed, labLevel, onClose }: LabPanelV2Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // Genetics V2 — Slice 7 UI-фикс (defect report bug 2): структурированный
  // результат переработки (`dustGained`), НЕ собранная строка — рендерится
  // как два отдельных DOM-элемента ниже, без объединяющей пунктуации.
  const [recycleNotice, setRecycleNotice] = useState<RecycleNoticeLines | null>(null);
  // Genetics V2 — Slice 7 (contract §4.10.5): id семени, для которого сейчас
  // показан двухшаговый экран подтверждения переработки ("Да, переработать" /
  // "Отмена"). Отмена сбрасывает это состояние без вызова store —
  // `recycleNurserySeedV2` не вызывается вообще, полный no-op на уровне UI
  // (тот же принцип, что отмена скрещивания, §4.9.3).
  const [pendingRecycleSeedId, setPendingRecycleSeedId] = useState<string | null>(null);

  // Genetics V2 — Slice 11 (contract §4.13.3): дополнительный фильтр по
  // isSupportedParentSpeciesV2 поверх уже существующего фильтра genomeV2 —
  // species 3-8 полностью исчезают из списка лаборатории (не рендерятся ни
  // активной, ни is-locked карточкой). Species 2 до Lab L2 остаётся в списке
  // (уже поддерживаемый вид) и продолжает рендериться заблокированной
  // карточкой ниже через isCandidateLocked/isSpeciesUnlockedV2 (Slice 8, без
  // изменений) — два независимых, не путаемых состояния.
  const candidates = specimens.filter(
    (s) => !!s.genomeV2 && isSupportedParentSpeciesV2(s.genomeV2.speciesId)
  );

  function isCandidateLocked(id: string): boolean {
    const s = candidates.find((c) => c.id === id);
    return !!s && !!s.genomeV2 && !isSpeciesUnlockedV2(s.genomeV2.speciesId, labLevel);
  }
  const trayFull = nurseryTray.length >= NURSERY_TRAY_CAPACITY;

  function toggle(id: string) {
    // Genetics V2 — Slice 8 (contract §4.11.2): заблокированный до Lab L2
    // Колокольник-специмен нельзя выбрать как V2-родителя — клик по
    // заблокированной карточке полностью игнорируется (тот же принцип, что
    // `renderHybridPlotCellReadOnly` в EstateScene: заблокированный вариант
    // виден, но не имеет эффекта). Store-level `species_locked`
    // (`breedNurseryV2`) остаётся обязательным защитным слоем независимо от
    // этой UI-проверки (defense-in-depth).
    if (isCandidateLocked(id)) return;
    setNotice(null);
    setRecycleNotice(null);
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  const selectedSpecimens = selected
    .map((id) => candidates.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s && !!s.genomeV2);
  // Стоимость выбранной пары (contract §4.9.5/§4.12) — 0, пока бесплатная
  // первая попытка ещё не использована; иначе `breedCostV2` по видам
  // выбранной пары (8 одновидовое; 12 межвидовое — со Slice 9 достижимо и в
  // проде, не только в unit-тестах самой функции).
  const selectedCost =
    !firstBreedFreeClaimed || selectedSpecimens.length !== 2
      ? 0
      : breedCostV2(selectedSpecimens[0]!.genomeV2!.speciesId, selectedSpecimens[1]!.genomeV2!.speciesId);
  const insufficientForSelection = firstBreedFreeClaimed && selected.length === 2 && pollen < selectedCost;

  function doBreed() {
    if (selected.length !== 2) return;
    setRecycleNotice(null);
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

  function recycleSeed(id: string) {
    const result = gameStore.recycleNurserySeedV2(id);
    setPendingRecycleSeedId(null);
    if (result.ok) {
      // Structured result straight from the store — no string built then
      // parsed apart (defect report bug 2).
      setNotice(null);
      setRecycleNotice(recycleNoticeLines(result.dustGained));
    }
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
        {/* Slice 7 UI-фикс (defect report bug 1): подсказка при заполненном
            питомнике — ОТДЕЛЬНЫЙ элемент, не дописанная в тот же элемент, что
            и точный текст "Питомник заполнен: 8/8" выше. */}
        {trayFull && <p className="sheet-empty lab-hint">{nurseryTrayFullHint(nurseryTray.length, NURSERY_TRAY_CAPACITY)}</p>}

        <div className="album-dust">Пыльца: {pollen}</div>

        {/* Genetics V2 — Slice 9 (contract §4.12): явные подписанные слоты
            выбора родителей — первый выбранный specimen — Seed Parent
            (задаёт вид/rig потомка), второй — Pollen Parent. Обновляются
            реактивно из `selected`/`selectedSpecimens` — та же механика
            выбора (`toggle()`), никакого отдельного состояния слотов. */}
        <div className="lab-parent-slots">
          <div className="sheet-row">
            <div className="sheet-row-title">Первый родитель</div>
            <div className="sheet-row-count">
              {selectedSpecimens[0] ? (
                <SpecimenThumbnail genome={selectedSpecimens[0].genome} size={48} />
              ) : (
                'не выбран'
              )}
            </div>
          </div>
          <div className="sheet-row">
            <div className="sheet-row-title">Второй родитель</div>
            <div className="sheet-row-count">
              {selectedSpecimens[1] ? (
                <SpecimenThumbnail genome={selectedSpecimens[1].genome} size={48} />
              ) : (
                'не выбран'
              )}
            </div>
          </div>
        </div>

        {notice && <p className="sheet-empty lab-hint">{notice}</p>}
        {/* Slice 7 UI-фикс (defect report bug 2): два отдельных элемента, без
            объединяющей пунктуации (не " · "), из структурированного
            RecycleNoticeLines. */}
        {recycleNotice && (
          <>
            <p className="sheet-empty lab-hint">{recycleNotice.primary}</p>
            <p className="sheet-empty lab-hint">{recycleNotice.secondary}</p>
          </>
        )}

        {candidates.length < 2 ? (
          <div className="sheet-empty-block sheet-empty-centered">
            {/* Slice 11 (contract §4.13.3): точный текст — candidates уже
                отфильтрован и по genomeV2, и по isSupportedParentSpeciesV2,
                так что прежний общий текст про "диплоидный геном" избыточен. */}
            <p className="sheet-empty">Нужно как минимум две особи поддерживаемых видов.</p>
          </div>
        ) : (
          <div className="specimen-grid">
            {candidates.map((s) => {
              const isSelected = selected.includes(s.id);
              const isLocked = isCandidateLocked(s.id);
              return (
                <button
                  key={s.id}
                  className={`specimen-card ${isSelected ? 'is-selected' : ''} ${isLocked ? 'is-locked' : ''}`}
                  onClick={() => toggle(s.id)}
                  title={isLocked ? COLOKOLNIK_LOCKED_TEXT_V2 : undefined}
                  aria-disabled={isLocked}
                >
                  <SpecimenThumbnail genome={s.genome} size={72} />
                  {isLocked && <span className="specimen-card-locked">🔒</span>}
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

        {nurseryTray.length > 0 && (
          <div className="sheet-list">
            <p className="sheet-empty lab-hint">Питомник — можно переработать в генетическую пыль:</p>
            {nurseryTray.map((seed, i) => (
              <div className="sheet-row" key={seed.id}>
                <div className="sheet-row-title">Семя №{i + 1}</div>
                {pendingRecycleSeedId === seed.id ? (
                  <div className="sheet-row-count">
                    <button className="album-card-sell" onClick={() => recycleSeed(seed.id)}>
                      Да, переработать
                    </button>
                    <button className="album-card-share" onClick={() => setPendingRecycleSeedId(null)}>
                      Отмена
                    </button>
                  </div>
                ) : (
                  <button className="album-card-sell" onClick={() => setPendingRecycleSeedId(seed.id)}>
                    Переработать
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
