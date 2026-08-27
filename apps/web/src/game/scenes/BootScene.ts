import Phaser from 'phaser';
import { SEED_CATALOG } from '../seedCatalog';
import { preloadSpecies } from '../plantArt';

// Грузим арт-пак (см. claude/status.md в проекте): тайлы грядок, иконки,
// и по 4 слоя (leaf/secondary/primary маски + line-контур) на каждую стадию
// каждого вида, встречающегося в каталоге семян.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    this.load.image('tile_soil', 'assets/tiles/tile_soil.png');
    this.load.image('tile_soil_locked', 'assets/tiles/tile_soil_locked.png');
    this.load.image('icon_coin', 'assets/ui/icon_coin.png');
    this.load.image('decor_bench', 'assets/decor/decor_bench.png');
    this.load.image('decor_lantern', 'assets/decor/decor_lantern.png');

    const species = new Set(SEED_CATALOG.map((s) => s.speciesId));
    species.forEach((id) => preloadSpecies(this.load, id));
  }

  create() {
    // Дожидаемся веб-шрифтов, чтобы канвас-тексты сразу рисовались в Baloo 2 /
    // Nunito, а не в системном fallback (иначе первый кадр «мигает» шрифтом).
    const start = () => this.scene.start('Garden');
    if (document.fonts?.ready) {
      Promise.race([
        document.fonts.ready,
        new Promise((res) => setTimeout(res, 1200)), // не блокируемся на медленной сети
      ]).then(start);
    } else {
      start();
    }
  }
}
