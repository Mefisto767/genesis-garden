// ============================================================================
// Genetics V2 — Slice 2: Genome V2 phenotype resolver.
//
// Реализует ТОЛЬКО docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.2
// (полный каталог dominance rank всех девяти локусов) и §4.3 (алгоритм
// expressPhenotype/полное доминирование), в объёме Slice 2 из
// docs/GENETICS_TARGET_DELTA.md §12: чистые data-resolver функции над уже
// существующей схемой `GenomeV2` (Slice 1, geneticsV2.ts) — НИКАКОЙ игровой
// логики здесь нет и не должно быть: ни breedV2/наследования/RNG (Slice 3),
// ни mutation roll/pity (Slice 4), ни rarityOfV2 (Slice 4/13), ни Nursery
// Tray (Slice 5), ни пыльцы/оплаты (Slice 6), ни микроскопа как игровой
// операции (Slice 8), ни React/UI/Phaser. Эти функции сознательно не
// реализованы в этом файле.
//
// Резолвер ничего не запрещает по `speciesId` — ограничение «species 3-8
// нельзя использовать как родителей V2» (delta doc §3 п.3) относится к
// логике выбора родителя в будущем breedV2 (Slice 11), не к разрешению
// фенотипа: мигрировавший фенотип specimen любого вида должен читаться
// корректно уже сейчас (задание этого прохода, п.6).
// ============================================================================

import type {
  AllelePair,
  AuraAllele,
  FlowerFormAllele,
  GenomeV2,
  GenomeV2LocusKey,
  LeafColorAllele,
  LeafFormAllele,
  MutationIdV2,
  PatternAllele,
  PrimaryColorAllele,
  RevealedLocusEntry,
  SecondaryColorAllele,
  SizeAllele,
  StemFormAllele,
} from './geneticsV2';

/** Одна запись `DOMINANCE_TABLE` — только числовой ранг (contract §4.3, §4.2
 * столбец Dominance rank). Меньший ранг = более доминантный аллель. */
export interface DominanceEntry {
  rank: number;
}

// ----------------------------------------------------------------------------
// §4.2 — dominance rank каждого аллеля каждого локуса, переписан 1:1 из
// таблиц contract §4.2. `Record<Allele, DominanceEntry>` над union-типом
// аллелей локуса заставляет TypeScript отказаться компилировать объект,
// если пропущен хотя бы один аллель — таблица физически не может быть
// неполной (требование задания: «ни одного пропущенного аллеля и никакого
// fallback/default rank»), никакой `default`/catch-all ветки здесь нет.
// ----------------------------------------------------------------------------

const STEM_FORM_DOMINANCE: Record<StemFormAllele, DominanceEntry> = {
  stem_standard: { rank: 1 },
  stem_branching: { rank: 2 },
  stem_climbing: { rank: 3 },
};

const LEAF_FORM_DOMINANCE: Record<LeafFormAllele, DominanceEntry> = {
  leaf_standard: { rank: 1 },
  leaf_broad: { rank: 2 },
  leaf_narrow: { rank: 3 },
  leaf_frilled: { rank: 4 },
};

const FLOWER_FORM_DOMINANCE: Record<FlowerFormAllele, DominanceEntry> = {
  flower_standard: { rank: 1 },
  flower_fan: { rank: 2 },
  flower_cap: { rank: 3 },
  flower_star: { rank: 4 },
};

const PRIMARY_COLOR_DOMINANCE: Record<PrimaryColorAllele, DominanceEntry> = {
  primary_honey: { rank: 1 },
  primary_amber: { rank: 2 },
  primary_sunset: { rank: 3 },
  primary_coral: { rank: 4 },
  primary_lilac: { rank: 5 },
  primary_violet: { rank: 6 },
  primary_leaf: { rank: 7 },
  primary_frost: { rank: 8 },
};

const SECONDARY_COLOR_DOMINANCE: Record<SecondaryColorAllele, DominanceEntry> = {
  secondary_forest: { rank: 1 },
  secondary_sunset: { rank: 2 },
  secondary_amber: { rank: 3 },
  secondary_crimson: { rank: 4 },
  secondary_purple: { rank: 5 },
  secondary_sky: { rank: 6 },
  secondary_ochre: { rank: 7 },
};

