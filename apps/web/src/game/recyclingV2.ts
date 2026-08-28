// ============================================================================
// Genetics V2 — Slice 7: переработка HybridSeed/Specimen в генетическую пыль.
//
// Реализует ТОЛЬКО docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.10.1
// (модуль recyclingV2.ts) в объёме Slice 7 из docs/GENETICS_TARGET_DELTA.md
// §0.9: чистые типизированные константы и функции экономики переработки.
// НИКАКОГО RNG, НИКАКОГО чтения/записи GameState здесь нет и не должно быть —
// та же дисциплина, что уже применена в pollenV2.ts/nurseryV2.ts/rarityV2.ts.
// GameStore (store.ts) использует эти функции, но сам расчёт живёт здесь.
// ============================================================================

import type { GenomeV2 } from './geneticsV2';
import { rarityOfV2, type RarityTierV2 } from './rarityV2';

/**
 * Пыль за переработку выращенного `Specimen` (100% тарифа) по тиру редкости
 * (delta doc §5.2). `Record<RarityTierV2, number>` — TypeScript не
 * скомпилирует таблицу с пропущенным тиром, тот же приём полноты, что уже
 * применён в `RARITY_POLLEN_BONUS` (pollenV2.ts)/`MUTATION_TIER_BY_ID`
 * (rarityV2.ts).
 */
export const RARITY_RECYCLE_DUST: Record<RarityTierV2, number> = {
  Common: 1,
  Uncommon: 2,
  Rare: 5,
  Epic: 12,
  Legendary: 30,
  Mythic: 80,
};

/**
 * Награда за переработку выращенного `Specimen` — 100% тарифа тира. Редкость
 * всегда через `rarityOfV2(genomeV2, genomeV2.mutationId)` (Slice 3-4, без
 * изменений) — не определяется напрямую по `mutationId`, тот же принцип, что
 * `pollenRewardV2` (pollenV2.ts).
 */
export function grownRecycleDustV2(genomeV2: GenomeV2): number {
  const rarity = rarityOfV2(genomeV2, genomeV2.mutationId);
  return RARITY_RECYCLE_DUST[rarity];
}

/**
 * Награда за переработку `HybridSeedV2`, ещё лежащего в Nursery Tray (не
 * выращенного) — `max(1, floor(fullSpecimenReward / 2))` (delta doc §5.2,
 * contract §4.10.1). `Math.floor` зафиксирован явно, не `Math.round` — снимает
 * неоднозначность 50% для Rare: `floor(5/2)=2`, не 3 (округление вверх дало
 * бы неверные 3, contract §0.9 п.1). `Math.max(1, …)` гарантирует, что
 * переработка семени никогда не даёт 0 пыли даже для Common
 * (`floor(1/2)=0` → поднимается до 1).
 */
export function nurseryRecycleDustV2(genomeV2: GenomeV2): number {
  return Math.max(1, Math.floor(grownRecycleDustV2(genomeV2) / 2));
}

/** Результат чистого расчёта первой компенсации (contract §4.10.1, delta doc
 * §5.3 п.2) — `baseDust`/`topUpDust` раздельно для точных unit-тестов,
 * `dustGained` — единственное число, которое видит игрок в UI. */
export interface FirstRecycleTopUpResult {
  /** Обычная награда по уже выбранной вызывающей стороной ставке
   * (`grownRecycleDustV2` или `nurseryRecycleDustV2`). */
  baseDust: number;
  /** 0, если компенсация уже использована или награда и так >= 3; иначе `3 - baseDust`. */
  topUpDust: number;
  /** `baseDust + topUpDust` — итоговая сумма, без разделения на тариф/компенсацию для UI. */
  dustGained: number;
}

/**
 * Чистая функция первой компенсации до 3 пыли (contract §4.10.1, delta doc
 * §0.9 п.2/§5.3 п.2) — не читает и не пишет `GameState`. `firstRecycleTopUpClaimed`
 * относится к первой успешно завершённой переработке НЕЗАВИСИМО от типа
 * цели (Nursery Seed или выращенный Specimen) — единая точка правды,
 * вызывается одинаково из `recycleNurserySeedV2` и `recycleSpecimenV2`
 * (store.ts), ни одна из них не дублирует эту арифметику инлайном.
 * Вызывающая сторона (store) сама решает, атомарно устанавливать ли
 * `firstRecycleTopUpClaimed=true` по результату — эта функция только считает.
 */
export function firstRecycleTopUpV2(
  baseDust: number,
  firstRecycleTopUpClaimed: boolean
): FirstRecycleTopUpResult {
  const topUpDust = firstRecycleTopUpClaimed || baseDust >= 3 ? 0 : 3 - baseDust;
  return { baseDust, topUpDust, dustGained: baseDust + topUpDust };
}

/** Slice 7 UI-фикс (defect report bug 2): две строки, показанные игроку после
 * успешной переработки (`LabPanelV2.tsx`/`AlbumPanelV2.tsx`, contract
 * §4.10.5) — как ДВА раздельных значения, не одна собранная строка. Раньше
 * оба компонента строили `` `+${dustGained} генетической пыли · Пыль
 * пригодится в лаборатории` `` одной строкой (с ` · ` посередине) и рендерили
 * её одним DOM-элементом — по заданию это два отдельных элемента/строки, без
 * объединяющей пунктуации. */
export interface RecycleNoticeLines {
  /** `+N генетической пыли`. */
  primary: string;
  /** `Пыль пригодится в лаборатории` — не зависит от `dustGained`. */
  secondary: string;
}

/** Строит структурированные строки уведомления из уже посчитанного
 * `dustGained` (`RecycleV2Success.dustGained`, store.ts) — вызывающая сторона
 * не разбирает никакую сформированную строку, только передаёт число. */
export function recycleNoticeLines(dustGained: number): RecycleNoticeLines {
  return { primary: `+${dustGained} генетической пыли`, secondary: 'Пыль пригодится в лаборатории' };
}
