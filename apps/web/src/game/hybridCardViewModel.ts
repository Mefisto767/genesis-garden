// ============================================================================
// Genetics V2 — fix-pass (audit, bug 3): подготовка данных «простой карточки»
// (`HybridCardPanel.tsx`) как чистая типизированная функция, ОТДЕЛЬНО от
// React-компонента. В репозитории нет React Testing Library и `vitest.config.ts`
// включает только `src/**/*.test.ts` (ни одного `.tsx`) — значит логика выбора
// текста должна быть unit-тестируема напрямую, без рендера компонента.
//
// Источник данных — исключительно уже существующие чистые резолверы:
// `resolveSimpleCard` (phenotypeV2.ts, Slice 2) и `rarityOfV2` (rarityV2.ts,
// Slice 4). Эта функция не добавляет новой игровой логики — она только
// переводит уже выраженный фенотип (никаких `AllelePair`/`parentIds`/
// `revealedLoci` сюда не попадает и попасть не может, задание владельца:
// «не показывать скрытые пары аллелей, parentIds, микроскоп или Reveal») в
// русские названия через исчерпывающие `Record<Allele, string>` — тот же
// принцип полноты, что уже применён в `DOMINANCE_TABLE` (phenotypeV2.ts) и
// обратных hex-таблицах (legacyProjectionV2.ts): TypeScript отказывается
// компилировать любую из этих таблиц, если пропущен хотя бы один аллель/
// mutationId/rarity tier — добавление нового значения в любой из этих union
// типов ловится на этапе `tsc`, а не в рантайме.
// ============================================================================

