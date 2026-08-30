import Phaser from 'phaser';
import { gameStore } from '../store';
import { getSeedDef } from '../seedCatalog';
import type { Plot, PlotHybridV2 } from '../types';
import { gardenEvents } from '../events';
import { GENETICS_V2_ENABLED } from '../featureFlags';
import { overhaulEvents } from '../../overhaul/events';
import { buildPlantSprite, PALETTE } from '../plantArt';
import { isCoralMatureSunflower } from '../artVerticalSliceA';
import { track } from '../../analytics/track';
import {
  clampToBounds,
  facingFromDelta,
  moveWithCollisions,
  pointBlocked,
  stepTowardTarget,
  type Facing,
  type Point,
} from '../../overhaul/movement';
import { deriveLumiState, lumiFollowStep, type LumiState } from '../../overhaul/lumiBehavior';
import { CAMERA_FOLLOW_OFFSET_Y, computeCameraZoom } from '../../overhaul/camera';
import { shouldAnimateWater, terrainCellTextures } from '../../overhaul/terrainTextures';
import {
  BOUNDARY_TRANSITIONS,
  BUILDINGS,
  CAMERA_BOUNDS,
  DECOR,
  LAB_BUILDING,
  LANDMARK_CLEARING_RENDER_POS,
  LUMI_STATION_POS,
  NPC_PATROL,
  PLAYER_SPAWN,
  PLOT_SLOTS,
  RENDER_COLS,
  RENDER_COL_START,
  RENDER_ROWS,
  RENDER_ROW_START,
  TILE,
  collisionRects,
  pathTileKeySet,
  type BoundaryTransition,
} from '../../overhaul/worldConfig';

const STAGE2_THRESHOLD = 0.45;
const INK = '#4A2E17';
const FONT_HEAD = "'Baloo 2', 'Nunito', sans-serif";
const FONT_BODY = "'Nunito', sans-serif";
const PLAYER_SPEED = 130; // px/s
const PLAYER_HALF_W = 9;
const PLAYER_HALF_H = 8;
// Защита от "прошивания" тонкой полосы коллизии на границе сектора при
// внезапном скачке delta (например, вкладка была в фоне) — см.
// worldConfig.test.ts "blocks movement... " и обсуждение в CLAUDE.md про
// троттлинг rAF в headless-среде. 50ms — с запасом меньше ширины полосы
// зарослей (64px) даже на максимальной скорости персонажа.
const MAX_FRAME_MS = 50;

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Genetics V2 — Slice 5 (delta doc §0.7 п.11): проекция legacy hex-строки
 * (`#RRGGBB`, из `projectGenomeV2ToLegacy`/`Specimen.genome`) в Phaser-тинт
 * (число), тот же формат, что уже используют `PlantColorway`/`PALETTE`
 * (plantPalette.ts). Обратной синхронизации с движком не требует — чисто
 * презентационная конвертация форматов одного и того же цвета.
 */
