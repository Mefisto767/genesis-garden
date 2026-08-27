import Phaser from 'phaser';
import { SEED_CATALOG } from '../seedCatalog';
import { preloadSpecies } from '../plantArt';
import { generateAllProceduralTextures } from '../../overhaul/proceduralAssets';
import { BUILDINGS } from '../../overhaul/worldConfig';
import { assetById } from '../../overhaul/assetManifest';

/**
 * Boot-сцена overhaul-режима — расширяет обычный BootScene: та же загрузка
 * растений/тайлов/иконок, плюс здания и маскот для EstateScene, плюс
 * процедурные временные текстуры (см. overhaul/proceduralAssets.ts).
 * Отдельный файл, а не правка BootScene.ts — чтобы классический режим
 * не грузил лишний вес построек, которые ему не нужны.
 */
export class BootSceneOverhaul extends Phaser.Scene {
  constructor() {
    super('BootOverhaul');
  }

  preload() {
    this.load.image('tile_soil', 'assets/tiles/tile_soil.png');
    this.load.image('tile_soil_locked', 'assets/tiles/tile_soil_locked.png');
    this.load.image('icon_coin', 'assets/ui/icon_coin.png');
    this.load.image('decor_bench', 'assets/decor/decor_bench.png');
    this.load.image('decor_lantern', 'assets/decor/decor_lantern.png');
    this.load.image('ui_panel_cream', 'assets/ui/panel_cream.png');

    // Здания — только реальные файловые ассеты манифеста (пропускаем missing/procedural).
    for (const b of BUILDINGS) {
      const entry = assetById(b.assetId);
      if (entry && entry.source.kind === 'file') {
        this.load.image(b.assetId, entry.source.path);
      }
    }
    const npcEntry = assetById('npc_mascot_patrol');
    if (npcEntry && npcEntry.source.kind === 'file') {
      this.load.image('npc_mascot_patrol', npcEntry.source.path);
    }

    const species = new Set(SEED_CATALOG.map((s) => s.speciesId));
    species.forEach((id) => preloadSpecies(this.load, id));
  }

  create() {
    generateAllProceduralTextures(this);
    const start = () => this.scene.start('Estate');
    if (document.fonts?.ready) {
      Promise.race([document.fonts.ready, new Promise((res) => setTimeout(res, 1200))]).then(start);
    } else {
      start();
    }
  }
}
