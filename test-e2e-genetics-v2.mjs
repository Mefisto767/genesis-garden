import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Genetics V2 — Slice 5 focused smoke test (Overhaul+V2 build only, see
// CLAUDE.md/README for the VITE_VISUAL_OVERHAUL_ENABLED=true
// VITE_DIPLOID_GENETICS_ENABLED=true build command). Exercises the new
// nursery lifecycle end-to-end through the real UI (LabPanelV2 ->
// PlantPickerV2 -> EstateScene mature plot -> HybridCardPanel), the way
// test-e2e-overhaul.mjs exercises the legacy Overhaul flow. Does NOT
// duplicate the pure-logic coverage already in store.nurseryV2.test.ts /
// nurseryV2.test.ts / legacyProjectionV2.test.ts — this only checks that the
// UI wiring itself is correct and that the genome/phenotype of a hybrid seed
// is never shown before maturity (delta doc §0.7 п.11/п.13).

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const URL = process.argv[2] || 'http://localhost:4175/genesis-garden/';
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
  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', `genetics-v2-${name}.png`) });
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`OK: ${msg}`);
}

async function dismissOnboarding() {
  const visible = await page.locator('.onboarding-backdrop').isVisible().catch(() => false);
  if (visible) {
    await page.locator('.onboarding-skip').click();
    await page.waitForTimeout(300);
  }
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 8000 });
await page.waitForTimeout(1000);
await dismissOnboarding();

