import Phaser from 'phaser';
import { gameStore } from '../store';
import { getSeedDef } from '../seedCatalog';
import { MAX_PLOTS, type Plot } from '../types';
import { gardenEvents } from '../events';

const COLS = 4;
const ROWS = Math.ceil(MAX_PLOTS / COLS);
const HUD_TOP_PADDING = 72; // место под React HUD-бар сверху
const GRID_SIDE_PADDING = 16;
const CELL_GAP = 10;

const COLORS = {
  background: 0xeaf5e6,
  locked: 0xb7b7b7,
  lockedText: '#f5f5f5',
  emptyFill: 0xf3e6c4,
  emptyBorder: 0xd9bd83,
  growingFill: 0xb08256,
  readyFill: 0xc99a63,
  readyGlow: 0xfff1a8,
  text: '#3c2a1a',
};

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export class GardenScene extends Phaser.Scene {
  private gridContainer!: Phaser.GameObjects.Container;
  private cellSize = 64;
  private unsubscribeStore?: () => void;

  constructor() {
    super('Garden');
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.background);
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

  private renderPlotCell(plot: Plot, x: number, y: number) {
    const size = this.cellSize;

    if (!plot.unlocked) {
      const cost = gameStore.unlockCostFor(plot.id);
      const rect = this.add
        .rectangle(x, y, size, size, COLORS.locked)
        .setStrokeStyle(2, 0x8a8a8a)
        .setInteractive({ useHandCursor: true });
      const lock = this.add.text(x, y - size * 0.12, '🔒', { fontSize: `${size * 0.32}px` }).setOrigin(0.5);
      const costText = this.add
        .text(x, y + size * 0.28, `${cost}🪙`, { fontSize: `${size * 0.16}px`, color: COLORS.lockedText })
        .setOrigin(0.5);
      rect.on('pointerdown', () => {
        const ok = gameStore.unlockPlot(plot.id);
        if (!ok) gardenEvents.emit('toast', { text: 'Не хватает монет на новую грядку' });
      });
      this.gridContainer.add([rect, lock, costText]);
      return;
    }

    if (!plot.seedId) {
      const rect = this.add
        .rectangle(x, y, size, size, COLORS.emptyFill)
        .setStrokeStyle(2, COLORS.emptyBorder)
        .setInteractive({ useHandCursor: true });
      const plus = this.add
        .text(x, y, '+', { fontSize: `${size * 0.5}px`, color: '#a3781f' })
        .setOrigin(0.5);
      rect.on('pointerdown', () => gardenEvents.emit('requestPlant', { plotId: plot.id }));
      this.gridContainer.add([rect, plus]);
      return;
    }

    const def = getSeedDef(plot.seedId);
    if (!def || plot.plantedAt === null) return;
    const elapsed = Date.now() - plot.plantedAt;
    const ready = elapsed >= def.growMs;
    const progress = Phaser.Math.Clamp(elapsed / def.growMs, 0, 1);

    const rect = this.add
      .rectangle(x, y, size, size, ready ? COLORS.readyFill : COLORS.growingFill)
      .setStrokeStyle(2, 0x5c3a20)
      .setInteractive({ useHandCursor: true });

    if (ready) {
      const glow = this.add.circle(x, y, size * 0.55, COLORS.readyGlow, 0.5);
      this.tweens.add({ targets: glow, alpha: 0.15, duration: 700, yoyo: true, repeat: -1 });
      this.gridContainer.add(glow);
    }

    const emoji = this.add
      .text(x, y - size * 0.12, def.emoji, { fontSize: `${size * (ready ? 0.42 : 0.3)}px` })
      .setOrigin(0.5);

    this.gridContainer.add([rect, emoji]);

    if (ready) {
      const label = this.add
        .text(x, y + size * 0.34, 'Собрать', { fontSize: `${size * 0.14}px`, color: COLORS.text })
        .setOrigin(0.5);
      this.gridContainer.add(label);
    } else {
      // тонкий прогресс-бар роста снизу клетки
      const barWidth = size * 0.8;
      const barBg = this.add.rectangle(x, y + size * 0.36, barWidth, 6, 0x3c2a1a, 0.25).setOrigin(0.5);
      const barFill = this.add
        .rectangle(x - barWidth / 2, y + size * 0.36, barWidth * progress, 6, 0xffffff, 0.9)
        .setOrigin(0, 0.5);
      const timer = this.add
        .text(x, y + size * 0.5, formatRemaining(def.growMs - elapsed), {
          fontSize: `${size * 0.13}px`,
          color: COLORS.text,
        })
        .setOrigin(0.5);
      this.gridContainer.add([barBg, barFill, timer]);
    }

    rect.on('pointerdown', () => {
      if (!ready) return;
      gameStore.harvest(plot.id);
    });
  }
}