const LEAF_COLOR_DOMINANCE: Record<LeafColorAllele, DominanceEntry> = {
  leaf_color_meadow: { rank: 1 },
  leaf_color_fresh: { rank: 2 },
  leaf_color_forest: { rank: 3 },
};

const PATTERN_DOMINANCE: Record<PatternAllele, DominanceEntry> = {
  pattern_solid: { rank: 1 },
  pattern_duotone: { rank: 2 },
  pattern_spots: { rank: 3 },
  pattern_stripes: { rank: 4 },
  pattern_veins: { rank: 5 },
};

const SIZE_DOMINANCE: Record<SizeAllele, DominanceEntry> = {
  size_normal: { rank: 1 },
  size_large: { rank: 2 },
  size_small: { rank: 3 },
  size_giant: { rank: 4 },
};

const AURA_DOMINANCE: Record<AuraAllele, DominanceEntry> = {
  aura_none: { rank: 1 },
  aura_faint: { rank: 2 },
  aura_glow: { rank: 3 },
  aura_radiant: { rank: 4 },
};

/**
 * Полная `DOMINANCE_TABLE` (contract §4.3) — по одной явной таблице на
 * каждый из девяти локусов, ни одним больше и ни одним меньше. `speciesId`
 * и `mutationId` сюда не входят — они не локусы (contract §4.1) и не
 * участвуют в доминировании (задание этого прохода, п.5).
 */
export const DOMINANCE_TABLE = {
  stemForm: STEM_FORM_DOMINANCE,
  leafForm: LEAF_FORM_DOMINANCE,
  flowerForm: FLOWER_FORM_DOMINANCE,
  primaryColor: PRIMARY_COLOR_DOMINANCE,
  secondaryColor: SECONDARY_COLOR_DOMINANCE,
  leafColor: LEAF_COLOR_DOMINANCE,
  pattern: PATTERN_DOMINANCE,
  size: SIZE_DOMINANCE,
  aura: AURA_DOMINANCE,
} as const;

/**
 * Разрешение фенотипа одного локуса — единственный алгоритм, применяется
 * одинаково ко всем девяти локусам (contract §4.3). Чистая функция: без
 * RNG, без кодоминирования, без чтения/записи чего-либо вне аргументов.
 *
 * - Гомозигота (`pair.a === pair.b`) выражается напрямую, без обращения к
 *   таблице рангов вообще.
 * - Гетерозигота — выражается аллель с МЕНЬШИМ `rank` (rank 1 = максимально
 *   доминантный в локусе).
 * - Порядок полей `a`/`b` не влияет на результат — `table[pair.a].rank` и
 *   `table[pair.b].rank` сравниваются напрямую, перестановка местами `a`/`b`
 *   даёт то же самое сравнение.
 * - Всегда возвращает РОВНО один из двух переданных аллелей (`pair.a` или
 *   `pair.b`) — никогда третье/смешанное значение (кодоминирование не
 *   реализовано и не может быть реализовано этой сигнатурой).
 */
export function expressPhenotype<T extends string>(
  pair: AllelePair<T>,
  table: Record<T, DominanceEntry>
): T {
  if (pair.a === pair.b) return pair.a;
  return table[pair.a].rank < table[pair.b].rank ? pair.a : pair.b;
}

/**
 * Полный резолвед-фенотип `GenomeV2` — выраженный аллель по каждому из
 * девяти локусов плюс `speciesId`/`mutationId`, переданные без изменений
 * (они не локусы, задание п.5). Это же — содержимое «простой карточки»
 * (`resolveSimpleCard` ниже): простая карточка не показывает ничего, кроме
 * этого набора, поэтому оба резолвера намеренно дают одну и ту же форму
 * результата, не две параллельные структуры.
 */
export interface PhenotypeV2 {
  stemForm: StemFormAllele;
  leafForm: LeafFormAllele;
  flowerForm: FlowerFormAllele;
  primaryColor: PrimaryColorAllele;
  secondaryColor: SecondaryColorAllele;
  leafColor: LeafColorAllele;
  pattern: PatternAllele;
  size: SizeAllele;
  aura: AuraAllele;
  speciesId: number;
  mutationId: MutationIdV2 | null;
}

