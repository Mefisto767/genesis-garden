// ============================================================================
// Genetics V2 — Slice 1: persistence-only data schema + legacy migration.
//
// Реализует ТОЛЬКО docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.1 (типы)
// и §4.4 (lossless legacy -> V2 миграция), в объёме Slice 1 из
// docs/GENETICS_TARGET_DELTA.md §12: чистая структура данных и её
// (одноразовая) миграция из legacy-генома. НИКАКОЙ игровой логики здесь нет
// и не должно быть — ни expressPhenotype()/доминирования (Slice 2), ни
// rarityOfV2 (Slice 2/13), ни breedV2/mutation roll (Slice 3/4), ни Nursery
// Tray (Slice 5). Эти функции сознательно не реализованы в этом файле.
//
// Легенда полей ниже сверена построчно с implementation contract §4.1/§4.4 и
// с фактическими цветовыми пулами legacy-кода (game/config.ts,
// GENETICS_CONFIG.primaryPool/secondaryPool/leafPool) — hex-значения ниже
// НЕ изобретены заново, а переписаны 1:1 из этого файла.
// ============================================================================

import type { Genome } from './genetics';
import type { AuraTier, Pattern, SizeTier } from './genetics';
import type { Specimen } from './types';

/**
 * Пара аллелей одного локуса — ровно по одному от каждого родителя (или два
 * одинаковых значения для гомозиготного/мигрировавшего локуса). Порядок
 * полей `a`/`b` НЕ несёт смысла доминирования (contract §4.1) — в Slice 1
 * доминирование вообще не реализовано (Slice 2), поле нужно только для
 * будущего «происхождение признака» (delta doc §6.1).
 */
export interface AllelePair<T extends string = string> {
  a: T;
  b: T;
}

// --- девять локусов Gate 1, ровно эти девять ключей (contract §4.1/§4.2) ---

export type StemFormAllele = 'stem_standard' | 'stem_branching' | 'stem_climbing';

export type LeafFormAllele = 'leaf_standard' | 'leaf_broad' | 'leaf_narrow' | 'leaf_frilled';

export type FlowerFormAllele = 'flower_standard' | 'flower_fan' | 'flower_cap' | 'flower_star';

export type PrimaryColorAllele =
  | 'primary_honey'
  | 'primary_amber'
  | 'primary_sunset'
  | 'primary_coral'
  | 'primary_lilac'
  | 'primary_violet'
  | 'primary_leaf'
  | 'primary_frost';

export type SecondaryColorAllele =
  | 'secondary_forest'
  | 'secondary_sunset'
  | 'secondary_amber'
  | 'secondary_crimson'
  | 'secondary_purple'
  | 'secondary_sky'
  | 'secondary_ochre';

export type LeafColorAllele = 'leaf_color_meadow' | 'leaf_color_fresh' | 'leaf_color_forest';

export type PatternAllele =
  | 'pattern_solid'
  | 'pattern_duotone'
  | 'pattern_spots'
  | 'pattern_stripes'
  | 'pattern_veins';

export type SizeAllele = 'size_normal' | 'size_large' | 'size_small' | 'size_giant';

export type AuraAllele = 'aura_none' | 'aura_faint' | 'aura_glow' | 'aura_radiant';

/**
 * Полный каталог Gate 1 mutationId (delta doc §9) — шесть ID, из которых
 * только четыре достижимы через существующий legacy-код сегодня
 * (`golden_vein`/`stardust`/`prism`/`phoenix`, config.ts:73-78);
 * `double_bloom`/`luminous_edge` появятся только вместе с mutation roll V2
 * (Slice 4) и не встречаются в legacy-сохранениях.
 */
export type MutationIdV2 =
  | 'golden_vein'
  | 'double_bloom'
  | 'stardust'
  | 'prism'
  | 'luminous_edge'
  | 'phoenix';

/** Полный диплоидный геном Genetics V2 (contract §4.1). */
export interface GenomeV2 {
  stemForm: AllelePair<StemFormAllele>;
  leafForm: AllelePair<LeafFormAllele>;
  flowerForm: AllelePair<FlowerFormAllele>;
  primaryColor: AllelePair<PrimaryColorAllele>;
  secondaryColor: AllelePair<SecondaryColorAllele>;
  leafColor: AllelePair<LeafColorAllele>;
  pattern: AllelePair<PatternAllele>;
  size: AllelePair<SizeAllele>;
  aura: AllelePair<AuraAllele>;

  /**
   * НЕ локус. Копируется целиком от Seed Parent — фиксирует вид и body rig.
   * Никогда не диплоиден, никогда не участвует в mutation roll.
   */
  speciesId: number;

