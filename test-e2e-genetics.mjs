import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const URL = process.argv[2] || 'http://localhost:4173/genesis-garden/';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
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

const realErrors = errors.filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
if (realErrors.length) throw new Error(`page errors: ${realErrors.join(', ')}`);

console.log('genetics e2e: OK — album:', albumCards, '-> ', albumCardsAfter, 'rarity:', rarityText.trim(), 'coins:', coinsBefore, '->', coinsAfter);

await browser.close();
