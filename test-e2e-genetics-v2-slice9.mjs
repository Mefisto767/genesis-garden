import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Genetics V2 — Slice 9 dedicated E2E (contract §4.12, spec §9): interspecies
// V2 breeding through the real rendered UI (Overhaul+V2, :4175 build). Covers
// the 13-step scenario required by the governing spec:
//   1. Lab L2 already open, select species1 (Солнечник) then species2
//      (Колокольник) — "Первый родитель" / "Второй родитель" role labels.
//   2. Exact "Стоимость: 12 пыльцы" cost text.
//   3. Breed succeeds; the resulting Nursery Seed does NOT leak its genome
//      (PlantPickerV2 lists it only as "Гибридное семя #N").
//   4. Plant it, fast-forward growth, harvest — confirm the mature hybrid's
//      speciesId equals the Seed Parent (species1, Солнечник).
//   5. Repeat reversed (Колокольник first, Солнечник second) — confirm the
//      2x1 result's speciesId equals species2 (Колокольник), the new Seed
//      Parent.
//   6. Exact insufficient-pollen text ("Не хватает пыльцы: нужно 12, есть
//      N") plus a disabled "Скрестить" button.
//   7. Overhaul+Legacy (:4174 build) still cannot open the V2 lab UI (shows
//      the plain "Лаборатория скрещивания" header, never the V2 one) and
//      loading the same save there does not alter its V2 fields
//      (specimens[].genomeV2 / nurseryTray) — byte-identical round-trip.
//
// Does NOT duplicate the pure-logic/store-level coverage already in
// inheritanceV2.test.ts / mutationV2.test.ts / store.nurseryV2.test.ts /
// store.labV2.test.ts / store.pollenV2.test.ts (RNG draw counts, speciesId
// invariant across seeds, exact insufficient_pollen no-op semantics) — this
// only checks that the real rendered UI wiring (LabPanelV2, PlantPickerV2,
// EstateScene) is correct end-to-end, the same division of labor already
// established by test-e2e-genetics-v2.mjs / test-e2e-genetics-v2-slice8.mjs.

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const URL = process.argv[2] || 'http://localhost:4175/genesis-garden/';
const LEGACY_URL = process.argv[3] || 'http://localhost:4174/genesis-garden/';
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
  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', `genetics-v2-slice9-${name}.png`) });
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

async function readSave() {
  return page.evaluate(() => JSON.parse(localStorage.getItem('genesis-garden-save-v1')));
}
async function writeSave(save) {
  await page.evaluate((s) => localStorage.setItem('genesis-garden-save-v1', JSON.stringify(s)), save);
}

function homo(value) {
  return { a: value, b: value };
}
function fixtureGenomeV2(speciesId, overrides = {}) {
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
    ...overrides,
  };
}
// Same hand-computed legacy projection as test-e2e-genetics-v2-slice8.mjs /
// test-e2e-genetics-v2-legacy-isolation.mjs for this exact homozygous
// fixture (primary_honey/secondary_forest, solid pattern -> secondary
// collapses to primary, legacy invariant).
function legacyProjectionFor(genomeV2) {
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

// worldConfig.PLOT_SLOTS[0] / [1] — same constants test-e2e-genetics-v2.mjs
// uses. Two distinct plots so the two hybrids (species1-seed, then
// species2-seed) can grow without conflict.
const PLOT0_WORLD = { x: 780, y: 732 };
const PLOT1_WORLD = { x: 852, y: 732 };
// SPECIES_GROWTH_V2 (apps/web/src/game/nurseryV2.ts): species1 (Солнечник)
// firstGrowMs = 5 min; species2 (Колокольник) firstGrowMs = 8 min. The
// Seed Parent determines the resulting speciesId AND therefore which
// timing applies to the resulting hybrid.
const SPECIES1_FIRST_GROW_MS = 5 * 60 * 1000;
const SPECIES2_FIRST_GROW_MS = 8 * 60 * 1000;

function buildSave() {
  const plots = Array.from({ length: 24 }, (_, i) => ({ id: i, unlocked: i < 6, seedId: null, plantedAt: null }));
  const sunGenome = fixtureGenomeV2(1);
  const koloGenome = fixtureGenomeV2(2);
  return {
    version: 4,
    coins: 100,
    plots,
    inventory: {},
    specimens: [
      { id: 'sun-1', genome: legacyProjectionFor(sunGenome), genomeV2: sunGenome, createdAt: 1 },
      { id: 'kolo-1', genome: legacyProjectionFor(koloGenome), genomeV2: koloGenome, createdAt: 2 },
    ],
    geneticDust: 0,
    pityCounter: 0,
    questProgress: {},
    questsClaimed: [],
    entitlements: [],
    pollen: 30, // covers 12 (1x2) + 12 (2x1) with 6 left over for the insufficient-pollen check
    labLevel: 2, // Lab L2 already open (spec: "Lab L2 open" is a precondition, not part of the flow under test)
    nurseryTray: [],
    firstBreedFreeClaimed: true, // avoid the free-first-breed path complicating the exact cost/deduction math
    firstHybridRewardClaimed: true, // already granted in an earlier slice — irrelevant to Slice 9
    firstRecycleTopUpClaimed: false,
  };
}

const canvasBox0 = await (async () => {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 8000 });
  await page.waitForTimeout(1000);
  await dismissOnboarding();
  return page.locator('canvas').boundingBox();
})();
async function worldToScreen(worldX, worldY) {
  const debug = await page.evaluate(() => window.__overhaulDebug?.getEstateState());
  if (!debug) throw new Error('window.__overhaulDebug not available — EstateScene debug hook missing');
  const box = await page.locator('canvas').boundingBox();
  return { x: box.x + (worldX - debug.cameraScrollX), y: box.y + (worldY - debug.cameraScrollY) };
}
void canvasBox0;

