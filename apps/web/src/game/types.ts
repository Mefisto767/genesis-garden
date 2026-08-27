import type { PlantColorway } from './plantArt';

export interface SeedDef {
  id: string;
  name: string;
  growMs: number;
  buyCost: number;
  sellValue: number;
  /** Вид растения (форма силуэта) из арт-пака — 1..8. */
  speciesId: number;
  /** Фиксированный окрас тира; Этап 2 заменит на цвета из генома. */
  colorway: PlantColorway;
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
}

export const MAX_PLOTS = 24;
export const START_UNLOCKED_PLOTS = 6;
