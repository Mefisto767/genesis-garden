import Phaser from 'phaser';
import { gameStore } from '../store';
import { getSeedDef } from '../seedCatalog';
import type { Plot } from '../types';
import { gardenEvents } from '../events';
import { overhaulEvents } from '../../overhaul/events';
import { buildPlantSprite, PALETTE } from '../plantArt';
import { track } from '../../analytics/track';
import {
  clampToWorld,
  facingFromDelta,
  moveWithCollisions,
  pointBlocked,
  stepTowardTarget,
  type Facing,
  type Point,
} from '../../overhaul/movement';
import {
  BUILDINGS,
  DECOR,
  EXPANSION_GATE,
  LAB_BUILDING,
  NPC_PATROL,
  PLAYER_SPAWN,
  PLOT_SLOTS,
  TILE,
  WORLD_COLS,
  WORLD_HEIGHT,
  WORLD_ROWS,
  WORLD_WIDTH,
  collisionRects,
  pathTileKeySet,
  terrainAt,
} from '../../overhaul/worldConfig';

const STAGE2_THRESHOLD = 0.45;
const INK = '#4A2E17';
const FONT_HEAD = "'Baloo 2', 'Nunito', sans-serif";
const FONT_BODY = "'Nunito', sans-serif";
const PLAYER_SPEED = 130; // px/s
const PLAYER_HALF_W = 9;
const PLAYER_HALF_H = 8;

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * EstateScene — внешний мир overhaul-режима (см. docs/FINAL_VISION.md 4.1,
 * техпромт "Vertical Overhaul, этап 1"). Один законченный сектор поместья:
 * дом, 6 грядок (те же сущности gameStore, что и в классическом GardenScene),
 * дорожка, интерактивная лаборатория, пруд, декор, ворота будущего
 * расширения, NPC-патруль. Персонаж: WASD/стрелки + click/tap-to-move,
 * коллизии со зданиями/прудом, камера следует за персонажем в границах мира.
 */
export class EstateScene extends Phaser.Scene {
  private plotsContainer!: Phaser.GameObjects.Container;
  private player!: Phaser.GameObjects.Container;
  private facingIndicator!: Phaser.GameObjects.Image;
  private npc!: Phaser.GameObjects.Container;
  private promptImage?: Phaser.GameObjects.Image;
  private promptText?: Phaser.GameObjects.Text;
  private unsubscribeStore?: () => void;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'W' | 'A' | 'S' | 'D' | 'E' | 'ENTER', Phaser.Input.Keyboard.Key>;
  private moveTarget: Point | null = null;
  private facing: Facing = 'down';
  private obstacles = collisionRects();
  private nearLab = false;
  private nearGate = false;
  private transitioning = false;
  private readonly handleResize = () => this.layoutHud();

  constructor() {
    super('Estate');
  }