  /**
   * Результат ОТДЕЛЬНОГО mutation roll (Slice 4), не значение локуса.
   * `null`, если не было mutation event. При миграции из legacy —
   * копия исторического `genome.mutationId` (см. `migrateMutationId`
   * ниже) — НЕ новый ролл и НЕ переигрывание pity.
   */
  mutationId: MutationIdV2 | null;
}

export type GenomeV2LocusKey =
  | 'stemForm'
  | 'leafForm'
  | 'flowerForm'
  | 'primaryColor'
  | 'secondaryColor'
  | 'leafColor'
  | 'pattern'
  | 'size'
  | 'aura';

/**
 * Стабильный порядок девяти локусов (Slice 8, микроскоп/расширенная
 * карточка) — единственное место, где этот порядок объявлен; UI и
 * `microscopeV2.ts` переиспользуют его, не заводят собственную копию.
 */
export const GENOME_V2_LOCUS_KEYS: readonly GenomeV2LocusKey[] = [
  'stemForm',
  'leafForm',
  'flowerForm',
  'primaryColor',
  'secondaryColor',
  'leafColor',
  'pattern',
  'size',
  'aura',
];

/**
 * Раскрытые скрытые локусы конкретного экземпляра — единый контракт
 * видимости, delta doc §6.1. Плоский МАССИВ, не `Set`: `Set` не переживает
 * `JSON.stringify`/`JSON.parse` (сериализуется в `{}`), а весь save целиком
 * идёт через этот round-trip (аудит §10.1, `store.ts` `persist()`/`loadState()`).
 * Не используется в Slice 1 (заводится в Slice 8) — тип объявлен здесь,
 * потому что Specimen.revealedLoci на него ссылается уже сейчас.
 */
export interface RevealedLocusEntry {
  locus: GenomeV2LocusKey;
  source: 'microscope' | 'natural';
}

/**
 * Persistence-only тип содержимого Nursery Tray (delta doc §6). Только
 * данные — никакой игровой логики (роста, разрешения фенотипа, оплаты) на
 * этом типе нет и не должно быть; вся логика — в Slice 5. Не используется в
 * Slice 1 (nurseryTray в GameState всегда пуст), объявлен здесь для типа
 * `GameState.nurseryTray: HybridSeedV2[]`.
 */
export interface HybridSeedV2 {
  id: string;
  genomeV2: GenomeV2;
  parentIds: [string, string];
  createdAt: number;
  /** null, пока семя лежит в трее, не посажено. */
  plantedAt: number | null;
  /** Задаётся при посадке. */
  plotId: number | null;
  /**
   * Genetics V2 — Slice 12 fix-pass (contract §4.14.14): какое из двух
   * гарантированных обучающих скрещиваний (§4.6.3/§4.6.4) породило это
   * семя — `0` первый урок, `1` второй, `undefined` для любого не-tutorial
   * скрещивания. Копируется на `Specimen.tutorialBreedStep` при первом
   * сборе (`GameStore.harvestHybridV2`) — единственный способ надёжно
   * найти «гибрид первого урока», даже если те же два tutorialStarter
   * специмена впоследствии скрещены ещё раз до того, как второй урок
   * фактически разблокирован (`tutorialV2.ts secondTutorialLessonAvailable`).
   */
  tutorialBreedStep?: 0 | 1;

  /**
   * Genetics V2 — final Gate 1 package, carryover fix (contract §4.15.1):
   * `[seedSpeciesId, pollenSpeciesId]` captured DIRECTLY from the two real
   * parents at the moment `breedNurseryV2` succeeds — before either parent
   * can possibly be recycled. Fixes a defect the Slice 12 final audit found:
   * `Specimen.revealParentSpecies` (below) used to be computed only at
   * maturity by looking up the CURRENT `state.specimens` by `parentIds` — if
   * one parent of an interspecies pair was recycled before the hybrid
   * matured, that lookup silently fell back to the child's own species for
   * the missing side, making an interspecies pair look same-species and
   * showing "От первого/второго растения" instead of "← Солнечник"/
   * "← Колокольник". Optional so any `HybridSeedV2` serialized before this
   * fix (still a valid V4 save — `SAVE_VERSION` is not bumped for this
   * additive field) safely falls back to the pre-existing live-parent
   * lookup at maturity (`GameStore.harvestHybridV2`).
   */
  parentSpeciesIds?: [number, number];
}

