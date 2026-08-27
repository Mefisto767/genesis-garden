import type { PlantColorway } from './plantPalette';
import type { Genome } from './genetics';
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
}

export type { QuestGoalType };
export const MAX_PLOTS = GARDEN_CONFIG.maxPlots;
export const START_UNLOCKED_PLOTS = GARDEN_CONFIG.startUnlockedPlots;
