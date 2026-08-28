import { useState } from 'react';
import type { GameState } from '../game/types';
import { gameStore } from '../game/store';
import { buildHybridCardViewModel } from '../game/hybridCardViewModel';
import { SpecimenThumbnail } from './SpecimenThumbnail';

/**
 * Genetics V2 — Slice 7 minimal UI (contract §4.10.5, delta doc §0.9 п.6):
 * отдельная от legacy `AlbumPanel.tsx` коллекция для Overhaul+V2
 * (GENETICS_V2_ENABLED) — та же простая V2-карточка/view-model, что уже
 * принята для `HybridCardPanel` (`buildHybridCardViewModel`,
 * `rarityOfV2`-редкость + mutation, БЕЗ скрытых аллелей/микроскопа/Reveal/
 * родословной), плюс баланс `geneticDust` и переработка выращенного
 * specimen через `recycleSpecimenV2` — с обязательным двухшаговым
 * подтверждением перед удалением, предупреждением о снятии mature-растения с
 * грядки ДО подтверждения (не только toast'ом после факта) и явной
 * блокировкой favorite понятным сообщением. Не показывает полную тарифную
 * таблицу переработки (delta doc §5.2) — только итоговую сумму после успеха.
 *
 * Overhaul + Legacy Genetics продолжает использовать старый `AlbumPanel`
 * (recycleSpecimen(), фиксированная награда) — этот компонент его не
 * заменяет и не меняет.
 */

interface AlbumPanelV2Props {
  specimens: GameState['specimens'];
  plots: GameState['plots'];
  geneticDust: number;
  onClose: () => void;
}

export function AlbumPanelV2({ specimens, plots, geneticDust, onClose }: AlbumPanelV2Props) {
  const [notice, setNotice] = useState<string | null>(null);
  // Genetics V2 — Slice 7: id specimen, для которого сейчас показан
  // двухшаговый экран подтверждения переработки. Отмена — полный no-op на
  // уровне UI, `recycleSpecimenV2` не вызывается вообще.
  const [pendingRecycleId, setPendingRecycleId] = useState<string | null>(null);

  const candidates = specimens.filter((s) => !!s.genomeV2);
  const sorted = [...candidates].sort((a, b) => {
    if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
    return b.createdAt - a.createdAt;
  });

  function isLinkedToMaturePlot(specimenId: string): boolean {
    return plots.some((p) => p.hybridV2?.phase === 'mature' && p.hybridV2.specimenId === specimenId);
  }

  function toggleFavorite(id: string) {
    gameStore.toggleFavorite(id);
  }

  function recycle(id: string) {
    const result = gameStore.recycleSpecimenV2(id);
    setPendingRecycleId(null);
    if (result.ok) {
      setNotice(`+${result.dustGained} генетической пыли · Пыль пригодится в лаборатории`);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Коллекция — V2</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="album-dust">Генетическая пыль: {geneticDust}</div>

        {notice && <p className="sheet-empty lab-hint">{notice}</p>}

        {sorted.length === 0 ? (
          <div className="sheet-empty-block sheet-empty-centered">
            <p className="sheet-empty">Коллекция пуста. Скрести первую пару в лаборатории.</p>
          </div>
        ) : (
          <div className="album-grid">
            {sorted.map((s) => {
              const card = buildHybridCardViewModel(s.genomeV2!);
              const rarityClass = card.rarity.toLowerCase();
              const linkedToPlot = isLinkedToMaturePlot(s.id);
              const isPending = pendingRecycleId === s.id;
              return (
                <div className="album-card" key={s.id}>
                  <button
                    type="button"
                    className={`album-card-favorite ${s.favorite ? 'is-favorite' : ''}`}
                    onClick={() => toggleFavorite(s.id)}
                    aria-label={s.favorite ? 'Убрать из избранного' : 'Добавить в избранное'}
                    aria-pressed={!!s.favorite}
                  >
                    {s.favorite ? '★' : '☆'}
                  </button>
                  <SpecimenThumbnail genome={s.genome} size={88} />
                  <div className={`album-card-rarity rarity-${rarityClass}`}>{card.rarityLabel}</div>
                  {card.mutationLabel && <div className="album-card-mutation">✦ {card.mutationLabel}</div>}
                  <div className="album-card-actions">
                    {s.favorite ? (
                      <p className="sheet-empty lab-hint">В избранном — сними звезду, чтобы переработать</p>
                    ) : isPending ? (
                      <>
                        {linkedToPlot && (
                          <p className="sheet-empty lab-hint">Растение будет удалено с грядки насовсем.</p>
                        )}
                        <button className="album-card-sell" onClick={() => recycle(s.id)}>
                          Да, переработать
                        </button>
                        <button className="album-card-share" onClick={() => setPendingRecycleId(null)}>
                          Отмена
                        </button>
                      </>
                    ) : (
                      <button className="album-card-sell" onClick={() => setPendingRecycleId(s.id)}>
                        Переработать
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
