import { gameStore } from '../game/store';
import { useGameState } from '../game/useGameState';
import { buildHybridCardViewModel } from '../game/hybridCardViewModel';
import { SpecimenThumbnail } from './SpecimenThumbnail';

/**
 * Genetics V2 — Slice 5 minimal UI (contract §4.8.4, delta doc §0.7 п.11):
 * «минимальная простая карточка для созревшего V2-специмена через уже
 * принятый resolveSimpleCard, без скрытых аллелей, микроскопа, Reveal,
 * родословной». Открывается ТОЛЬКО для `Plot.hybridV2.phase === 'mature'`
 * (см. game/scenes/EstateScene.ts) — растущий гибрид карточку не показывает,
 * геном ещё не раскрыт (contract §4.8.3).
 *
 * Fix-pass (audit, bug 3): вся подготовка данных (перевод технических ID в
 * русские названия, вычисление редкости) вынесена в чистую типизированную
 * `buildHybridCardViewModel` (game/hybridCardViewModel.ts) — этот компонент
 * только рендерит уже готовую view-model, сам не знает про сырые ID геномов.
 * Показывает название вида (не `#1`/`#2`), все девять выраженных локусов,
 * редкость (`rarityOfV2`) и mutation, если она есть. Скрытые пары аллелей/
 * parentIds/микроскоп/Reveal по-прежнему вне области — view-model физически
 * не предоставляет ничего из этого.
 */

interface HybridCardPanelProps {
  plotId: number;
  onClose: () => void;
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

  const card = buildHybridCardViewModel(specimen.genomeV2);
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
            <div className="sheet-row-count">{card.speciesName}</div>
          </div>
          <div className="sheet-row">
            <div className="sheet-row-title">Редкость</div>
            <div className="sheet-row-count">{card.rarityLabel}</div>
          </div>
          {card.loci.map((row) => (
            <div className="sheet-row" key={row.key}>
              <div className="sheet-row-title">{row.label}</div>
              <div className="sheet-row-count">{row.value}</div>
            </div>
          ))}
          {card.mutationLabel && (
            <div className="sheet-row">
              <div className="sheet-row-title">Мутация</div>
              <div className="sheet-row-count">✦ {card.mutationLabel}</div>
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