  create() {
    this.transitioning = false;
    this.cameras.main.setBackgroundColor(PALETTE.leafDark);
    this.renderTerrain();
    this.renderDecor();
    this.renderBuildings();
    this.plotsContainer = this.add.container(0, 0);
    this.renderPlots();
    this.createPlayer();
    this.createNpc();
    this.setupCamera();
    this.setupInput();

    this.unsubscribeStore = gameStore.subscribe(() => this.renderPlots());
    this.time.addEvent({ delay: 250, loop: true, callback: () => this.renderPlots() });
    this.scale.on('resize', this.handleResize);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeStore?.();
      this.scale.off('resize', this.handleResize);
    });
  }

  private layoutHud() {
    // Камера сама подстраивается под новый размер канваса (Phaser Scale.RESIZE);
    // выделенная функция — задел на будущую адаптацию HUD-элементов сцены
    // (сейчас всё в мировых координатах и camera.setBounds уже достаточно).
  }

  // ---- мир: террейн/декор/здания ------------------------------------------

  private renderTerrain() {
    const pathTiles = pathTileKeySet();
    for (let row = 0; row < WORLD_ROWS; row++) {
      for (let col = 0; col < WORLD_COLS; col++) {
        const kind = terrainAt(col, row, pathTiles);
        const key = kind === 'grass' ? 'tile_grass' : kind === 'path' ? 'tile_path' : 'tile_water';
        const img = this.add.image(col * TILE, row * TILE, key).setOrigin(0, 0);
        img.setDepth(-1000);
        if (kind === 'water') {
          const shine = this.add.image(col * TILE, row * TILE, 'tile_water_alt').setOrigin(0, 0);
          shine.setDepth(-999);
          shine.setAlpha(0);
          this.tweens.add({
            targets: shine,
            alpha: 0.6,
            duration: 1400 + ((col + row) % 5) * 120,
            yoyo: true,
            repeat: -1,
            delay: ((col * 7 + row * 13) % 10) * 80,
          });
        }
      }
    }
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
      const img = this.add
        .image(b.x, b.y, b.assetId)
        .setOrigin(0.5, 1)
        .setDisplaySize(b.displayWidth, b.displayHeight);
      img.setDepth(b.y);
      if (b.interactive) {
        img.setInteractive({ useHandCursor: true });
        img.on('pointerdown', () => this.tryInteractWith(b.id));
      }
    }
  }

  // ---- грядки (переиспользуем существующую игровую модель без изменений) --

  private renderPlots() {
    const state = gameStore.getState();
    this.plotsContainer.removeAll(true);
    for (const slot of PLOT_SLOTS) {
      const plot = state.plots.find((p) => p.id === slot.plotId);
      if (plot) this.renderPlotCell(plot, slot.x, slot.y, slot.size);
    }
  }

  private addTile(x: number, y: number, size: number, locked: boolean): Phaser.GameObjects.Image {
    const tile = this.add
      .image(x, y, locked ? 'tile_soil_locked' : 'tile_soil')
      .setDisplaySize(size, size)
      .setInteractive({ useHandCursor: true });
    tile.setDepth(y);
    this.plotsContainer.add(tile);
    return tile;
  }

  private renderPlotCell(plot: Plot, x: number, y: number, size: number) {
    if (!plot.unlocked) {
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

    if (!plot.seedId) {
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

    if (ready) {
      const glow = this.add.circle(x, y - size * 0.06, size * 0.5, PALETTE.amberLight, 0.55);
      glow.setDepth(y - 1);
      this.tweens.add({ targets: glow, alpha: 0.2, duration: 700, yoyo: true, repeat: -1 });
      this.plotsContainer.add(glow);
    }

    const plantSize = size * (ready ? 0.98 : 0.9);
    const plant = buildPlantSprite(this, x, y - size * 0.06, plantSize, def.speciesId, stage, def.colorway);
    plant.setDepth(y);
    this.plotsContainer.add(plant);

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
    } else {
      const barWidth = size * 0.72;
      const barBg = this.add
        .rectangle(x, y + size * 0.33, barWidth, size * 0.08, PALETTE.cream, 0.95)
        .setOrigin(0.5)
        .setStrokeStyle(2, PALETTE.ink, 0.9);
      const barFill = this.add
        .rectangle(x - barWidth / 2, y + size * 0.33, barWidth * progress, size * 0.08, PALETTE.amber, 1)
        .setOrigin(0, 0.5);
      const timer = this.add
        .text(x, y + size * 0.48, formatRemaining(remainingMs), {
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

    tile.on('pointerdown', () => {
      if (!ready) return;
      const ok = gameStore.harvest(plot.id);
      if (ok) track('plant_harvested', { plotId: plot.id, seedId: plot.seedId });
    });
  }

  // ---- персонаж -------------------------------------------------------------

  private createPlayer() {
    const avatar = this.add.image(0, 0, 'char_avatar').setOrigin(0.5, 0.92);
    this.facingIndicator = this.add.image(10, -4, 'char_facing_indicator').setOrigin(0.5, 0.5);
    this.player = this.add.container(PLAYER_SPAWN.x, PLAYER_SPAWN.y, [avatar, this.facingIndicator]);
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

  private setupCamera() {
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.startFollow(this.player, true, 0.14, 0.14);
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
        this.moveTarget = {
          x: Math.min(Math.max(target.x, 0), WORLD_WIDTH),
          y: Math.min(Math.max(target.y, 0), WORLD_HEIGHT),
        };
      }
    );
  }

  private tryInteractWith(buildingId: string) {
    if (buildingId === 'lab') {
      if (this.nearLab) this.enterLaboratory();
      else gardenEvents.emit('toast', { text: 'Подойди ближе ко входу в лабораторию' });
    } else if (buildingId === 'gate') {
      gardenEvents.emit('toast', { text: 'Расширение территории появится позже' });
    }
  }

  private enterLaboratory() {
    if (this.transitioning) return;
    this.transitioning = true;
    const reduced =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 80 : 320;
    this.cameras.main.fadeOut(duration, 20, 15, 12);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      overhaulEvents.emit('enterLaboratory', {});
      this.scene.start('Laboratory');
    });
  }

  update(_time: number, delta: number) {
    if (this.transitioning) return;
    const dt = delta / 1000;
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

    if (dx !== 0 || dy !== 0) {
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

    if (dx !== 0 || dy !== 0) {
      const moved = moveWithCollisions(this.player.x, this.player.y, dx, dy, PLAYER_HALF_W, PLAYER_HALF_H, this.obstacles);
      const clamped = clampToWorld(moved.x, moved.y, PLAYER_HALF_W, PLAYER_HALF_H, WORLD_WIDTH, WORLD_HEIGHT);
      this.player.setPosition(clamped.x, clamped.y);
      this.player.setDepth(clamped.y);
      this.facing = facingFromDelta(dx, dy, this.facing);
      this.updateFacingIndicator();
    }

    this.updateProximity();

    const interactPressed =
      (this.wasd && (Phaser.Input.Keyboard.JustDown(this.wasd.E) || Phaser.Input.Keyboard.JustDown(this.wasd.ENTER))) ??
      false;
    if (interactPressed) {
      if (this.nearLab) this.tryInteractWith('lab');
      else if (this.nearGate) this.tryInteractWith('gate');
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

  private updateProximity() {
    const distLab = Phaser.Math.Distance.Between(this.player.x, this.player.y, LAB_BUILDING.x, LAB_BUILDING.y);
    const distGate = Phaser.Math.Distance.Between(this.player.x, this.player.y, EXPANSION_GATE.x, EXPANSION_GATE.y);
    const nowNearLab = distLab <= LAB_BUILDING.interactionRadius;
    const nowNearGate = !nowNearLab && distGate <= EXPANSION_GATE.interactionRadius;
    if (nowNearLab !== this.nearLab) {
      this.nearLab = nowNearLab;
      overhaulEvents.emit('nearLabChanged', { near: nowNearLab });
    }
    if (nowNearGate !== this.nearGate) {
      this.nearGate = nowNearGate;
      overhaulEvents.emit('nearGateChanged', { near: nowNearGate });
    }
    this.renderPrompt();
  }

  private renderPrompt() {
    const target = this.nearLab ? LAB_BUILDING : this.nearGate ? EXPANSION_GATE : null;
    if (!target) {
      this.promptImage?.setVisible(false);
      this.promptText?.setVisible(false);
      return;
    }
    const label = target === LAB_BUILDING ? 'E / тап — войти в лабораторию' : 'E / тап — Скоро';
    const py = target.y - target.displayHeight - 14;
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
