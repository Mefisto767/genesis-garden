import { gameStore } from '../game/store';
import { useGameState } from '../game/useGameState';
import { resolveSimpleCard } from '../game/phenotypeV2';
import { SpecimenThumbnail } from './SpecimenThumbnail';

/**
 * Genetics V2 — Slice 5 minimal UI (contract §4.8.4, delta doc §0.7 п.11):
 * «минимальная простая карточка для созревшего V2-специмена через уже
 * принятый resolveSimpleCard, без скрытых аллелей, микроскопа, Reveal,
 * родословной». Открывается ТОЛЬКО для `Plot.hybridV2.phase === 'mature'`
 * (см. game/scenes/EstateScene.ts) — растущий гибрид карточку не показывает,
 * геном ещё не раскрыт (contract §4.8.3).
 */

interface HybridCardPanelProps {
  plotId: number;
  onClose: () => void;
}

function prettyAllele(id: string): string {
  const tail = id.includes('_') ? id.slice(id.indexOf('_') + 1) : id;
  const words = tail.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function HybridCardPanel({ plotId, onClose }: HybridCardPanelProps) {
  const state = useGameState();
  const plot = state.plots.find((p) => p.id === plotId);
  const hybridV2 = plot?.hybridV2;

  if (!hybridV2 || hybridV2.phase !== 'mature') {
    // Грядка перестала быть mature-V2-растением между открытием и рендером
    // (например, save изменился в другой вкладке) — тихо закрываемся, без
    // возможности показать пустую/некорректную карточку.
    return null;
  }

  const specimen = state.specimens.find((s) => s.id === hybridV2.specimenId);
  if (!specimen || !specimen.genomeV2) return null;

  const card = resolveSimpleCard(specimen.genomeV2);
  const status = gameStore.hybridPlotStatusV2(plot!);

  function collect() {
    gameStore.harvestHybridV2(plotId);
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Постоянное растение</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="sheet-empty-block sheet-empty-centered">
          <SpecimenThumbnail genome={specimen.genome} size={120} />
        </div>

        <div className="sheet-list">
          <div className="sheet-row">
            <div className="sheet-row-title">Вид</div>
            <div className="sheet-row-count">#{card.speciesId}</div>
          </div>
          <div className="sheet-row">
            <div className="sheet-row-title">Основной цвет</div>
            <div className="sheet-row-count">{prettyAllele(card.primaryColor)}</div>
          </div>
          <div className="sheet-row">
            <div className="sheet-row-title">Доп. цвет</div>
            <div className="sheet-row-count">{prettyAllele(card.secondaryColor)}</div>
          </div>
          <div className="sheet-row">
            <div className="sheet-row-title">Листва</div>
            <div className="sheet-row-count">{prettyAllele(card.leafColor)}</div>
          </div>
          <div className="sheet-row">
            <div className="sheet-row-title">Размер</div>
            <div className="sheet-row-count">{prettyAllele(card.size)}</div>
          </div>
          <div className="sheet-row">
            <div className="sheet-row-title">Аура</div>
            <div className="sheet-row-count">{prettyAllele(card.aura)}</div>
          </div>
          <div className="sheet-row">
            <div className="sheet-row-title">Узор</div>
            <div className="sheet-row-count">{prettyAllele(card.pattern)}</div>
          </div>
          {card.mutationId && (
            <div className="sheet-row">
              <div className="sheet-row-title">Мутация</div>
              <div className="sheet-row-count">✦ {prettyAllele(card.mutationId)}</div>
            </div>
          )}
        </div>

        <div className="lab-footer">
          <div className="lab-footer-cost">
            {status?.ready
              ? 'Повторный цикл готов'
              : status
                ? `До повторного цикла: ${Math.ceil(status.remainingMs / 1000)} с`
                : ''}
          </div>
          <button className="sheet-buy-btn" disabled={!status?.ready} onClick={collect}>
            Собрать
          </button>
        </div>
      </div>
    </div>
  );
}
