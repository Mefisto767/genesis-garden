import type { SeedDef } from './types';
import { PALETTE, plantThumbUrl, type PlantColorway } from './plantArt';

// v0.1 placeholder economy: 3 tiers matching the design doc's timer spread
// (учебное / обычное / улучшенное). No genetics yet — that's stage 2.
// speciesId/colorway — фиксированный "фенотип" тира до подключения генов:
// Этап 2 заменит их на значения, вычисленные из генома конкретного растения.
export const SEED_CATALOG: SeedDef[] = [
  {
    id: 'sprout',
    name: 'Росток',
    growMs: 60 * 1000, // 1 минута — учебное растение
    buyCost: 5,
    sellValue: 8,
    speciesId: 1, // ромашка
    colorway: {
      primary: PALETTE.coralLight,
      secondary: PALETTE.amber,
      leaf: PALETTE.leaf,
    },
  },
  {
    id: 'common',
    name: 'Обычный цветок',
    growMs: 15 * 60 * 1000, // 15 минут — обычное
    buyCost: 15,
    sellValue: 35,
    speciesId: 2, // тюльпан
    colorway: {
      primary: PALETTE.coral,
      secondary: PALETTE.amber,
      leaf: PALETTE.leaf,
    },
  },
  {
    id: 'upgraded',
    name: 'Улучшенный цветок',
    growMs: 2 * 60 * 60 * 1000, // 2 часа — улучшенное
    buyCost: 60,
    sellValue: 170,
    speciesId: 5, // звёздный цветок
    colorway: {
      primary: PALETTE.amber,
      secondary: PALETTE.purple,
      leaf: PALETTE.leafDark,
    },
  },
];

export function getSeedDef(id: string): SeedDef | undefined {
  return SEED_CATALOG.find((s) => s.id === id);
}

export function seedThumb(seed: SeedDef): string {
  return plantThumbUrl(seed.speciesId);
}

export type { PlantColorway };