/**
 * Genetics V2 — Slice 12 fix-pass (contract §4.14.14): результат
 * `computeNaturalRevealsV2` (revealV2.ts) — локусы, естественно раскрытые у
 * seed/pollen родителя. Определён здесь (data-schema слой), а не в
 * revealV2.ts, потому что `Specimen.revealNaturalReveal` (types.ts) ссылается
 * на этот тип, а types.ts не должен зависеть от revealV2.ts (избежание
 * циклического импорта) — revealV2.ts реэкспортирует тип для обратной
 * совместимости существующих импортов.
 */
export interface NaturalRevealResultV2 {
  readonly seedLoci: readonly GenomeV2LocusKey[];
  readonly pollenLoci: readonly GenomeV2LocusKey[];
}

// ----------------------------------------------------------------------------
// Legacy -> V2 lossless migration (contract §4.4, delta doc §7/§7.2)
// ----------------------------------------------------------------------------

function homozygous<T extends string>(value: T): AllelePair<T> {
  return { a: value, b: value };
}

/**
 * Hex -> ID таблицы ниже переписаны 1:1 из `GENETICS_CONFIG.primaryPool` /
 * `.secondaryPool` / `.leafPool` (game/config.ts) — не изменять по одному
 * значению без синхронной правки config.ts и implementation contract §4.2:
 * там же (аудит §3.2) описано, что это существующие цвета кода, не новые.
 */
/**
 * Экспортировано (без изменения значений) начиная со Slice 5 — переиспользуется
 * 1:1 инверсией в `legacyProjectionV2.ts`, чтобы обратная V2->legacy проекция
 * (contract §4.8.6) не заводила отдельную, потенциально расходящуюся копию
 * той же таблицы hex<->id.
 */
export const PRIMARY_HEX_TO_ID: Record<string, PrimaryColorAllele> = {
  '#FFC85C': 'primary_honey',
  '#F5A623': 'primary_amber',
  '#FF6F59': 'primary_sunset',
  '#FF8C77': 'primary_coral',
  '#CFA1E8': 'primary_lilac',
  '#B678D9': 'primary_violet',
  '#89D65C': 'primary_leaf',
  '#CBE9F2': 'primary_frost',
};

/** Экспортировано с тем же обоснованием, что и `PRIMARY_HEX_TO_ID` выше. */
export const SECONDARY_HEX_TO_ID: Record<string, SecondaryColorAllele> = {
  '#57993A': 'secondary_forest',
  '#FF6F59': 'secondary_sunset',
  '#F5A623': 'secondary_amber',
  '#E05543': 'secondary_crimson',
  '#9457BC': 'secondary_purple',
  '#A9D4E2': 'secondary_sky',
  '#D98C12': 'secondary_ochre',
};

/** Экспортировано с тем же обоснованием, что и `PRIMARY_HEX_TO_ID` выше. */
export const LEAF_COLOR_HEX_TO_ID: Record<string, LeafColorAllele> = {
  '#89D65C': 'leaf_color_meadow',
  '#6FBE44': 'leaf_color_fresh',
  '#57993A': 'leaf_color_forest',
};

// Безопасные дефолты для случая повреждённого/неизвестного hex в отдельном
// specimen (не всего JSON — тот случай ловит внешний try/catch в store.ts
// loadState()). Это защитная мера, не ожидаемый путь: все legacy-геномы,
// порождённые randomGenome()/breed(), всегда берут значения строго из
// перечисленных выше пулов.
const PRIMARY_FALLBACK: PrimaryColorAllele = 'primary_honey';
const SECONDARY_FALLBACK: SecondaryColorAllele = 'secondary_forest';
const LEAF_COLOR_FALLBACK: LeafColorAllele = 'leaf_color_meadow';

function patternToAllele(pattern: Pattern): PatternAllele {
  return pattern === 'solid' ? 'pattern_solid' : 'pattern_duotone';
}

function sizeToAllele(size: SizeTier): SizeAllele {
  return `size_${size}` as SizeAllele;
}

function auraToAllele(aura: AuraTier): AuraAllele {
  return `aura_${aura}` as AuraAllele;
}

/**
 * Четыре legacy `mutationId`, реально достижимые через текущий код
 * (`config.ts` `MUTATIONS_CONFIG`, аудит §4.4). Единственный список,
 * который `migrateMutationId` считает «известным» для копирования 1:1 —
 * `double_bloom`/`luminous_edge` из полного Gate-1-каталога сюда сознательно
 * не входят: они не существуют как legacy-значения, появятся только через
 * mutation roll V2 (Slice 4), в legacy-сохранении их быть не может.
 */
