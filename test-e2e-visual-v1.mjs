import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Visual V1 foundation — focused e2e (docs/VISUAL_BIBLE_V1.md §3/§6/§7,
// docs/VISUAL_PRODUCTION_ROADMAP.md V1). Гоняется против реального
// Overhaul+V2 билда (тот же :4175, что test-e2e-genetics-v2*.mjs).
//
// Проверяет три вьюпорта контракта:
//   Desktop 1366×768 — canvas заполняет экран, cover-камера без пустоты,
//     сетка 6 грядок (footprint 64 / pitch 96, уникальные координаты),
//     контекстный таймер (нет по умолчанию / hover / tap-pin / pin timeout),
//     shape-based ready marker, агрегат «Готово: N», сбор по клику.
//   Reference 960×540 — контрольный desktop viewport: корректный zoom
//     (960/640 = 1.5), нет overflow, грядки читаемы, HUD не перекрывает
//     основной участок.
//   Mobile 360×800 — нет horizontal overflow, touch targets ≥44 CSS px,
//     tap по растущей грядке показывает таймер, игровые действия достижимы,
//     HUD и bottom sheet помещаются.
//
// Скриншоты кладутся в shots/ (в .gitignore, не коммитятся):
//   visual-v1-desktop.png / visual-v1-reference.png /
//   visual-v1-mobile.png / visual-v1-mobile-timer.png
// ============================================================================

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const URL = process.argv[2] || 'http://localhost:4175/genesis-garden/';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};
mkdirSync(path.join(SCRIPT_DIR, 'shots'), { recursive: true });

// Константы мира, пришпиленные юнит-тестами (worldConfig.test.ts /
// camera.test.ts) — дублируются здесь осознанно, как контрольные значения.
// SECTOR (18×16 тайлов = 576×512) + кольцо зарослей 64px с каждой стороны.
const CAMERA_BOUNDS = { x: 416, y: 448, w: 704, h: 640 };
const PLOT_SLOTS = [
  { plotId: 0, x: 704, y: 720 },
  { plotId: 1, x: 800, y: 720 },
  { plotId: 2, x: 896, y: 720 },
  { plotId: 3, x: 704, y: 816 },
  { plotId: 4, x: 800, y: 816 },
  { plotId: 5, x: 896, y: 816 },
];
const HUD_HEIGHT = 64; // .hud-bar (App.css)

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`OK: ${msg}`);
}

async function debugState() {
  const s = await page.evaluate(() => window.__overhaulDebug?.getEstateState());
  if (!s) throw new Error('window.__overhaulDebug not available — EstateScene debug hook missing');
  return s;
}

async function canvasBox() {
  return await page.locator('canvas').boundingBox();
}

async function worldToScreen(worldX, worldY) {
  const [debug, box] = [await debugState(), await canvasBox()];
  return {
    x: box.x + (worldX - debug.cameraScrollX) * debug.cameraZoom,
    y: box.y + (worldY - debug.cameraScrollY) * debug.cameraZoom,
  };
}

/** Камера не показывает пустоту: видимая область мира внутри CAMERA_BOUNDS. */
async function assertNoEmptySpace(label) {
  const d = await debugState();
  const visW = d.viewportWidth / d.cameraZoom;
  const visH = d.viewportHeight / d.cameraZoom;
  const eps = 1; // субпиксельные погрешности кламп-скролла
  assert(d.cameraScrollX >= CAMERA_BOUNDS.x - eps, `[${label}] camera left edge inside bounds (scrollX=${d.cameraScrollX.toFixed(1)})`);
  assert(d.cameraScrollY >= CAMERA_BOUNDS.y - eps, `[${label}] camera top edge inside bounds (scrollY=${d.cameraScrollY.toFixed(1)})`);
  assert(d.cameraScrollX + visW <= CAMERA_BOUNDS.x + CAMERA_BOUNDS.w + eps, `[${label}] camera right edge inside bounds`);
  assert(d.cameraScrollY + visH <= CAMERA_BOUNDS.y + CAMERA_BOUNDS.h + eps, `[${label}] camera bottom edge inside bounds`);
}