await writeSave(buildSave());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();
await shot('00-loaded-lab-l2-two-species');

// --- Step 1-2: open Lab, select species1 (sun-1) then species2 (kolo-1) —
// role labels + exact cost text. ---
await page.getByRole('button', { name: 'Лаборатория' }).click();
await page.waitForTimeout(300);
const specimenCards = page.locator('.specimen-card');
const specimenCardCount = await specimenCards.count();
assert(specimenCardCount === 2, `lab shows both V2-eligible specimens (Солнечник + Колокольник, got ${specimenCardCount})`);
// specimens[] order: [sun-1, kolo-1] -> card 0 = Солнечник (Seed Parent),
// card 1 = Колокольник (Pollen Parent).
await specimenCards.nth(0).click();
await specimenCards.nth(1).click();
await page.waitForTimeout(200);
const firstParentLabelVisible = await page.getByText('Первый родитель', { exact: true }).isVisible().catch(() => false);
assert(firstParentLabelVisible, 'step 1: "Первый родитель" (Seed Parent) slot label shown for the 1x2 pair');
const secondParentLabelVisible = await page.getByText('Второй родитель', { exact: true }).isVisible().catch(() => false);
assert(secondParentLabelVisible, 'step 1: "Второй родитель" (Pollen Parent) slot label shown for the 1x2 pair');
const cost12Visible = await page.getByText('Стоимость: 12 пыльцы', { exact: true }).isVisible().catch(() => false);
assert(cost12Visible, 'step 2: exact "Стоимость: 12 пыльцы" text shown for the interspecies pair');
const breedBtnEnabled1x2 = await page.locator('.sheet-buy-btn', { hasText: 'Скрестить' }).isEnabled();
assert(breedBtnEnabled1x2, 'step 2: "Скрестить" button enabled (pollen 30 >= 12)');
await shot('01-lab-1x2-selected');

// --- Step 3: breed 1x2, confirm the Nursery Seed's genome is not leaked. ---
const stateBeforeBreed1x2 = await readSave();
await page.locator('.sheet-buy-btn', { hasText: 'Скрестить' }).click();
await page.waitForTimeout(300);
// Genetics V2 — Slice 12 fix-pass (contract §4.14.14): breeding never shows
// a Reveal screen (deferred to first maturity) — no close-click needed here.
const bredNotice1x2 = await page.getByText(/Гибридное семя появилось/).isVisible().catch(() => false);
assert(bredNotice1x2, 'step 3: 1x2 (Солнечник x Колокольник) pair breeds successfully after Lab L2');
const stateAfterBreed1x2 = await readSave();
assert(
  stateAfterBreed1x2.nurseryTray.length === stateBeforeBreed1x2.nurseryTray.length + 1,
  'step 3: breed added exactly one hybrid seed to the Nursery Tray'
);
assert(stateAfterBreed1x2.pollen === 18, `step 3: interspecies breed deducted exactly 12 pollen (30 -> 18, got ${stateAfterBreed1x2.pollen})`);
const seed1x2 = stateAfterBreed1x2.nurseryTray[stateAfterBreed1x2.nurseryTray.length - 1];
assert(seed1x2.genomeV2.speciesId === 1, `step 3: 1x2 hybrid seed speciesId equals the Seed Parent (Солнечник, id=1) (got ${seed1x2.genomeV2.speciesId})`);
assert(
  seed1x2.parentIds[0] === 'sun-1' && seed1x2.parentIds[1] === 'kolo-1',
  'step 3: parentIds preserved as [seedParentId, pollenParentId] = [sun-1, kolo-1]'
);
await page.locator('.sheet-close').click();
await page.waitForTimeout(200);

