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
  LeafColorAllele,
  LeafFormAllele,
  MutationIdV2,
  PatternAllele,
  PrimaryColorAllele,
  SecondaryColorAllele,
  SizeAllele,
  StemFormAllele,
} from './geneticsV2';
import { resolveSimpleCard } from './phenotypeV2';
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