async function plotSnapshot(plotId) {
  const d = await debugState();
  const p = d.plots.find((x) => x.plotId === plotId);
  if (!p) throw new Error(`debug snapshot for plot ${plotId} missing`);
  return p;
}

// Фикстура: legacy-сад с растущей (plot 0) и готовой (plot 1) грядками —
// генетика не трогается, это существующие legacy-механики.
function buildSave(now) {
  const plots = Array.from({ length: 24 }, (_, i) => ({ id: i, unlocked: i < 6, seedId: null, plantedAt: null }));
  plots[0] = { ...plots[0], seedId: 'common', plantedAt: now - 60_000 }; // 15 мин роста — ещё растёт
  plots[1] = { ...plots[1], seedId: 'sprout', plantedAt: now - 120_000 }; // 60с роста — готово
  return {
    version: 4,
    coins: 100,
    plots,
    inventory: { sprout: 1 },
    specimens: [
      {
        id: 'a',
        genome: { shape: 1, primary: '#FF8C77', secondary: '#F5A623', leaf: '#6FBE44', pattern: 'solid', size: 'normal', aura: 'none', mutationId: null },
        createdAt: 1,
      },
    ],
    geneticDust: 0,
    pityCounter: 0,
    questProgress: {},
    questsClaimed: [],
    entitlements: [],
    pollen: 0,
    labLevel: 1,
    nurseryTray: [],
    firstBreedFreeClaimed: true,
    firstHybridRewardClaimed: false,
    firstRecycleTopUpClaimed: false,
    geneticsIntroSeen: true,
    geneticsTutorialBreedsCompleted: 2,
  };
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 8000 });
await page.waitForTimeout(800);
await page.evaluate((save) => {
  localStorage.setItem('genesis-garden-save-v1', JSON.stringify(save));
}, buildSave(Date.now()));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
assert(await page.locator('.overhaul-mode-estate').isVisible(), 'Overhaul+V2 build starts in estate mode');

// ============================ Desktop 1366×768 ==============================