import type {
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
import { GENOME_V2_LOCUS_KEYS } from './geneticsV2';
import { resolveExtendedCard, resolveSimpleCard } from './phenotypeV2';
import { rarityOfV2, type RarityTierV2 } from './rarityV2';

const STEM_FORM_LABEL: Record<StemFormAllele, string> = {
  stem_standard: 'Обычный',
  stem_branching: 'Ветвистый',
  stem_climbing: 'Вьющийся',
};

const LEAF_FORM_LABEL: Record<LeafFormAllele, string> = {
  leaf_standard: 'Обычная',
  leaf_broad: 'Широкая',
  leaf_narrow: 'Узкая',
  leaf_frilled: 'Волнистая',
};

const FLOWER_FORM_LABEL: Record<FlowerFormAllele, string> = {
  flower_standard: 'Обычная',
  flower_fan: 'Веерная',
  flower_cap: 'Колпачком',
  flower_star: 'Звёздчатая',
};

const PRIMARY_COLOR_LABEL: Record<PrimaryColorAllele, string> = {
  primary_honey: 'Медовый',
  primary_amber: 'Янтарный',
  primary_sunset: 'Закатный',
  primary_coral: 'Коралловый',
  primary_lilac: 'Сиреневый',
  primary_violet: 'Фиолетовый',
  primary_leaf: 'Листовой',
  primary_frost: 'Морозный',
};

const SECONDARY_COLOR_LABEL: Record<SecondaryColorAllele, string> = {
  secondary_forest: 'Лесной',
  secondary_sunset: 'Закатный',
  secondary_amber: 'Янтарный',
  secondary_crimson: 'Малиновый',
  secondary_purple: 'Пурпурный',
  secondary_sky: 'Небесный',
  secondary_ochre: 'Охра',
};

const LEAF_COLOR_LABEL: Record<LeafColorAllele, string> = {
  leaf_color_meadow: 'Луговой',
  leaf_color_fresh: 'Свежий',
  leaf_color_forest: 'Лесной',
};

const PATTERN_LABEL: Record<PatternAllele, string> = {
  pattern_solid: 'Однотонный',
  pattern_duotone: 'Двухтонный',
  pattern_spots: 'Пятнистый',
  pattern_stripes: 'Полосатый',
  pattern_veins: 'Прожилки',
};

const SIZE_LABEL: Record<SizeAllele, string> = {
  size_normal: 'Обычный',
  size_large: 'Крупный',
  size_small: 'Мелкий',
  size_giant: 'Гигантский',
};

const AURA_LABEL: Record<AuraAllele, string> = {
  aura_none: 'Нет',
  aura_faint: 'Слабая',
  aura_glow: 'Свечение',
  aura_radiant: 'Сияние',
};

/**
 * Все шесть `MutationIdV2` Gate 1 (geneticsV2.ts) — включая `double_bloom`/
 * `luminous_edge`, которых ещё нет в legacy `MUTATIONS_CONFIG` (config.ts:73-78,
 * достижимы только через mutation roll V2, Slice 4). `Record<MutationIdV2,
 * string>` не компилируется, если пропущен хотя бы один из шести.
 */
const MUTATION_LABEL: Record<MutationIdV2, string> = {
  golden_vein: 'Золотая жилка',
  double_bloom: 'Двойное цветение',
  stardust: 'Звёздная пыльца',
  prism: 'Призма',
  luminous_edge: 'Светящаяся кромка',
  phoenix: 'Феникс',
};

const RARITY_LABEL: Record<RarityTierV2, string> = {
  Common: 'Обычная',
  Uncommon: 'Необычная',
  Rare: 'Редкая',
  Epic: 'Эпическая',
  Legendary: 'Легендарная',
  Mythic: 'Мифическая',
};

/**
 * Gate 1 поддерживает только Солнечника (`speciesId:1`) и Колокольника
 * (`speciesId:2`) как родителей V2 (`nurseryV2.ts` `SPECIES_GROWTH_V2`) —
 * единственный путь рождения mature `Plot.hybridV2` specimen — это
 * `breedNurseryV2`, ограниченный этими двумя видами, так что `speciesId`
 * простой карточки на практике не может быть другим числом. `GenomeV2.
 * speciesId` типизирован как обычный `number` (не union, contract §4.1) —
 * значит TS-исчерпывающий `Record` в строгом смысле здесь физически
 * невозможен так же, как для остальных таблиц выше. Вместо этого — явный
 * `Record<1 | 2, string>` (тот же принцип полноты для двух реально
 * возможных значений) плюс честный текстовый fallback для любого другого
 * числа, чтобы повреждённые/непредвиденные данные не роняли UI.
 */
const SPECIES_NAME_BY_ID: Record<1 | 2, string> = {
  1: 'Солнечник',
  2: 'Колокольник',
};

function speciesNameV2(speciesId: number): string {
  return SPECIES_NAME_BY_ID[speciesId as 1 | 2] ?? `Вид #${speciesId}`;
}

/**
 * Русское название категории локуса (Slice 8, микроскоп/расширенная
 * карточка, delta doc §6.1: «список выбора содержит только понятное русское
 * название категории, но не значение скрытого аллеля»). Те же подписи, что
 * уже используются как `label` в `loci` простой карточки выше — единственный
 * источник истины для названия каждой из девяти категорий, не дублируется.
 */
export const LOCUS_CATEGORY_LABEL_V2: Record<GenomeV2LocusKey, string> = {
  stemForm: 'Стебель',
  leafForm: 'Форма листвы',
  flowerForm: 'Форма цветка',
  primaryColor: 'Основной цвет',
  secondaryColor: 'Доп. цвет',
  leafColor: 'Листва',
  pattern: 'Узор',
  size: 'Размер',
  aura: 'Аура',
};

/**
 * Один общий словарь «локус -> (аллель -> русское название)», собранный из
 * уже существующих исчерпывающих таблиц выше (Slice 5 fix-pass, дефект 3) —
 * не дублирует ни одно значение, только группирует уже готовые Record'ы под
 * общий индекс по `GenomeV2LocusKey`, чтобы микроскоп (Slice 8) мог перевести
 * произвольный раскрытый аллель без девяти отдельных `switch`-веток.
 */
const LOCUS_ALLELE_LABELS: { readonly [K in GenomeV2LocusKey]: Record<string, string> } = {
  stemForm: STEM_FORM_LABEL,
  leafForm: LEAF_FORM_LABEL,
  flowerForm: FLOWER_FORM_LABEL,
  primaryColor: PRIMARY_COLOR_LABEL,
  secondaryColor: SECONDARY_COLOR_LABEL,
  leafColor: LEAF_COLOR_LABEL,
  pattern: PATTERN_LABEL,
  size: SIZE_LABEL,
  aura: AURA_LABEL,
};

/**
 * Переводит raw ID аллеля произвольного локуса в русское название (Slice 8,
 * микроскоп — «показать точное русское название скрытого аллеля... Не
 * показывать raw ID»). Fix-pass (дефект 3): fallback НИКОГДА не возвращает
 * сам `alleleId` — для повреждённого/непредвиденного значения используется
 * безопасный русский текст `Неизвестный признак`, чтобы raw ID физически не
 * мог попасть в DOM ни при каких данных (не ожидается для реальных данных:
 * все каталожные аллели Gate 1 присутствуют в исчерпывающих таблицах выше).
 */
export function alleleLabelV2(locus: GenomeV2LocusKey, alleleId: string): string {
  return LOCUS_ALLELE_LABELS[locus][alleleId] ?? 'Неизвестный признак';
}

/**
 * Один локус на простой карточке — уже переведённые русские подпись и
 * значение, никаких raw ID и никаких скрытых `AllelePair` (см.
 * `hybridCardViewModel.test.ts` — тест явно проверяет отсутствие утечки
 * скрытых пар через этот тип: `value` всегда `string`).
 */
export interface HybridCardLocusRow {
  key:
    | 'stemForm'
    | 'leafForm'
    | 'flowerForm'
    | 'primaryColor'
    | 'secondaryColor'
    | 'leafColor'
    | 'pattern'
    | 'size'
    | 'aura';
  label: string;
  value: string;
}

/** Полная модель отображения простой карточки — единственное, что читает
 * `HybridCardPanel.tsx`. Ровно девять строк в `loci`, без пропусков и без
 * дублей (порядок — как в задании владельца: stemForm, leafForm, flowerForm,
 * primaryColor, secondaryColor, leafColor, pattern, size, aura). */
export interface HybridCardViewModel {
  speciesName: string;
  rarity: RarityTierV2;
  rarityLabel: string;
  /** `null`, если у экземпляра нет мутации — компонент не рендерит строку. */
  mutationLabel: string | null;
  loci: HybridCardLocusRow[];
}

/**
 * Строит `HybridCardViewModel` из полного `GenomeV2` зрелого V2-специмена
 * (contract §4.8.4, delta doc §6.1). Чистая функция: без React, без чтения
 * `GameState`/`Specimen` целиком — только `genomeV2`, переданный по значению.
 * Использует `resolveSimpleCard` (выраженный фенотип всех девяти локусов) и
 * `rarityOfV2(genomeV2, genomeV2.mutationId)` ровно так, как требует задание
 * владельца — не пересчитывает редкость никаким другим способом.
 */
export function buildHybridCardViewModel(genomeV2: GenomeV2): HybridCardViewModel {
  const card = resolveSimpleCard(genomeV2);
  const rarity = rarityOfV2(genomeV2, genomeV2.mutationId);
  return {
    speciesName: speciesNameV2(card.speciesId),
    rarity,
    rarityLabel: RARITY_LABEL[rarity],
    mutationLabel: card.mutationId ? MUTATION_LABEL[card.mutationId] : null,
    loci: [
      { key: 'stemForm', label: 'Стебель', value: STEM_FORM_LABEL[card.stemForm] },
      { key: 'leafForm', label: 'Форма листвы', value: LEAF_FORM_LABEL[card.leafForm] },
      { key: 'flowerForm', label: 'Форма цветка', value: FLOWER_FORM_LABEL[card.flowerForm] },
      { key: 'primaryColor', label: 'Основной цвет', value: PRIMARY_COLOR_LABEL[card.primaryColor] },
      { key: 'secondaryColor', label: 'Доп. цвет', value: SECONDARY_COLOR_LABEL[card.secondaryColor] },
      { key: 'leafColor', label: 'Листва', value: LEAF_COLOR_LABEL[card.leafColor] },
      { key: 'pattern', label: 'Узор', value: PATTERN_LABEL[card.pattern] },
      { key: 'size', label: 'Размер', value: SIZE_LABEL[card.size] },
      { key: 'aura', label: 'Аура', value: AURA_LABEL[card.aura] },
    ],
  };
}

// ============================================================================
// Genetics V2 — Slice 8 UI fix-pass: view-model расширенной карточки
// (микроскоп, `MicroscopePanel.tsx`). Единый контракт видимости (задание
// владельца, дословно):
//
//   до раскрытия (гетерозигота): "[Категория]: видно — [выраженный аллель],
//   скрыто — Не исследован" — значение скрытого аллеля НИКОГДА не попадает в
//   этот объект (типом — см. `MicroscopeCardLocusRow` ниже, не проверкой в
//   рантайме).
//
//   после раскрытия: "[Категория]: видно — [выраженный аллель], скрыто —
//   [раскрытый аллель]" отдельной строкой "[Выраженный] доминирует над
//   [скрытым]" и отдельно источник ("Раскрыт микроскопом"/"Раскрыт
//   естественно").
//
//   гомозиготный локус: единственное значение, без фиктивного скрытого
//   признака и без кнопки раскрытия.
//
// Строится исключительно поверх уже принятого `resolveExtendedCard` (Slice
// 2) — не пересчитывает homozygous/unresearched/revealed никаким другим
// способом. Компонент (`MicroscopePanel.tsx`) только рендерит готовые строки
// этого view-model'а, ни одной строки не строит сам в JSX.
// ============================================================================

/** Один локус расширенной карточки — homozygous-ветка: единственное
 * значение, без скрытого состояния (задание: "без фиктивного скрытого
 * признака и без кнопки раскрытия"). */
export interface MicroscopeCardHomozygousRow {
  readonly key: GenomeV2LocusKey;
  readonly label: string;
  readonly state: 'homozygous';
  readonly valueLabel: string;
}

/** Гетерозиготный локус до раскрытия — `hiddenLabel`/`dominanceLine`/
 * `sourceLabel` физически ОТСУТСТВУЮТ в этом варианте типа (не `null`, а
 * не существуют как поля вовсе): скрытое значение не может утечь в DOM
 * через этот объект ни при каком рендере, потому что рендерить нечего. */
export interface MicroscopeCardUnresearchedRow {
  readonly key: GenomeV2LocusKey;
  readonly label: string;
  readonly state: 'unresearched';
  /** Точный текст: "[Категория]: видно — [выраженный], скрыто — Не исследован". */
  readonly statusLine: string;
}

/** Гетерозиготный локус после раскрытия — оба аллеля видны, плюс отдельная
 * строка доминирования и отдельная строка источника (задание: "отдельной
 * строкой"/"и отдельно источник" — не склеены с `statusLine`). */
export interface MicroscopeCardRevealedRow {
  readonly key: GenomeV2LocusKey;
  readonly label: string;
  readonly state: 'revealed';
  /** Точный текст: "[Категория]: видно — [выраженный], скрыто — [раскрытый]". */
  readonly statusLine: string;
  /** Точный текст: "[Выраженный аллель] доминирует над [скрытым аллелем]". */
  readonly dominanceLine: string;
  /** "Раскрыт микроскопом" либо "Раскрыт естественно". */
  readonly sourceLabel: string;
}

export type MicroscopeCardLocusRow =
  | MicroscopeCardHomozygousRow
  | MicroscopeCardUnresearchedRow
  | MicroscopeCardRevealedRow;

/**
 * Строит все девять строк расширенной карточки в стабильном порядке
 * `GENOME_V2_LOCUS_KEYS` (задание: "все девять локусов выводятся в
 * стабильном порядке"). Чистая функция — без React, без чтения `GameState`/
 * `Specimen` целиком, только `genomeV2`+`revealedLoci` по значению, как и
 * `resolveExtendedCard`, поверх которого она построена. Раскрытие ОДНОГО
 * локуса (через содержимое `revealedLoci`) не может изменить строки других
 * локусов — каждая строка строится независимо из своего собственного
 * `ExtendedLocusView`.
 */
export function buildMicroscopeCardViewModel(
  genomeV2: GenomeV2,
  revealedLoci: readonly RevealedLocusEntry[] = []
): MicroscopeCardLocusRow[] {
  const card = resolveExtendedCard(genomeV2, revealedLoci);
  return GENOME_V2_LOCUS_KEYS.map((locus): MicroscopeCardLocusRow => {
    const label = LOCUS_CATEGORY_LABEL_V2[locus];
    const view = card[locus];

    if (view.state === 'homozygous') {
      return { key: locus, label, state: 'homozygous', valueLabel: alleleLabelV2(locus, view.allele) };
    }

    const expressedLabel = alleleLabelV2(locus, view.expressed);

    if (view.state === 'unresearched') {
      return {
        key: locus,
        label,
        state: 'unresearched',
        statusLine: `${label}: видно — ${expressedLabel}, скрыто — Не исследован`,
      };
    }

    const hiddenLabel = alleleLabelV2(locus, view.hidden);
    return {
      key: locus,
      label,
      state: 'revealed',
      statusLine: `${label}: видно — ${expressedLabel}, скрыто — ${hiddenLabel}`,
      dominanceLine: `${expressedLabel} доминирует над ${hiddenLabel}`,
      sourceLabel: view.source === 'microscope' ? 'Раскрыт микроскопом' : 'Раскрыт естественно',
    };
  });
}
