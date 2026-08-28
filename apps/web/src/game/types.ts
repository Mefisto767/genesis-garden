import type { PlantColorway } from './plantPalette';
import type { Genome } from './genetics';
import type { GenomeV2, HybridSeedV2, RevealedLocusEntry } from './geneticsV2';
import { GARDEN_CONFIG, type QuestGoalType } from './config';

export interface SeedDef {
  id: string;
  name: string;
  growMs: number;
  buyCost: number;
  sellValue: number;
  /** Вид растения (форма силуэта) из арт-пака — 1..8. */
  speciesId: number;
  /** Фиксированный окрас тира — базовая экономика, без генетики. */
  colorway: PlantColorway;
}

/** Экземпляр с геномом — продукт скрещивания (Этап 2), живёт в коллекции игрока. */
export interface Specimen {
  id: string;
  genome: Genome;
  createdAt: number;
  /**
   * Избранное (Этап 5) — чисто клиентский флаг для быстрой сортировки/защиты
   * от случайной переработки, пока не синхронизируется с сервером.
   * Необязательное поле: у сохранений до Этапа 5 его нет — undefined
   * читается как false, миграция SAVE_VERSION не нужна.
   */
  favorite?: boolean;
  /**
   * Genetics V2 sidecar (Slice 1, GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md
   * §4.1/§4.4). Legacy `genome` выше НЕ удаляется и не переписывается —
   * legacy-движок продолжает читать только его. `genomeV2` заполняется
   * `ensureGenomeV2Sidecars()` (game/geneticsV2.ts) при каждой загрузке save
   * для любого specimen, у которого его ещё нет; undefined до первого
   * прохода backfill. В Slice 1 никакая игровая логика это поле не читает.
   */
  genomeV2?: GenomeV2;
  /** Родословная (Slice 10) — не заполняется в Slice 1. */
  parentIds?: [string, string] | null;
  /** Раскрытые скрытые локусы (Slice 8, delta doc §6.1) — не заполняется в Slice 1. */
  revealedLoci?: RevealedLocusEntry[];
}

export interface Plot {
  id: number;
  unlocked: boolean;
  seedId: string | null;
  plantedAt: number | null;
}

/** Временный буст (сейчас пусто — Этап 7 заполнит покупками ускорений). */
export interface Entitlement {
  id: string;
  type: 'growth_boost';
  /** Доля ускорения, напр. 0.1 = +10% к скорости роста. */
  percent: number;
  /** null = бессрочно (не используется в MVP, задел на сезонные покупки). */
  expiresAt: number | null;
}

export interface GameState {
  coins: number;
  plots: Plot[];
  inventory: Record<string, number>;
  /** Коллекция экземпляров с геномом — Этап 2. */
  specimens: Specimen[];
  /** Побочный ресурс от скрещивания; задел под будущую экономику (Этап 4). */
  geneticDust: number;
  /** Счётчик скрещиваний без мутации гена — pity-система. */
  pityCounter: number;
  /** Прогресс по квестам: questId -> текущий счётчик. */
  questProgress: Record<string, number>;
  /** id квестов, награда за которые уже забрана. */
  questsClaimed: string[];
  /** Активные ускорители (сейчас всегда []; Этап 7 подключит покупки). */
  entitlements: Entitlement[];

  // --- Genetics V2 — Slice 1 (save/state/feature flags), см.
  // docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.1 и
  // docs/GENETICS_TARGET_DELTA.md §12 Slice 1. Никакая игровая логика,
  // кроме миграции default-значений, эти поля в Slice 1 не читает и не
  // пишет — экономика/UI/breed подключаются в Slice 3+.

  /** Пыльца — новая валюта Genetics V2 (Slice 6). В Slice 1 только хранится. */
  pollen: number;
  /** Уровень лаборатории (1-4). В Slice 1 только мигрирует/хранится. */
  labLevel: number;
  /** Nursery Tray, вместимость 8 (Slice 5). В Slice 1 всегда пуст. */
  nurseryTray: HybridSeedV2[];
  /** Бесплатное первое скрещивание уже использовано (delta doc §6.2). */
  firstBreedFreeClaimed: boolean;
  /** Обучающий грант пыльцы + открытие Колокольника/Lab L2 уже выдан (delta doc §6.2). */
  firstHybridRewardClaimed: boolean;
  /** Компенсация пыли до 3 при первой переработке уже выдана (delta doc §6.2). */
  firstRecycleTopUpClaimed: boolean;
}

export type { QuestGoalType };
export const MAX_PLOTS = GARDEN_CONFIG.maxPlots;
export const START_UNLOCKED_PLOTS = GARDEN_CONFIG.startUnlockedPlots;