// Deterministic same-species save (shape 1 for both) so V2 breeding never
// hits unsupported_species/interspecies_locked — those rejection paths are
// already unit-tested (store.nurseryV2.test.ts), this smoke test only needs
// a guaranteed-successful breed. `version: 3` reuses the same migration path
// already exercised by test-e2e-overhaul.mjs Test A (backfills genomeV2 via
// ensureGenomeV2Sidecars on load).
await page.evaluate(() => {
  localStorage.setItem(
    'genesis-garden-save-v1',
    JSON.stringify({
      version: 3,
      coins: 100,
      plots: Array.from({ length: 24 }, (_, i) => ({ id: i, unlocked: i < 6, seedId: null, plantedAt: null })),
      inventory: { sprout: 1 },
      specimens: [
        { id: 'a', genome: { shape: 1, primary: '#FF8C77', secondary: '#F5A623', leaf: '#6FBE44', pattern: 'solid', size: 'normal', aura: 'none', mutationId: null }, createdAt: 1 },
        { id: 'b', genome: { shape: 1, primary: '#89D65C', secondary: '#F5A623', leaf: '#57993A', pattern: 'solid', size: 'large', aura: 'faint', mutationId: null }, createdAt: 2 },
      ],
      geneticDust: 0,
      pityCounter: 0,
      questProgress: {},
      questsClaimed: [],
      entitlements: [],
    })
  );
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();
await shot('00-estate-loaded');

// --- walk to the lab building (same navigation recipe as test-e2e-overhaul.mjs) ---
const canvasBox = await page.locator('canvas').boundingBox();
async function worldToScreen(worldX, worldY) {
  const debug = await page.evaluate(() => window.__overhaulDebug?.getEstateState());
  if (!debug) throw new Error('window.__overhaulDebug not available — EstateScene debug hook missing');
  return { x: canvasBox.x + (worldX - debug.cameraScrollX), y: canvasBox.y + (worldY - debug.cameraScrollY) };
}

const plot0World = { x: 780, y: 732 }; // worldConfig.PLOT_SLOTS[0]
const labWorld = { x: 980, y: 892 }; // worldConfig.LAB_BUILDING
const nearLabWorld = { x: labWorld.x - 60, y: labWorld.y + 8 };
const nearLabScreen = await worldToScreen(nearLabWorld.x, nearLabWorld.y);
await page.mouse.click(nearLabScreen.x, nearLabScreen.y);
let entered = false;
for (let i = 0; i < 30 && !entered; i++) {
  const labScreen = await worldToScreen(labWorld.x, labWorld.y - 40);
  await page.mouse.click(labScreen.x, labScreen.y);
  await page.waitForTimeout(500);
  entered = await page.locator('.overhaul-mode-laboratory').isVisible().catch(() => false);
}
assert(entered, 'walked into LaboratoryScene');

// --- Test A: workbench hotspot opens LabPanelV2 (not legacy LabPanel) ---
const canvasBox2 = await page.locator('canvas').boundingBox();
const w = canvasBox2.width;
const h = canvasBox2.height;
const spacing = Math.min(150, w / 6);
const startX = w / 2 - spacing * 2;
const hotspotY = h * 0.68;
await page.mouse.click(canvasBox2.x + startX, canvasBox2.y + hotspotY);
await page.waitForTimeout(400);
const nurseryCounterVisible = await page.getByText(/Питомник: 0\/8/).first().isVisible().catch(() => false);
assert(nurseryCounterVisible, 'workbench hotspot opens LabPanelV2 showing "Питомник: 0/8"');
await shot('01-labpanel-v2');

// --- Test B: breed two V2-eligible specimens — no genome/phenotype revealed ---
const cards = page.locator('.specimen-card');
const cardCount = await cards.count();
assert(cardCount === 2, `both starter specimens selectable for V2 breeding (found ${cardCount})`);
await cards.nth(0).click();
await cards.nth(1).click();
await page.waitForTimeout(200);
await page.locator('.sheet-buy-btn').click();
await page.waitForTimeout(300);
const bredNotice = await page.getByText(/Гибридное семя появилось/).first().isVisible().catch(() => false);
assert(bredNotice, 'breedNurseryV2 success shows only "hybrid seed appeared" notice');
const nurseryAfterBreed = await page.getByText(/Питомник: 1\/8/).first().isVisible().catch(() => false);
assert(nurseryAfterBreed, 'nursery tray counter updated to 1/8 after breeding');
const genomeLeaked = await page.getByText(/Основной цвет|Доп\. цвет|Аура:|Узор:/).first().isVisible().catch(() => false);
assert(!genomeLeaked, 'no phenotype/genome fields rendered anywhere after breeding (not revealed before maturity)');
await shot('02-hybrid-seed-bred');
await page.locator('.sheet-close').click();
await page.waitForTimeout(200);

// --- back to Estate --- (retry loop: the fade transition takes a moment,
// same pattern as the LaboratoryScene-entry retry loop above)
let backInEstate = false;
for (let i = 0; i < 10 && !backInEstate; i++) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  backInEstate = await page.locator('.overhaul-mode-estate').isVisible().catch(() => false);
}
assert(backInEstate, 'exited back to Estate');
await page.waitForTimeout(400);

// --- Test C: clicking an empty plot opens PlantPickerV2 with the hybrid seed listed ---
// Retry loop (same reasoning as the LaboratoryScene-entry loop above): right
// after a scene transition, EstateScene.create() may not have finished
// registering plot hit areas / re-enabling input for a beat.
let pickerOpen = false;
for (let i = 0; i < 10 && !pickerOpen; i++) {
  const plot0Screen = await worldToScreen(plot0World.x, plot0World.y);
  await page.mouse.click(plot0Screen.x, plot0Screen.y);
  await page.waitForTimeout(400);
  pickerOpen = await page.locator('.sheet-backdrop').isVisible().catch(() => false);
}
const hybridRowVisible = pickerOpen && (await page.getByText(/Гибридное семя #1/).first().isVisible().catch(() => false));
assert(hybridRowVisible, 'PlantPickerV2 lists the bred hybrid seed from the Nursery Tray, without revealing its genome');
await shot('03-plantpicker-v2');
await page.getByText(/Гибридное семя #1/).first().click();
await page.waitForTimeout(400);
const pickerClosed = !(await page.locator('.sheet-backdrop').isVisible().catch(() => false));
assert(pickerClosed, 'planting the hybrid seed closes the picker (plantHybridSeedV2 succeeded)');
await shot('04-hybrid-planted-growing');

// --- Test D: fast-forward growth (localStorage time-travel, same technique as
// other e2e scripts use for save injection) and harvest first maturity ---
await page.evaluate(() => {
  const raw = localStorage.getItem('genesis-garden-save-v1');
  const state = JSON.parse(raw);
  const plot = state.plots.find((p) => p.hybridV2 && p.hybridV2.phase === 'growing');
  if (!plot) throw new Error('no growing V2 plot found in save to fast-forward');
  plot.hybridV2.hybrid.plantedAt = Date.now() - (5 * 60 * 1000 + 5000); // species 1: 5 min first growth
  localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();

const plot0ScreenAfterReload = await worldToScreen(plot0World.x, plot0World.y);
await page.mouse.click(plot0ScreenAfterReload.x, plot0ScreenAfterReload.y);
await page.waitForTimeout(500);

await page.getByRole('button', { name: 'Альбом' }).click();
await page.waitForTimeout(400);
const albumCards = await page.locator('.album-card').count();
assert(albumCards === 3, `first harvest created exactly one new Specimen, added to collection automatically (album shows ${albumCards}, expected 3)`);
await shot('05-album-after-first-harvest');
await page.locator('.sheet-close').click();
await page.waitForTimeout(300);

// --- Test E: mature plot click opens the minimal simple card (HybridCardPanel) ---
let cardOpen = false;
for (let i = 0; i < 10 && !cardOpen; i++) {
  const plot0ScreenMature = await worldToScreen(plot0World.x, plot0World.y);
  await page.mouse.click(plot0ScreenMature.x, plot0ScreenMature.y);
  await page.waitForTimeout(400);
  cardOpen = await page.getByText('Постоянное растение').first().isVisible().catch(() => false);
}
assert(cardOpen, 'clicking the mature V2 plot opens the simple card panel');
const forbiddenElements = await page.getByText(/Микроскоп|Reveal|Раскрыть|Родословн|Pedigree/).first().isVisible().catch(() => false);
assert(!forbiddenElements, 'simple card has no microscope/reveal/pedigree elements (Slice 5 scope only)');

// --- Test E2 (fix-pass, bug 3): species name, rarity, and all nine locus
// rows are shown on the mature card — none of this was revealed before
// maturity (Test B/C above already assert no phenotype leaked pre-harvest).
const speciesNameVisible = await page.getByText('Солнечник').first().isVisible().catch(() => false);
assert(speciesNameVisible, 'mature card shows the species NAME ("Солнечник"), not "#1"');
const rarityRowVisible = await page.getByText('Редкость').first().isVisible().catch(() => false);
assert(rarityRowVisible, 'mature card shows a computed rarity row (rarityOfV2)');
const NINE_LOCUS_LABELS = [
  'Стебель',
  'Форма листвы',
  'Форма цветка',
  'Основной цвет',
  'Доп. цвет',
  'Листва',
  'Узор',
  'Размер',
  'Аура',
];
for (const label of NINE_LOCUS_LABELS) {
  const visible = await page.getByText(label, { exact: true }).first().isVisible().catch(() => false);
  assert(visible, `mature card shows the "${label}" locus row (all 9 expressed loci, no gaps)`);
}
const collectDisabled = await page.locator('.sheet-buy-btn', { hasText: 'Собрать' }).isDisabled().catch(() => true);
assert(collectDisabled, 'repeat-cycle collect button correctly disabled (20 min regrow not elapsed yet)');
await shot('06-hybrid-card-panel');
await page.locator('.sheet-close').click();

const realErrors = errors.filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
assert(realErrors.length === 0, `no unexpected console/page errors (found: ${JSON.stringify(realErrors)})`);

console.log('CONSOLE/PAGE ERRORS:', errors.length ? errors : 'none');
await browser.close();
console.log('genetics v2 (Slice 5) e2e: OK');
