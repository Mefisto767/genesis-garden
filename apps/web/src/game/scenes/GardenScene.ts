import Phaser from 'phaser';
import { gameStore } from '../store';
import { getSeedDef } from '../seedCatalog';
import { MAX_PLOTS, type Plot } from '../types';
import { gardenEvents } from '../events';
import { buildPlantSprite, PALETTE } from '../plantArt';
import { track } from '../../analytics/track';

const COLS = 4;
const ROWS = Math.ceil(MAX_PLOTS / COLS);
const HUD_TOP_PADDING = 72; // место под React HUD-бар сверху
const GRID_SIDE_PADDING = 16;
const CELL_GAP = 10;

// Порог смены стадии роста: до 45% — росток, дальше — бутон, готово — цветок.
const STAGE2_THRESHOLD = 0.45;

const INK = '#4A2E17';
const FONT_HEAD = "'Baloo 2', 'Nunito', sans-serif";
const FONT_BODY = "'Nunito', sans-serif";

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export class GardenScene extends Phaser.Scene {
  private gridContainer!: Phaser.GameObjects.Container;
  private decorContainer!: Phaser.GameObjects.Container;
  private cellSize = 64;
  private unsubscribeStore?: () => void;

  constructor() {
    super('Garden');
  }

  create() {
    this.cameras.main.setBackgroundColor(PALETTE.cream);
    this.decorContainer = this.add.container(0, 0);
    this.gridContainer = this.add.container(0, 0);

    this.layoutAndRender();

    this.scale.on('resize', () => this.layoutAndRender());
    this.unsubscribeStore = gameStore.subscribe(() => this.renderPlots());

    // Периодическая перерисовка таймеров роста — раз в 250мс достаточно
    // для плавного обратного отсчёта без нагрузки на CPU телефона.
    this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => this.renderPlots(),
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeStore?.();
    });
  }

  private layoutAndRender() {
    const width = this.scale.width;
    const height = this.scale.height;
    const availableWidth = width - GRID_SIDE_PADDING * 2;
    const availableHeight = height - HUD_TOP_PADDING - GRID_SIDE_PADDING;
    const cellByWidth = (availableWidth - CELL_GAP * (COLS - 1)) / COLS;
    const cellByHeight = (availableHeight - CELL_GAP * (ROWS - 1)) / ROWS;
    this.cellSize = Math.max(40, Math.min(cellByWidth, cellByHeight, 110));
    this.renderPlots();
    this.renderDecor();
  }

  /** Уютный фоновый декор в свободных полях вокруг сетки грядок (когда места
   * достаточно — на десктопе и широких телефонах). Чисто атмосферный слой,
   * без интерактивности, не влияет на игровую логику. */
  private renderDecor() {
    this.decorContainer.removeAll(true);
    const gridWidth = COLS * this.cellSize + (COLS - 1) * CELL_GAP;
    const marginX = (this.scale.width - gridWidth) / 2;
    const centerY = HUD_TOP_PADDING + (this.scale.height - HUD_TOP_PADDING) / 2;

    if (marginX > 90) {
      const size = Math.min(marginX * 0.7, 96);
      const lx = marginX * 0.42;
      const ly = centerY - size * 0.3;
      this.decorContainer.add(this.add.ellipse(lx, ly + size * 0.62, size * 0.7, size * 0.22, PALETTE.ink, 0.18));
      this.decorContainer.add(this.add.image(lx, ly, 'decor_lantern').setDisplaySize(size, size * 1.3));

      const bx = this.scale.width - marginX * 0.45;
      const by = centerY + size * 0.5;
      this.decorContainer.add(this.add.ellipse(bx, by + size * 0.32, size * 1.1, size * 0.22, PALETTE.ink, 0.18));
      this.decorContainer.add(this.add.image(bx, by, 'decor_bench').setDisplaySize(size * 1.2, size * 0.7));
    }
  }

  private renderPlots() {
    const state = gameStore.getState();
    this.gridContainer.removeAll(true);

    const gridWidth = COLS * this.cellSize + (COLS - 1) * CELL_GAP;
    const gridHeight = ROWS * this.cellSize + (ROWS - 1) * CELL_GAP;
    const startX = (this.scale.width - gridWidth) / 2 + this.cellSize / 2;
    const startY = HUD_TOP_PADDING + (this.scale.height - HUD_TOP_PADDING - gridHeight) / 2 + this.cellSize / 2;

    for (const plot of state.plots) {
      const col = plot.id % COLS;
      const row = Math.floor(plot.id / COLS);
      const x = startX + col * (this.cellSize + CELL_GAP);
      const y = startY + row * (this.cellSize + CELL_GAP);
      this.renderPlotCell(plot, x, y);
    }
  }

  private addTile(x: number, y: number, locked: boolean): Phaser.GameObjects.Image {
    const tile = this.add
      .image(x, y, locked ? 'tile_soil_locked' : 'tile_soil')
      .setDisplaySize(this.cellSize, this.cellSize)
      .setInteractive({ useHandCursor: true });
    this.gridContainer.add(tile);
    return tile;
  }

  private renderPlotCell(plot: Plot, x: number, y: number) {
    const size = this.cellSize;

    if (!plot.unlocked) {
      const cost = gameStore.unlockCostFor(plot.id);
      const tile = this.addTile(x, y, true);
      const lock = this.add
        .text(x, y - size * 0.14, '🔒', { fontSize: `${size * 0.28}px` })
        .setOrigin(0.5)
        .setAlpha(0.9);
      const coin = this.add
        .image(x - size * 0.14, y + size * 0.22, 'icon_coin')
        .setDisplaySize(size * 0.18, size * 0.18);
      const costText = this.add
        .text(x + size * 0.02, y + size * 0.22, `${cost}`, {
          fontFamily: FONT_HEAD,
          fontSize: `${size * 0.19}px`,
          color: INK,
        })
        .setOrigin(0, 0.5);
      tile.on('pointerdown', () => {
        const ok = gameStore.unlockPlot(plot.id);
        if (!ok) gardenEvents.emit('toast', { text: 'Не хватает монет на новую грядку' });
      });
      this.gridContainer.add([lock, coin, costText]);
      return;
    }

    if (!plot.seedId) {
      const tile = this.addTile(x, y, false);
      const plus = this.add
        .text(x, y - size * 0.02, '+', {
          fontFamily: FONT_HEAD,
          fontSize: `${size * 0.5}px`,
          color: '#FDF3D9',
        })
        .setOrigin(0.5)
        .setAlpha(0.85);
      tile.on('pointerdown', () => gardenEvents.emit('requestPlant', { plotId: plot.id }));
      this.gridContainer.add([plus]);
      return;
    }

    const def = getSeedDef(plot.seedId);
    if (!def || plot.plantedAt === null) return;
    const status = gameStore.plotStatus(plot);
    if (!status) return;
    const { ready, progress, remainingMs } = status;
    const stage = ready ? 3 : progress < STAGE2_THRESHOLD ? 1 : 2;

    const tile = this.addTile(x, y, false);

    if (ready) {
      const glow = this.add.circle(x, y - size * 0.06, size * 0.5, PALETTE.amberLight, 0.55);
      this.tweens.add({ targets: glow, alpha: 0.2, duration: 700, yoyo: true, repeat: -1 });
      this.gridContainer.add(glow);
    }

    // Послойный спрайт растения: маски, покрашенные в окрас тира, + контур.
    const plantSize = size * (ready ? 0.98 : 0.9);
    const plant = buildPlantSprite(
      this,
      x,
      y - size * 0.06,
      plantSize,
      def.speciesId,
      stage,
      def.colorway
    );
    this.gridContainer.add(plant);

    if (ready) {
      const label = this.add
        .text(x, y + size * 0.38, 'Собрать', {
          fontFamily: FONT_HEAD,
          fontSize: `${size * 0.15}px`,
          color: INK,
          backgroundColor: '#F5A623',
          padding: { left: 8, right: 8, top: 2, bottom: 2 },
        })
        .setOrigin(0.5);
      this.gridContainer.add(label);
    } else {
      // тонкий прогресс-бар роста снизу клетки
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
      this.gridContainer.add([barBg, barFill, timer]);
    }

    tile.on('pointerdown', () => {
      if (!ready) return;
      const ok = gameStore.harvest(plot.id);
      if (ok) track('plant_harvested', { plotId: plot.id, seedId: plot.seedId });
    });
  }
}
