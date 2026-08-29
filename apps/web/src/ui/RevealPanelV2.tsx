import { useState } from 'react';
import type { GenomeV2 } from '../game/geneticsV2';
import type { NaturalRevealResultV2 } from '../game/revealV2';
import { buildRevealCardViewModel, buildRevealWhyViewModel } from '../game/revealV2';
import { buildHybridCardViewModel } from '../game/hybridCardViewModel';
import type { MutationTierV2 } from '../game/rarityV2';
import { SpecimenThumbnail } from './SpecimenThumbnail';
import { projectGenomeV2ToLegacy } from '../game/legacyProjectionV2';

/**
 * Genetics V2 — Slice 12 (delta doc §12, onboarding spec §3.3/§11): Reveal
 * результата V2-скрещивания — отдельный полноэкранный экран ДО возврата к
 * обычной лаборатории (переиспользует уже принятые `.sheet-reveal-scene`
 * CSS-классы, тот же паттерн, что legacy `LabPanel.tsx` `fullscreenReveal`).
 * Крупная простая карточка потомка (вид/редкость/все девять проявившихся
 * признаков) + происхождение каждого признака + «Отлично!» + «Почему
 * получилось так?». Никаких сырых allele/species/specimen ID — весь текст
 * идёт через уже готовые view-model'ы (`hybridCardViewModel.ts`/`revealV2.ts`).
 *
 * Переиспользуется ДВАЖДЫ: реальным Reveal после `breedNurseryV2`
 * (`LabPanelV2.tsx`) и демонстрационным повтором обучения
 * (`TutorialReplayPanelV2.tsx`, зафиксированные демо-данные) — этот
 * компонент сам не знает, откуда взялся геном, только рендерит его.
 */

interface RevealPanelV2Props {
  genomeV2: GenomeV2;
  seedSpeciesId: number;
  pollenSpeciesId: number;
  mutated: boolean;
  mutationTier: MutationTierV2 | null;
  /** `null` в демонстрационном повторе (естественное раскрытие там не
   * применяется — данные фиксированные, никакой `Specimen.revealedLoci` не
   * меняется, onboarding spec §14). */
  naturalReveal: NaturalRevealResultV2 | null;
  onClose: () => void;
}

export function RevealPanelV2({
  genomeV2,
  seedSpeciesId,
  pollenSpeciesId,
  mutated,
  mutationTier,
  naturalReveal,
  onClose,
}: RevealPanelV2Props) {
  const [showWhy, setShowWhy] = useState(false);
  const card = buildHybridCardViewModel(genomeV2);
  const reveal = buildRevealCardViewModel(
    genomeV2,
    seedSpeciesId,
    pollenSpeciesId,
    mutated,
    card.rarityLabel,
    card.mutationLabel
  );
  const why = showWhy
    ? buildRevealWhyViewModel(
        genomeV2,
        seedSpeciesId,
        pollenSpeciesId,
        mutated,
        mutationTier,
        naturalReveal ?? { seedLoci: [], pollenLoci: [] }
      )
    : null;
  const hasNaturalReveal = (naturalReveal?.seedLoci.length ?? 0) > 0 || (naturalReveal?.pollenLoci.length ?? 0) > 0;

  return (
    <div className="sheet-backdrop sheet-backdrop-reveal-scene" onClick={onClose}>
      <div className="sheet sheet-reveal-scene sheet-fullscreen" onClick={(e) => e.stopPropagation()}>
        <button className="sheet-close reveal-scene-close" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>

        {!showWhy ? (
          <div className="lab-reveal lab-reveal-scene">
            <div className="lab-reveal-card lab-reveal-card-scene is-revealed">
              <SpecimenThumbnail genome={projectGenomeV2ToLegacy(genomeV2)} size={140} />
            </div>
            <div className="reveal-species-name">{reveal.speciesName}</div>
            <div className="lab-reveal-rarity">{reveal.rarityLabel}</div>
            {reveal.mutationLabel && <div className="lab-reveal-mutation">✦ {reveal.mutationLabel}</div>}

            <div className="reveal-trait-list">
              {reveal.traits.map((trait) => (
                <div className="reveal-trait-row" key={trait.locus}>
                  <div className="reveal-trait-value">
                    {trait.label}: {trait.valueLabel}
                  </div>
                  <div className="reveal-trait-origin">{trait.originLabels.join(' + ')}</div>
                </div>
              ))}
            </div>

            {hasNaturalReveal && (
              <p className="reveal-natural-hint">
                Этот признак был скрыт у родителя — а у потомка стал видимым!
              </p>
            )}

            <div className="lab-reveal-actions">
              <button className="sheet-buy-btn lab-reveal-btn" onClick={onClose}>
                Отлично!
              </button>
              <button
                className="sheet-buy-btn lab-reveal-btn lab-reveal-btn-secondary"
                onClick={() => setShowWhy(true)}
              >
                Почему получилось так?
              </button>
            </div>
          </div>
        ) : (
          <div className="reveal-why-screen">
            <h2 className="reveal-why-title">Почему получилось так?</h2>
            <div className="reveal-trait-list">
              {why!.traits.map((trait) => (
                <div className="reveal-trait-row" key={trait.locus}>
                  <div className="reveal-trait-value">
                    {trait.label}: {trait.valueLabel}
                  </div>
                  <div className="reveal-trait-origin">{trait.originLabels.join(' + ')}</div>
                </div>
              ))}
            </div>
            <p className="reveal-why-line">
              {why!.mutated
                ? `Произошла мутация: ${why!.mutationTierDescription}.`
                : 'Мутации не произошло.'}
            </p>
            {why!.hasNaturalReveal && (
              <p className="reveal-why-line">Этот признак был скрыт у родителя — а у потомка стал видимым!</p>
            )}
            {why!.rarityFactors.length > 0 && (
              <p className="reveal-why-line">
                Этот экземпляр получил повышенную редкость благодаря: {why!.rarityFactors.join(', ')}.
              </p>
            )}
            <div className="lab-reveal-actions">
              <button className="sheet-buy-btn lab-reveal-btn" onClick={() => setShowWhy(false)}>
                Назад
              </button>
              <button className="sheet-buy-btn lab-reveal-btn lab-reveal-btn-secondary" onClick={onClose}>
                Отлично!
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
