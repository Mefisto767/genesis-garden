// ============================================================================
// Genetics V2 — Slice 8: Lab L2 gate (Колокольник unlock) + first hybrid
// reward constants.
//
// Реализует ТОЛЬКО docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.11.1
// (обучающий грант) и §4.11.2 (гейт labLevel>=2 для Колокольника), в объёме
// Slice 8 из docs/GENETICS_TARGET_DELTA.md §12: чистые типизированные
// константы и предикат гейта. НИКАКОГО RNG, НИКАКОГО чтения/записи GameState
// здесь нет — та же дисциплина, что уже применена в nurseryV2.ts/pollenV2.ts/
// recyclingV2.ts/rarityV2.ts. GameStore (store.ts) использует эти функции,
// но сам расчёт живёт здесь.
// ============================================================================

/** Порог лаборатории, открывающий Колокольника и минимальный микроскоп
 * одновременно (contract §4.11.2, delta doc §6.1/§9). */
export const LAB_LEVEL_2 = 2;

/** Обучающий грант пыльцы при первом выращенном гибриде (contract §4.11.1,
 * delta doc §5.3 п.1) — поверх обычной награды за сбор, не вместо неё. */
export const FIRST_HYBRID_POLLEN_GRANT = 8;

/**
 * Единственный вид Gate 1, гейтящийся `labLevel` — Колокольник (`speciesId:2`,
 * delta doc §2). Солнечник (`speciesId:1`) доступен с самого начала. Legacy
 * species 3-8 не гейтятся этим порогом вообще (они не являются предметом
 * V2-открытия — политика доступа для них уже отдельно решена, delta doc §3).
 */
export const GATED_SPECIES_ID_V2 = 2;

/** Точный текст блокировки Колокольника до открытия Lab L2 (contract §4.11.2). */
export const COLOKOLNIK_LOCKED_TEXT_V2 =
  'Этот вид пока недоступен — вырасти своего первого гибрида, чтобы открыть его';

/**
 * Гейт-предикат: разрешён ли `speciesId` для V2-покупки/посадки/
 * скрещивания-как-родителя при текущем `labLevel`. Единственный источник
 * истины, переиспользуется store-методами (`buySeedV2`/`plantSeedV2`/
 * `breedNurseryV2`) и UI (`ShopPanelV2`/`PlantPickerV2`/`LabPanelV2`) — чтобы
 * гейт никогда не разошёлся между слоями.
 */
export function isSpeciesUnlockedV2(speciesId: number, labLevel: number): boolean {
  return speciesId !== GATED_SPECIES_ID_V2 || labLevel >= LAB_LEVEL_2;
}
