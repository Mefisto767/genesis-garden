import Phaser from 'phaser';

// ============================================================================
// Послойный движок отрисовки растений — точка стыковки с генетикой (Этап 2).
//
// Каждое растение = 4 слоя из арт-пака Fable (см. claude/status.md в проекте):
//   1) mask_leaf      — белая маска листвы/стебля  → красится в цвет листа
//   2) mask_secondary — белая маска доп. канала     → красится в доп. цвет
//   3) mask_primary   — белая маска осн. канала     → красится в осн. цвет
//   4) line           — контур #4A2E17, прозрачные внутренности — всегда сверху
//
// Гены Этапа 2 будут просто менять speciesId (форма) и три цвета (окрас) —
// этот модуль трогать не придётся.
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

const LAYERS = ['mask_leaf', 'mask_secondary', 'mask_primary', 'line'] as const;

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

/** Загрузить все слои всех стадий вида. Вызывается из BootScene.preload(). */
export function preloadSpecies(load: Phaser.Loader.LoaderPlugin, speciesId: number) {
  for (let stage = 1; stage <= PLANT_STAGES; stage++) {
    for (const layer of LAYERS) {
      const key = plantTextureKey(speciesId, stage, layer);
      load.image(key, `assets/plants/${assetBase(speciesId, stage)}_${layer}.png`);
    }
  }
}

/**
 * Собрать спрайт растения в контейнер: три тонированные маски + контур.
 * size — сторона квадрата, в который вписывается растение.
 */
export function buildPlantSprite(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  speciesId: number,
  stage: number,
  colors: PlantColorway
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y);
  const tints: Record<(typeof LAYERS)[number], number | null> = {
    mask_leaf: colors.leaf,
    mask_secondary: colors.secondary,
    mask_primary: colors.primary,
    line: null,
  };
  for (const layer of LAYERS) {
    const key = plantTextureKey(speciesId, stage, layer);
    if (!scene.textures.exists(key)) continue;
    const img = scene.add.image(0, 0, key).setDisplaySize(size, size);
    const tint = tints[layer];
    if (tint !== null) img.setTintFill(tint);
    container.add(img);
  }
  return container;
}
