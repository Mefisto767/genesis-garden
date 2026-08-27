import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const URL = process.argv[2] || 'http://localhost:4173';

// В этой sandbox-сессии Chromium предустановлен по фиксированному пути (см.
// системный промт разработки) — используем его напрямую, чтобы не тянуть
// заново. В CI (.github/workflows/ci.yml) этого пути нет: там браузер ставит
// `npx playwright install --with-deps chromium`, и Playwright сам находит
// его через стандартный механизм — тогда executablePath просто не передаём.
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

async function screenshot(name) {
  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', `${name}.png`) });
}

// --- Test A: fresh state, plant + buy + inventory + persistence ---
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 5000 });
await page.waitForTimeout(1500); // дать Phaser-сцене отрисовать сетку по финальному размеру канваса

// Этап 9 — первый визит на "устройстве" (свежий контекст без localStorage)
// показывает онбординг поверх игры, как и должно быть у реального нового
// игрока. Закрываем его один раз — дальше localStorage помнит, что он
// показан, и ни один из последующих page.reload() его больше не покажет.
const onboardingVisible = await page.locator('.onboarding-backdrop').isVisible().catch(() => false);
if (onboardingVisible) {
  await page.locator('.onboarding-skip').click();
  await page.waitForTimeout(200);
}

const coinsInitial = await page.locator('.hud-coins').innerText();
console.log('Initial coins:', coinsInitial);
await screenshot('01-initial');

const canvasBox = await page.locator('canvas').boundingBox();
const firstCellX = canvasBox.x + 56;
const firstCellY = canvasBox.y + 227;

await page.mouse.click(firstCellX, firstCellY);
await page.waitForTimeout(300);
const sheetVisible = await page.locator('.sheet').isVisible().catch(() => false);
console.log('Plant picker sheet visible:', sheetVisible);
await screenshot('02-plant-picker-open');

if (sheetVisible) {
  await page.locator('.sheet-row-clickable').first().click();
  await page.waitForTimeout(300);
}
await screenshot('03-after-planting');

// Buy a seed in the shop
await page.locator('.hud-btn', { hasText: 'Магазин' }).click();
await page.waitForTimeout(300);
await screenshot('04-shop-open');
await page.locator('.sheet-buy-btn').nth(1).click(); // buy "common" seed (index 1)
await page.waitForTimeout(300);
await page.locator('.sheet-close').click();
const coinsAfterBuy = await page.locator('.hud-coins').innerText();
console.log('Coins after buying common seed (-15):', coinsAfterBuy);

// Check inventory shows it
await page.locator('.hud-btn', { hasText: 'Инвентарь' }).click();
await page.waitForTimeout(300);
await screenshot('05-inventory');
await page.locator('.sheet-close').click();

// --- Test B: inject a plot that's already grown (real-time based, no clock mocking) ---
// Simulates a player returning after the grow timer elapsed.
await page.evaluate(() => {
  const raw = localStorage.getItem('genesis-garden-save-v1');
  const state = JSON.parse(raw);
  // plot 1 (index 1, second cell) unlocked & empty by default -> plant a sprout that's already done
  state.plots[1] = { id: 1, unlocked: true, seedId: 'sprout', plantedAt: Date.now() - 70_000 };
  localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await screenshot('06-second-plot-ready');

const coinsBeforeHarvest = await page.locator('.hud-coins').innerText();
console.log('Coins before harvesting ready plot:', coinsBeforeHarvest);

// second cell is one column to the right of the first
const secondCellX = canvasBox.x + 56 + (149 - 56);
const secondCellY = canvasBox.y + 227;
await page.mouse.click(secondCellX, secondCellY);
await page.waitForTimeout(400);
await screenshot('07-after-harvest');

const coinsAfterHarvest = await page.locator('.hud-coins').innerText();
console.log('Coins after harvest (+8 expected):', coinsAfterHarvest);

// --- Test C: unlock a locked plot ---
// Give ourselves enough coins first via direct state edit (isolates the unlock-cost UI logic from economy grind)
await page.evaluate(() => {
  const raw = localStorage.getItem('genesis-garden-save-v1');
  const state = JSON.parse(raw);
  state.coins = 100;
  localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await screenshot('08-before-unlock');

// plot index 6 = row 2, col 2 -> third cell in second row, cost shown as "20"
const lockedCellX = canvasBox.x + 241;
const lockedCellY = canvasBox.y + 320;
await page.mouse.click(lockedCellX, lockedCellY);
await page.waitForTimeout(400);
await screenshot('09-after-unlock');
const coinsAfterUnlock = await page.locator('.hud-coins').innerText();
console.log('Coins after unlocking plot (-20 expected):', coinsAfterUnlock);

// --- Test D: reload persistence check ---
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const coinsAfterReload = await page.locator('.hud-coins').innerText();
console.log('Coins after final reload (should match):', coinsAfterReload);
await screenshot('10-final-reload');

console.log('CONSOLE/PAGE ERRORS:', errors.length ? errors : 'none');

await browser.close();
