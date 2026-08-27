// ============================================================================
// Единая конфигурация баланса игры (правило 14 мастер-промта: все изменяемые
// параметры баланса — здесь, а не размазаны по компонентам/модулям).
// Меняя числа в этом файле, ты меняешь экономику всей игры — ничего не нужно
// трогать в genetics.ts / store.ts / seedCatalog.ts.
// ============================================================================

import type { AuraTier, Pattern, RarityTier, SizeTier } from './genetics';

// --- Экономика грядок ---------------------------------------------------
export const GARDEN_CONFIG = {
  maxPlots: 24,
  startUnlockedPlots: 6,
  /** cost(plotId) = unlockCostBase + (plotId - startUnlockedPlots) * unlockCostStep */
  unlockCostBase: 20,
  unlockCostStep: 12,
} as const;

// --- Семена / рост / сбор ------------------------------------------------
export interface SeedBalanceDef {
  id: string;
  name: string;
  growMs: number;
  buyCost: number;
  sellValue: number;
  speciesId: number;
}

export const SEED_BALANCE: SeedBalanceDef[] = [
  { id: 'sprout', name: 'Росток', growMs: 60 * 1000, buyCost: 5, sellValue: 8, speciesId: 1 },
  { id: 'common', name: 'Обычный цветок', growMs: 15 * 60 * 1000, buyCost: 15, sellValue: 35, speciesId: 2 },
  { id: 'upgraded', name: 'Улучшенный цветок', growMs: 2 * 60 * 60 * 1000, buyCost: 60, sellValue: 170, speciesId: 5 },
];

// --- Скрещивание / коллекция ---------------------------------------------
export const BREEDING_CONFIG = {
  breedCost: 12,
  dustRewardMin: 2,
  dustRewardMax: 5,
  /** Сколько пыли фиксирует один наследуемый признак при следующей попытке (Этап 5). */
  dustCostPerLockedGene: 8,
  /**
   * Переработка лишнего специмена в пыль (Этап 5, `GameStore.recycleSpecimen`) —
   * зеркалирует серверную `recycle_plant()` (см. docs/ECONOMY.md). Прежняя
   * продажа за монеты (`sellSpecimenValue`) убрана — расхождение с сервером
   * устранено.
   */
  recycleDustReward: 5,
} as const;

// --- Генетика --------------------------------------------------------------
export const GENETICS_CONFIG = {
  pityThreshold: 10,
  mutationChance: 0.06,
  geneMutateChance: 0.08,
  pityMutationChance: 0.7,
  pityTraitChance: 0.35,
  shapes: [1, 2, 3, 4, 5, 6, 7, 8] as const,
  primaryPool: ['#FF8C77', '#FF6F59', '#F5A623', '#FFC85C', '#B678D9', '#CFA1E8', '#89D65C', '#CBE9F2'] as const,
  secondaryPool: ['#F5A623', '#FF6F59', '#9457BC', '#57993A', '#E05543', '#A9D4E2', '#D98C12'] as const,
  leafPool: ['#6FBE44', '#89D65C', '#57993A'] as const,
  sizeTiers: ['small', 'normal', 'normal', 'large', 'giant'] as SizeTier[],
  auraTiers: ['none', 'none', 'none', 'faint', 'faint', 'glow'] as AuraTier[],
  patterns: ['solid', 'duotone'] as Pattern[],
} as const;

export interface MutationDef {
  id: string;
  name: string;
  minRarity: RarityTier;
}

export const MUTATIONS_CONFIG: MutationDef[] = [
  { id: 'golden_vein', name: 'Золотая жилка', minRarity: 'rare' },
  { id: 'stardust', name: 'Звёздная пыльца', minRarity: 'epic' },
  { id: 'prism', name: 'Призма', minRarity: 'epic' },
  { id: 'phoenix', name: 'Феникс', minRarity: 'legendary' },
];

// --- Редкость (очки для rarityOf) ------------------------------------------
export const RARITY_SCORING = {
  giantSize: 2,
  largeSize: 1,
  radiantAura: 3,
  glowAura: 2,
  faintAura: 1,
  duotonePattern: 1,
  epicThreshold: 5,
  rareThreshold: 3,
  uncommonThreshold: 1,
} as const;

// --- Ускорители / entitlements (Этап 7 наполнит реальными покупками) ------
export const BOOSTS_CONFIG = {
  /** Правило мастер-промта: суммарное ускорение роста не больше 25%. */
  maxTotalGrowthBoostPercent: 0.25,
} as const;

// --- Стартовое состояние нового игрока --------------------------------------
export const STARTING_STATE_CONFIG = {
  startingCoins: 50,
  startingSprouts: 3,
  startingSpecimenCount: 2,
} as const;

// --- Квесты (онбординг + ежедневные, минимальный набор Этапа 2) ------------
export type QuestGoalType = 'plant' | 'harvest' | 'breed';

export interface QuestDef {
  id: string;
  title: string;
  description: string;
  goalType: QuestGoalType;
  target: number;
  rewardCoins: number;
  rewardDust: number;
}

export const QUEST_CATALOG: QuestDef[] = [
  {
    id: 'first_plant',
    title: 'Первая посадка',
    description: 'Посади любое семя в саду',
    goalType: 'plant',
    target: 1,
    rewardCoins: 5,
    rewardDust: 0,
  },
  {
    id: 'first_harvest',
    title: 'Первый урожай',
    description: 'Собери выросшее растение',
    goalType: 'harvest',
    target: 1,
    rewardCoins: 10,
    rewardDust: 0,
  },
  {
    id: 'first_breed',
    title: 'Первое скрещивание',
    description: 'Скрести две особи в лаборатории',
    goalType: 'breed',
    target: 1,
    rewardCoins: 0,
    rewardDust: 3,
  },
  {
    id: 'harvest_five',
    title: 'Опытный садовник',
    description: 'Собери урожай 5 раз',
    goalType: 'harvest',
    target: 5,
    rewardCoins: 25,
    rewardDust: 0,
  },
];
