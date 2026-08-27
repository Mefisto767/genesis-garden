import Phaser from 'phaser';
import { BootSceneOverhaul } from './scenes/BootSceneOverhaul';
import { EstateScene } from './scenes/EstateScene';
import { LaboratoryScene } from './scenes/LaboratoryScene';

/** То же, что createPhaserGame (PhaserGame.ts), но со сценами overhaul-режима.
 * Классический режим продолжает использовать createPhaserGame + BootScene/
 * GardenScene без изменений — эти два игровых движка не пересекаются. */
export function createOverhaulPhaserGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
    backgroundColor: '#2E4B2F',
    pixelArt: true,
    roundPixels: true,
    scene: [BootSceneOverhaul, EstateScene, LaboratoryScene],
    input: {
      activePointers: 2,
    },
  });
}
