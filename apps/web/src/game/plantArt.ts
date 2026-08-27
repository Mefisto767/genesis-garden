import Phaser from 'phaser';
import { PLANT_STAGES, PLANT_LAYERS, plantTextureKey, plantLayerUrl, type PlantColorway } from './plantPalette';

// ============================================================================
// Послойный движок отрисовки растений (Phaser-часть) — точка стыковки с
// генетикой (Этап 2). Чистые данные (палитра, ключи, URL) — в plantPalette.ts,
// этот файл содержит только то, что реально требует Phaser.
//
// Каждое растение = 4 слоя из арт-пака Fable (см. claude/status.md в проекте):
//   1) mask_leaf      — белая маска листвы/стебля  → красится в цвет листа
//   2) mask_secondary — белая маска доп. канала     → красится в доп. цвет
//   3) mask_primary   — белая маска осн. канала     → красится в осн. цвет
//   4) line           — контур #4A2E17, прозрачные внутренности — всегда сверху
// ============================================================================

export { PLANT_STAGES, PALETTE, plantTextureKey, plantThumbUrl, type PlantColorway } from './plantPalette';

/** Загрузить все слои всех стадий вида. Вызывается из BootScene.preload(). */
export function preloadSpecies(load: Phaser.Loader.LoaderPlugin, speciesId: number) {
  for (let stage = 1; stage <= PLANT_STAGES; stage++) {
    for (const layer of PLANT_LAYERS) {
      const key = plantTextureKey(speciesId, stage, layer);
      load.image(key, plantLayerUrl(speciesId, stage, layer));
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
  const tints: Record<(typeof PLANT_LAYERS)[number], number | null> = {
    mask_leaf: colors.leaf,
    mask_secondary: colors.secondary,
    mask_primary: colors.primary,
    line: null,
  };
  for (const layer of PLANT_LAYERS) {
    const key = plantTextureKey(speciesId, stage, layer);
    if (!scene.textures.exists(key)) continue;
    const img = scene.add.image(0, 0, key).setDisplaySize(size, size);
    const tint = tints[layer];
    if (tint !== null) img.setTintFill(tint);
    container.add(img);
  }
  return container;
}
