// ============================================================================
// Genetics V2 — Slice 3: рабочая rarity-модель (`rarityOfV2`).
//
// Реализует ТОЛЬКО docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.5
// (naturalScore, пороги тиров, mutation floors, отдельное условие Mythic), в
// объёме Slice 3 из docs/GENETICS_TARGET_DELTA.md §12: контракт прямо требует
// «рабочую», воспроизводимую формулу уже на этом slice — финальная калибровка
// весов/порогов остаётся Slice 13 (contract §4.5.5) и НЕ делается здесь.
//
// Никакого RNG в этом файле нет и не должно быть (contract §4.5.1: «rarityOfV2
// не содержит собственного случайного вызова») — единственная случайность во
// всей цепочке уже произошла (mutation roll, Slice 4) и приходит сюда как
// готовый аргумент `mutationId`.
// ============================================================================

import { DOMINANCE_TABLE, expressPhenotype } from './phenotypeV2';
import type { GenomeV2, MutationIdV2 } from './geneticsV2';

/** Шесть тиров Gate 1 (contract §4.5.2/§4.5.4) — порядок важен: используется
 * `higherOf` ниже как индекс «редкости» (больше индекс = более редкий тир).
 * Отдельный от legacy `RarityTier` (`genetics.ts`) тип: legacy не знает про
 * `Mythic` и использует нижний регистр значений — не то же самое понятие. */
export type RarityTierV2 = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic';

const RARITY_TIER_ORDER: readonly RarityTierV2[] = [
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Mythic',
];

/** Тир mutation-события (contract §4.5.3, §9 delta-документа). Веса выбора
 * тира внутри успешного mutation roll (70/25/5) — Slice 4 (mutationV2.ts);
 * здесь только сам тип и статический каталог `MUTATION_TIER_BY_ID`, потому
 * что Slice 3 обязан иметь рабочие mutation floors уже сейчас (задание,
 * тест «Все mutation floors и условие Mythic» числится за Slice 3, не Slice
 * 4) — единственный источник истины для «какой ID какого тира», Slice 4
 * строит обратный индекс (тир -> список ID) из этой же таблицы, не дублирует
 * её заново. */
export type MutationTierV2 = 'Minor' | 'Major' | 'Signature';

/**
 * Полный каталог шести Gate-1 mutationId по тирам (delta doc §9,
 * `GENETICS_TARGET_DELTA.md` §4.3): Minor — `golden_vein`/`double_bloom`;
 * Major — `stardust`/`prism`/`luminous_edge`; Signature — `phoenix`.
 * Числа/состав каталога не пересматриваются в этом проходе.
 */
export const MUTATION_TIER_BY_ID: Record<MutationIdV2, MutationTierV2> = {
  golden_vein: 'Minor',
  double_bloom: 'Minor',
  stardust: 'Major',
  prism: 'Major',
  luminous_edge: 'Major',
  phoenix: 'Signature',
};

/**
 * Rarity points каждого аллеля каждого локуса — переписаны 1:1 из контракта
 * §4.2 (столбец «Rarity points»). Как и `DOMINANCE_TABLE` (Slice 2),
 * `Record<Allele, number>` над union-типом локуса не даёт TypeScript
 * скомпилировать таблицу с пропущенным аллелем — тот же принцип полноты, что
 * и в phenotypeV2.ts, применённый к rarity points вместо dominance rank.
 */
const STEM_FORM_POINTS = { stem_standard: 0, stem_branching: 2, stem_climbing: 5 } as const;
const LEAF_FORM_POINTS = { leaf_standard: 0, leaf_broad: 1, leaf_narrow: 2, leaf_frilled: 4 } as const;
const FLOWER_FORM_POINTS = { flower_standard: 0, flower_fan: 1, flower_cap: 2, flower_star: 4 } as const;
const PRIMARY_COLOR_POINTS = {
  primary_honey: 0,
  primary_amber: 0,
  primary_sunset: 0,
  primary_coral: 0,
  primary_lilac: 1,
  primary_violet: 1,
  primary_leaf: 2,
  primary_frost: 4,
} as const;
const SECONDARY_COLOR_POINTS = {
  secondary_forest: 0,
  secondary_sunset: 0,
  secondary_amber: 0,
  secondary_crimson: 1,
  secondary_purple: 1,
  secondary_sky: 2,
  secondary_ochre: 4,
} as const;
const LEAF_COLOR_POINTS = { leaf_color_meadow: 0, leaf_color_fresh: 1, leaf_color_forest: 2 } as const;
const PATTERN_POINTS = {
  pattern_solid: 0,
  pattern_duotone: 1,
  pattern_spots: 2,
  pattern_stripes: 3,
  pattern_veins: 5,
} as const;
const SIZE_POINTS = { size_normal: 0, size_large: 1, size_small: 1, size_giant: 3 } as const;
const AURA_POINTS = { aura_none: 0, aura_faint: 1, aura_glow: 2, aura_radiant: 5 } as const;

