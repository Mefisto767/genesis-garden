import type { SeedDef } from './types';
import { PALETTE, plantThumbUrl, type PlantColorway } from './plantPalette';
import { SEED_BALANCE } from './config';

// Числа экономики (таймеры/цены/вид) — из единого конфига баланса
// (src/game/config.ts), правило 14 мастер-промта. Здесь остаётся только
// визуальный окрас (colorway) — это художественный выбор тира, не баланс,
// пока не подключена генетика к самим семенам магазина.
const COLORWAY_BY_SEED_ID: Record<string, PlantColorway> = {
  sprout: { primary: PALETTE.coralLight, secondary: PALETTE.amber, leaf: PALETTE.leaf },
  common: { primary: PALETTE.coral, secondary: PALETTE.amber, leaf: PALETTE.leaf },
  upgraded: { primary: PALETTE.amber, secondary: PALETTE.purple, leaf: PALETTE.leafDark },
};

export const SEED_CATALOG: SeedDef[] = SEED_BALANCE.map((s) => ({
  id: s.id,
  name: s.name,
  growMs: s.growMs,
  buyCost: s.buyCost,
  sellValue: s.sellValue,
  speciesId: s.speciesId,
  colorway: COLORWAY_BY_SEED_ID[s.id] ?? { primary: PALETTE.neutral, secondary: PALETTE.neutral, leaf: PALETTE.leaf },
}));

export function getSeedDef(id: string): SeedDef | undefined {
  return SEED_CATALOG.find((s) => s.id === id);
}

export function seedThumb(seed: SeedDef): string {
  return plantThumbUrl(seed.speciesId);
}

export type { PlantColorway };
