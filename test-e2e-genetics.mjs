import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const URL = process.argv[2] || 'http://localhost:4173/genesis-garden/';

// См. test-e2e.mjs — sandbox-путь используется, если есть, иначе браузер,
// поставленный `npx playwright install` (так и происходит в CI).
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 420, height: 780 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

async function screenshot(name) {
  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', `${name}.png`) });
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// Этап 9 — чистый localStorage = первый визит = показывается онбординг
// поверх игры (реальное поведение для нового игрока). Закрываем один раз.
const onboardingVisible = await page.locator('.onboarding-backdrop').isVisible().catch(() => false);
if (onboardingVisible) {
  await page.locator('.onboarding-skip').click();
  await page.waitForTimeout(200);
}

// Album should show 2 starter specimens with genomes
await page.getByRole('button', { name: 'Альбом' }).click();
await page.waitForTimeout(400);
await screenshot('gen_01_album');
const albumCards = await page.locator('.album-card').count();
if (albumCards !== 2) throw new Error(`expected 2 starter specimens, got ${albumCards}`);
await page.locator('.sheet-close').click();

// Lab: select two specimens and breed
await page.getByRole('button', { name: 'Лаборатория' }).click();
await page.waitForTimeout(400);
const specimenCards = await page.locator('.specimen-card').all();
if (specimenCards.length !== 2) throw new Error(`expected 2 selectable specimens, got ${specimenCards.length}`);
await specimenCards[0].click();
await specimenCards[1].click();
await screenshot('gen_02_lab_selected');

const coinsBefore = Number((await page.locator('.hud-coins span').textContent()).trim());
await page.getByRole('button', { name: 'Скрестить' }).click();
await page.waitForTimeout(700);
await screenshot('gen_03_reveal');

const rarityText = await page.locator('.lab-reveal-rarity').textContent();
if (!rarityText) throw new Error('reveal rarity label did not render');

await page.getByRole('button', { name: 'Отлично!' }).click();
await page.waitForTimeout(300);

const coinsAfter = Number((await page.locator('.hud-coins span').textContent()).trim());
if (coinsBefore - coinsAfter !== 12) throw new Error(`expected -12 coins for breeding, got ${coinsBefore - coinsAfter}`);

await page.locator('.sheet-close').click();
await page.getByRole('button', { name: 'Альбом' }).click();
await page.waitForTimeout(400);
await screenshot('gen_04_album_after');
const albumCardsAfter = await page.locator('.album-card').count();
if (albumCardsAfter !== 3) throw new Error(`expected 3 specimens after breeding, got ${albumCardsAfter}`);

// Recycle (Этап 5): переработка специмена должна давать пыль, а не монеты,
// и убирать карточку из альбома. Проверяем на только что выведенном (третьем).
const dustBefore = Number((await page.locator('.album-dust').textContent()).replace(/\D+/g, ''));
const coinsBeforeRecycle = Number((await page.locator('.hud-coins span').textContent()).trim());
const recycleButtons = page.locator('.album-card-sell');
if (!(await recycleButtons.first().textContent())?.includes('Переработать')) {
  throw new Error('expected "Переработать" (recycle) label on album card button');
}
await recycleButtons.first().click();
await page.waitForTimeout(300);
await screenshot('gen_05_album_after_recycle');

const albumCardsAfterRecycle = await page.locator('.album-card').count();
if (albumCardsAfterRecycle !== 2) throw new Error(`expected 2 specimens after recycling one, got ${albumCardsAfterRecycle}`);

const dustAfter = Number((await page.locator('.album-dust').textContent()).replace(/\D+/g, ''));
if (dustAfter - dustBefore !== 5) throw new Error(`expected +5 dust from recycling, got ${dustAfter - dustBefore}`);

const coinsAfterRecycle = Number((await page.locator('.hud-coins span').textContent()).trim());
if (coinsAfterRecycle !== coinsBeforeRecycle) throw new Error(`recycling must not change coins, got ${coinsBeforeRecycle} -> ${coinsAfterRecycle}`);

const realErrors = errors.filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
if (realErrors.length) throw new Error(`page errors: ${realErrors.join(', ')}`);

console.log(
  'genetics e2e: OK — album:', albumCards, '-> ', albumCardsAfter, '-> recycle ->', albumCardsAfterRecycle,
  'rarity:', rarityText.trim(), 'coins:', coinsBefore, '->', coinsAfter,
  'dust:', dustBefore, '->', dustAfter,
);

await browser.close();
