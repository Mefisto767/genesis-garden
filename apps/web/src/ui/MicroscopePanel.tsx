import { useState } from 'react';
import { gameStore } from '../game/store';
import { useGameState } from '../game/useGameState';
import type { GenomeV2LocusKey } from '../game/geneticsV2';
import { GENOME_V2_LOCUS_KEYS } from '../game/geneticsV2';
import { resolveExtendedCard } from '../game/phenotypeV2';
import { MICROSCOPE_REVEAL_COST, insufficientDustLabelV2 } from '../game/microscopeV2';
import { LOCUS_CATEGORY_LABEL_V2, alleleLabelV2 } from '../game/hybridCardViewModel';

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
 * §6.1) — рендерит все девять локусов через уже принятый
 * `resolveExtendedCard` (Slice 2): гомозиготные — значением напрямую,
 * нераскрытые гетерозиготные — «Не исследован» + кнопка раскрытия,
 * раскрытые — точное значение + источник (микроскоп/естественно). Простая
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
  const card = resolveExtendedCard(genomeV2, revealedLoci);
  const unresearchedCount = GENOME_V2_LOCUS_KEYS.filter((locus) => card[locus].state === 'unresearched').length;
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
          {GENOME_V2_LOCUS_KEYS.map((locus) => {
            const view = card[locus];
            const label = LOCUS_CATEGORY_LABEL_V2[locus];
            if (view.state === 'homozygous') {
              return (
                <div className="sheet-row" key={locus}>
                  <div className="sheet-row-title">{label}</div>
                  <div className="sheet-row-count">{alleleLabelV2(locus, view.allele)}</div>
                </div>
              );
            }
            if (view.state === 'revealed') {
              return (
                <div className="sheet-row" key={locus}>
                  <div className="sheet-row-title">{label}</div>
                  <div className="sheet-row-count">
                    {alleleLabelV2(locus, view.hidden)} ·{' '}
                    {view.source === 'microscope' ? 'раскрыт микроскопом' : 'раскрыт естественно'}
                  </div>
                </div>
              );
            }
            // 'unresearched' — до оплаты видна только категория, не значение.
            return (
              <div className="sheet-row" key={locus}>
                <div className="sheet-row-title">{label}</div>
                <div className="sheet-row-count">Не исследован</div>
                <button className="sheet-buy-btn" disabled={insufficientDust} onClick={() => reveal(locus)}>
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
