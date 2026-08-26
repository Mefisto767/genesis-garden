import Phaser from 'phaser';

// В v0.1 нет графических ассетов для загрузки (см. claude/assets-and-prompts.md
// в проекте) — сад собирается из примитивов Phaser. BootScene оставлена как
// точка расширения: как только появятся спрайты (силуэты растений, здания),
// preload() начнёт грузить их здесь, и остальной код можно не трогать.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // намеренно пусто в v0.1
  }

  create() {
    this.scene.start('Garden');
  }
}
