import { useState } from 'react';
import { gameStore } from '../game/store';
import { useGameState } from '../game/useGameState';
import type { GenomeV2LocusKey } from '../game/geneticsV2';
import { availableLociForRevealV2, MICROSCOPE_REVEAL_COST, insufficientDustLabelV2 } from '../game/microscopeV2';
import { buildMicroscopeCardViewModel } from '../game/hybridCardViewModel';

/**
 * Genetics V2 — Slice 8 minimal UI (contract §4.11.3, delta doc §0.10):
 * единственная операция микроскопа — выбрать specimen (передаётся снаружи,
 * из `AlbumPanelV2`) → выбрать один скрытый признак с реально нераскрытым
 * аллелем → 3 генетической пыли → навсегда раскрыть его для ЭТОГО specimen.
 * Доступен только при `labLevel>=2` (проверка на уровне вызывающей стороны —
 * `AlbumPanelV2` не показывает кнопку "Микроскоп" раньше; store-level
 * `lab_locked` в `revealHiddenLocusV2` — обязательный защитный слой
 * независимо от этого, defense-in-depth).
 *
 * Это же представление удваивает роль «расширенной карточки» (delta doc
 * §6.1, fix-pass единый контракт видимости) — рендерит все девять локусов
 * через готовый `buildMicroscopeCardViewModel` (hybridCardViewModel.ts),
 * построенный поверх `resolveExtendedCard` (Slice 2): гомозиготные —
 * единственным значением без кнопки, нераскрытые гетерозиготные — строка
 * "Категория: видно — X, скрыто — Не исследован" + кнопка раскрытия,
 * раскрытые — строка с обоими аллелями + отдельная строка доминирования +
 * отдельная строка источника (микроскоп/естественно). Компонент не строит ни
 * одной из этих строк сам — только рендерит уже готовый view-model. Простая
 * карточка (`HybridCardPanel`/`AlbumPanelV2`) не меняется и продолжает
 * показывать только выраженный фенотип.
 */

interface MicroscopePanelProps {
  specimenId: string;
  onClose: () => void;
}

export function MicroscopePanel({ specimenId, onClose }: MicroscopePanelProps) {
  const state = useGameState();
  const [notice, setNotice] = useState<string | null>(null);
  const specimen = state.specimens.find((s) => s.id === specimenId);

  if (!specimen || !specimen.genomeV2) {
    // Specimen переработан/исчез между открытием и рендером — тихо
    // закрываемся, тот же принцип, что HybridCardPanel.
    return null;
  }

  const genomeV2 = specimen.genomeV2;
  const revealedLoci = specimen.revealedLoci ?? [];
  const rows = buildMicroscopeCardViewModel(genomeV2, revealedLoci);
  const unresearchedCount = availableLociForRevealV2(genomeV2, revealedLoci).length;
  const insufficientDust = state.geneticDust < MICROSCOPE_REVEAL_COST;

  function reveal(locus: GenomeV2LocusKey) {
    const result = gameStore.revealHiddenLocusV2(specimenId, locus);
    if (result.ok) {
      setNotice('Признак раскрыт');
    } else if (result.reason === 'insufficient_dust') {
      setNotice(insufficientDustLabelV2(result.availableDust));
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Микроскоп</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="album-dust">Генетическая пыль: {state.geneticDust}</div>

        {unresearchedCount === 0 ? (
          <div className="sheet-empty-block sheet-empty-centered">
            <p className="sheet-empty">У этого растения нет нераскрытых скрытых признаков</p>
          </div>
        ) : (
          <p className="sheet-empty lab-hint">Выбери скрытый признак</p>
        )}

        {notice && <p className="sheet-empty lab-hint">{notice}</p>}
        {!notice && unresearchedCount > 0 && insufficientDust && (
          <p className="sheet-empty lab-hint">{insufficientDustLabelV2(state.geneticDust)}</p>
        )}

        <div className="sheet-list">
          {rows.map((row) => {
            if (row.state === 'homozygous') {
              return (
                <div className="sheet-row" key={row.key}>
                  <div className="sheet-row-title">{row.label}</div>
                  <div className="sheet-row-count">{row.valueLabel}</div>
                </div>
              );
            }
            if (row.state === 'revealed') {
              return (
                <div className="sheet-row" key={row.key}>
                  <div className="sheet-row-title">{row.label}</div>
                  <div className="sheet-row-count">{row.statusLine}</div>
                  <div className="sheet-row-sub">{row.dominanceLine}</div>
                  <div className="sheet-row-sub">{row.sourceLabel}</div>
                </div>
              );
            }
            // 'unresearched' — statusLine уже содержит "Не исследован"; ни
            // выраженный, ни (тем более) скрытый аллель раздельно здесь не
            // строится — вся строка приходит готовой из view-model'а.
            return (
              <div className="sheet-row" key={row.key}>
                <div className="sheet-row-title">{row.label}</div>
                <div className="sheet-row-count">{row.statusLine}</div>
                <button className="sheet-buy-btn" disabled={insufficientDust} onClick={() => reveal(row.key)}>
                  Раскрыть за 3 пыли
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
