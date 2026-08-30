import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Genetics V2 fix-pass (audit, bug 1) — dedicated regression: Overhaul +
// Legacy Genetics (VITE_VISUAL_OVERHAUL_ENABLED=true,
// VITE_DIPLOID_GENETICS_ENABLED=false, i.e. the :4174 build — same as
// test-e2e-overhaul.mjs) loading a save that ALREADY contains `plot.hybridV2`
// (both a growing and a mature one — saved while V2 was enabled, then the
// player turned Genetics V2 off). This is the exact defect the audit found:
// EstateScene/OverhaulApp used to process `plot.hybridV2` unconditionally,
// without checking `GENETICS_V2_ENABLED`, so a Legacy-mode Overhaul session
// could still open the V2 simple card / trigger V2-harvest.
//
// Does NOT duplicate the pure store-level coverage already in
// store.hybridV2Isolation.test.ts (plantSeed guard, JSON round-trip,
// hybridPlotStatusV2/harvestHybridV2 still functioning) — this only checks
// that the real rendered Legacy-mode UI genuinely cannot reach any V2 action,
// the same "canvas hides text, check DOM effects" methodology already used
// by test-e2e-overhaul.mjs/test-e2e-genetics-v2.mjs (EstateScene draws on a
// Phaser canvas, invisible to Playwright text locators).

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
  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', `genetics-v2-legacy-isolation-${name}.png`) });
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

// Same GenomeV2 fixture shape used across the Vitest suite (fixtureGenomeV2
// pattern from store.nurseryV2.test.ts / hybridCardViewModel.test.ts).
function homo(value) {
  return { a: value, b: value };
}
function fixtureGenomeV2(speciesId) {
  return {
    stemForm: homo('stem_standard'),
    leafForm: homo('leaf_standard'),
    flowerForm: homo('flower_standard'),
    primaryColor: homo('primary_honey'),
    secondaryColor: homo('secondary_forest'),
    leafColor: homo('leaf_color_meadow'),
    pattern: homo('pattern_solid'),
    size: homo('size_normal'),
    aura: homo('aura_none'),
    speciesId,
    mutationId: null,
  };
}
function legacyProjectionFor(genomeV2) {
  // Same values projectGenomeV2ToLegacy() would produce for the homozygous
  // fixture above (primary_honey/secondary_forest solid pattern -> secondary
  // collapses to primary, legacy invariant) — hand-computed here since this
  // script has no access to the app's TS modules directly.
  return {
    shape: genomeV2.speciesId,
    primary: '#FFC85C',
    secondary: '#FFC85C',
    leaf: '#89D65C',
    pattern: 'solid',
    size: 'normal',
    aura: 'none',
    mutationId: null,
  };
}

