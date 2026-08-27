import type { PlantColorway } from './plantArt';
import type { Genome } from './genetics';

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
}

export interface Plot {
  id: number;
  unlocked: boolean;
  seedId: string | null;
  plantedAt: number | null;
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
}

export const MAX_PLOTS = 24;
export const START_UNLOCKED_PLOTS = 6;
