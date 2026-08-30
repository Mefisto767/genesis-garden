import Phaser from 'phaser';
import { SEED_CATALOG } from '../seedCatalog';
import { preloadSpecies } from '../plantArt';
import { generateAllProceduralTextures } from '../../overhaul/proceduralAssets';
import { BUILDINGS } from '../../overhaul/worldConfig';
import { assetById } from '../../overhaul/assetManifest';
import { GENETICS_V2_ENABLED } from '../featureFlags';

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

    // Art Vertical Slice A (см. docs/ART_VERTICAL_SLICE_A.md). plot_empty
    // заменяет tile_soil для ЛЮБОЙ незаблокированной грядки в обоих
    // overhaul-режимах (Legacy и V2) — грузится всегда. Гибрид/Солнечник —
    // строго V2-lifecycle ассеты (renderHybridPlotCell), Overhaul + Legacy
    // Genetics их не рендерит вообще (renderHybridPlotCellReadOnly), поэтому
    // load вызов гейтится тем же GENETICS_V2_ENABLED, что и сам рендер —
    // не только чтобы не тратить сеть впустую в Legacy-режиме, но и чтобы
    // строковые литералы путей этих двух файлов не появлялись в
    // dist-overhaul (Overhaul + Legacy) бандле при статическом
    // dead-code-elimination константного `if (false)` (GENETICS_V2_ENABLED
    // строится из import.meta.env.VITE_*, статически инлайнится на билде).
    this.load.image('plot_empty_v1', 'assets/tiles/plot_empty.png');
    if (GENETICS_V2_ENABLED) {
      this.load.image('plant_hybrid_unrevealed_v1', 'assets/plants/plant_hybrid_unrevealed.png');
      this.load.image('plant_sunflower_mature_v1', 'assets/plants/plant_sunflower_mature.png');
    }

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
