import type { SeedDef } from './types';

// v0.1 placeholder economy: 3 tiers matching the design doc's timer spread
// (учебное / обычное / улучшенное). No genetics yet — that's stage 2.
export const SEED_CATALOG: SeedDef[] = [
  {
    id: 'sprout',
    name: 'Росток',
    emoji: '🌱',
    growMs: 60 * 1000, // 1 минута — учебное растение
    buyCost: 5,
    sellValue: 8,
  },
  {
    id: 'common',
    name: 'Обычный цветок',
    emoji: '🌼',
    growMs: 15 * 60 * 1000, // 15 минут — обычное
    buyCost: 15,
    sellValue: 35,
  },
  {
    id: 'upgraded',
    name: 'Улучшенный цветок',
    emoji: '🌸',
    growMs: 2 * 60 * 60 * 1000, // 2 часа — улучшенное
    buyCost: 60,
    sellValue: 170,
  },
];

export function getSeedDef(id: string): SeedDef | undefined {
  return SEED_CATALOG.find((s) => s.id === id);
}