/**
 * Резолвер полного `GenomeV2` (задание, п.4) — выраженный фенотип всех
 * девяти локусов одним вызовом. Не читает и не пишет `Specimen`/save —
 * принимает и возвращает только значения, никаких побочных эффектов.
 * Не ограничивает `speciesId` (п.6 — фильтрация «нельзя как родителя V2»
 * для species 3-8 не относится к разрешению фенотипа, это забота Slice 11).
 */
export function resolvePhenotypeV2(genomeV2: GenomeV2): PhenotypeV2 {
  return {
    stemForm: expressPhenotype(genomeV2.stemForm, DOMINANCE_TABLE.stemForm),
    leafForm: expressPhenotype(genomeV2.leafForm, DOMINANCE_TABLE.leafForm),
    flowerForm: expressPhenotype(genomeV2.flowerForm, DOMINANCE_TABLE.flowerForm),
    primaryColor: expressPhenotype(genomeV2.primaryColor, DOMINANCE_TABLE.primaryColor),
    secondaryColor: expressPhenotype(genomeV2.secondaryColor, DOMINANCE_TABLE.secondaryColor),
    leafColor: expressPhenotype(genomeV2.leafColor, DOMINANCE_TABLE.leafColor),
    pattern: expressPhenotype(genomeV2.pattern, DOMINANCE_TABLE.pattern),
    size: expressPhenotype(genomeV2.size, DOMINANCE_TABLE.size),
    aura: expressPhenotype(genomeV2.aura, DOMINANCE_TABLE.aura),
    speciesId: genomeV2.speciesId,
    mutationId: genomeV2.mutationId,
  };
}

/**
 * «Простая карточка» (delta doc §6.1) — получает ТОЛЬКО выраженный фенотип,
 * ни одного скрытого признака ни в каком виде. Ровно то же самое, что
 * `resolvePhenotypeV2` — простая карточка не показывает ничего сверх
 * полностью выраженного генома, поэтому отдельной структуры данных для неё
 * не заводится (единственный источник истины — `PhenotypeV2`). Результат —
 * плоский объект из строк/чисел, ни одного `AllelePair`/скрытого значения
 * внутри физически быть не может (сериализуется JSON.stringify без потерь
 * и без утечек — задание, тест 8).
 */
export function resolveSimpleCard(genomeV2: GenomeV2): PhenotypeV2 {
  return resolvePhenotypeV2(genomeV2);
}

/**
 * Состояние одного локуса на расширенной карточке (delta doc §6.1):
 *
 * - `homozygous` — локус гомозиготен, скрытого признака нет вообще (не
 *   помечается как `unresearched` ни при каких условиях, задание п.11).
 * - `unresearched` — гетерозигота, второй аллель ещё не раскрыт: наружу
 *   уходит только выраженный аллель и символический статус, ни реальное
 *   значение скрытого аллеля, ни его rank сюда не попадают.
 * - `revealed` — гетерозигота, локус раскрыт (микроскопом или естественно,
 *   `RevealedLocusEntry` для этого локуса присутствует в `revealedLoci`):
 *   наружу уходит и выраженный, и реальный скрытый аллель с его rank и
 *   источником раскрытия.
 */
export type ExtendedLocusView<T extends string> =
  | { readonly state: 'homozygous'; readonly allele: T }
  | { readonly state: 'unresearched'; readonly expressed: T }
  | {
      readonly state: 'revealed';
      readonly expressed: T;
      readonly hidden: T;
      readonly hiddenRank: number;
      readonly source: RevealedLocusEntry['source'];
    };

/** Расширенная карточка (delta doc §6.1) — по одному `ExtendedLocusView` на
 * каждый из девяти локусов, плюс `speciesId`/`mutationId` без изменений. */
export interface ExtendedCardV2 {
  stemForm: ExtendedLocusView<StemFormAllele>;
  leafForm: ExtendedLocusView<LeafFormAllele>;
  flowerForm: ExtendedLocusView<FlowerFormAllele>;
  primaryColor: ExtendedLocusView<PrimaryColorAllele>;
  secondaryColor: ExtendedLocusView<SecondaryColorAllele>;
  leafColor: ExtendedLocusView<LeafColorAllele>;
  pattern: ExtendedLocusView<PatternAllele>;
  size: ExtendedLocusView<SizeAllele>;
  aura: ExtendedLocusView<AuraAllele>;
  speciesId: number;
  mutationId: MutationIdV2 | null;
}

