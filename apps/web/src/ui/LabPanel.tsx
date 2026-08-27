import { useEffect, useRef, useState } from 'react';
import type { GameState } from '../game/types';
import { gameStore, BREED_COST, type BreedOutcome, type GeneLock } from '../game/store';
import { rarityOf, mutationName, type LockableGene } from '../game/genetics';
import { SpecimenThumbnail } from './SpecimenThumbnail';
import { RARITY_LABEL } from '../game/specimenRender';
import { BREEDING_CONFIG, GENETICS_CONFIG } from '../game/config';

interface LabPanelProps {
  specimens: GameState['specimens'];
  coins: number;
  geneticDust: number;
  pityCounter: number;
  onClose: () => void;
}

const LOCKABLE_GENE_LABELS: Record<LockableGene, string> = {
  shape: 'Форма',
  primary: 'Основной цвет',
  secondary: 'Доп. цвет',
  leaf: 'Листва',
  pattern: 'Узор',
  size: 'Размер',
  aura: 'Аура',
};

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function LabPanel({ specimens, coins, geneticDust, pityCounter, onClose }: LabPanelProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<BreedOutcome | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [lockGene, setLockGene] = useState<LockableGene | ''>('');
  const [lockSource, setLockSource] = useState<'a' | 'b'>('a');
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
  }, []);

  function toggle(id: string) {
    if (result) return; // не меняем выбор посреди показа результата
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  const lockCost = BREEDING_CONFIG.dustCostPerLockedGene;
  const wantsLock = lockGene !== '';
  const canAffordLock = geneticDust >= lockCost;

  function doBreed() {
    if (selected.length !== 2) return;
    const lock: GeneLock | undefined = wantsLock ? { gene: lockGene, source: lockSource } : undefined;
    const outcome = gameStore.breedSpecimens(selected[0], selected[1], lock);
    if (!outcome) return;
    setResult(outcome);
    setRevealed(false);
    setLockGene('');
    if (prefersReducedMotion()) {
      // Без анимации: показываем результат сразу же, без гача-паузы.
      setRevealed(true);
    } else {
      // маленькая пауза перед "вспышкой" открытия — ощущение гача-реролла;
      // rAF гарантирует, что браузер отрисует "нераскрытое" состояние карточки
      // перед стартом перехода, иначе CSS-transition может не запуститься.
      requestAnimationFrame(() => {
        revealTimer.current = setTimeout(() => setRevealed(true), 60);
      });
    }
  }

  /** Тап по карточке во время анимации — пропустить и сразу показать результат. */
  function skipReveal() {
    if (revealed) return;
    if (revealTimer.current) clearTimeout(revealTimer.current);
    setRevealed(true);
  }

  function closeResult() {
    setResult(null);
    setRevealed(false);
    setSelected([]);
  }

  /** «Скрестить ещё» — та же пара остаётся выбранной, лишний тап по коллекции не нужен. */
  function breedAgain() {
    setResult(null);
    setRevealed(false);
  }

  const canBreed = selected.length === 2 && coins >= BREED_COST && (!wantsLock || canAffordLock);
  const pityRemaining = Math.max(0, GENETICS_CONFIG.pityThreshold - pityCounter);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Лаборатория скрещивания</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {result ? (
          <div className="lab-reveal">
            <button
              type="button"
              className={`lab-reveal-card ${revealed ? 'is-revealed' : ''}`}
              onClick={skipReveal}
              aria-label={revealed ? 'Результат скрещивания' : 'Пропустить анимацию'}
            >
              <SpecimenThumbnail genome={result.specimen.genome} size={140} />
            </button>
            {!revealed && (
              <button type="button" className="lab-reveal-skip" onClick={skipReveal}>
                Пропустить анимацию
              </button>
            )}
            {revealed && (
              <>
                <div className={`lab-reveal-rarity rarity-${rarityOf(result.specimen.genome)}`}>
                  {RARITY_LABEL[rarityOf(result.specimen.genome)]}
                </div>
                {mutationName(result.specimen.genome.mutationId) && (
                  <div className="lab-reveal-mutation">
                    ✦ Особая мутация: {mutationName(result.specimen.genome.mutationId)}
                  </div>
                )}
                <div className="lab-reveal-dust">
                  + {result.dustGained}
                  <img className="coin-icon coin-icon-sm" src="assets/ui/icon_dust.png" alt="пыльца" /> генетической
                  пыли
                  {result.dustSpentOnLock > 0 && ` (−${result.dustSpentOnLock} за блокировку гена)`}
                </div>
                <div className="lab-reveal-actions">
                  <button className="sheet-buy-btn lab-reveal-btn" onClick={closeResult}>
                    Отлично!
                  </button>
                  {selected.length === 2 && coins >= BREED_COST && (
                    <button className="sheet-buy-btn lab-reveal-btn lab-reveal-btn-secondary" onClick={breedAgain}>
                      Скрестить ещё раз с той же парой
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <p className="sheet-empty lab-hint">
              Выбери двух особей из коллекции, чтобы скрестить их. Родители остаются в коллекции.
            </p>
            <div className="lab-pity">
              {pityRemaining === 0
                ? 'Гарантированная мутация уже готова — она произойдёт в следующем скрещивании.'
                : `До гарантированной мутации гена: ${pityRemaining} ${pityRemaining === 1 ? 'скрещивание' : 'скрещиваний'}.`}
            </div>
            {specimens.length < 2 ? (
              <div className="sheet-empty-block sheet-empty-centered">
                <img className="mascot-img" src="assets/ui/mascot_neutral.png" alt="" />
                <p className="sheet-empty">Нужно как минимум две особи — вырасти их или подожди скрещивания.</p>
              </div>
            ) : (
              <div className="specimen-grid">
                {specimens.map((s) => {
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
            {selected.length === 2 && (
              <div className="lab-gene-lock">
                <label className="lab-gene-lock-label">
                  Зафиксировать ген за {lockCost}
                  <img className="coin-icon coin-icon-sm" src="assets/ui/icon_dust.png" alt="пыли" />:
                  <select
                    value={lockGene}
                    onChange={(e) => setLockGene(e.target.value as LockableGene | '')}
                    className="lab-gene-lock-select"
                  >
                    <option value="">Без блокировки</option>
                    {(Object.keys(LOCKABLE_GENE_LABELS) as LockableGene[]).map((g) => (
                      <option key={g} value={g}>
                        {LOCKABLE_GENE_LABELS[g]}
                      </option>
                    ))}
                  </select>
                </label>
                {wantsLock && (
                  <div className="lab-gene-lock-source">
                    <button
                      type="button"
                      className={lockSource === 'a' ? 'is-selected' : ''}
                      onClick={() => setLockSource('a')}
                    >
                      От 1-й особи
                    </button>
                    <button
                      type="button"
                      className={lockSource === 'b' ? 'is-selected' : ''}
                      onClick={() => setLockSource('b')}
                    >
                      От 2-й особи
                    </button>
                  </div>
                )}
                {wantsLock && !canAffordLock && (
                  <p className="lab-gene-lock-warning">Не хватает пыли: нужно {lockCost}, есть {geneticDust}.</p>
                )}
              </div>
            )}
            <div className="lab-footer">
              <div className="lab-footer-cost">
                Цена скрещивания: {BREED_COST}
                <img className="coin-icon coin-icon-sm" src="assets/ui/icon_coin.png" alt="монет" />
              </div>
              <button className="sheet-buy-btn" disabled={!canBreed} onClick={doBreed}>
                Скрестить
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