// --- back to Estate ---
let backInEstate = false;
for (let i = 0; i < 10 && !backInEstate; i++) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  backInEstate = await page.locator('.overhaul-mode-estate').isVisible().catch(() => false);
}
assert(backInEstate, 'exited back to Estate after 1x2 breed');
await page.waitForTimeout(400);

// --- Test PlantPickerV2 on plot0: seed listed only by name, no genome leak. ---
let picker0Open = false;
for (let i = 0; i < 10 && !picker0Open; i++) {
  const s = await worldToScreen(PLOT0_WORLD.x, PLOT0_WORLD.y);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(400);
  picker0Open = await page.locator('.sheet-backdrop').isVisible().catch(() => false);
}
assert(picker0Open, 'PlantPickerV2 opened on plot0');
const hybridRow1Visible = await page.getByText(/Гибридное семя #1/).first().isVisible().catch(() => false);
assert(hybridRow1Visible, 'PlantPickerV2 lists the 1x2 hybrid seed only as "Гибридное семя #1" — no id/genome/species leaked');
const speciesLeaked = await page.getByText('Солнечник', { exact: false }).isVisible().catch(() => false);
assert(!speciesLeaked, 'PlantPickerV2 does not reveal the unplanted hybrid seed species name anywhere');
await shot('02-plantpicker-1x2-seed');
await page.getByText(/Гибридное семя #1/).first().click();
await page.waitForTimeout(400);
const picker0Closed = !(await page.locator('.sheet-backdrop').isVisible().catch(() => false));
assert(picker0Closed, 'planting the 1x2 hybrid seed on plot0 closed the picker');

// --- Step 4: fast-forward growth (species1 timing — Seed Parent is species1)
// and harvest; confirm the mature hybrid's speciesId is species1. ---
await page.evaluate((ms) => {
  const state = JSON.parse(localStorage.getItem('genesis-garden-save-v1'));
  const plot = state.plots.find((p) => p.hybridV2 && p.hybridV2.phase === 'growing');
  if (!plot) throw new Error('no growing V2 plot found in save to fast-forward');
  plot.hybridV2.hybrid.plantedAt = Date.now() - (ms + 5000);
  localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
}, SPECIES1_FIRST_GROW_MS);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();
const plot0ScreenMature = await worldToScreen(PLOT0_WORLD.x, PLOT0_WORLD.y);
await page.mouse.click(plot0ScreenMature.x, plot0ScreenMature.y);
await page.waitForTimeout(500);
// Genetics V2 — Slice 12 fix-pass (contract §4.14.14): first-ever maturity
// of this hybrid now opens the Reveal screen as a global overlay — close it
// before continuing (same as the rest of the V2 e2e suite at first maturity).
const revealVisible1x2 = await page.locator('.reveal-species-name').first().isVisible().catch(() => false);
if (revealVisible1x2) {
  await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
  await page.waitForTimeout(300);
}
await shot('03-harvested-1x2-mature');
const stateAfterHarvest1x2 = await readSave();
const harvestedSpecimen1x2 = stateAfterHarvest1x2.specimens.find((s) => s.id !== 'sun-1' && s.id !== 'kolo-1');
assert(!!harvestedSpecimen1x2 && !!harvestedSpecimen1x2.genomeV2, 'step 4: maturity harvest created a new Specimen with genomeV2');
assert(
  harvestedSpecimen1x2.genomeV2.speciesId === 1,
  `step 4: post-maturity 1x2 hybrid speciesId equals the Seed Parent (Солнечник, id=1) (got ${harvestedSpecimen1x2.genomeV2.speciesId})`
);
const harvestedId1x2 = harvestedSpecimen1x2.id;

// --- Step 5: repeat reversed — Колокольник first (Seed), Солнечник second
// (Pollen). Confirm role labels + cost again, then breed, plant on plot1,
// fast-forward species2 timing, harvest, confirm speciesId == species2. ---
await page.getByRole('button', { name: 'Лаборатория' }).click();
await page.waitForTimeout(300);
const specimenCardsAfter = page.locator('.specimen-card');
const cardCountAfter = await specimenCardsAfter.count();
assert(cardCountAfter === 3, `lab shows all 3 V2-eligible specimens after the first harvest (got ${cardCountAfter})`);
// specimens[] order: [sun-1, kolo-1, harvested-1x2] -> to select
// Колокольник (kolo-1) first and Солнечник (sun-1) second, click index 1
// then index 0.
await specimenCardsAfter.nth(1).click();
await specimenCardsAfter.nth(0).click();
await page.waitForTimeout(200);
const firstParentLabelVisibleRev = await page.getByText('Первый родитель', { exact: true }).isVisible().catch(() => false);
assert(firstParentLabelVisibleRev, 'step 5: "Первый родитель" slot label shown for the reversed 2x1 pair');
const secondParentLabelVisibleRev = await page.getByText('Второй родитель', { exact: true }).isVisible().catch(() => false);
assert(secondParentLabelVisibleRev, 'step 5: "Второй родитель" slot label shown for the reversed 2x1 pair');
const cost12VisibleRev = await page.getByText('Стоимость: 12 пыльцы', { exact: true }).isVisible().catch(() => false);
assert(cost12VisibleRev, 'step 5: exact "Стоимость: 12 пыльцы" text shown for the reversed 2x1 pair (same interspecies cost)');
await shot('04-lab-2x1-selected');

const stateBeforeBreed2x1 = await readSave();
await page.locator('.sheet-buy-btn', { hasText: 'Скрестить' }).click();
await page.waitForTimeout(300);
const bredNotice2x1 = await page.getByText(/Гибридное семя появилось/).isVisible().catch(() => false);
assert(bredNotice2x1, 'step 5: reversed 2x1 (Колокольник x Солнечник) pair breeds successfully');
const stateAfterBreed2x1 = await readSave();
assert(
  stateAfterBreed2x1.nurseryTray.length === stateBeforeBreed2x1.nurseryTray.length + 1,
  'step 5: reversed breed added exactly one hybrid seed to the Nursery Tray'
);
// Pollen before this breed includes the step 4 maturity-harvest reward
// (formulaic speciesBasePollen + rarityBonus, real RNG through the UI — not
// a fixed number, same reasoning test-e2e-genetics-v2.mjs uses for harvest
// rewards) on top of the 18 left after the first breed — so the exact
// deduction is asserted relative to the captured pre-breed value, not a
// hardcoded absolute.
assert(
  stateAfterBreed2x1.pollen === stateBeforeBreed2x1.pollen - 12,
  `step 5: reversed interspecies breed deducted exactly 12 pollen (${stateBeforeBreed2x1.pollen} -> ${stateAfterBreed2x1.pollen})`
);
const seed2x1 = stateAfterBreed2x1.nurseryTray[stateAfterBreed2x1.nurseryTray.length - 1];
assert(seed2x1.genomeV2.speciesId === 2, `step 5: 2x1 hybrid seed speciesId equals the new Seed Parent (Колокольник, id=2) (got ${seed2x1.genomeV2.speciesId})`);
assert(
  seed2x1.parentIds[0] === 'kolo-1' && seed2x1.parentIds[1] === 'sun-1',
  'step 5: parentIds preserved as [seedParentId, pollenParentId] = [kolo-1, sun-1]'
);
await page.locator('.sheet-close').click();
await page.waitForTimeout(200);

backInEstate = false;
for (let i = 0; i < 10 && !backInEstate; i++) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  backInEstate = await page.locator('.overhaul-mode-estate').isVisible().catch(() => false);
}
assert(backInEstate, 'exited back to Estate after 2x1 breed');
await page.waitForTimeout(400);

let picker1Open = false;
for (let i = 0; i < 10 && !picker1Open; i++) {
  const s = await worldToScreen(PLOT1_WORLD.x, PLOT1_WORLD.y);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(400);
  picker1Open = await page.locator('.sheet-backdrop').isVisible().catch(() => false);
}
assert(picker1Open, 'PlantPickerV2 opened on plot1');
// Tray now has exactly one (unplanted) seed again -> index resets to #1.
const hybridRowRevVisible = await page.getByText(/Гибридное семя #1/).first().isVisible().catch(() => false);
assert(hybridRowRevVisible, 'PlantPickerV2 lists the 2x1 hybrid seed only as "Гибридное семя #1"');
await page.getByText(/Гибридное семя #1/).first().click();
await page.waitForTimeout(400);
const picker1Closed = !(await page.locator('.sheet-backdrop').isVisible().catch(() => false));
assert(picker1Closed, 'planting the 2x1 hybrid seed on plot1 closed the picker');
await shot('05-plot1-2x1-planted');

await page.evaluate((ms) => {
  const state = JSON.parse(localStorage.getItem('genesis-garden-save-v1'));
  const plot = state.plots.find((p) => p.id === 1 && p.hybridV2 && p.hybridV2.phase === 'growing');
  if (!plot) throw new Error('no growing V2 plot found on plot1 to fast-forward');
  plot.hybridV2.hybrid.plantedAt = Date.now() - (ms + 5000);
  localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
}, SPECIES2_FIRST_GROW_MS);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();
const plot1ScreenMature = await worldToScreen(PLOT1_WORLD.x, PLOT1_WORLD.y);
await page.mouse.click(plot1ScreenMature.x, plot1ScreenMature.y);
await page.waitForTimeout(500);
// Genetics V2 — Slice 12 fix-pass (contract §4.14.14): first-ever maturity
// of THIS hybrid also opens its own Reveal overlay — close it before
// continuing.
const revealVisible2x1 = await page.locator('.reveal-species-name').first().isVisible().catch(() => false);
if (revealVisible2x1) {
  await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
  await page.waitForTimeout(300);
}
await shot('06-harvested-2x1-mature');
const stateAfterHarvest2x1 = await readSave();
const harvestedSpecimen2x1 = stateAfterHarvest2x1.specimens.find(
  (s) => s.id !== 'sun-1' && s.id !== 'kolo-1' && s.id !== harvestedId1x2
);
assert(!!harvestedSpecimen2x1 && !!harvestedSpecimen2x1.genomeV2, 'step 5: reversed maturity harvest created a new Specimen with genomeV2');
assert(
  harvestedSpecimen2x1.genomeV2.speciesId === 2,
  `step 5: post-maturity 2x1 hybrid speciesId equals the new Seed Parent (Колокольник, id=2) (got ${harvestedSpecimen2x1.genomeV2.speciesId})`
);

// --- Step 6: insufficient-pollen path. Pollen after the two breeds above
// carries real (RNG-derived) maturity-harvest rewards on top of the fixed
// breed costs, so it is pinned to a known value here (same top-up/pin
// technique test-e2e-genetics-v2-slice8.mjs uses for its exact-text
// assertion) rather than asserted organically. ---
{
  const state = await readSave();
  state.pollen = 6;
  await writeSave(state);
}
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();
await page.getByRole('button', { name: 'Лаборатория' }).click();
await page.waitForTimeout(300);
const specimenCardsFinal = page.locator('.specimen-card');
await specimenCardsFinal.nth(0).click();
await specimenCardsFinal.nth(1).click();
await page.waitForTimeout(200);
const insufficientTextVisible = await page
  .getByText('Не хватает пыльцы: нужно 12, есть 6', { exact: true })
  .isVisible()
  .catch(() => false);
assert(insufficientTextVisible, 'step 6: exact "Не хватает пыльцы: нужно 12, есть 6" text shown when pollen (6) < cost (12)');
const breedBtnDisabledFinal = await page.locator('.sheet-buy-btn', { hasText: 'Скрестить' }).isDisabled();
assert(breedBtnDisabledFinal, 'step 6: "Скрестить" button disabled while pollen is insufficient');
await shot('07-insufficient-pollen-6-of-12');
const stateBeforeRejected = await readSave();
await page.locator('.sheet-buy-btn', { hasText: 'Скрестить' }).click({ force: true }).catch(() => {});
await page.waitForTimeout(200);
const stateAfterRejected = await readSave();
assert(stateAfterRejected.pollen === stateBeforeRejected.pollen, 'step 6: clicking a disabled breed button caused zero pollen change');
assert(
  stateAfterRejected.nurseryTray.length === stateBeforeRejected.nurseryTray.length,
  'step 6: clicking a disabled breed button added zero seeds to the Nursery Tray'
);
await page.locator('.sheet-close').click();
await page.waitForTimeout(200);

// --- Step 7: Overhaul+Legacy (:4174) still cannot open the V2 lab UI, and
// loading the same save there does not alter its V2 fields. ---
const finalV2State = await readSave();
const finalV2StateJson = JSON.stringify(finalV2State);

const legacyPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const legacyErrors = [];
legacyPage.on('pageerror', (e) => legacyErrors.push(String(e)));
legacyPage.on('console', (msg) => {
  if (msg.type() === 'error') legacyErrors.push(msg.text());
});
await legacyPage.goto(LEGACY_URL, { waitUntil: 'networkidle' });
await legacyPage.waitForSelector('canvas', { timeout: 8000 });
await legacyPage.waitForTimeout(1000);
const legacyOnboardingVisible = await legacyPage.locator('.onboarding-backdrop').isVisible().catch(() => false);
if (legacyOnboardingVisible) {
  await legacyPage.locator('.onboarding-skip').click();
  await legacyPage.waitForTimeout(300);
}
await legacyPage.evaluate((json) => localStorage.setItem('genesis-garden-save-v1', json), finalV2StateJson);
await legacyPage.reload({ waitUntil: 'networkidle' });
await legacyPage.waitForTimeout(1000);
const legacyOnboardingVisible2 = await legacyPage.locator('.onboarding-backdrop').isVisible().catch(() => false);
if (legacyOnboardingVisible2) {
  await legacyPage.locator('.onboarding-skip').click();
  await legacyPage.waitForTimeout(300);
}

await legacyPage.getByRole('button', { name: 'Лаборатория' }).click();
await legacyPage.waitForTimeout(300);
const legacyHeaderVisible = await legacyPage
  .getByRole('heading', { name: 'Лаборатория скрещивания', exact: true })
  .isVisible()
  .catch(() => false);
assert(legacyHeaderVisible, 'step 7: Overhaul+Legacy opens the plain LabPanel ("Лаборатория скрещивания" header)');
const v2HeaderVisibleInLegacy = await legacyPage
  .getByRole('heading', { name: 'Лаборатория — V2 скрещивание', exact: true })
  .isVisible()
  .catch(() => false);
assert(!v2HeaderVisibleInLegacy, 'step 7: Overhaul+Legacy never renders the V2 lab header');
const v2ParentLabelVisibleInLegacy = await legacyPage.getByText('Первый родитель', { exact: true }).isVisible().catch(() => false);
assert(!v2ParentLabelVisibleInLegacy, 'step 7: Overhaul+Legacy lab UI shows no Slice 9 parent-slot labels');
await legacyPage.screenshot({ path: path.join(SCRIPT_DIR, 'shots', 'genetics-v2-slice9-08-legacy-lab-header.png') });
await legacyPage.locator('.sheet-close').click();
await legacyPage.waitForTimeout(200);

const legacyStateJson = await legacyPage.evaluate(() => localStorage.getItem('genesis-garden-save-v1'));
const legacyState = JSON.parse(legacyStateJson);
assert(
  JSON.stringify(legacyState.specimens) === JSON.stringify(finalV2State.specimens),
  'step 7: Overhaul+Legacy round-trip leaves specimens[].genomeV2 byte-identical (no mutation by the legacy UI)'
);
assert(
  JSON.stringify(legacyState.nurseryTray) === JSON.stringify(finalV2State.nurseryTray),
  'step 7: Overhaul+Legacy round-trip leaves nurseryTray byte-identical'
);
assert(legacyState.version === 4, 'step 7: SAVE_VERSION remains 4 after the Overhaul+Legacy round-trip');

const legacyRealErrors = legacyErrors.filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
assert(legacyRealErrors.length === 0, `step 7: no unexpected console/page errors in Overhaul+Legacy (found: ${JSON.stringify(legacyRealErrors)})`);
await legacyPage.close();

const realErrors = errors.filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
assert(realErrors.length === 0, `no unexpected console/page errors in Overhaul+V2 (found: ${JSON.stringify(realErrors)})`);

console.log('CONSOLE/PAGE ERRORS (Overhaul+V2):', errors.length ? errors : 'none');
await browser.close();
console.log('genetics v2 Slice 9 (interspecies breeding) e2e: OK');