{
  const box = await canvasBox();
  assert(Math.abs(box.width - 1366) <= 2 && Math.abs(box.height - 768) <= 2, `[desktop] canvas fills the viewport (${box.width}x${box.height})`);
  await assertNoEmptySpace('desktop');

  const d = await debugState();
  const expectedZoom = Math.max(1366 / CAMERA_BOUNDS.w, 768 / CAMERA_BOUNDS.h);
  assert(Math.abs(d.cameraZoom - expectedZoom) < 1e-3, `[desktop] cover zoom is ${expectedZoom.toFixed(4)} (actual ${d.cameraZoom.toFixed(4)})`);

  // Сетка: 6 грядок, уникальные координаты, footprint 64, pitch 96.
  assert(d.plots.length === 6, '[desktop] debug snapshot exposes all six plots');
  const coordKeys = new Set(d.plots.map((p) => `${p.x},${p.y}`));
  assert(coordKeys.size === 6, '[desktop] all six plots have unique world coordinates');
  assert(d.plots.every((p) => p.size === 64), '[desktop] every plot footprint is 64px');
  for (const expected of PLOT_SLOTS) {
    const actual = d.plots.find((p) => p.plotId === expected.plotId);
    assert(actual && actual.x === expected.x && actual.y === expected.y, `[desktop] plot ${expected.plotId} at (${expected.x}, ${expected.y})`);
  }
  const xs = [...new Set(d.plots.map((p) => p.x))].sort((a, b) => a - b);
  const ys = [...new Set(d.plots.map((p) => p.y))].sort((a, b) => a - b);
  assert(xs[1] - xs[0] === 96 && xs[2] - xs[1] === 96 && ys[1] - ys[0] === 96, '[desktop] plot pitch is 96px on both axes');

  // Скриншот ДО взаимодействия (ready-маркер на plot 1 уже виден).
  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', 'visual-v1-desktop.png') });

  // Контекстный таймер: по умолчанию отсутствует (мышь в углу, игрок далеко).
  await page.mouse.move(10, 300);
  await page.waitForTimeout(600);
  assert((await plotSnapshot(0)).timerVisible === false, '[desktop] growing plot 0 shows NO timer by default');

  // Hover -> таймер появляется.
  const plot0Screen = await worldToScreen(704, 720);
  await page.mouse.move(plot0Screen.x, plot0Screen.y);
  await page.waitForTimeout(600);
  assert((await plotSnapshot(0)).timerVisible === true, '[desktop] hovering the growing plot shows its timer');

  // Мышь ушла -> таймер прячется (перерисовка идёт 250ms-циклом; в headless
  // среде тики могут группироваться — опрашиваем с запасом по времени).
  await page.mouse.move(10, 300);
  let hiddenAfterLeave = false;
  for (let i = 0; i < 12 && !hiddenAfterLeave; i++) {
    await page.waitForTimeout(400);
    hiddenAfterLeave = (await plotSnapshot(0)).timerVisible === false;
  }
  assert(hiddenAfterLeave, '[desktop] moving the pointer away hides the timer again');

  // Tap -> пин ~3 секунды, затем прячется.
  await page.mouse.click(plot0Screen.x, plot0Screen.y);
  await page.mouse.move(10, 300);
  await page.waitForTimeout(600);
  assert((await plotSnapshot(0)).timerVisible === true, '[desktop] tapping the growing plot pins its timer');
  await page.waitForTimeout(3200);
  let hiddenAfterPin = (await plotSnapshot(0)).timerVisible === false;
  for (let i = 0; i < 8 && !hiddenAfterPin; i++) {
    await page.waitForTimeout(400);
    hiddenAfterPin = (await plotSnapshot(0)).timerVisible === false;
  }
  assert(hiddenAfterPin, '[desktop] the pinned timer disappears after the ~3s pin timeout');

  // Ready-маркер (форма+анимация, см. renderReadyMarker) активен на plot 1.
  assert((await plotSnapshot(1)).ready === true, '[desktop] ready plot 1 exposes an active ready marker state');
  assert((await plotSnapshot(0)).ready === false, '[desktop] growing plot 0 is not marked ready');

  // Агрегат «Готово: N» — ровно 1 готовая грядка.
  const readyCount = page.locator('.overhaul-ready-count');
  assert(await readyCount.isVisible(), '[desktop] the aggregate ready counter is visible');
  assert((await readyCount.textContent()).trim() === 'Готово: 1', '[desktop] the aggregate counter reads exactly «Готово: 1»');

  // Клик по готовой грядке выполняет прежнее действие (legacy harvest).
  const plot1Screen = await worldToScreen(800, 720);
  await page.mouse.click(plot1Screen.x, plot1Screen.y);
  await page.waitForTimeout(700);
  const saveAfter = JSON.parse(await page.evaluate(() => localStorage.getItem('genesis-garden-save-v1')));
  assert(saveAfter.plots[1].seedId === null && saveAfter.plots[1].plantedAt === null, '[desktop] clicking the ready plot harvests it (plot cleared in the save)');
  assert(saveAfter.coins > 100, `[desktop] harvest paid out coins (100 -> ${saveAfter.coins})`);
  await page.waitForTimeout(500);
  assert(!(await page.locator('.overhaul-ready-count').isVisible().catch(() => false)), '[desktop] the ready counter disappears once nothing is ready');
}

// ============================ Reference 960×540 =============================

{
  await page.setViewportSize({ width: 960, height: 540 });
  await page.waitForTimeout(800);

  const d = await debugState();
  assert(Math.abs(d.viewportWidth - 960) <= 2 && Math.abs(d.viewportHeight - 540) <= 2, '[reference] Phaser scale follows the viewport resize');
  const refZoom = Math.max(960 / CAMERA_BOUNDS.w, 540 / CAMERA_BOUNDS.h);
  assert(Math.abs(d.cameraZoom - refZoom) < 1e-3, `[reference] resize recomputed the cover zoom to ${refZoom.toFixed(4)} (actual ${d.cameraZoom.toFixed(4)})`);
  await assertNoEmptySpace('reference');

  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  assert(noHScroll, '[reference] no page overflow on the 960×540 reference viewport');

  // Грядки читаемы: 64px footprint -> 96 CSS px на экране.
  assert(64 * d.cameraZoom >= 64, `[reference] plot footprint renders at ${(64 * d.cameraZoom).toFixed(0)} CSS px — readable`);

  // HUD не перекрывает основной участок: верхний край верхнего ряда грядок
  // ниже нижнего края HUD-панели.
  const hudBox = await page.locator('.hud-bar').boundingBox();
  const topPlotTop = await worldToScreen(704, 720 - 32);
  assert(hudBox.height >= HUD_HEIGHT - 1, '[reference] HUD bar present at its contract height');
  assert(topPlotTop.y >= hudBox.y + hudBox.height, `[reference] HUD does not cover the plot grid (plot top ${topPlotTop.y.toFixed(0)}px vs HUD bottom ${(hudBox.y + hudBox.height).toFixed(0)}px)`);

  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', 'visual-v1-reference.png') });
}