const KNOWN_LEGACY_MUTATION_IDS: readonly MutationIdV2[] = ['golden_vein', 'stardust', 'prism', 'phoenix'];

/**
 * Миграция `genome.mutationId` -> `genomeV2.mutationId` (contract §4.4,
 * исправлено в проходе 6 — устраняет дефект, где эта функция всегда
 * возвращала `null`). Копирует один из четырёх известных legacy ID 1:1;
 * `null` остаётся `null`; неизвестное/повреждённое значение НЕ роняет
 * миграцию — возвращает `null` для `genomeV2`, но НЕ трогает исходный
 * `genome.mutationId` (вызывающая сторона его не переписывает, см.
 * `migrateGenomeToV2` ниже: legacy `genome` в specimen не изменяется).
 *
 * Это перенос уже состоявшегося исторического результата, а не новый
 * mutation roll — функция чистая, без RNG, не трогает `pityCounter`.
 */
export function migrateMutationId(legacyMutationId: string | null): MutationIdV2 | null {
  if (legacyMutationId === null) return null;
  return (KNOWN_LEGACY_MUTATION_IDS as readonly string[]).includes(legacyMutationId)
    ? (legacyMutationId as MutationIdV2)
    : null;
}

/**
 * Строит `GenomeV2` sidecar из legacy `Genome` (contract §4.4). Гомозиготна
 * каждая пара аллелей (`a === b`) — миграция никогда не создаёт скрытого
 * состояния (delta doc §7 п.1-2). Три новых геометрических локуса
 * (`stemForm`/`leafForm`/`flowerForm`), которых в legacy-геноме не
 * существовало вовсе, получают нейтральный дефолтный ID
 * (`stem_standard`/`leaf_standard`/`flower_standard`, delta doc §7 п.3).
 *
 * Не мутирует переданный `genome` и не хранит на него ссылок из
 * результата — вызывающая сторона (`ensureGenomeV2Sidecars`) отдельно
 * гарантирует, что legacy `specimen.genome` не переписывается.
 */
export function migrateGenomeToV2(genome: Genome): GenomeV2 {
  return {
    stemForm: homozygous('stem_standard'),
    leafForm: homozygous('leaf_standard'),
    flowerForm: homozygous('flower_standard'),
    primaryColor: homozygous(PRIMARY_HEX_TO_ID[genome.primary] ?? PRIMARY_FALLBACK),
    secondaryColor: homozygous(SECONDARY_HEX_TO_ID[genome.secondary] ?? SECONDARY_FALLBACK),
    leafColor: homozygous(LEAF_COLOR_HEX_TO_ID[genome.leaf] ?? LEAF_COLOR_FALLBACK),
    pattern: homozygous(patternToAllele(genome.pattern)),
    size: homozygous(sizeToAllele(genome.size)),
    aura: homozygous(auraToAllele(genome.aura)),
    speciesId: genome.shape,
    mutationId: migrateMutationId(genome.mutationId),
  };
}

/**
 * Идемпотентный backfill `genomeV2` (delta doc §7.2, механизм 2). Проходит
 * по всем specimens и создаёт sidecar ТОЛЬКО тем, у кого его нет —
 * существующий `genomeV2` никогда не пересчитывается и не перезаписывается
 * (при отсутствии работы для конкретного specimen возвращается тот же самый
 * объект по ссылке, не копия). Не читает и не пишет `pollen`/`labLevel`/
 * обучающие флаги/`pityCounter` — это исключительно операция над
 * `Specimen.genomeV2`. Работает при любом `SAVE_VERSION`, независимо от
 * feature flags, без RNG — полностью детерминирована.
 *
 * ВАЖНО: не вызывает и не подразумевает никакой игровой логики (breed,
 * рост, экономику) — только структура данных, как того требует Slice 1.
 */
export function ensureGenomeV2Sidecars(specimens: Specimen[]): Specimen[] {
  return specimens.map((specimen) => {
    if (specimen.genomeV2) return specimen;
    try {
      return { ...specimen, genomeV2: migrateGenomeToV2(specimen.genome) };
    } catch {
      // Защитный путь, не ожидаемый для реальных данных: legacy `genome`
      // отсутствует или повреждён настолько, что даже безопасные hex/enum
      // фоллбэки внутри migrateGenomeToV2 не спасают (например, сам `genome`
      // — не объект). Backfill этого одного specimen безопасно пропускается
      // (specimen возвращается без sidecar, как есть) — вся загрузка save
      // не должна падать из-за одного повреждённого specimen (тот же
      // принцип, что и у migrateMutationId для неизвестного ID выше).
      return specimen;
    }
  });
}
