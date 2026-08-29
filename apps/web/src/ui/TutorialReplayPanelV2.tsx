import { useState } from 'react';
import { tutorialReplayChildGenomeV2, tutorialSunflowerPollenGenomeV2, tutorialSunflowerSeedGenomeV2 } from '../game/tutorialV2';
import { computeNaturalRevealsV2 } from '../game/revealV2';
import { GeneticsIntroPanelV2 } from './GeneticsIntroPanelV2';
import { RevealPanelV2 } from './RevealPanelV2';

/**
 * Genetics V2 — Slice 12 (onboarding spec §14, delta doc §12 Slice 12):
 * безопасный демонстрационный повтор обучения. Переиспользует те же UI-
 * компоненты (`GeneticsIntroPanelV2`/`RevealPanelV2`), что и реальный
 * онбординг, но на ФИКСИРОВАННЫХ демо-данных (`tutorialV2.ts` —
 * `tutorialReplayChildGenomeV2`, литеральные значения, не вызов `breedV2`).
 *
 * Не вызывает `breedV2`, не создаёт `HybridSeed`/`Specimen`, не меняет
 * Nursery Tray/грядки/пыльцу/пыль/монеты/`pityCounter`/`labLevel`/любой из
 * трёх `firstXClaimed`-флагов, не сбрасывает и не повторно выдаёт реальные
 * tutorial/Lumi-флаги — этот компонент физически не импортирует `gameStore`
 * ни в каком виде, поэтому не может ничего из перечисленного сделать даже
 * случайно.
 */

type ReplayStep = 'intro' | 'reveal1' | 'hint2' | 'reveal2' | 'done';

interface TutorialReplayPanelV2Props {
  onClose: () => void;
}

export function TutorialReplayPanelV2({ onClose }: TutorialReplayPanelV2Props) {
  const [step, setStep] = useState<ReplayStep>('intro');

  const seedGenome = tutorialSunflowerSeedGenomeV2();
  const pollenGenome = tutorialSunflowerPollenGenomeV2();

  if (step === 'intro') {
    return (
      <div className="sheet-backdrop" onClick={onClose}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-header">
            <h2>Демонстрация обучения</h2>
            <button className="sheet-close" onClick={onClose}>
              ✕
            </button>
          </div>
          <GeneticsIntroPanelV2 onDismiss={() => setStep('reveal1')} />
        </div>
      </div>
    );
  }

  if (step === 'reveal1') {
    return (
      <RevealPanelV2
        genomeV2={tutorialReplayChildGenomeV2(0)}
        seedSpeciesId={seedGenome.speciesId}
        pollenSpeciesId={pollenGenome.speciesId}
        mutated={false}
        mutationTier={null}
        naturalReveal={null}
        onClose={() => setStep('hint2')}
      />
    );
  }

  if (step === 'hint2') {
    return (
      <div className="sheet-backdrop" onClick={onClose}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-header">
            <h2>Демонстрация обучения</h2>
            <button className="sheet-close" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="sheet-empty-block sheet-empty-centered">
            <p className="sheet-empty">
              Один из признаков этого растения скрыт — потомок может унаследовать его, даже если у самого растения
              он не виден.
            </p>
            <button className="sheet-buy-btn" onClick={() => setStep('reveal2')}>
              Скрестить ещё раз
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'reveal2') {
    const childGenome = tutorialReplayChildGenomeV2(1);
    const naturalReveal = computeNaturalRevealsV2(childGenome, seedGenome, pollenGenome, false);
    return (
      <RevealPanelV2
        genomeV2={childGenome}
        seedSpeciesId={seedGenome.speciesId}
        pollenSpeciesId={pollenGenome.speciesId}
        mutated={false}
        mutationTier={null}
        naturalReveal={naturalReveal}
        onClose={() => setStep('done')}
      />
    );
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Демонстрация обучения</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="sheet-empty-block sheet-empty-centered">
          <p className="sheet-empty">Демонстрация завершена — это не повлияло на твою игру.</p>
          <button className="sheet-buy-btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
