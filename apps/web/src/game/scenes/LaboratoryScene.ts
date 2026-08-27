import Phaser from 'phaser';
import { overhaulEvents } from '../../overhaul/events';
import { gardenEvents } from '../events';
import type { HotspotShape } from '../../overhaul/proceduralAssets';

const FONT_HEAD = "'Baloo 2', 'Nunito', sans-serif";
const FONT_BODY = "'Nunito', sans-serif";

const HOTSPOTS: { shape: HotspotShape; label: string; implemented: boolean }[] = [
  { shape: 'workbench', label: 'Рабочий стол', implemented: true },
  { shape: 'showcase', label: 'Витрина', implemented: true },
  { shape: 'book', label: 'Архивная книга', implemented: false },
  { shape: 'microscope', label: 'Микроскоп', implemented: false },
  { shape: 'dryer', label: 'Сушильный шкаф', implemented: false },
];

/**
 * LaboratoryScene — отдельная полноэкранная сцена (не модалка поверх карты),
 * см. docs/FINAL_VISION.md 4.2 и техпромт этапа. Временный (честно помеченный)
 * фон + 5 hotspot'ов. "Рабочий стол" и "Витрина" открывают существующие,
 * протестированные LabPanel/AlbumPanel как React-оверлей поверх сцены —
 * генетика и коллекция не переписывались. "Книга"/"Микроскоп"/"Сушильный
 * шкаф" честно помечены "скоро" (см. GDD раздел 4.2 — это реальные будущие
 * зоны лаборатории, не выдумка).
 */
export class LaboratoryScene extends Phaser.Scene {
  private backdrop!: Phaser.GameObjects.Image;
  private backButton!: Phaser.GameObjects.Text;
  private hotspotNodes: { shape: HotspotShape; icon: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text }[] = [];
  private escKey?: Phaser.Input.Keyboard.Key;
  private transitioning = false;
  private readonly handleResize = () => this.layout();

  constructor() {
    super('Laboratory');
  }

  create() {
    this.transitioning = false;
    this.cameras.main.setBackgroundColor(0x0e1610);
    this.backdrop = this.add.image(0, 0, 'lab_bg_level1').setOrigin(0, 0).setDepth(-100);

    this.add
      .text(8, 8, 'ВРЕМЕННЫЙ ФОН — см. docs/ASSET_MANIFEST.md', {
        fontFamily: FONT_BODY,
        fontSize: '11px',
        color: '#FDF3D9',
      })
      .setAlpha(0.45)
      .setDepth(1000);

    this.backButton = this.add
      .text(16, 40, '← Назад в сад', {
        fontFamily: FONT_HEAD,
        fontSize: '18px',
        color: '#FDF3D9',
        backgroundColor: '#4A2E17',
        padding: { left: 12, right: 12, top: 6, bottom: 6 },
      })
      .setInteractive({ useHandCursor: true })
      .setDepth(1000)
      .on('pointerdown', () => this.exitToEstate());

    this.hotspotNodes = HOTSPOTS.map(({ shape, label }) => {
      const icon = this.add.image(0, 0, `hotspot_icon_${shape}`).setInteractive({ useHandCursor: true }).setDepth(500);
      const text = this.add
        .text(0, 0, label, { fontFamily: FONT_BODY, fontSize: '13px', color: '#FDF3D9', fontStyle: '700' })
        .setOrigin(0.5, 0)
        .setDepth(500);
      icon.on('pointerdown', () => this.activateHotspot(shape));
      icon.on('pointerover', () => icon.setScale(1.12));
      icon.on('pointerout', () => icon.setScale(1));
      return { shape, icon, label: text };
    });

    this.layout();
    // Phaser Scale.RESIZE иногда ещё не успевает измерить финальный размер
    // контейнера в момент create() сразу после смены сцены (особенно на
    // втором/третьем переключении Estate<->Laboratory) — короткий повторный
    // layout() подчищает случай, когда фон/hotspot'ы легли по устаревшему
    // scale.width/height и не дождались отдельного события 'resize'.
    this.time.delayedCall(50, () => this.layout());
    this.scale.on('resize', this.handleResize);

    const kb = this.input.keyboard;
    if (kb) {
      this.escKey = kb.addKey('ESC');
      // Цифры 1-5 — доступ к hotspot'ам с клавиатуры без указателя (см.
      // ограничения полноценной DOM-фокусировки внутри canvas в финальном отчёте).
      HOTSPOTS.forEach((h, i) => {
        kb.addKey(`${i + 1}`).on('down', () => this.activateHotspot(h.shape));
      });
    }

    const reduced =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.cameras.main.fadeIn(reduced ? 60 : 260, 20, 15, 12);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.handleResize);
    });
  }

  private layout() {
    const w = this.scale.width;
    const h = this.scale.height;
    this.backdrop.setDisplaySize(w, h);
    this.backButton.setPosition(16, Math.max(40, h * 0.06));

    const isPortrait = h > w;
    if (isPortrait) {
      const cols = 3;
      const cellW = w / cols;
      const startY = h * 0.4;
      const rowH = 96;
      this.hotspotNodes.forEach((node, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = cellW * (col + 0.5);
        const y = startY + row * rowH;
        node.icon.setPosition(x, y);
        node.label.setPosition(x, y + 30);
      });
    } else {
      const spacing = Math.min(150, w / (HOTSPOTS.length + 1));
      const startX = w / 2 - spacing * ((HOTSPOTS.length - 1) / 2);
      const y = h * 0.68;
      this.hotspotNodes.forEach((node, i) => {
        const x = startX + i * spacing;
        node.icon.setPosition(x, y);
        node.label.setPosition(x, y + 32);
      });
    }
  }

  update() {
    if (this.escKey && Phaser.Input.Keyboard.JustDown(this.escKey)) this.exitToEstate();
  }

  private activateHotspot(shape: HotspotShape) {
    const def = HOTSPOTS.find((h) => h.shape === shape);
    if (!def) return;
    if (!def.implemented) {
      gardenEvents.emit('toast', { text: `${def.label} — скоро` });
      return;
    }
    overhaulEvents.emit('openHotspot', { hotspot: shape });
  }

  private exitToEstate() {
    if (this.transitioning) return;
    this.transitioning = true;
    const reduced =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 80 : 260;
    this.cameras.main.fadeOut(duration, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      overhaulEvents.emit('exitLaboratory', {});
      this.scene.start('Estate');
    });
  }
}
