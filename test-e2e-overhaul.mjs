import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Visual Overhaul e2e (VITE_VISUAL_OVERHAUL_ENABLED=true build only — see
// CLAUDE.md/README для команды сборки этого бандла). Проверяет ровно то, что
// требует техпромт этапа: переход Estate -> Laboratory -> Estate без утечки
// клика, отсутствие протекания между сценами, что старое сохранение
// открывается в overhaul-режиме, и что скрещивание (существующая генетика)
// по-прежнему работает изнутри LaboratoryScene.
//
// EstateScene/LaboratoryScene рисуются на canvas (Phaser), поэтому текст
// внутри них НЕ виден Playwright-локаторам — так же, как в классическом
// GardenScene. Проверяем эффекты через DOM: класс `overhaul-mode-*` на
// корневом контейнере (App.tsx меняет его по overhaulEvents), toast, и
// существующие DOM-панели (.sheet/.lab-reveal-card), которые открывают
// hotspot'ы лаборатории.

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const URL = process.argv[2] || 'http://localhost:4174/genesis-garden/';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

async function shot(name) {
  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', `overhaul-${name}.png`) });
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`OK: ${msg}`);
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 8000 });
await page.waitForTimeout(1200);

const onboardingVisible = await page.locator('.onboarding-backdrop').isVisible().catch(() => false);
if (onboardingVisible) {
  await page.locator('.onboarding-skip').click();
  await page.waitForTimeout(300);
}

