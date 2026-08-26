import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GardenScene } from './scenes/GardenScene';

export function createPhaserGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
    backgroundColor: '#eaf5e6',
    scene: [BootScene, GardenScene],
    // Мобильный браузер: не даём странице скроллиться/зумиться жестами по канвасу.
    input: {
      activePointers: 2,
    },
  });
}