// ============================== Mobile 360×800 ==============================

{
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(800);

  const d = await debugState();
  const expectedZoom = Math.max(360 / CAMERA_BOUNDS.w, 800 / CAMERA_BOUNDS.h);
  assert(Math.abs(d.cameraZoom - expectedZoom) < 1e-3, `[mobile] portrait cover zoom is ${expectedZoom.toFixed(4)} (actual ${d.cameraZoom.toFixed(4)})`);
  await assertNoEmptySpace('mobile');

  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  assert(noHScroll, '[mobile] no horizontal overflow on 360×800');

  // Touch targets: HUD-кнопки и грядки >= 44 CSS px.
  const hudBtnHeights = await page.locator('.hud-btn').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  assert(hudBtnHeights.length > 0 && hudBtnHeights.every((h) => h >= 44), `[mobile] every HUD button is >=44 CSS px (min ${Math.min(...hudBtnHeights).toFixed(1)})`);
  assert(64 * d.cameraZoom >= 44, `[mobile] plot touch target is ${(64 * d.cameraZoom).toFixed(0)} CSS px (>=44)`);

  // Скриншот ДО взаимодействия.
  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', 'visual-v1-mobile.png') });

  // Tap по растущей грядке показывает таймер (пин).
  const plot0Screen = await worldToScreen(704, 720);
  assert(plot0Screen.x >= 0 && plot0Screen.x <= 360 && plot0Screen.y >= 0 && plot0Screen.y <= 800, '[mobile] the growing plot is on screen at spawn');
  await page.mouse.click(plot0Screen.x, plot0Screen.y);
  await page.waitForTimeout(600);
  assert((await plotSnapshot(0)).timerVisible === true, '[mobile] tapping the growing plot shows its pinned timer');
  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', 'visual-v1-mobile-timer.png') });

  // Игровые действия достижимы: пустая грядка открывает PlantPicker...
  const plot2Screen = await worldToScreen(896, 720);
  await page.mouse.click(plot2Screen.x, plot2Screen.y);
  await page.waitForTimeout(600);
  const picker = page.locator('.sheet-backdrop');
  assert(await picker.isVisible(), '[mobile] tapping an empty plot opens the plant picker sheet');
  const sheetBox = await page.locator('.sheet').boundingBox();
  assert(sheetBox.width <= 360 + 1 && sheetBox.x >= -1, '[mobile] the bottom sheet fits the 360px viewport');
  await page.locator('.sheet-close').first().click();
  await page.waitForTimeout(400);

  // ...и HUD-магазин открывается/закрывается без overflow.
  await page.locator('.hud-btn-accent').click();
  await page.waitForTimeout(600);
  assert(await page.locator('.sheet-backdrop').isVisible(), '[mobile] the HUD shop button opens the shop sheet');
  const shopBox = await page.locator('.sheet').boundingBox();
  assert(shopBox.width <= 360 + 1, '[mobile] the shop sheet fits the viewport width');
  const stillNoHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  assert(stillNoHScroll, '[mobile] no horizontal overflow with a sheet open');
  await page.locator('.sheet-close').first().click();
  await page.waitForTimeout(300);
}

const realErrors = errors.filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
assert(realErrors.length === 0, `no unexpected page errors (found: ${JSON.stringify(realErrors)})`);

await browser.close();
console.log('visual-v1 e2e: OK');