function hexStringToTint(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/** Read-only снимок одной грядки для e2e (Visual V1): что реально
 * отрисовано в мире прямо сейчас — без раскрытия генома/фенотипа. */
type PlotDebugSnapshot = {
  plotId: number;
  x: number;
  y: number;
  size: number;
  ready: boolean;
  timerVisible: boolean;
  /** Art Vertical Slice A (docs/ART_VERTICAL_SLICE_A.md) — Phaser texture
   * key of the base plot tile currently drawn on this cell, e.g.
   * 'plot_empty_v1' or 'tile_soil_locked'. Read-only, does not affect game
   * logic; lets e2e assert asset wiring without pixel-diffing screenshots. */
  tileTextureKey: string | null;
  /** Same idea for the plant/hybrid sprite drawn on top, if any — e.g.
   * 'plant_hybrid_unrevealed_v1' before Reveal, 'plant_sunflower_mature_v1'
   * only for the one coral-Sunflower mature phenotype this pack covers, or
   * null when nothing is planted. Exposing the KEY (not the genome) does not
   * leak phenotype for the pre-Reveal neutral sprite — it is the same single
   * key regardless of the hidden genome, by construction. */
  plantTextureKey: string | null;
};

type EstateDebugApi = {
  getEstateState: () => {
    cameraScrollX: number;
    cameraScrollY: number;
    cameraZoom: number;
    viewportWidth: number;
    viewportHeight: number;
    playerX: number;
    playerY: number;
    plots: PlotDebugSnapshot[];
    /** Environment Art Slice B (docs/ENVIRONMENT_ART_SLICE_B.md): read-only
     * confirmation that the six approved material textures actually loaded
     * into Phaser's texture manager — lets e2e assert real asset wiring
     * instead of pixel-diffing screenshots, same idea as tileTextureKey/
     * plantTextureKey above. */
    terrainMaterialsLoaded: {
      grass: boolean;
      grassAlt: boolean;
      pathEarth: boolean;
      water: boolean;
      waterAlt: boolean;
      thicket: boolean;
    };
    /** Whether this session actually allows water shimmer animation
     * (terrainTextures.shouldAnimateWater(), which folds in
     * prefers-reduced-motion) — read once at scene create. */
    waterAnimating: boolean;
  };
};

/**
 * EstateScene — внешний мир overhaul-режима (см. docs/FINAL_VISION.md 4.1,
 * docs/ESTATE_LAYOUT_BLUEPRINT.md). Рисует и делает проходимой ОДНУ открытую
 * зону поместья (zone_starting_garden из estateBlueprint.ts): дом, склад,
 * лабораторию, 6 грядок (те же сущности gameStore, что и в классическом
 * GardenScene), дорожку, пруд, декор, станцию и самого помощника Люми,
 * NPC-патруль, и 4 честные "заглушки будущего" по периметру сектора
 * (BOUNDARY_TRANSITIONS) — заросли/разрушенные проходы, за которые выйти
 * нельзя (см. worldConfig.collisionRects()). Персонаж: WASD/стрелки +
 * click/tap-to-move, коллизии со зданиями/прудом/границей сектора, камера
 * следует за персонажем в пределах CAMERA_BOUNDS (заметно меньше полного
 * 48×48 мира — весь мир одновременно никогда не показывается).
 */
export class EstateScene extends Phaser.Scene {
  private plotsContainer!: Phaser.GameObjects.Container;
  private player!: Phaser.GameObjects.Container;
  private facingIndicator!: Phaser.GameObjects.Image;
  private npc!: Phaser.GameObjects.Container;
  private lumi!: Phaser.GameObjects.Container;
  private lumiGlow!: Phaser.GameObjects.Image;
  private lumiPos: Point = { ...LUMI_STATION_POS };
  private lumiState: LumiState = 'idle';
  private promptImage?: Phaser.GameObjects.Image;
  private promptText?: Phaser.GameObjects.Text;
  private unsubscribeStore?: () => void;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'W' | 'A' | 'S' | 'D' | 'E' | 'ENTER', Phaser.Input.Keyboard.Key>;
  private moveTarget: Point | null = null;
  private facing: Facing = 'down';
  private obstacles = collisionRects();
  private nearLab = false;
  private nearTransition: BoundaryTransition | null = null;
  private transitioning = false;
  /** Visual V1: touch/click keeps a growing plot's contextual timer visible
   * briefly. Hover and player proximity are derived live, not persisted. */
  private selectedPlotId: number | null = null;
  private selectedPlotUntil = 0;
  /** Read-only снимок отрисованных грядок текущего кадра renderPlots —
   * только для e2e/debug API, игровая логика его не читает. */
  private plotDebugSnapshots: PlotDebugSnapshot[] = [];
  private readonly handleResize = () => this.applyResponsiveCamera();
  /** Environment Art Slice B: read once in renderTerrain() (create()), read
   * back by exposeDebugHook() — see terrainMaterialsLoaded/waterAnimating. */
  private waterAnimatingDebug = false;

  constructor() {
    super('Estate');
  }

  create() {
    this.transitioning = false;
    this.lumiPos = { ...LUMI_STATION_POS };
    this.lumiState = 'idle';
    this.cameras.main.setBackgroundColor(PALETTE.leafDark);
    this.renderTerrain();
    this.renderLandmarkClearing();
    this.renderDecor();
    this.renderBuildings();
    this.renderLumiStation();
    this.renderBoundaryTransitions();
    this.plotsContainer = this.add.container(0, 0);
    this.renderPlots();
    this.createPlayer();
    this.createNpc();
    this.createLumi();
    this.setupCamera();
    this.setupInput();
    this.exposeDebugHook();

    this.unsubscribeStore = gameStore.subscribe(() => this.renderPlots());
    this.time.addEvent({ delay: 250, loop: true, callback: () => this.renderPlots() });
    this.scale.on('resize', this.handleResize);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeStore?.();
      this.scale.off('resize', this.handleResize);
    });
  }

  /** Visual V1 (docs/VISUAL_BIBLE_V1.md §3): responsive cover-камера.
   * Вызывается на create и на каждом resize/orientation change — zoom
   * пересчитывается из реального размера канваса и CAMERA_BOUNDS, чтобы
   * видимая область мира никогда не выходила за границы (пустое
   * пространство за CAMERA_BOUNDS не показывается: setBounds клампит
   * scroll, а cover-zoom гарантирует, что viewport/zoom ≤ bounds). */
  private applyResponsiveCamera() {
    const cam = this.cameras.main;
    cam.setZoom(computeCameraZoom(this.scale.width, this.scale.height));
  }

  /** Только для e2e/ручной проверки — read-only снимок состояния сцены на
   * `window`, не влияет на игровую логику. Позволяет тестам вычислять точные
   * экранные координаты (мировые - scroll камеры) вместо хрупких магических
   * чисел, продублированных в тестовом файле (см. test-e2e-overhaul.mjs). */
  private exposeDebugHook() {
    if (typeof window === 'undefined') return;
    const api: EstateDebugApi = {
      getEstateState: () => ({
        // Мировая координата ВИДИМОГО левого верхнего угла кадра. При
        // zoom ≠ 1 это camera.worldView.x/y, а не scrollX/scrollY (scrollX в
        // Phaser отсчитывается от НЕзумированной ширины кадра) — e2e-формула
        // screenX = canvasX + (worldX - cameraScrollX) * cameraZoom остаётся
        // верной именно с worldView.
        cameraScrollX: this.cameras.main.worldView.x,
        cameraScrollY: this.cameras.main.worldView.y,
        cameraZoom: this.cameras.main.zoom,
        viewportWidth: this.scale.width,
        viewportHeight: this.scale.height,
        playerX: this.player.x,
        playerY: this.player.y,
        plots: this.plotDebugSnapshots.map((p) => ({ ...p })),
        terrainMaterialsLoaded: {
          grass: this.textures.exists('tile_grass_v1'),
          grassAlt: this.textures.exists('tile_grass_v1_alt'),
          pathEarth: this.textures.exists('tile_path_earth_v1'),
          water: this.textures.exists('tile_water_v1'),
          waterAlt: this.textures.exists('tile_water_v1_alt'),
          thicket: this.textures.exists('tile_thicket_v1'),
        },
        waterAnimating: this.waterAnimatingDebug,
      }),
    };
    (window as unknown as { __overhaulDebug?: EstateDebugApi }).__overhaulDebug = api;
  }

  // ---- мир: террейн/декор/здания ------------------------------------------

  /**
   * Environment Art Slice B (docs/ENVIRONMENT_ART_SLICE_B.md): replaces the
   * flat-rectangle prototype terrain (solid grass fill / brown path
   * rectangles / blue pond rectangle / dark thicket rectangle) with the six
   * approved 32×32 material textures, composited deterministically per cell
   * from the SAME `terrainAt`/`pathTileKeySet` data this scene already used
   * — no new geometry invented, only how each existing cell is painted.
   * `terrainTextures.ts` owns the actual Canvas 2D compositing; the
   * adjacency-mask/hash DECISIONS it consumes live in the pure, unit-tested
   * `terrainComposition.ts`.
   */
  private renderTerrain() {
    const pathTiles = pathTileKeySet();
    const animateWater = shouldAnimateWater();
    this.waterAnimatingDebug = animateWater;
    for (let row = RENDER_ROW_START; row < RENDER_ROW_START + RENDER_ROWS; row++) {
      for (let col = RENDER_COL_START; col < RENDER_COL_START + RENDER_COLS; col++) {
        const { key, shimmerAltKey } = terrainCellTextures(this, col, row, pathTiles, animateWater);
        const img = this.add.image(col * TILE, row * TILE, key).setOrigin(0, 0);
        img.setDepth(-1000);
        if (shimmerAltKey) {
          // Water shimmer: alternate/crossfade the two composited water
          // frames. shouldAnimateWater() already folded in
          // prefers-reduced-motion (terrainComposition.waterAnimatesFor) —
          // shimmerAltKey is only ever non-null when animation is allowed,
          // so reduced motion always renders exactly the base frame, never
          // this tween.
          const shine = this.add.image(col * TILE, row * TILE, shimmerAltKey).setOrigin(0, 0);
          shine.setDepth(-999);
          shine.setAlpha(0);
          this.tweens.add({
            targets: shine,
            alpha: 0.55,
            duration: 1600 + ((col + row) % 5) * 140,
            yoyo: true,
            repeat: -1,
            delay: ((col * 7 + row * 13) % 10) * 90,
          });
        }
      }
    }
  }

  /**
   * Environment Art Slice B: one restrained soft contact-shadow recipe,
   * shared by buildings/plots/player/Lumi (docs/ENVIRONMENT_ART_SLICE_B.md
   * "Locked visual direction" — warm daylight from upper-left, one shadow
   * language). Presentation only: no setInteractive, never added to
   * `obstacles`/collisionRects, so it cannot affect hit areas or collision.
   * Two stacked low-alpha ellipses fake a soft edge without a real blur
   * filter (Phaser has no cheap CSS-blur-equivalent for this without a
   * post-fx pipeline, which is out of scope for a "restrained" shadow) —
   * an explicit, documented interpretation choice, not a silent shortcut.
   * Offset is down-right, consistent with the locked upper-left light
   * direction. Depth is placed just below `depth` so it never draws over
   * the object that casts it, regardless of call order.
   */
  private addContactShadow(x: number, y: number, width: number, depth: number) {
    const w = width;
    const h = width * 0.3;
    const ox = w * 0.08;
    const oy = h * 0.32;
    const outer = this.add.ellipse(x + ox, y + oy, w, h, 0x1a1208, 0.14).setDepth(depth);
    const inner = this.add.ellipse(x + ox, y + oy, w * 0.62, h * 0.62, 0x1a1208, 0.14).setDepth(depth);
    return [outer, inner];
  }

  /** Same shadow recipe as `addContactShadow`, but as loose GameObjects
   * meant to be added as the FIRST children of a Container (player/Lumi) —
   * container-local coordinates, no explicit depth (the container's single
   * depth value governs the whole group; drawing the shadow before the body
   * sprite already keeps it visually behind, same idea as depth ordering). */
  private buildContactShadowChild(width: number): Phaser.GameObjects.Ellipse[] {
    const w = width;
    const h = width * 0.3;
    const ox = w * 0.08;
    const oy = h * 0.32;
    const outer = this.add.ellipse(ox, oy, w, h, 0x1a1208, 0.14);
    const inner = this.add.ellipse(ox, oy, w * 0.62, h * 0.62, 0x1a1208, 0.14);
    return [outer, inner];
  }

  /** Зарезервированная площадка landmark_central — только расчищенная
   * поляна, без монумента (см. estateBlueprint.ts LANDMARK_SLOTS). */
  private renderLandmarkClearing() {
    const img = this.add.image(LANDMARK_CLEARING_RENDER_POS.x, LANDMARK_CLEARING_RENDER_POS.y, 'landmark_clearing');
    img.setDepth(-900);
  }

  private renderDecor() {
    for (const d of DECOR) {
      const img = this.add
        .image(d.x, d.y, d.assetId)
        .setOrigin(0.5, 1)
        .setDisplaySize(d.displayWidth, d.displayHeight);
      img.setDepth(d.y);
    }
  }

  private renderBuildings() {
    for (const b of BUILDINGS) {
      this.addContactShadow(b.x, b.y, b.displayWidth * 0.7, b.y - 1);
      const img = this.add
        .image(b.x, b.y, b.assetId)
        .setOrigin(0.5, 1)
        .setDisplaySize(b.displayWidth, b.displayHeight);
      img.setDepth(b.y);
      if (b.interactive) {
        img.setInteractive({ useHandCursor: true });
        img.on('pointerdown', () => this.tryInteractWithBuilding(b.id));
      }
    }
  }

  /** Станция Люми — декоративная, без коллизии и без интерактивности
   * (см. lumiBehavior.ts — вся идея Люми в том, что она никогда не мешает). */
  private renderLumiStation() {
    const img = this.add
      .image(LUMI_STATION_POS.x, LUMI_STATION_POS.y, 'building_lumi_station')
      .setOrigin(0.5, 0.92);
    img.setDepth(LUMI_STATION_POS.y - 1);
  }

  private renderBoundaryTransitions() {
    for (const t of BOUNDARY_TRANSITIONS) {
      const img = this.add
        .image(t.x, t.y, t.assetId)
        .setOrigin(0.5, 1)
        .setDisplaySize(t.displayWidth, t.displayHeight)
        .setInteractive({ useHandCursor: true });
      img.setDepth(t.y);
      img.on('pointerdown', () => this.tryInteractWithTransition(t.id));
    }
  }

  // ---- грядки (переиспользуем существующую игровую модель без изменений) --

  private renderPlots() {
    const state = gameStore.getState();
    this.plotsContainer.removeAll(true);
    this.plotDebugSnapshots = [];
    for (const slot of PLOT_SLOTS) {
      const plot = state.plots.find((p) => p.id === slot.plotId);
      if (plot) this.renderPlotCell(plot, slot.x, slot.y, slot.size);
    }
  }

  /** Read-only debug (Visual V1 e2e): фиксирует, что реально показано на
   * грядке в этом кадре. Не влияет на игровую логику и не раскрывает геном. */
  private snapshotPlot(
    plotId: number,
    x: number,
    y: number,
    size: number,
    ready: boolean,
    timerVisible: boolean,
    tileTextureKey: string | null = null,
    plantTextureKey: string | null = null
  ) {
    this.plotDebugSnapshots.push({ plotId, x, y, size, ready, timerVisible, tileTextureKey, plantTextureKey });
  }

  private addTile(x: number, y: number, size: number, locked: boolean): Phaser.GameObjects.Image {
    // Art Vertical Slice A (docs/ART_VERTICAL_SLICE_A.md): 'plot_empty_v1'
    // replaces the placeholder 'tile_soil' as the base tile for every
    // unlocked plot cell (empty, growing, ready, permanent V2 hybrid) — the
    // same role tile_soil already played. Locked plots are out of this
    // pack's scope and keep 'tile_soil_locked' unchanged.
    // Environment Art Slice B: restrained contact shadow behind every plot
    // tile, same recipe as buildings/player/Lumi.
    const shadow = this.addContactShadow(x, y, size * 0.8, y - 1);
    this.plotsContainer.add(shadow);
    const tile = this.add
      .image(x, y, locked ? 'tile_soil_locked' : 'plot_empty_v1')
      .setDisplaySize(size, size)
      .setInteractive({ useHandCursor: true });
    tile.setDepth(y);
    this.plotsContainer.add(tile);
    return tile;
  }

  /**
   * Art Vertical Slice A: bottom-center-anchored 64×96 static plant sprite
   * (docs/VISUAL_ASSET_CONTRACT.md §5 "Plant" row). `scale` multiplies the
   * 64px display width; height follows the fixed 2:3 source aspect ratio
   * (64×96), no separate height parameter to avoid an inconsistent canvas.
   * The bottom anchor (`y + size * 0.44`) matches where the previous
   * square procedural plant's bottom edge already sat (verified against
   * buildPlantSprite's `y - size * 0.06` center + ~size*0.98 square), so
   * swapping sprites does not shift the visual "planted in this tile" point.
   */
  private addBottomAnchoredPlantSprite(x: number, y: number, size: number, key: string, scale: number): Phaser.GameObjects.Image {
    const width = size * scale;
    const height = width * 1.5;
    const img = this.add.image(x, y + size * 0.44, key).setOrigin(0.5, 1).setDisplaySize(width, height);
    return img;
  }

  private renderPlotCell(plot: Plot, x: number, y: number, size: number) {
    if (!plot.unlocked) {
      this.snapshotPlot(plot.id, x, y, size, false, false, 'tile_soil_locked', null);
      const cost = gameStore.unlockCostFor(plot.id);
      const tile = this.addTile(x, y, size, true);
      const label = this.add
        .text(x, y - size * 0.16, 'Закрыто', {
          fontFamily: FONT_BODY,
          fontSize: `${size * 0.16}px`,
          color: INK,
        })
        .setOrigin(0.5)
        .setAlpha(0.9);
      const coin = this.add.image(x - size * 0.14, y + size * 0.22, 'icon_coin').setDisplaySize(size * 0.18, size * 0.18);
      const costText = this.add
        .text(x + size * 0.02, y + size * 0.22, `${cost}`, { fontFamily: FONT_HEAD, fontSize: `${size * 0.19}px`, color: INK })
        .setOrigin(0, 0.5);
      label.setDepth(y + 1);
      coin.setDepth(y + 1);
      costText.setDepth(y + 1);
      tile.on('pointerdown', () => {
        const ok = gameStore.unlockPlot(plot.id);
        if (!ok) gardenEvents.emit('toast', { text: 'Не хватает монет на новую грядку' });
      });
      this.plotsContainer.add([label, coin, costText]);
      return;
    }

    // Genetics V2 — Slice 5 (contract §4.8.1/§4.8.3, delta doc §0.7 п.11):
    // `hybridV2` — отдельная от legacy-посадки ветка рендера. Проверяется
    // ДО `!plot.seedId`, т.к. занятая V2-грядка тоже имеет `seedId === null`
    // (инвариант mutual-exclusion, contract §4.8.1) — иначе она ошибочно
    // отрисовалась бы как пустая "+" грядка.
    //
    // Fix-pass (audit, bug 1): активный V2-рендер/harvest доступны ТОЛЬКО при
    // `GENETICS_V2_ENABLED === true`. Если данные есть (`plot.hybridV2`), но
    // флаг выключен (Overhaul + Legacy Genetics — например, save был сохранён,
    // пока V2 был включён, а потом флаг переключили), грядка рисуется как
    // нейтральная read-only "занятая" — БЕЗ раскрытия генома и БЕЗ клика в
    // любое V2-действие (`renderHybridPlotCellReadOnly` не регистрирует
    // pointerdown вообще). Ветка `!plot.seedId` ниже в обоих случаях
    // недостижима для этой грядки (return выше) — значит `plantSeed()`
    // (обычная посадка) никогда не может быть вызван кликом по такой грядке
    // ни в одном из двух состояний флага, что бы ни показывалось визуально.
    if (plot.hybridV2) {
      if (GENETICS_V2_ENABLED) {
        this.renderHybridPlotCell(plot, plot.hybridV2, x, y, size);
      } else {
        this.snapshotPlot(plot.id, x, y, size, false, false, 'plot_empty_v1', null);
        this.renderHybridPlotCellReadOnly(x, y, size);
      }
      return;
    }

    if (!plot.seedId) {
      this.snapshotPlot(plot.id, x, y, size, false, false, 'plot_empty_v1', null);
      const tile = this.addTile(x, y, size, false);
      const plus = this.add
        .text(x, y - size * 0.02, '+', { fontFamily: FONT_HEAD, fontSize: `${size * 0.5}px`, color: '#FDF3D9' })
        .setOrigin(0.5)
        .setAlpha(0.85);
      plus.setDepth(y + 1);
      tile.on('pointerdown', () => gardenEvents.emit('requestPlant', { plotId: plot.id }));
      this.plotsContainer.add(plus);
      return;
    }

    const def = getSeedDef(plot.seedId);
    if (!def || plot.plantedAt === null) return;
    const status = gameStore.plotStatus(plot);
    if (!status) return;
    const { ready, progress, remainingMs } = status;
    const stage = ready ? 3 : progress < STAGE2_THRESHOLD ? 1 : 2;

    const tile = this.addTile(x, y, size, false);

    if (ready) this.renderReadyMarker(x, y, size);

    const plantSize = size * (ready ? 0.98 : 0.9);
    const plant = buildPlantSprite(this, x, y - size * 0.06, plantSize, def.speciesId, stage, def.colorway);
    plant.setDepth(y);
    this.plotsContainer.add(plant);

    const timerVisible = !ready && this.plotContextVisible(plot.id, x, y, size);
    // Composite procedural render (multiple tinted layers, legacy species
    // catalog) — no single asset id represents it, unlike the Art Vertical
    // Slice A static sprites below.
    this.snapshotPlot(plot.id, x, y, size, ready, timerVisible, 'plot_empty_v1', null);
    if (ready) {
      const labelText = this.add
        .text(x, y + size * 0.38, 'Собрать', {
          fontFamily: FONT_HEAD,
          fontSize: `${size * 0.15}px`,
          color: INK,
          backgroundColor: '#F5A623',
          padding: { left: 8, right: 8, top: 2, bottom: 2 },
        })
        .setOrigin(0.5);
      labelText.setDepth(y + 1);
      this.plotsContainer.add(labelText);
    } else if (timerVisible) {
      this.renderProgressBar(x, y, size, progress, remainingMs);
    }

    tile.on('pointerdown', () => {
      if (!ready) {
        this.pinPlotContext(plot.id);
        return;
      }
      const ok = gameStore.harvest(plot.id);
      if (ok) track('plant_harvested', { plotId: plot.id, seedId: plot.seedId });
    });
  }

  /**
   * Genetics V2 — Slice 5 (contract §4.8.1/§4.8.3/§4.8.4, delta doc §0.7 п.11)
   * — визуально отдельная от legacy ветка одной и той же грядки. Растущий
   * гибрид (`growing`) — нейтральный окрас (PALETTE.neutral на всех трёх
   * каналах), геном НЕ раскрывается до созревания; стадии 1/2/3 те же
   * пороги, что у legacy-растений (STAGE2_THRESHOLD). Постоянное растение
   * (`mature`) — ВСЕГДА стадия 3 (растение не исчезает и не "перерастает"
   * после первого сбора, contract §4.8.4 "растение остаётся"), реальный
   * окрас через legacy-проекцию specimen.genome (см. legacyProjectionV2.ts),
   * повторный цикл показан отдельным прогресс-баром поверх постоянного
   * растения, не как рост самого растения.
   */
  /**
   * Fix-pass (audit, bug 1): нейтральная read-only "занятая" грядка для
   * `plot.hybridV2`, когда `GENETICS_V2_ENABLED === false` (Overhaul + Legacy
   * Genetics). Намеренно НЕ читает ничего из `hybridV2`/`genomeV2`/
   * `specimen` — ни speciesId, ни фаза, ни окрас не используются, чтобы
   * физически не было способа случайно "подсветить" геном через эту ветку.
   * `addTile()` делает тайл интерактивным (useHandCursor для консистентного
   * вида грядок), но pointerdown-обработчик НЕ регистрируется вообще — клик
   * не имеет никакого эффекта: не открывает HybridCard (requestHybridCard не
   * эмитится), не проваливается в посадку (эта грядка никогда не доходит до
   * ветки `!plot.seedId` — см. return в вызывающем renderPlotCell). Никакого
   * прогресс-бара/таймера/кнопки "Собрать" — грядка выглядит просто занятой,
   * без намёка на то, что можно с ней что-то сделать.
   */
  private renderHybridPlotCellReadOnly(x: number, y: number, size: number) {
    this.addTile(x, y, size, false);
    const marker = this.add.circle(x, y - size * 0.02, size * 0.3, PALETTE.neutral, 0.9);
    marker.setDepth(y);
    const label = this.add
      .text(x, y + size * 0.34, 'Занято', {
        fontFamily: FONT_BODY,
        fontSize: `${size * 0.15}px`,
        color: INK,
      })
      .setOrigin(0.5)
      .setAlpha(0.85);
    label.setDepth(y + 1);
    this.plotsContainer.add([marker, label]);
  }

  private renderHybridPlotCell(plot: Plot, hybridV2: PlotHybridV2, x: number, y: number, size: number) {
    const status = gameStore.hybridPlotStatusV2(plot);
    if (!status) return; // повреждённые данные (contract §4.8.4) — не рендерим, не роняем сцену

    const tile = this.addTile(x, y, size, false);

    if (hybridV2.phase === 'growing') {
      const { ready, progress, remainingMs } = status;

      if (ready) this.renderReadyMarker(x, y, size);

      // Art Vertical Slice A (docs/ART_VERTICAL_SLICE_A.md): one static,
      // species-neutral "unrevealed" sprite for the whole 'growing' phase
      // (planted/growing/pending-Reveal) — replaces the previous 3-stage
      // procedural render, which already used a neutral colorway but still
      // leaked shape via speciesId/stage. The new sprite reveals neither
      // phenotype nor rarity, matching the contract's "no phenotype leak"
      // acceptance criterion more strictly than before.
      const plant = this.addBottomAnchoredPlantSprite(x, y, size, 'plant_hybrid_unrevealed_v1', ready ? 0.98 : 0.9);
      plant.setDepth(y);
      this.plotsContainer.add(plant);

      const timerVisible = !ready && this.plotContextVisible(plot.id, x, y, size);
      this.snapshotPlot(plot.id, x, y, size, ready, timerVisible, 'plot_empty_v1', 'plant_hybrid_unrevealed_v1');
      if (ready) {
        const labelText = this.add
          .text(x, y + size * 0.38, 'Собрать', {
            fontFamily: FONT_HEAD,
            fontSize: `${size * 0.15}px`,
            color: INK,
            backgroundColor: '#F5A623',
            padding: { left: 8, right: 8, top: 2, bottom: 2 },
          })
          .setOrigin(0.5);
        labelText.setDepth(y + 1);
        this.plotsContainer.add(labelText);
      } else if (timerVisible) {
        this.renderProgressBar(x, y, size, progress, remainingMs);
      }

      tile.on('pointerdown', () => {
        if (!ready) {
          this.pinPlotContext(plot.id);
          return;
        }
        gameStore.harvestHybridV2(plot.id);
      });
      return;
    }

    // phase === 'mature' — постоянное растение, всегда стадия 3.
    const state = gameStore.getState();
    const specimen = state.specimens.find((s) => s.id === hybridV2.specimenId);
    if (!specimen) return; // повреждённые данные — не рендерим (contract §4.8.4 idempotency guard)

    // Art Vertical Slice A (docs/ART_VERTICAL_SLICE_A.md): the mature
    // Sunflower art asset depicts exactly one phenotype — Солнечник
    // (speciesId 1) with primary_coral (#FF8C77). It is used ONLY when the
    // specimen's actual revealed genome matches both; every other
    // species/primary-color keeps the existing procedural layered render,
    // which can faithfully represent all 8 primary colors and both species.
    // A single flat PNG cannot honestly stand in for the other 7 primary
    // colors of the same species (see docs/ART_VERTICAL_SLICE_A.md for the
    // full reasoning) — this is a deliberate, narrow scope, not an oversight.
    const isCoralSunflower = isCoralMatureSunflower(specimen.genome);

    const plant: Phaser.GameObjects.Image | Phaser.GameObjects.Container = isCoralSunflower
      ? this.addBottomAnchoredPlantSprite(x, y, size, 'plant_sunflower_mature_v1', 0.98)
      : buildPlantSprite(
          this,
          x,
          y - size * 0.06,
          size * 0.98,
          specimen.genome.shape,
          3,
          {
            primary: hexStringToTint(specimen.genome.primary),
            secondary: hexStringToTint(specimen.genome.secondary),
            leaf: hexStringToTint(specimen.genome.leaf),
          }
        );
    plant.setDepth(y);
    this.plotsContainer.add(plant);

    const matureTimerVisible = !status.ready && this.plotContextVisible(plot.id, x, y, size);
    this.snapshotPlot(
      plot.id,
      x,
      y,
      size,
      status.ready,
      matureTimerVisible,
      'plot_empty_v1',
      isCoralSunflower ? 'plant_sunflower_mature_v1' : null
    );
    if (status.ready) {
      this.renderReadyMarker(x, y, size);
    } else if (matureTimerVisible) {
      this.renderProgressBar(x, y, size, status.progress, status.remainingMs);
    }

    tile.on('pointerdown', () => gardenEvents.emit('requestHybridCard', { plotId: plot.id }));
  }

  /** Прогресс-бар роста/повторного цикла — общий кусок разметки, использовался
   * повторно (было продублировано между legacy- и V2-веткой рендера грядки). */
  private renderProgressBar(x: number, y: number, size: number, progress: number, remainingMs: number) {
    const barWidth = size * 0.72;
    const barBg = this.add
      .rectangle(x, y + size * 0.33, barWidth, size * 0.08, PALETTE.cream, 0.95)
      .setOrigin(0.5)
      .setStrokeStyle(2, PALETTE.ink, 0.9);
    const barFill = this.add
      .rectangle(x - barWidth / 2, y + size * 0.33, barWidth * progress, size * 0.08, PALETTE.amber, 1)
      .setOrigin(0, 0.5);
    const timer = this.add
      .text(x, y + size * 0.5, `Рост · ${formatRemaining(remainingMs)}`, {
        fontFamily: FONT_BODY,
        fontSize: `${size * 0.13}px`,
        fontStyle: '700',
        color: INK,
        backgroundColor: '#FDF3D9',
        padding: { left: 5, right: 5, top: 1, bottom: 1 },
      })
      .setOrigin(0.5);
    barBg.setDepth(y + 1);
    barFill.setDepth(y + 1);
    timer.setDepth(y + 1);
    this.plotsContainer.add([barBg, barFill, timer]);
  }

  /** Context appears without filling every plot with dashboard chrome:
   * desktop hover, player proximity, or a three-second touch/click pin. */
  private plotContextVisible(plotId: number, x: number, y: number, size: number): boolean {
    if (this.selectedPlotId === plotId && this.time.now <= this.selectedPlotUntil) return true;
    const pointer = this.input.activePointer;
    if (pointer) {
      // Мировые координаты считаем сами через getWorldPoint: pointer.worldX
      // обновляется Phaser'ом лениво и может остаться устаревшим после ухода
      // курсора с интерактивного объекта (а при zoom ≠ 1 это давало бы ещё и
      // навсегда «прилипший» hover-таймер).
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      if (Math.abs(world.x - x) <= size * 0.6 && Math.abs(world.y - y) <= size * 0.6) {
        return true;
      }
    }
    return !!this.player?.active && Phaser.Math.Distance.Between(this.player.x, this.player.y, x, y) <= 88;
  }

  private pinPlotContext(plotId: number) {
    this.selectedPlotId = plotId;
    this.selectedPlotUntil = this.time.now + 3000;
    this.renderPlots();
  }

  /** Ready is never encoded by colour alone: a diamond + exclamation mark
   * supplies a stable shape while the restrained pulse supplies motion. */
  private renderReadyMarker(x: number, y: number, size: number) {
    const glow = this.add.circle(x, y - size * 0.08, size * 0.5, PALETTE.amberLight, 0.42);
    glow.setDepth(y - 1);
    const diamond = this.add
      .rectangle(x, y - size * 0.72, size * 0.24, size * 0.24, PALETTE.amber, 1)
      .setRotation(Math.PI / 4)
      .setStrokeStyle(2, PALETTE.ink, 1);
    const mark = this.add
      .text(x, y - size * 0.72, '!', {
        fontFamily: FONT_HEAD,
        fontSize: `${size * 0.2}px`,
        color: INK,
      })
      .setOrigin(0.5);
    diamond.setDepth(y + 2);
    mark.setDepth(y + 3);
    this.tweens.add({ targets: [glow, diamond, mark], alpha: 0.28, duration: 760, yoyo: true, repeat: -1 });
    this.plotsContainer.add([glow, diamond, mark]);
  }

  // ---- персонаж -------------------------------------------------------------

  private createPlayer() {
    const shadow = this.buildContactShadowChild(20);
    const avatar = this.add.image(0, 0, 'char_avatar').setOrigin(0.5, 0.92);
    this.facingIndicator = this.add.image(10, -4, 'char_facing_indicator').setOrigin(0.5, 0.5);
    this.player = this.add.container(PLAYER_SPAWN.x, PLAYER_SPAWN.y, [...shadow, avatar, this.facingIndicator]);
    this.player.setDepth(PLAYER_SPAWN.y);
  }

  private createNpc() {
    const sprite = this.add
      .image(0, 0, NPC_PATROL.assetId)
      .setOrigin(0.5, 0.92)
      .setDisplaySize(NPC_PATROL.displayWidth, NPC_PATROL.displayHeight);
    this.npc = this.add.container(NPC_PATROL.from.x, NPC_PATROL.from.y, [sprite]);
    this.npc.setDepth(NPC_PATROL.from.y);
    const dist = Math.hypot(NPC_PATROL.to.x - NPC_PATROL.from.x, NPC_PATROL.to.y - NPC_PATROL.from.y);
    const duration = (dist / NPC_PATROL.speed) * 1000;
    this.tweens.add({
      targets: this.npc,
      x: NPC_PATROL.to.x,
      duration,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        sprite.setFlipX(this.npc.x < (NPC_PATROL.from.x + NPC_PATROL.to.x) / 2 ? false : true);
      },
    });
  }

  /** Люми — постоянный помощник поместья (см. docs/ESTATE_LAYOUT_BLUEPRINT.md
   * "Люми" и apps/web/src/overhaul/lumiBehavior.ts). НЕ интерактивна и НЕ
   * добавлена в obstacles/collisionRects — намеренно: не блокирует движение
   * персонажа и не может случайно вызвать игровое действие. */
  private createLumi() {
    const shadow = this.buildContactShadowChild(18);
    const body = this.add.image(0, 0, 'companion_lumi_idle').setOrigin(0.5, 0.92);
    this.lumiGlow = this.add.image(0, -body.displayHeight * 0.62, 'companion_lumi_glow').setAlpha(0.7);
    this.lumi = this.add.container(this.lumiPos.x, this.lumiPos.y, [...shadow, body, this.lumiGlow]);
    this.lumi.setDepth(this.lumiPos.y);
    this.tweens.add({
      targets: this.lumiGlow,
      alpha: 0.25,
      duration: 900,
      yoyo: true,
      repeat: -1,
    });
  }

  private setupCamera() {
    this.cameras.main.setBounds(CAMERA_BOUNDS.x, CAMERA_BOUNDS.y, CAMERA_BOUNDS.w, CAMERA_BOUNDS.h);
    // Follow-offset поднимает центр кадра чуть выше персонажа, чтобы при
    // нижнем клампе скролла грядки не уезжали под верхний HUD (64 CSS px).
    this.cameras.main.startFollow(this.player, true, 0.14, 0.14, 0, CAMERA_FOLLOW_OFFSET_Y);
    this.applyResponsiveCamera();
  }

  private setupInput() {
    const kb = this.input.keyboard;
    if (kb) {
      this.cursors = kb.createCursorKeys();
      this.wasd = kb.addKeys('W,A,S,D,E,ENTER') as typeof this.wasd;
    }
    this.input.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        if (currentlyOver.length > 0) return; // клик поймал интерактивный объект (грядка/здание) — не двигаем персонажа сквозь него
        const target = { x: pointer.worldX, y: pointer.worldY };
        if (pointBlocked(target, this.obstacles)) return;
        this.moveTarget = clampToBounds(target.x, target.y, 0, 0, CAMERA_BOUNDS);
      }
    );
  }

  private tryInteractWithBuilding(buildingId: string) {
    if (buildingId === LAB_BUILDING.id) {
      if (this.nearLab) this.enterLaboratory();
      else gardenEvents.emit('toast', { text: 'Подойди ближе ко входу в лабораторию' });
    }
  }

  private tryInteractWithTransition(transitionId: string) {
    const t = BOUNDARY_TRANSITIONS.find((x) => x.id === transitionId);
    if (!t) return;
    gardenEvents.emit('toast', { text: t.label });
  }

  private enterLaboratory() {
    if (this.transitioning) return;
    this.transitioning = true;
    const reduced =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 80 : 320;
    // Симметрично LaboratoryScene.exitToEstate (см. комментарий там): любой
    // активный fade-эффект камеры сбрасывается, иначе fadeOut может молча
    // не стартовать и переход зависнет с transitioning=true.
    this.cameras.main.fadeEffect.reset();
    this.cameras.main.fadeOut(duration, 20, 15, 12);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      overhaulEvents.emit('enterLaboratory', {});
      this.scene.start('Laboratory');
    });
  }

  update(_time: number, delta: number) {
    if (this.transitioning) return;
    const dt = Math.min(delta, MAX_FRAME_MS) / 1000;
    let dx = 0;
    let dy = 0;
    const left = this.cursors?.left.isDown || this.wasd?.A.isDown;
    const right = this.cursors?.right.isDown || this.wasd?.D.isDown;
    const up = this.cursors?.up.isDown || this.wasd?.W.isDown;
    const down = this.cursors?.down.isDown || this.wasd?.S.isDown;
    if (left) dx -= 1;
    if (right) dx += 1;
    if (up) dy -= 1;
    if (down) dy += 1;

    const keyboardActive = dx !== 0 || dy !== 0;
    if (keyboardActive) {
      this.moveTarget = null;
      const len = Math.hypot(dx, dy) || 1;
      dx = (dx / len) * PLAYER_SPEED * dt;
      dy = (dy / len) * PLAYER_SPEED * dt;
    } else if (this.moveTarget) {
      const step = stepTowardTarget(this.player.x, this.player.y, this.moveTarget, PLAYER_SPEED * dt);
      dx = step.dx;
      dy = step.dy;
      if (step.arrived) this.moveTarget = null;
    }

    const playerIsMoving = dx !== 0 || dy !== 0;
    if (playerIsMoving) {
      const moved = moveWithCollisions(this.player.x, this.player.y, dx, dy, PLAYER_HALF_W, PLAYER_HALF_H, this.obstacles);
      const clamped = clampToBounds(moved.x, moved.y, PLAYER_HALF_W, PLAYER_HALF_H, CAMERA_BOUNDS);
      this.player.setPosition(clamped.x, clamped.y);
      this.player.setDepth(clamped.y);
      this.facing = facingFromDelta(dx, dy, this.facing);
      this.updateFacingIndicator();
    }

    this.updateProximity();
    this.updateLumi(dt, playerIsMoving);

    const interactPressed =
      (this.wasd && (Phaser.Input.Keyboard.JustDown(this.wasd.E) || Phaser.Input.Keyboard.JustDown(this.wasd.ENTER))) ??
      false;
    if (interactPressed) {
      if (this.nearLab) this.tryInteractWithBuilding(LAB_BUILDING.id);
      else if (this.nearTransition) this.tryInteractWithTransition(this.nearTransition.id);
    }
  }

  private updateFacingIndicator() {
    const offsets: Record<Facing, [number, number, number]> = {
      right: [12, -4, 0],
      left: [-12, -4, Math.PI],
      up: [0, -16, -Math.PI / 2],
      down: [0, 4, Math.PI / 2],
    };
    const [ox, oy, rot] = offsets[this.facing];
    this.facingIndicator.setPosition(ox, oy);
    this.facingIndicator.setRotation(rot);
  }

  /** Люми следует за игроком с небольшим отставанием (см. lumiBehavior.ts).
   * Не участвует в коллизиях, не интерактивна — только чтение позиции
   * игрока и позиционирование собственного Container. */
  private updateLumi(dt: number, playerIsMoving: boolean) {
    const prev = this.lumiPos;
    const next = lumiFollowStep(this.lumiPos, { x: this.player.x, y: this.player.y }, dt);
    const lumiIsMoving = next.x !== prev.x || next.y !== prev.y;
    this.lumiPos = next;
    this.lumi.setPosition(next.x, next.y);
    this.lumi.setDepth(next.y);

    const nearInteractable = this.nearLab || !!this.nearTransition;
    const state = deriveLumiState({ playerIsMoving, nearInteractable, lumiIsMoving });
    if (state !== this.lumiState) {
      this.lumiState = state;
      // "Простое временное представление" по ТЗ — единственная визуальная
      // реакция на состояние 'point' на этом этапе: свечение меняет тон.
      this.lumiGlow.setTint(state === 'point' ? PALETTE.amber : 0xffffff);
    }
  }

  private updateProximity() {
    const distLab = Phaser.Math.Distance.Between(this.player.x, this.player.y, LAB_BUILDING.x, LAB_BUILDING.y);
    const nowNearLab = distLab <= LAB_BUILDING.interactionRadius;
    let nowNearTransition: BoundaryTransition | null = null;
    if (!nowNearLab) {
      for (const t of BOUNDARY_TRANSITIONS) {
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, t.x, t.y);
        if (dist <= t.interactionRadius) {
          nowNearTransition = t;
          break;
        }
      }
    }
    if (nowNearLab !== this.nearLab) {
      this.nearLab = nowNearLab;
      overhaulEvents.emit('nearLabChanged', { near: nowNearLab });
    }
    const transitionChanged = nowNearTransition?.id !== this.nearTransition?.id;
    if (transitionChanged) {
      this.nearTransition = nowNearTransition;
      overhaulEvents.emit('nearGateChanged', { near: !!nowNearTransition });
    }
    this.renderPrompt();
  }

  private renderPrompt() {
    const target = this.nearLab
      ? { x: LAB_BUILDING.x, y: LAB_BUILDING.y, height: LAB_BUILDING.displayHeight }
      : this.nearTransition
        ? { x: this.nearTransition.x, y: this.nearTransition.y, height: this.nearTransition.displayHeight }
        : null;
    if (!target) {
      this.promptImage?.setVisible(false);
      this.promptText?.setVisible(false);
      return;
    }
    const label = this.nearLab ? 'E / тап — войти в лабораторию' : this.nearTransition!.label;
    const py = target.y - target.height - 14;
    if (!this.promptImage) {
      this.promptImage = this.add.image(target.x, py, 'hud_interact_prompt');
      this.promptText = this.add
        .text(target.x, py, label, { fontFamily: FONT_BODY, fontSize: '13px', color: INK, fontStyle: '700' })
        .setOrigin(0.5);
    }
    this.promptImage.setPosition(target.x, py).setDepth(target.y + 500).setVisible(true);
    this.promptText!.setPosition(target.x, py).setText(label).setDepth(target.y + 501).setVisible(true);
  }
}
