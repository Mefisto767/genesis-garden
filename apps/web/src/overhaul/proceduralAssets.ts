// ============================================================================
// Генераторы временных текстур для Visual Overhaul — см. docs/ASSET_MANIFEST.md,
// колонка source: { kind: 'procedural', gen }. Каждая функция здесь
// соответствует ровно одному `gen` из assetManifest.ts и рисует АККУРАТНЫЙ
// ВРЕМЕННЫЙ ассет через Phaser.Graphics -> generateTexture — не эмодзи, не
// куски чужого арт-пака, не попытка выдать это за финальную иллюстрацию.
// Все текстуры используют существующую палитру проекта (game/plantPalette.ts
// PALETTE), чтобы не создавать второй несогласованный набор цветов.
//
// Идемпотентно: каждая функция не перегенерирует текстуру, если она уже
// зарегистрирована (важно — BootSceneOverhaul может вызываться не первый раз
// в hot-reload/тестах).
// ============================================================================
import Phaser from 'phaser';
import { PALETTE } from '../game/plantPalette';

function already(scene: Phaser.Scene, key: string): boolean {
  return scene.textures.exists(key);
}

export function generateGrassTile(scene: Phaser.Scene): void {
  if (already(scene, 'tile_grass')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(PALETTE.leafDark, 1).fillRect(0, 0, 32, 32);
  g.fillStyle(PALETTE.leaf, 1).fillRect(0, 0, 32, 30);
  // Лёгкий детерминированный спекл — не случайный на каждый кадр, фиксированный узор.
  const speckles: [number, number][] = [
    [4, 6], [12, 3], [22, 9], [7, 18], [26, 15], [17, 24], [3, 27], [29, 22],
  ];
  g.fillStyle(PALETTE.leafLight, 0.55);
  for (const [sx, sy] of speckles) g.fillRect(sx, sy, 2, 2);
  g.generateTexture('tile_grass', 32, 32);
  g.destroy();
}

export function generatePathTile(scene: Phaser.Scene): void {
  if (already(scene, 'tile_path')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(PALETTE.woodShade, 1).fillRect(0, 0, 32, 32);
  g.fillStyle(PALETTE.wood, 1).fillRect(1, 1, 30, 30);
  const speckles: [number, number][] = [[5, 5], [20, 8], [10, 20], [24, 24], [15, 14]];
  g.fillStyle(PALETTE.woodShade, 0.5);
  for (const [sx, sy] of speckles) g.fillRect(sx, sy, 2, 2);
  g.generateTexture('tile_path', 32, 32);
  g.destroy();
}

export function generateWaterTile(scene: Phaser.Scene): void {
  if (already(scene, 'tile_water')) return;
  const base = scene.make.graphics({ x: 0, y: 0 }, false);
  base.fillStyle(0x3f7fa6, 1).fillRect(0, 0, 32, 32);
  base.fillStyle(0x5aa0c9, 0.6).fillRect(2, 4, 26, 6);
  base.generateTexture('tile_water', 32, 32);
  base.destroy();

  if (already(scene, 'tile_water_alt')) return;
  const alt = scene.make.graphics({ x: 0, y: 0 }, false);
  alt.fillStyle(0x3f7fa6, 1).fillRect(0, 0, 32, 32);
  alt.fillStyle(0x8fc6e6, 0.6).fillRect(4, 18, 22, 6);
  alt.generateTexture('tile_water_alt', 32, 32);
  alt.destroy();
}

/** Заросли/дикая полоса за границей открытого сектора (см. worldConfig.ts
 * CAMERA_BOUNDS/collisionRects) — нарочито темнее и гуще травы, чтобы честно
 * читаться как "сюда пока нельзя", а не как обычный газон. */
export function generateThicketTile(scene: Phaser.Scene): void {
  if (already(scene, 'tile_thicket')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(PALETTE.leafDark, 1).fillRect(0, 0, 32, 32);
  g.fillStyle(0x1c2e1a, 1).fillRect(0, 0, 32, 30);
  const clumps: [number, number, number][] = [
    [4, 4, 6], [16, 8, 7], [26, 6, 5], [8, 18, 6], [22, 20, 7], [3, 26, 5], [28, 27, 5],
  ];
  g.fillStyle(0x122011, 0.85);
  for (const [cx, cy, r] of clumps) g.fillCircle(cx, cy, r);
  g.generateTexture('tile_thicket', 32, 32);
  g.destroy();
}

/** Небольшой склад-сарай (building_storage) — отдельная от дома силуэт-форма
 * (дом временно переиспользует building_storage.png из v0.3-pack; этот сарай
 * — второй, более скромный объект, чтобы не дублировать один и тот же PNG на
 * двух разных зданиях подряд). Честный процедурный плейсхолдер. */
export function generateStorageShedTexture(scene: Phaser.Scene): void {
  if (already(scene, 'building_storage_shed')) return;
  const w = 70;
  const h = 70;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(PALETTE.ink, 0.25).fillEllipse(w / 2, h - 4, w * 0.6, 10);
  g.fillStyle(PALETTE.wood, 1).fillRect(w * 0.16, h * 0.42, w * 0.68, h * 0.5);
  g.lineStyle(2, PALETTE.ink, 1).strokeRect(w * 0.16, h * 0.42, w * 0.68, h * 0.5);
  g.fillStyle(PALETTE.woodShade, 1).fillTriangle(w * 0.08, h * 0.42, w * 0.92, h * 0.42, w * 0.5, h * 0.1);
  g.lineStyle(2, PALETTE.ink, 1).strokeTriangle(w * 0.08, h * 0.42, w * 0.92, h * 0.42, w * 0.5, h * 0.1);
  g.fillStyle(PALETTE.ink, 0.8).fillRect(w * 0.44, h * 0.66, w * 0.14, h * 0.26);
  g.generateTexture('building_storage_shed', w, h);
  g.destroy();
}

/** "Разрушенный проход" — вторая честная заглушка будущей зоны, вариация
 * fence_gate (см. Task4: "воротами ИЛИ разрушенными проходами"). */
export function generateRuinedPassageTexture(scene: Phaser.Scene): void {
  if (already(scene, 'prop_ruined_passage')) return;
  const w = 90;
  const h = 70;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(PALETTE.neutral, 1);
  g.fillRect(4, 24, 16, h - 24);
  g.fillRect(w - 20, 10, 16, h - 10);
  g.lineStyle(2, PALETTE.ink, 1);
  g.strokeRect(4, 24, 16, h - 24);
  g.strokeRect(w - 20, 10, 16, h - 10);
  // Осыпавшиеся камни у основания — читается как "давно не расчищали".
  g.fillStyle(PALETTE.neutral, 0.8);
  g.fillCircle(30, h - 6, 6);
  g.fillCircle(44, h - 4, 5);
  g.fillCircle(60, h - 8, 7);
  g.lineStyle(2, PALETTE.ink, 0.6);
  g.strokeCircle(30, h - 6, 6);
  g.strokeCircle(44, h - 4, 5);
  g.strokeCircle(60, h - 8, 7);
  g.generateTexture('prop_ruined_passage', w, h);
  g.destroy();
}

export function generateGateTexture(scene: Phaser.Scene): void {
  if (already(scene, 'fence_gate')) return;
  const w = 110;
  const h = 90;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  // Два столба + верхняя перекладина, "недостроенные" ворота будущей зоны.
  g.fillStyle(PALETTE.wood, 1);
  g.fillRect(6, 20, 12, h - 20);
  g.fillRect(w - 18, 20, 12, h - 20);
  g.fillRect(6, 14, w - 12, 10);
  g.lineStyle(3, PALETTE.ink, 1);
  g.strokeRect(6, 20, 12, h - 20);
  g.strokeRect(w - 18, 20, 12, h - 20);
  g.strokeRect(6, 14, w - 12, 10);
  // Диагональная решётка между столбами — читается как "закрыто".
  g.lineStyle(2, PALETTE.neutral, 0.8);
  g.lineBetween(22, 26, w - 22, h - 4);
  g.lineBetween(w - 22, 26, 22, h - 4);
  g.generateTexture('fence_gate', w, h);
  g.destroy();
}

export function generateCharacterPlaceholder(scene: Phaser.Scene): void {
  if (already(scene, 'char_avatar')) return;
  const w = 32;
  const h = 48;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  // Мягкая тень
  g.fillStyle(PALETTE.ink, 0.25).fillEllipse(w / 2, h - 4, 20, 8);
  // Капсула тела — НЕ финальный персонаж, честный геометрический токен.
  g.fillStyle(PALETTE.purple, 1).fillRoundedRect(6, 8, w - 12, h - 18, 10);
  g.lineStyle(2, PALETTE.ink, 1).strokeRoundedRect(6, 8, w - 12, h - 18, 10);
  // "Голова"
  g.fillStyle(0xf3d7b6, 1).fillCircle(w / 2, 10, 7);
  g.lineStyle(2, PALETTE.ink, 1).strokeCircle(w / 2, 10, 7);
  g.generateTexture('char_avatar', w, h);
  g.destroy();
}

/** Маленький треугольник-индикатор направления взгляда — рисуется отдельно
 * от char_avatar и позиционируется/поворачивается в EstateScene по `facing`,
 * чтобы не плодить 4 полных текстуры персонажа ради временного токена. */
export function generateFacingIndicator(scene: Phaser.Scene): void {
  if (already(scene, 'char_facing_indicator')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(PALETTE.ink, 0.9);
  g.fillTriangle(0, -4, 0, 4, 7, 0);
  g.generateTexture('char_facing_indicator', 8, 8);
  g.destroy();
}

// ---- Люми (companion_lumi_*, building_lumi_station) — см. lumiBehavior.ts --
// Только базовые состояния реализованы честным простым плейсхолдером
// (companion_lumi_idle используется и для 'follow', и для 'idle' — Lumi
// просто перемещается, поза не меняется на этом этапе; companion_lumi_glow —
// отдельная пульсирующая текстура светящегося ростка). move/point/work —
// намеренно НЕ генерируются здесь (см. assetManifest.ts, status: 'missing') —
// честно ждут отдельного арт-прохода, а не заменяются похожей текстурой.

export function generateLumiIdleTexture(scene: Phaser.Scene): void {
  if (already(scene, 'companion_lumi_idle')) return;
  const w = 28;
  const h = 36;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  // Латунный корпус в форме семени.
  g.fillStyle(0xb08a4a, 1).fillEllipse(w / 2, h * 0.62, w * 0.42, h * 0.34);
  g.lineStyle(1.5, PALETTE.ink, 0.8).strokeEllipse(w / 2, h * 0.62, w * 0.42, h * 0.34);
  // Стеклянная колба сверху.
  g.fillStyle(0xdff5fb, 0.55).fillCircle(w / 2, h * 0.32, w * 0.34);
  g.lineStyle(1.5, 0xdff5fb, 0.9).strokeCircle(w / 2, h * 0.32, w * 0.34);
  // Живой росток внутри колбы.
  g.fillStyle(PALETTE.leaf, 1).fillCircle(w / 2, h * 0.32, w * 0.12);
  g.generateTexture('companion_lumi_idle', w, h);
  g.destroy();
}

/** Мягкое пульсирующее свечение ростка — единственная "анимация" Люми на
 * этом этапе (alpha-tween, как у water shimmer), не отдельный спрайт-лист. */
export function generateLumiGlowTexture(scene: Phaser.Scene): void {
  if (already(scene, 'companion_lumi_glow')) return;
  const size = 20;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(PALETTE.leafLight, 0.55).fillCircle(size / 2, size / 2, size / 2);
  g.generateTexture('companion_lumi_glow', size, size);
  g.destroy();
}

/** Маленький насест/станция Люми в стартовом саду — building_lumi_station. */
export function generateLumiStationTexture(scene: Phaser.Scene): void {
  if (already(scene, 'building_lumi_station')) return;
  const w = 44;
  const h = 56;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(PALETTE.ink, 0.2).fillEllipse(w / 2, h - 4, w * 0.5, 8);
  g.fillStyle(PALETTE.wood, 1).fillRect(w / 2 - 3, h * 0.35, 6, h * 0.55);
  g.lineStyle(1.5, PALETTE.ink, 0.9).strokeRect(w / 2 - 3, h * 0.35, 6, h * 0.55);
  g.fillStyle(0xdff5fb, 0.5).fillCircle(w / 2, h * 0.28, w * 0.28);
  g.lineStyle(1.5, 0xdff5fb, 0.8).strokeCircle(w / 2, h * 0.28, w * 0.28);
  g.generateTexture('building_lumi_station', w, h);
  g.destroy();
}

const HOTSPOT_SHAPES = ['workbench', 'showcase', 'book', 'microscope', 'dryer'] as const;
export type HotspotShape = (typeof HOTSPOT_SHAPES)[number];

export function generateHotspotIcon(scene: Phaser.Scene, shape: HotspotShape): string {
  const key = `hotspot_icon_${shape}`;
  if (already(scene, key)) return key;
  const size = 48;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(PALETTE.ink, 0.85).fillCircle(size / 2, size / 2, size / 2 - 2);
  g.fillStyle(PALETTE.amber, 1).fillCircle(size / 2, size / 2, size / 2 - 5);
  g.lineStyle(2, PALETTE.ink, 1).strokeCircle(size / 2, size / 2, size / 2 - 5);
  const c = size / 2;
  g.lineStyle(2.5, PALETTE.ink, 1);
  switch (shape) {
    case 'workbench':
      // силуэт колбы
      g.strokeRect(c - 5, c - 9, 10, 6);
      g.strokeTriangle(c - 7, c - 3, c + 7, c - 3, c, c + 10);
      break;
    case 'showcase':
      g.strokeRect(c - 8, c - 2, 16, 10);
      g.lineBetween(c - 8, c - 2, c, c - 10);
      g.lineBetween(c + 8, c - 2, c, c - 10);
      break;
    case 'book':
      g.strokeRect(c - 9, c - 7, 18, 14);
      g.lineBetween(c, c - 7, c, c + 7);
      break;
    case 'microscope':
      g.lineBetween(c, c - 9, c, c + 6);
      g.strokeCircle(c, c - 9, 3);
      g.strokeRect(c - 7, c + 6, 14, 3);
      break;
    case 'dryer':
      g.strokeRect(c - 8, c - 9, 16, 18);
      g.strokeCircle(c, c + 1, 4);
      break;
  }
  g.generateTexture(key, size, size);
  g.destroy();
  return key;
}

export function generateAllHotspotIcons(scene: Phaser.Scene): void {
  HOTSPOT_SHAPES.forEach((s) => generateHotspotIcon(scene, s));
}

export function generateInteractPrompt(scene: Phaser.Scene): void {
  if (already(scene, 'hud_interact_prompt')) return;
  const w = 176;
  const h = 40;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(PALETTE.ink, 0.88).fillRoundedRect(0, 0, w, h, 10);
  g.fillStyle(PALETTE.cream, 1).fillRoundedRect(2, 2, w - 4, h - 4, 8);
  g.lineStyle(2, PALETTE.wood, 1).strokeRoundedRect(2, 2, w - 4, h - 4, 8);
  g.generateTexture('hud_interact_prompt', w, h);
  g.destroy();
}

/** Фон полноэкранной сцены — используется и лабораторией (тёмно-зелёный), и
 * RevealScene (тёмно-фиолетовый) через параметр tone, но регистрируется под
 * своими ключами из манифеста. Растягивается на весь экран (cover) —
 * поэтому не критично к nearest-neighbor артефактам на границе, в отличие
 * от мирового тайлсета. */
function generateFullscreenBackdrop(
  scene: Phaser.Scene,
  key: string,
  topColor: number,
  bottomColor: number
): void {
  if (already(scene, key)) return;
  const w = 960;
  const h = 540;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillGradientStyle(topColor, topColor, bottomColor, bottomColor, 1);
  g.fillRect(0, 0, w, h);
  // Виньетка по углам — простые полупрозрачные прямоугольники, не текст/эмодзи.
  g.fillStyle(0x000000, 0.35);
  g.fillRect(0, 0, w, 60);
  g.fillRect(0, h - 60, w, 60);
  g.fillRect(0, 0, 60, h);
  g.fillRect(w - 60, 0, 60, h);
  g.generateTexture(key, w, h);
  g.destroy();
}

export function generateLabBackdrop(scene: Phaser.Scene): void {
  generateFullscreenBackdrop(scene, 'lab_bg_level1', 0x1c2b1e, 0x0e1610);
}

export function generateRevealBackdrop(scene: Phaser.Scene): void {
  generateFullscreenBackdrop(scene, 'reveal_backdrop', 0x241a33, 0x0c0714);
}

/** Расчищенная поляна, зарезервированная под будущий монумент (landmark_central,
 * см. estateBlueprint.ts). Никакого монумента здесь не рисуется — только
 * нейтрально расчищенный участок земли, честно "пусто и зарезервировано". */
export function generateLandmarkClearingTexture(scene: Phaser.Scene): void {
  if (already(scene, 'landmark_clearing')) return;
  const size = 64;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(PALETTE.wood, 0.35).fillCircle(size / 2, size / 2, size / 2 - 2);
  g.lineStyle(2, PALETTE.woodShade, 0.6).strokeCircle(size / 2, size / 2, size / 2 - 6);
  g.generateTexture('landmark_clearing', size, size);
  g.destroy();
}

export function generateRevealPedestal(scene: Phaser.Scene): void {
  if (already(scene, 'reveal_pedestal')) return;
  const w = 280;
  const h = 120;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(PALETTE.ink, 0.4).fillEllipse(w / 2, h - 14, w * 0.55, 18);
  g.fillStyle(0xbfe4f2, 0.35).fillEllipse(w / 2, h - 30, w * 0.42, 28);
  g.lineStyle(2, 0xdff5fb, 0.7).strokeEllipse(w / 2, h - 30, w * 0.42, 28);
  g.fillStyle(PALETTE.amber, 0.9).fillRect(w / 2 - 3, h - 46, 6, 20);
  g.generateTexture('reveal_pedestal', w, h);
  g.destroy();
}

/** Вызывается один раз из BootSceneOverhaul.preload()/create() — генерирует
 * все процедурные текстуры манифеста разом, до старта EstateScene. */
export function generateAllProceduralTextures(scene: Phaser.Scene): void {
  generateGrassTile(scene);
  generatePathTile(scene);
  generateWaterTile(scene);
  generateThicketTile(scene);
  generateGateTexture(scene);
  generateRuinedPassageTexture(scene);
  generateStorageShedTexture(scene);
  generateCharacterPlaceholder(scene);
  generateFacingIndicator(scene);
  generateLumiIdleTexture(scene);
  generateLumiGlowTexture(scene);
  generateLumiStationTexture(scene);
  generateLandmarkClearingTexture(scene);
  generateAllHotspotIcons(scene);
  generateInteractPrompt(scene);
  generateLabBackdrop(scene);
  generateRevealBackdrop(scene);
  generateRevealPedestal(scene);
}