function findRevealedEntry(
  revealedLoci: readonly RevealedLocusEntry[],
  locus: GenomeV2LocusKey
): RevealedLocusEntry | undefined {
  return revealedLoci.find((entry) => entry.locus === locus);
}

/** Резолвер одного локуса для расширенной карточки — см. `ExtendedLocusView`
 * выше. Гомозиготная ветка проверяется ПЕРВОЙ и безусловно: даже если
 * `revealedLoci` ошибочно содержит запись для гомозиготного локуса, она
 * игнорируется — у гомозиготы просто нет скрытого состояния (задание п.11),
 * это не флаг, который можно случайно проставить неправильными данными. */
function resolveExtendedLocusView<T extends string>(
  pair: AllelePair<T>,
  table: Record<T, DominanceEntry>,
  revealed: RevealedLocusEntry | undefined
): ExtendedLocusView<T> {
  if (pair.a === pair.b) {
    return { state: 'homozygous', allele: pair.a };
  }
  const expressed = expressPhenotype(pair, table);
  if (!revealed) {
    return { state: 'unresearched', expressed };
  }
  const hidden = expressed === pair.a ? pair.b : pair.a;
  return {
    state: 'revealed',
    expressed,
    hidden,
    hiddenRank: table[hidden].rank,
    source: revealed.source,
  };
}

/**
 * Резолвер расширенной карточки (задание, п.7) — чистая data-функция, без
 * React/UI. Принимает уже прочитанный `genomeV2` и `revealedLoci` конкретного
 * `Specimen` (по умолчанию — пустой массив, эквивалент отсутствующего поля
 * `Specimen.revealedLoci` до Slice 8) и возвращает `ExtendedCardV2`. НИЧЕГО
 * не записывает ни в `genomeV2`, ни в `revealedLoci`, ни в какой-либо
 * внешний `Specimen`/`GameState` — вызывающая сторона (будущий Slice 8,
 * операция микроскопа) сама решает, когда и как записать новую запись в
 * `Specimen.revealedLoci`; этот резолвер только читает.
 */
export function resolveExtendedCard(
  genomeV2: GenomeV2,
  revealedLoci: readonly RevealedLocusEntry[] = []
): ExtendedCardV2 {
  return {
    stemForm: resolveExtendedLocusView(
      genomeV2.stemForm,
      DOMINANCE_TABLE.stemForm,
      findRevealedEntry(revealedLoci, 'stemForm')
    ),
    leafForm: resolveExtendedLocusView(
      genomeV2.leafForm,
      DOMINANCE_TABLE.leafForm,
      findRevealedEntry(revealedLoci, 'leafForm')
    ),
    flowerForm: resolveExtendedLocusView(
      genomeV2.flowerForm,
      DOMINANCE_TABLE.flowerForm,
      findRevealedEntry(revealedLoci, 'flowerForm')
    ),
    primaryColor: resolveExtendedLocusView(
      genomeV2.primaryColor,
      DOMINANCE_TABLE.primaryColor,
      findRevealedEntry(revealedLoci, 'primaryColor')
    ),
    secondaryColor: resolveExtendedLocusView(
      genomeV2.secondaryColor,
      DOMINANCE_TABLE.secondaryColor,
      findRevealedEntry(revealedLoci, 'secondaryColor')
    ),
    leafColor: resolveExtendedLocusView(
      genomeV2.leafColor,
      DOMINANCE_TABLE.leafColor,
      findRevealedEntry(revealedLoci, 'leafColor')
    ),
    pattern: resolveExtendedLocusView(
      genomeV2.pattern,
      DOMINANCE_TABLE.pattern,
      findRevealedEntry(revealedLoci, 'pattern')
    ),
    size: resolveExtendedLocusView(
      genomeV2.size,
      DOMINANCE_TABLE.size,
      findRevealedEntry(revealedLoci, 'size')
    ),
    aura: resolveExtendedLocusView(
      genomeV2.aura,
      DOMINANCE_TABLE.aura,
      findRevealedEntry(revealedLoci, 'aura')
    ),
    speciesId: genomeV2.speciesId,
    mutationId: genomeV2.mutationId,
  };
}