// --- Test A: старое сохранение (localStorage сейв v3) открывается в overhaul-режиме ---
await page.evaluate(() => {
  localStorage.setItem(
    'genesis-garden-save-v1',
    JSON.stringify({
      version: 3,
      coins: 777,
      plots: Array.from({ length: 24 }, (_, i) => ({ id: i, unlocked: i < 6, seedId: null, plantedAt: null })),
      inventory: { sprout: 1 },
      specimens: [
        { id: 'a', genome: { shapeId: 1, primary: '#FF8C77', secondary: '#F5A623', leaf: '#6FBE44', pattern: 'solid', size: 'normal', aura: 'none', mutationId: null }, createdAt: 1 },
        { id: 'b', genome: { shapeId: 2, primary: '#89D65C', secondary: '#CFA1E8', leaf: '#57993A', pattern: 'duotone', size: 'large', aura: 'faint', mutationId: null }, createdAt: 2 },
      ],
      geneticDust: 40,
      pityCounter: 0,
      questProgress: {},
      questsClaimed: [],
      entitlements: [],
    })
  );
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const onboarding2 = await page.locator('.onboarding-backdrop').isVisible().catch(() => false);
if (onboarding2) {
  await page.locator('.onboarding-skip').click();
  await page.waitForTimeout(300);
}
const coinsText = await page.locator('.hud-coins').innerText();
assert(coinsText.includes('777'), `old save (777 coins) loaded in overhaul mode, got "${coinsText}"`);
assert(await page.locator('.overhaul-mode-estate').isVisible(), 'starts in overhaul-mode-estate');
await shot('01-estate-old-save');

// --- Test B: клик по грядке в мире (посадка) — существующая механика работает внутри EstateScene ---
const canvasBox = await page.locator('canvas').boundingBox();
// PLOT_SLOTS[0] = world (330, 210); камера не скроллит на 1366x768 (мир 960x640 целиком в кадре).
await page.mouse.click(canvasBox.x + 330, canvasBox.y + 210);
await page.waitForTimeout(400);
const plantPickerVisible = await page.locator('.sheet-row-clickable').first().isVisible().catch(() => false);
assert(plantPickerVisible, 'clicking an empty world plot opens the plant picker (reused PlantPicker)');
await page.locator('.sheet-row-clickable').first().click();
await page.waitForTimeout(300);
await shot('02-planted-in-world');

// --- Test C: подойти к лаборатории и войти (Estate -> Laboratory), без утечки клика ---
// Клик по траве рядом со зданием лаборатории (внутри радиуса взаимодействия,
// но вне hitbox самого спрайта здания) задаёт цель перемещения.
await page.mouse.click(canvasBox.x + 665, canvasBox.y + 265);
// Пока персонаж идёт, периодически "стучимся" в дверь лаборатории — до входа
// это просто тост "подойди ближе" (безвредно), после входа в радиус — переход.
let entered = false;
for (let i = 0; i < 30 && !entered; i++) {
  await page.mouse.click(canvasBox.x + 760, canvasBox.y + 150);
  await page.waitForTimeout(500);
  entered = await page.locator('.overhaul-mode-laboratory').isVisible().catch(() => false);
}
assert(entered, 'walked to the lab building and entered LaboratoryScene (overhaul-mode-laboratory)');
await shot('03-laboratory');

// --- Test D: нет протекания клика между сценами / в панель ---
// Клик по hotspot "Рабочий стол" открывает LabPanel (fullscreenReveal) —
// сама генетика не менялась, проверяем, что скрещивание всё ещё работает.
// Координаты — по формуле layout() в LaboratoryScene.ts (landscape-ветка):
// spacing = min(150, w/6), startX = w/2 - spacing*2, y = h*0.68. Workbench —
// первый (i=0) из 5 hotspot'ов.
const w = canvasBox.width;
const h = canvasBox.height;
const spacing = Math.min(150, w / 6);
const startX = w / 2 - spacing * 2;
const workbenchX = startX; // i = 0
const hotspotY = h * 0.68;
await page.mouse.click(canvasBox.x + workbenchX, canvasBox.y + hotspotY);
await page.waitForTimeout(400);
const labPanelOpen = await page.locator('.sheet').isVisible().catch(() => false);
assert(labPanelOpen, 'workbench hotspot opens the reused LabPanel over LaboratoryScene');
await shot('04-workbench-panel-open');

const cards = page.locator('.specimen-card');
const cardCount = await cards.count();
assert(cardCount >= 2, `at least 2 specimens available to breed (found ${cardCount})`);
await cards.nth(0).click();
await cards.nth(1).click();
await page.waitForTimeout(200);
await page.locator('.sheet-buy-btn').last().click();
await page.waitForTimeout(600);
const revealSceneVisible = await page.locator('.sheet-reveal-scene').isVisible().catch(() => false);
assert(revealSceneVisible, 'breeding result renders via the fullscreen RevealScene styling (sheet-reveal-scene)');
await shot('05-reveal-scene');
await page.locator('.lab-reveal-btn').first().click();
await page.waitForTimeout(200);
await page.locator('.sheet-close, .reveal-scene-close').first().click().catch(() => {});
await page.waitForTimeout(200);
// Закрыть панель, если ещё открыта (backdrop click).
if (await page.locator('.sheet-backdrop').isVisible().catch(() => false)) {
  await page.mouse.click(canvasBox.x + 20, canvasBox.y + canvasBox.height - 20);
  await page.waitForTimeout(200);
}

// --- Test E: выход обратно в Estate, отсутствие двойного harvest/breed ---
const coinsBeforeExit = await page.locator('.hud-coins').innerText();
await page.mouse.click(canvasBox.x + 30, canvasBox.y + 60); // "Назад в сад" (верхний левый угол сцены)
await page.waitForTimeout(800);
const backInEstate = await page.locator('.overhaul-mode-estate').isVisible().catch(() => false);
assert(backInEstate, 'exited back to overhaul-mode-estate');
const coinsAfterExit = await page.locator('.hud-coins').innerText();
assert(coinsAfterExit === coinsBeforeExit, 'coins unchanged by the scene transition itself (no duplicate side effects)');
await shot('06-back-in-estate');

console.log('CONSOLE/PAGE ERRORS:', errors.length ? errors : 'none');
await browser.close();
console.log('overhaul e2e: OK');