/**
 * `naturalScore` (contract §4.5.1) — целочисленная сумма rarity points
 * ВЫРАЖЕННЫХ (после разрешения доминирования, Slice 2 `expressPhenotype`)
 * аллелей по всем девяти локусам. Не читает и не зависит от `mutationId`.
 *
 * Каждый локус разрешается отдельным явным вызовом (тот же стиль, что
 * `resolvePhenotypeV2` в phenotypeV2.ts) — не циклом по общей таблице:
 * так каждая пара «таблица доминирования + таблица очков» остаётся строго
 * типизированной по своему собственному union аллелей локуса, без стирания
 * типа до `string` и без обхода проверки полноты `Record<Allele, ...>`.
 */
export function naturalScoreOfV2(genomeV2: GenomeV2): number {
  return (
    STEM_FORM_POINTS[expressPhenotype(genomeV2.stemForm, DOMINANCE_TABLE.stemForm)] +
    LEAF_FORM_POINTS[expressPhenotype(genomeV2.leafForm, DOMINANCE_TABLE.leafForm)] +
    FLOWER_FORM_POINTS[expressPhenotype(genomeV2.flowerForm, DOMINANCE_TABLE.flowerForm)] +
    PRIMARY_COLOR_POINTS[expressPhenotype(genomeV2.primaryColor, DOMINANCE_TABLE.primaryColor)] +
    SECONDARY_COLOR_POINTS[expressPhenotype(genomeV2.secondaryColor, DOMINANCE_TABLE.secondaryColor)] +
    LEAF_COLOR_POINTS[expressPhenotype(genomeV2.leafColor, DOMINANCE_TABLE.leafColor)] +
    PATTERN_POINTS[expressPhenotype(genomeV2.pattern, DOMINANCE_TABLE.pattern)] +
    SIZE_POINTS[expressPhenotype(genomeV2.size, DOMINANCE_TABLE.size)] +
    AURA_POINTS[expressPhenotype(genomeV2.aura, DOMINANCE_TABLE.aura)]
  );
}

/** Пороги natural score → tier, БЕЗ учёта мутации (contract §4.5.2). Mythic
 * сознательно не входит в область значений этой функции — недостижим через
 * naturalScore в одиночку, только через mutation floor (см. `rarityOfV2`). */
function tierFromNaturalScore(score: number): Exclude<RarityTierV2, 'Mythic'> {
  if (score < 3) return 'Common';
  if (score < 6) return 'Uncommon';
  if (score < 8) return 'Rare';
  if (score < 10) return 'Epic';
  return 'Legendary';
}

/** Mutation floors (contract §4.5.3) — минимальная итоговая редкость по тиру
 * состоявшейся мутации. */
const MUTATION_FLOOR: Record<MutationTierV2, RarityTierV2> = {
  Minor: 'Rare',
  Major: 'Epic',
  Signature: 'Legendary',
};

/** Порог для отдельного условия Mythic (contract §4.5.4) — не эвристика, два
 * явных предиката: `mutationTier==='Signature'` И `naturalScore>=5`. */
const MYTHIC_CO_THRESHOLD = 5;

function higherOf(a: RarityTierV2, b: RarityTierV2): RarityTierV2 {
  return RARITY_TIER_ORDER.indexOf(a) >= RARITY_TIER_ORDER.indexOf(b) ? a : b;
}

/**
 * `rarityOfV2` (contract §4.5.1) — детерминированная, БЕЗ RNG. Сигнатура
 * намеренно повторяет контракт: `mutationId` передаётся отдельным
 * аргументом, а не читается из `genomeV2.mutationId` — вызывающая сторона
 * (Slice 4 `breedV2`) отвечает за то, чтобы оба значения были согласованы;
 * это позволяет вызывать функцию и напрямую в тестах без сборки полного
 * `GenomeV2` под каждый mutationId.
 *
 * Mythic НЕ достижим через один только naturalScore (`tierFromNaturalScore`
 * физически не возвращает `'Mythic'`) — единственный путь к Mythic ниже,
 * отдельной явной веткой.
 */
export function rarityOfV2(genomeV2: GenomeV2, mutationId: MutationIdV2 | null): RarityTierV2 {
  const naturalScore = naturalScoreOfV2(genomeV2);
  const naturalTier = tierFromNaturalScore(naturalScore);

  if (mutationId === null) return naturalTier;

  const mutationTier = MUTATION_TIER_BY_ID[mutationId];
  const floor = MUTATION_FLOOR[mutationTier];
  const tier = higherOf(naturalTier, floor);

  if (mutationTier === 'Signature' && naturalScore >= MYTHIC_CO_THRESHOLD) {
    return 'Mythic';
  }
  return tier;
}