function buildSave() {
  const growingGenome = fixtureGenomeV2(1);
  const matureGenome = fixtureGenomeV2(2);
  const plots = Array.from({ length: 24 }, (_, i) => ({ id: i, unlocked: i < 6, seedId: null, plantedAt: null }));
  // plot 0 — растущий гибрид (species 1, first grow 5 min) — сохранён давно,
  // поэтому УЖЕ был бы готов к сбору, если бы V2-ветка рендера была активна.
  plots[0] = {
    ...plots[0],
    hybridV2: {
      phase: 'growing',
      hybrid: {
        id: 'hybrid-growing-1',
        genomeV2: growingGenome,
        parentIds: ['seed-a', 'seed-b'],
        createdAt: 0,
        plantedAt: Date.now() - 999_000_000, // далеко за порогом готовности
        plotId: 0,
      },
    },
  };
  // plot 1 — зрелое постоянное растение (species 2), уже готово к повторному циклу.
  plots[1] = {
    ...plots[1],
    hybridV2: { phase: 'mature', specimenId: 'hybrid-specimen-1', lastHarvestAt: Date.now() - 999_000_000 },
  };
  // plot 2 — обычная пустая разблокированная грядка, для контрольной проверки,
  // что legacy-посадка НА ДРУГИХ грядках по-прежнему работает как обычно.
  return {
    version: 4,
    coins: 100,
    plots,
    inventory: { sprout: 1 },
    specimens: [
      { id: 'a', genome: { shape: 1, primary: '#FF8C77', secondary: '#F5A623', leaf: '#6FBE44', pattern: 'solid', size: 'normal', aura: 'none', mutationId: null }, createdAt: 1 },
      {
        id: 'hybrid-specimen-1',
        genome: legacyProjectionFor(matureGenome),
        genomeV2: matureGenome,
        createdAt: 2,
        parentIds: ['seed-c', 'seed-d'],
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
    firstBreedFreeClaimed: false,
    firstHybridRewardClaimed: false,
    firstRecycleTopUpClaimed: false,
  };
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 8000 });
await page.waitForTimeout(1000);
await dismissOnboarding();

await page.evaluate((save) => {
  localStorage.setItem('genesis-garden-save-v1', JSON.stringify(save));
}, buildSave());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();
assert(await page.locator('.overhaul-mode-estate').isVisible(), 'starts in overhaul-mode-estate (:4174 Legacy-genetics build)');
await shot('00-estate-with-preserved-hybridv2');

const savedBefore = await page.evaluate(() => localStorage.getItem('genesis-garden-save-v1'));
const parsedBefore = JSON.parse(savedBefore);
assert(parsedBefore.plots[0].hybridV2?.phase === 'growing', 'save on disk really contains the growing plot.hybridV2 fixture before any interaction');
assert(parsedBefore.plots[1].hybridV2?.phase === 'mature', 'save on disk really contains the mature plot.hybridV2 fixture before any interaction');

const canvasBox = await page.locator('canvas').boundingBox();
async function worldToScreen(worldX, worldY) {
  const debug = await page.evaluate(() => window.__overhaulDebug?.getEstateState());
  if (!debug) throw new Error('window.__overhaulDebug not available — EstateScene debug hook missing');
  return { x: canvasBox.x + (worldX - debug.cameraScrollX), y: canvasBox.y + (worldY - debug.cameraScrollY) };
}

// --- Test A: clicking the mature-hybridV2 plot (plot 1, world PLOT_SLOTS[1])
// opens NOTHING — no HybridCardPanel, no PlantPicker. In the active-V2 build
// (test-e2e-genetics-v2.mjs Test E) the identical click opens the simple card
// ("Постоянное растение" text). Here — GENETICS_V2_ENABLED is false — it must
// not, and the plot's read-only rendering also does not fall through to the
// "empty plot" branch (which would open PlantPicker instead).
const plot1World = { x: 800, y: 720 }; // worldConfig.PLOT_SLOTS[1]
for (let i = 0; i < 5; i++) {
  const plot1Screen = await worldToScreen(plot1World.x, plot1World.y);
  await page.mouse.click(plot1Screen.x, plot1Screen.y);
  await page.waitForTimeout(300);
}
const cardOpenedOnMature = await page.getByText('Постоянное растение').first().isVisible().catch(() => false);
assert(!cardOpenedOnMature, 'clicking the Legacy-mode mature-hybridV2 plot does NOT open HybridCardPanel');
const pickerOpenedOnMature = await page.locator('.sheet-backdrop').isVisible().catch(() => false);
assert(!pickerOpenedOnMature, 'clicking the Legacy-mode mature-hybridV2 plot does NOT open PlantPicker (or any other sheet) either');
await shot('01-mature-plot-click-no-effect');

// --- Test B: clicking the growing-hybridV2 plot (plot 0) also opens nothing. ---
const plot0World = { x: 704, y: 720 }; // worldConfig.PLOT_SLOTS[0]
for (let i = 0; i < 5; i++) {
  const plot0Screen = await worldToScreen(plot0World.x, plot0World.y);
  await page.mouse.click(plot0Screen.x, plot0Screen.y);
  await page.waitForTimeout(300);
}
const anySheetOpenedOnGrowing = await page.locator('.sheet-backdrop').isVisible().catch(() => false);
assert(!anySheetOpenedOnGrowing, 'clicking the Legacy-mode growing-hybridV2 plot opens no panel at all (no V2-harvest reachable)');
await shot('02-growing-plot-click-no-effect');

// --- Test C: ordinary planting on a DIFFERENT, unoccupied plot still works
// (Legacy planting itself is not broken by the presence of hybridV2 data
// elsewhere in the save). ---
const plot2World = { x: 896, y: 720 }; // worldConfig.PLOT_SLOTS[2]
let pickerOpenOnEmpty = false;
for (let i = 0; i < 10 && !pickerOpenOnEmpty; i++) {
  const plot2Screen = await worldToScreen(plot2World.x, plot2World.y);
  await page.mouse.click(plot2Screen.x, plot2Screen.y);
  await page.waitForTimeout(400);
  pickerOpenOnEmpty = await page.locator('.sheet-backdrop').isVisible().catch(() => false);
}
assert(pickerOpenOnEmpty, 'clicking a genuinely empty plot elsewhere still opens PlantPicker normally (Legacy planting unaffected)');
await shot('03-empty-plot-still-plantable');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// --- Test D: the on-disk save is byte-for-byte unchanged for both hybridV2
// entries after all of the above interaction + a full page reload. ---
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();
const savedAfter = await page.evaluate(() => localStorage.getItem('genesis-garden-save-v1'));
const parsedAfter = JSON.parse(savedAfter);
assert(
  JSON.stringify(parsedAfter.plots[0].hybridV2) === JSON.stringify(parsedBefore.plots[0].hybridV2),
  'growing plot.hybridV2 survived the JSON save/reload round-trip unchanged'
);
assert(
  JSON.stringify(parsedAfter.plots[1].hybridV2) === JSON.stringify(parsedBefore.plots[1].hybridV2),
  'mature plot.hybridV2 survived the JSON save/reload round-trip unchanged'
);
const afterSpecimen = parsedAfter.specimens.find((s) => s.id === 'hybrid-specimen-1');
const beforeSpecimen = parsedBefore.specimens.find((s) => s.id === 'hybrid-specimen-1');
assert(
  JSON.stringify(afterSpecimen?.genomeV2) === JSON.stringify(beforeSpecimen?.genomeV2),
  'the mature specimen genomeV2 survived the round-trip unchanged (not deleted/modified)'
);

const realErrors = errors.filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
assert(realErrors.length === 0, `no unexpected console/page errors (found: ${JSON.stringify(realErrors)})`);

console.log('CONSOLE/PAGE ERRORS:', errors.length ? errors : 'none');
await browser.close();
console.log('genetics v2 legacy-mode isolation (fix-pass bug 1): OK');
