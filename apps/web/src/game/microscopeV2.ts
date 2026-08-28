// ============================================================================
// Genetics V2 — Slice 8: минимальный микроскоп.
//
// Реализует ТОЛЬКО docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.11.3
// (модель доступных признаков) в объёме Slice 8 из
// docs/GENETICS_TARGET_DELTA.md §12: чистые типизированные функции выбора
// доступных для раскрытия локусов + форматирование текста недостатка пыли.
// НИКАКОГО RNG, НИКАКОГО чтения/записи GameState здесь нет и не должно
// быть — та же дисциплина, что уже применена в pollenV2.ts/recyclingV2.ts.
// Атомарное списание пыли и запись `revealedLoci` — исключительно
// GameStore.revealHiddenLocusV2() (store.ts), не этот файл.
// ============================================================================

import { GENOME_V2_LOCUS_KEYS, type GenomeV2, type GenomeV2LocusKey, type RevealedLocusEntry } from './geneticsV2';
import { resolveExtendedCard } from './phenotypeV2';

/** Цена одного раскрытия микроскопом (delta doc §6.1, contract §4.11.3). */
export const MICROSCOPE_REVEAL_COST = 3;

/**
 * Локусы, реально доступные для раскрытия микроскопом у конкретного
 * specimen — используется состояние `unresearched` уже существующего
 * `resolveExtendedCard` (Slice 2), как и требует задание: не предлагает
 * гомозиготные признаки (у них состояние `homozygous`, не `unresearched`) и
 * уже раскрытые признаки (состояние `revealed`). Признаков «без единственного
 * скрытого аллеля» в Gate 1 не бывает отдельным случаем — кодоминирование не
 * реализовано (contract §4.3), поэтому у каждого гетерозиготного локуса
 * ровно один скрытый аллель либо он уже раскрыт.
 */
export function availableLociForRevealV2(
  genomeV2: GenomeV2,
  revealedLoci: readonly RevealedLocusEntry[] = []
): GenomeV2LocusKey[] {
  const card = resolveExtendedCard(genomeV2, revealedLoci);
  return GENOME_V2_LOCUS_KEYS.filter((locus) => card[locus].state === 'unresearched');
}

/** Точный текст недостатка пыли (contract §4.11.4): `Не хватает пыли: нужно 3, есть M`. */
export function insufficientDustLabelV2(availableDust: number): string {
  return `Не хватает пыли: нужно ${MICROSCOPE_REVEAL_COST}, есть ${availableDust}`;
}
