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
    // load вызов гейтится тем же GENETICS_V2_ENABLED, что и сам рендер: сеть
    // за этими двумя файлами не ходит и текстура не используется в
    // Overhaul + Legacy — тот же уровень runtime-изоляции, что уже принят
    // для LabPanelV2/AlbumPanelV2/ShopPanelV2 (условный рендер, не условный
    // бандл). Честная оговорка: сами строковые ЛИТЕРАЛЫ путей этих файлов
    // (как и весь код renderHybridPlotCell) остаются частью dist-overhaul
    // JS — проверено сборкой, esbuild/rolldown НЕ схлопывает этот `if` в
    // dead code через реэкспортированную константу GENETICS_V2_ENABLED;
    // истинное отсутствие строки в бандле подтверждено только для
    // Classic/dist (там EstateScene.ts целиком не импортируется, см.
    // CLAUDE.md "grep EstateScene dist/assets/*.js" и итоговый отчёт).
    this.load.image('plot_empty_v1', 'assets/tiles/plot_empty.png');

    // Environment Art Slice B (docs/ENVIRONMENT_ART_SLICE_B.md). Six 32×32
    // material textures — loaded unconditionally for Overhaul (both Legacy
    // and V2 Genetics render EstateScene's terrain the same way; this is
    // not a V2-only asset like the two below it). Classic never imports
    // BootSceneOverhaul/EstateScene at all, so these never reach a Classic
    // build (verified by the same "grep EstateScene dist/assets/*.js"
    // tree-shake check CLAUDE.md documents for the rest of this scene).
    this.load.image('tile_grass_v1', 'assets/terrain/tile_grass_v1.png');
    this.load.image('tile_grass_v1_alt', 'assets/terrain/tile_grass_v1_alt.png');
    this.load.image('tile_path_earth_v1', 'assets/terrain/tile_path_earth_v1.png');
    this.load.image('tile_water_v1', 'assets/terrain/tile_water_v1.png');
    this.load.image('tile_water_v1_alt', 'assets/terrain/tile_water_v1_alt.png');
    this.load.image('tile_thicket_v1', 'assets/terrain/tile_thicket_v1.png');

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
