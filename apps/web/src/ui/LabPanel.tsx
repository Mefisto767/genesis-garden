import { useState } from 'react';
import type { GameState } from '../game/types';
import { gameStore, BREED_COST, type BreedOutcome } from '../game/store';
import { rarityOf, mutationName } from '../game/genetics';
import { SpecimenThumbnail } from './SpecimenThumbnail';
import { RARITY_LABEL } from '../game/specimenRender';

interface LabPanelProps {
  specimens: GameState['specimens'];
  coins: number;
  onClose: () => void;
}

export function LabPanel({ specimens, coins, onClose }: LabPanelProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<BreedOutcome | null>(null);
  const [revealed, setRevealed] = useState(false);

  function toggle(id: string) {
    if (result) return; // не меняем выбор посреди показа результата
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  function doBreed() {
    if (selected.length !== 2) return;
    const outcome = gameStore.breedSpecimens(selected[0], selected[1]);
    if (!outcome) return;
    setResult(outcome);
    setRevealed(false);
    // маленькая пауза перед "вспышкой" открытия — ощущение гача-реролла
    requestAnimationFrame(() => setTimeout(() => setRevealed(true), 60));
  }

  function closeResult() {
    setResult(null);
    setRevealed(false);
    setSelected([]);
  }

  const canBreed = selected.length === 2 && coins >= BREED_COST;

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
            <div className={`lab-reveal-card ${revealed ? 'is-revealed' : ''}`}>
              <SpecimenThumbnail genome={result.specimen.genome} size={140} />
            </div>
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
                </div>
                <button className="sheet-buy-btn lab-reveal-btn" onClick={closeResult}>
                  Отлично!
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <p className="sheet-empty lab-hint">
              Выбери двух особей из коллекции, чтобы скрестить их. Родители остаются в коллекции.
            </p>
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
                    </button>
                  );
                })}
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
