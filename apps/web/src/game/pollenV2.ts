// ============================================================================
// Genetics V2 — Slice 6: пыльца как ресурс + стоимость V2-скрещивания.
//
// Реализует ТОЛЬКО docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.9.1
// (модуль pollenV2.ts) в объёме Slice 6 из docs/GENETICS_TARGET_DELTA.md §0.8:
// чистые типизированные константы и функции экономики пыльцы. НИКАКОГО RNG,
// НИКАКОГО чтения/записи GameState здесь нет и не должно быть — тот же
// принцип, что уже применён в nurseryV2.ts/rarityV2.ts. GameStore (store.ts)
// использует эти функции, но сам расчёт живёт здесь.
// ============================================================================

import type { GenomeV2 } from './geneticsV2';
import { rarityOfV2, type RarityTierV2 } from './rarityV2';

/** Стоимость одновидового скрещивания в пыльце (delta doc §0.8 п.1). */
export const SAME_SPECIES_BREED_COST = 8;

/**
 * Стоимость межвидового скрещивания в пыльце (delta doc §0.8 п.1) —
 * зафиксирована и тестируется уже в Slice 6 как экономика БУДУЩЕГО
 * разрешённого пути (Slice 9). Межвидовое скрещивание НЕ разблокируется этим
 * slice: species-валидация (`validateSameSpeciesParentsV2`, `inheritanceV2.ts`)
 * по-прежнему отклоняет любую пару разных поддерживаемых видов с причиной
 * `interspecies_locked`, ДО того, как эта стоимость успела бы примениться на
 * практике (contract §4.9.4) — это значение достижимо только через прямой
 * unit-тест `breedCostV2`, не через реальный `breedNurseryV2`.
 */
export const INTERSPECIES_BREED_COST = 12;

/**
 * Базовая пыльца за сбор по `speciesId` — только два поддерживаемых V2-вида
 * Gate 1 (Солнечник/Колокольник, `SUPPORTED_PARENT_SPECIES_V2` в
 * `inheritanceV2.ts`), синхронизировано с `genesis-garden-balance-model-v3.xlsx`
 * (delta doc §2.1/§5.1) — оба по 2.
 */
export const SPECIES_BASE_POLLEN: Record<1 | 2, number> = { 1: 2, 2: 2 };

/**
 * Бонус пыльцы за сбор по итоговому тиру редкости (delta doc §5.1, таблица
 * "Формула пыльцы за сбор") — Common/Uncommon +0, Rare/Epic +1,
 * Legendary/Mythic +2. `Record<RarityTierV2, number>` — TypeScript откажется
 * компилировать таблицу с пропущенным тиром, тот же приём полноты, что уже
 * применён в `MUTATION_TIER_BY_ID`/`RARITY_LABEL` и других таблицах Gate 1.
 */
export const RARITY_POLLEN_BONUS: Record<RarityTierV2, number> = {
  Common: 0,
  Uncommon: 0,
  Rare: 1,
  Epic: 1,
  Legendary: 2,
  Mythic: 2,
};

function isSupportedPollenSpecies(speciesId: number): speciesId is 1 | 2 {
  return speciesId === 1 || speciesId === 2;
}

/**
 * Базовая пыльца за сбор для конкретного `speciesId`. Неподдерживаемый
 * `speciesId` (не 1/2 — например, мигрировавший legacy-specimen species 3-8,
 * который физически не может быть V2-гибридом, contract §3, но защитный путь
 * не помешает) обрабатывается ЯВНО и безопасно: возвращает `0`, не бросает
 * исключение и не начисляет случайное/произвольное значение — тот же принцип
 * "безопасный дефолт для нераспознанного значения", что уже применён в
 * `migrateMutationId` (geneticsV2.ts) для неизвестного legacy `mutationId`.
 */
export function speciesBasePollenV2(speciesId: number): number {
  return isSupportedPollenSpecies(speciesId) ? SPECIES_BASE_POLLEN[speciesId] : 0;
}

/**
 * Стоимость скрещивания по паре УЖЕ поддерживаемых `speciesId` (1/2,
 * `SUPPORTED_PARENT_SPECIES_V2`). Эта функция НЕ решает, разрешено ли вообще
 * такое скрещивание — species-валидацию (`unsupported_species`/
 * `interspecies_locked`) выполняет `validateSameSpeciesParentsV2`
 * (`inheritanceV2.ts`), явно и раньше денежной проверки (contract §4.9.3
 * шаг 5). `breedCostV2` только считает цену ДЛЯ пары, которая уже прошла (или
 * будет проходить, в тестах) эту валидацию.
 */
export function breedCostV2(seedSpeciesId: number, pollenSpeciesId: number): number {
  return seedSpeciesId === pollenSpeciesId ? SAME_SPECIES_BREED_COST : INTERSPECIES_BREED_COST;
}

/**
 * Награда пыльцы за один сбор V2-растения (первый или любой готовый
 * повторный, contract §4.9.2) — `speciesBasePollenV2(speciesId) +
 * RARITY_POLLEN_BONUS[rarityOfV2(genomeV2, genomeV2.mutationId)]`. Использует
 * `rarityOfV2` (Slice 3-4, без изменений) — не пересчитывает редкость
 * самостоятельно, единственный источник истины по редкости остаётся один.
 *
 * Защитный фикс Slice 7 (contract §4.10.1, delta doc §0.9 п.3): для
 * неподдерживаемого `speciesId` возвращает `0` ЦЕЛИКОМ, явной ранней
 * проверкой — не `speciesBasePollenV2(id) + RARITY_POLLEN_BONUS[rarity]`, что
 * могло бы дать ненулевой результат (например, Rare → `0+1=1`) для явно
 * защитного пути, обесценивая сам смысл "безопасный дефолт для неизвестного
 * значения" (тот же принцип, что `migrateMutationId`, geneticsV2.ts).
 */
export function pollenRewardV2(genomeV2: GenomeV2): number {
  if (!isSupportedPollenSpecies(genomeV2.speciesId)) return 0;
  const rarity = rarityOfV2(genomeV2, genomeV2.mutationId);
  return SPECIES_BASE_POLLEN[genomeV2.speciesId] + RARITY_POLLEN_BONUS[rarity];
}
