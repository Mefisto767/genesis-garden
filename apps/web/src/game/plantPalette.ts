// ============================================================================
// Чистые данные об арт-паке растений (палитра, ключи текстур, пути к превью)
// — БЕЗ импорта Phaser. Вынесено отдельно от plantArt.ts (Этап 2, "отдели
// состояние игры от компонентов интерфейса"), потому что store.ts и
// seedCatalog.ts — часть чистой игровой модели, которая должна собираться и
// тестироваться (Vitest/jsdom) без загрузки рендер-движка Phaser. Раньше
// store.ts -> seedCatalog.ts -> plantArt.ts тянул `import Phaser from 'phaser'`
// транзитивно, из-за чего unit-тесты падали на инициализации canvas-фич Phaser.
// ============================================================================

export const PLANT_STAGES = 3;

export interface PlantColorway {
  primary: number;
  secondary: number;
  leaf: number;
}

// Палитра проекта (style_guide.png из арт-пака)
export const PALETTE = {
  cream: 0xfdf3d9,
  ink: 0x4a2e17,
  amber: 0xf5a623,
  amberLight: 0xffc85c,
  leaf: 0x6fbe44,
  leafLight: 0x89d65c,
  leafDark: 0x57993a,
  coral: 0xff6f59,
  coralLight: 0xff8c77,
  neutral: 0xb7afa0,
  wood: 0x8b5e3c,
  woodShade: 0x6b4a2e,
  purple: 0xb678d9,
} as const;

export const PLANT_LAYERS = ['mask_leaf', 'mask_secondary', 'mask_primary', 'line'] as const;

function assetBase(speciesId: number, stage: number): string {
  const s = String(speciesId).padStart(2, '0');
  return `plant_species${s}_stage${stage}`;
}

export function plantTextureKey(speciesId: number, stage: number, layer: string): string {
  return `${assetBase(speciesId, stage)}_${layer}`;
}

/** Ключ превью-картинки (цветной референс) для React-UI. */
export function plantThumbUrl(speciesId: number): string {
  return `assets/plants/${assetBase(speciesId, 3)}_ref.png`;
}

export function plantLayerUrl(speciesId: number, stage: number, layer: string): string {
  return `assets/plants/${assetBase(speciesId, stage)}_${layer}.png`;
}
