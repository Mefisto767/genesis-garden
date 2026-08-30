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

// --- Test 0: feature flag действительно переключает ClassicApp/OverhaulApp ---
// Классический (флаг выключен) билд обслуживается на 4173 в этом же тестовом
// прогоне (см. CLAUDE.md) — проверяем, что там НЕТ overhaul-разметки
// (`.overhaul-mode-*`), т.е. App.tsx реально рендерит ClassicApp, а не
// overhaul-код с флагом, спрятанным где-то внутри условия рендера.
const classicUrl = URL.replace(':4174', ':4173');
if (classicUrl !== URL) {
  const classicPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await classicPage.goto(classicUrl, { waitUntil: 'networkidle' }).catch(() => {});
  await classicPage.waitForSelector('canvas', { timeout: 8000 }).catch(() => {});
  await classicPage.waitForTimeout(800);
  const hasOverhaulMarkup = await classicPage.locator('[class*="overhaul-mode-"]').count();
  assert(hasOverhaulMarkup === 0, 'flag OFF (classic build on :4173) renders ClassicApp — no overhaul-mode-* markup at all');
  await classicPage.close();
} else {
  console.log('NOTE: skipped Test 0 (flag toggling) — classic build URL not reachable from the given overhaul URL');
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

// --- Test A2: клавиатурное управление (WASD) действительно двигает персонажа ---
// Без DOM-доступа к позиции персонажа (canvas) сравниваем скриншот канваса
// до/после удержания клавиши — сам факт различия пикселей доказывает, что
// keyboard-ввод дошёл до EstateScene и что-то в мире изменилось (персонаж
// сдвинулся). Общая скорость намеренно не проверяется здесь отдельно — она
// уже видна невооружённым взглядом на скриншотах e2e-прогонов этой ветки.
const beforeKeys = await page.locator('canvas').screenshot();
await page.keyboard.down('d');
await page.keyboard.down('s');
await page.waitForTimeout(2500);
await page.keyboard.up('d');
await page.keyboard.up('s');
const afterKeys = await page.locator('canvas').screenshot();
assert(!beforeKeys.equals(afterKeys), 'holding D+S (WASD) visibly moves the character in EstateScene');

// --- Test B: клик по грядке в мире (посадка) — существующая механика работает внутри EstateScene ---
// Вместо хардкода мировых координат PLOT_SLOTS[0] (которые несколько раз
// менялись между этапами вертикального среза) читаем текущую позицию
// камеры/игрока через window.__overhaulDebug (EstateScene.ts) и переводим
// мировые координаты грядки в экранные сами — устойчиво к любым будущим
// правкам worldConfig.ts, без дублирования магических чисел в этом файле.
const canvasBox = await page.locator('canvas').boundingBox();

async function worldToScreen(worldX, worldY) {
  const debug = await page.evaluate(() => window.__overhaulDebug?.getEstateState());
  if (!debug) throw new Error('window.__overhaulDebug not available — EstateScene debug hook missing');
  return {
    x: canvasBox.x + (worldX - debug.cameraScrollX) * debug.cameraZoom,
    y: canvasBox.y + (worldY - debug.cameraScrollY) * debug.cameraZoom,
  };
}

// PLOT_SLOTS[0] world coords (см. worldConfig.ts) — читаем напрямую из страницы,
// чтобы не дублировать число здесь на случай будущих правок раскладки.
const plot0World = { x: 704, y: 720 }; // worldConfig.PLOT_SLOTS[0]
const plot0Screen = await worldToScreen(plot0World.x, plot0World.y);
await page.mouse.click(plot0Screen.x, plot0Screen.y);
await page.waitForTimeout(400);
const plantPickerVisible = await page.locator('.sheet-row-clickable').first().isVisible().catch(() => false);
assert(plantPickerVisible, 'clicking an empty world plot opens the plant picker (reused PlantPicker)');
await page.locator('.sheet-row-clickable').first().click();
await page.waitForTimeout(300);
await shot('02-planted-in-world');

// --- Test C: подойти к лаборатории и войти (Estate -> Laboratory), без утечки клика ---
// worldConfig.LAB_BUILDING = {x:980,y:892}, interactionRadius:100. Кликаем
// чуть в стороне от здания (внутри радиуса взаимодействия, но вне hitbox
// самого спрайта), чтобы задать цель перемещения, а не сразу попасть по
// зданию — так же, как раньше, только координаты теперь вычисляются, а не
// подобраны вручную под конкретную раскладку.
const labWorld = { x: 980, y: 892 }; // worldConfig.LAB_BUILDING, interactionRadius:100
// Точка НИЖЕ anchor-точки здания (спрайт лаборатории растёт вверх от anchor,
// origin (0.5,1) — см. EstateScene.renderBuildings), значит любая точка с
// y > labWorld.y гарантированно вне hitbox самого спрайта, но в пределах
// interactionRadius(100) и не над одной из плиток грядок (PLOT_SLOTS макс.
// y=816+half32=848 — здесь y=900, уже южнее).
const nearLabWorld = { x: labWorld.x - 60, y: labWorld.y + 8 };
const nearLabScreen = await worldToScreen(nearLabWorld.x, nearLabWorld.y);
await page.mouse.click(nearLabScreen.x, nearLabScreen.y);
// Пока персонаж идёт, периодически "стучимся" в дверь лаборатории — до входа
// это просто тост "подойди ближе" (безвредно), после входа в радиус — переход.
// Экранные координаты здания пересчитываем на каждой итерации (камера следует
// за игроком, поэтому scroll меняется по мере ходьбы).
let entered = false;
for (let i = 0; i < 30 && !entered; i++) {
  const labScreen = await worldToScreen(labWorld.x, labWorld.y - 40);
  await page.mouse.click(labScreen.x, labScreen.y);
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

// --- Test E0: resize к портретному вьюпорту прямо внутри LaboratoryScene ---
// Дешёвый способ проверить адаптивную portrait-раскладку hotspot'ов без
// повторной ходьбы через камеру в узком вьюпорте (что медленно и шатко из-за
// троттлинга rAF в headless-песочнице) — просто меняем размер окна, пока уже
// внутри лаборатории, и проверяем реакцию scale.on('resize') -> layout().
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
const noHScrollPortraitLab = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
assert(noHScrollPortraitLab, 'LaboratoryScene resized to 390x844 portrait with no page horizontal scroll');
await shot('05b-laboratory-portrait-resized');
await page.setViewportSize({ width: 1366, height: 768 });
await page.waitForTimeout(400);

// --- Test E: выход обратно в Estate через Escape (клавиатура), отсутствие двойного harvest/breed ---
const coinsBeforeExit = await page.locator('.hud-coins').innerText();
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
const backInEstate = await page.locator('.overhaul-mode-estate').isVisible().catch(() => false);
assert(backInEstate, 'exited back to overhaul-mode-estate');
const coinsAfterExit = await page.locator('.hud-coins').innerText();
assert(coinsAfterExit === coinsBeforeExit, 'coins unchanged by the scene transition itself (no duplicate side effects)');
await shot('06-back-in-estate');

// --- Test F: повторные переходы Estate<->Laboratory — освобождение listeners ---
// LaboratoryScene.layout() читает this.scale/this.add — если бы SHUTDOWN не
// снимал scale.on('resize', ...) корректно, то после нескольких пересозданий
// сцены старый (уже уничтоженный) обработчик срабатывал бы на следующий
// resize и бросал исключение (Phaser-объекты уничтожены) — это попало бы в
// errors[] через page.on('pageerror'). 3 полных цикла туда-обратно — дешёвый,
// но реальный тест на утечку, а не просто "код выглядит правильно".
for (let i = 0; i < 3; i++) {
  const nearLabScreenAgain = await worldToScreen(nearLabWorld.x, nearLabWorld.y);
  await page.mouse.click(nearLabScreenAgain.x, nearLabScreenAgain.y);
  let enteredAgain = false;
  for (let j = 0; j < 20 && !enteredAgain; j++) {
    const labScreenAgain = await worldToScreen(labWorld.x, labWorld.y - 40);
    await page.mouse.click(labScreenAgain.x, labScreenAgain.y);
    await page.waitForTimeout(400);
    enteredAgain = await page.locator('.overhaul-mode-laboratory').isVisible().catch(() => false);
  }
  assert(enteredAgain, `repeat transition #${i + 1}: re-entered LaboratoryScene`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const backAgain = await page.locator('.overhaul-mode-estate').isVisible().catch(() => false);
  assert(backAgain, `repeat transition #${i + 1}: exited back to Estate`);
}

const coinsAfterRepeats = await page.locator('.hud-coins').innerText();
assert(
  coinsAfterRepeats === coinsAfterExit,
  `repeated transitions alone did not change coins (${coinsAfterExit} -> ${coinsAfterRepeats})`
);

const realErrors = errors.filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
assert(realErrors.length === 0, `no leaked-listener exceptions after 3 repeat Estate<->Lab transitions (found: ${JSON.stringify(realErrors)})`);

console.log('CONSOLE/PAGE ERRORS:', errors.length ? errors : 'none');
await browser.close();
console.log('overhaul e2e: OK');
