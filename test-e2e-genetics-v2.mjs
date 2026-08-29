import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Genetics V2 — Slice 5-7 focused smoke test (Overhaul+V2 build only, see
// CLAUDE.md/README for the VITE_VISUAL_OVERHAUL_ENABLED=true
// VITE_DIPLOID_GENETICS_ENABLED=true build command). Exercises the new
// nursery lifecycle end-to-end through the real UI (LabPanelV2 ->
// PlantPickerV2 -> EstateScene mature plot -> HybridCardPanel), the pollen
// economy (Slice 6) and the recycling economy (Slice 7, LabPanelV2 nursery
// list + AlbumPanelV2), the way test-e2e-overhaul.mjs exercises the legacy
// Overhaul flow. Does NOT duplicate the pure-logic coverage already in
// store.nurseryV2.test.ts / store.pollenV2.test.ts / store.recyclingV2.test.ts
// / recyclingV2.test.ts — this only checks that the UI wiring itself is
// correct and that the genome/phenotype of a hybrid seed is never shown
// before maturity (delta doc §0.7 п.11/п.13).

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
// Genetics V2 — Slice 12: this fixture-save has no breeding history
// (firstBreedFreeClaimed:false, implicit), so it is treated as a genuinely
// untouched genetics save and the new contextual intro screen gates the lab
// once — dismiss it the same way the rest of the V2 e2e suite dismisses the
// old 4-slide onboarding.
const introButton = page.getByRole('button', { name: 'Понятно, начать', exact: true });
if (await introButton.isVisible().catch(() => false)) {
  await introButton.click();
  await page.waitForTimeout(300);
}
const nurseryCounterVisible = await page.getByText(/Питомник: 0\/8/).first().isVisible().catch(() => false);
assert(nurseryCounterVisible, 'workbench hotspot opens LabPanelV2 showing "Питомник: 0/8"');
await shot('01-labpanel-v2');

// --- Test B: breed two V2-eligible specimens — free first breed, no
// genome/phenotype revealed (Slice 6 pollen economy, delta doc §0.8) ---
const cards = page.locator('.specimen-card');
const cardCount = await cards.count();
assert(cardCount === 2, `both starter specimens selectable for V2 breeding (found ${cardCount})`);
const pollenZeroVisible = await page.getByText('Пыльца: 0').first().isVisible().catch(() => false);
assert(pollenZeroVisible, 'pollen balance shown as 0 before the first breed');
const freeLabelVisible = await page.getByText('Первое скрещивание: бесплатно').first().isVisible().catch(() => false);
assert(freeLabelVisible, 'UI shows "Первое скрещивание: бесплатно" before firstBreedFreeClaimed');
await cards.nth(0).click();
await cards.nth(1).click();
await page.waitForTimeout(200);
await page.locator('.sheet-buy-btn').click();
await page.waitForTimeout(300);
// Genetics V2 — Slice 12: a successful breedNurseryV2 now shows the
// fullscreen Reveal screen first (species/rarity/all nine traits+origin)
// before returning to the lab — this supersedes the older "no
// phenotype/genome shown until harvest maturity" UI behavior this test used
// to assert right here (that rule still holds for the Nursery Tray LIST
// itself, checked below after closing Reveal — only the immediate breed
// result is now revealed, not any *other* still-growing seed in the tray).
const revealSpeciesVisible = await page.locator('.reveal-species-name').first().isVisible().catch(() => false);
assert(revealSpeciesVisible, 'breedNurseryV2 success shows the Slice 12 Reveal screen (species/rarity/traits)');
await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
await page.waitForTimeout(300);
const bredNotice = await page.getByText(/Гибридное семя появилось/).first().isVisible().catch(() => false);
assert(bredNotice, 'closing Reveal shows the "hybrid seed appeared" notice');
const nurseryAfterBreed = await page.getByText(/Питомник: 1\/8/).first().isVisible().catch(() => false);
assert(nurseryAfterBreed, 'nursery tray counter updated to 1/8 after breeding');
const genomeLeaked = await page.getByText(/Основной цвет|Доп\. цвет|Аура:|Узор:/).first().isVisible().catch(() => false);
assert(!genomeLeaked, 'back in the lab, no phenotype/genome fields rendered for the still-growing Nursery Tray seed (not revealed before maturity)');
await shot('02-hybrid-seed-bred');

// 1/2: first breed was free at pollen=0, and 2: firstBreedFreeClaimed flipped
// to true, atomically with the successful breed above.
const afterFreeBreed = await page.evaluate(() => JSON.parse(localStorage.getItem('genesis-garden-save-v1')));
assert(afterFreeBreed.pollen === 0, `first breed at pollen=0 stayed free (pollen still 0, got ${afterFreeBreed.pollen})`);
assert(afterFreeBreed.firstBreedFreeClaimed === true, 'firstBreedFreeClaimed flipped to true after the free breed');

// --- Test B2: next attempt (parents still in the collection, breeding
// doesn't consume them) is now paid — at pollen=0 it must show the exact
// "insufficient pollen" text and keep the paid-breed button disabled. ---
await cards.nth(0).click();
await cards.nth(1).click();
await page.waitForTimeout(200);
const insufficientTextVisible = await page.getByText('Не хватает пыльцы: нужно 8, есть 0').first().isVisible().catch(() => false);
assert(insufficientTextVisible, 'second attempt at pollen=0 shows exact "Не хватает пыльцы: нужно 8, есть 0"');
const breedBtnDisabled = await page.locator('.sheet-buy-btn').isDisabled().catch(() => false);
assert(breedBtnDisabled, 'paid-breed button is disabled while pollen is insufficient');
await shot('02b-insufficient-pollen');

// --- Test B3: top up pollen (localStorage, same time-travel technique the
// rest of this script already uses) and confirm the paid breed deducts
// exactly SAME_SPECIES_BREED_COST=8, no more/no less. ---
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('genesis-garden-save-v1'));
  state.pollen = 20;
  localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();
// Re-enter the lab and reopen the workbench hotspot after the reload.
{
  const nearLabScreen2 = await worldToScreen(nearLabWorld.x, nearLabWorld.y);
  await page.mouse.click(nearLabScreen2.x, nearLabScreen2.y);
  let enteredAgain = false;
  for (let i = 0; i < 30 && !enteredAgain; i++) {
    const labScreen = await worldToScreen(labWorld.x, labWorld.y - 40);
    await page.mouse.click(labScreen.x, labScreen.y);
    await page.waitForTimeout(500);
    enteredAgain = await page.locator('.overhaul-mode-laboratory').isVisible().catch(() => false);
  }
  assert(enteredAgain, 'walked back into LaboratoryScene after pollen top-up reload');
  const canvasBox3 = await page.locator('canvas').boundingBox();
  await page.mouse.click(canvasBox3.x + startX, canvasBox3.y + hotspotY);
  await page.waitForTimeout(400);
}
const pollen20Visible = await page.getByText('Пыльца: 20').first().isVisible().catch(() => false);
assert(pollen20Visible, 'pollen balance shows 20 after top-up + reload');
await page.locator('.specimen-card').nth(0).click();
await page.locator('.specimen-card').nth(1).click();
await page.waitForTimeout(200);
const costLabelVisible = await page.getByText('Стоимость: 8 пыльцы').first().isVisible().catch(() => false);
assert(costLabelVisible, 'selected pair shows "Стоимость: 8 пыльцы" once pollen is sufficient');
await page.locator('.sheet-buy-btn').click();
await page.waitForTimeout(300);
const afterPaidBreed = await page.evaluate(() => JSON.parse(localStorage.getItem('genesis-garden-save-v1')));
assert(afterPaidBreed.pollen === 12, `paid breed deducted exactly 8 pollen (20 -> 12, got ${afterPaidBreed.pollen})`);
await shot('02c-paid-breed-deducted-8');

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
const pollenBeforeHarvest = (await page.evaluate(() => JSON.parse(localStorage.getItem('genesis-garden-save-v1')))).pollen;
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

// 3: maturity harvest grants formulaic pollen (speciesBasePollen(1)=2 +
// rarityBonus in {0,1,2}) — real RNG breeding through the UI, so only the
// valid range is asserted, not one exact number. Genetics V2 — Slice 8
// (contract §4.11.1): this is also the very first growing->mature V2 harvest
// of this save (firstHybridRewardClaimed was never set before), so it
// legitimately ALSO grants the one-time "+8 pollen" first-hybrid bonus on
// top of the normal formulaic reward — range widened by exactly +8 to match,
// not weakened.
const stateAfterHarvest = await page.evaluate(() => JSON.parse(localStorage.getItem('genesis-garden-save-v1')));
const pollenAfterHarvest = stateAfterHarvest.pollen;
const pollenDelta = pollenAfterHarvest - pollenBeforeHarvest;
assert(
  pollenDelta >= 2 + 8 && pollenDelta <= 4 + 8,
  `maturity harvest granted formulaic pollen (base 2 + rarityBonus 0..2) plus the Slice 8 first-hybrid +8 bonus (delta=${pollenDelta})`
);
assert(stateAfterHarvest.firstHybridRewardClaimed === true, 'firstHybridRewardClaimed flipped to true on the first-ever V2 harvest (Slice 8)');
assert(stateAfterHarvest.labLevel === 2, 'labLevel opened to 2 atomically with the first-hybrid grant (Slice 8)');

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
assert(!forbiddenElements, 'simple card has no microscope/reveal/pedigree elements (Slice 5/6/7 scope only)');

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
await page.waitForTimeout(300);

// --- Test F: Slice 7 recycling — breed a fresh HybridSeed into the (now
// empty) Nursery Tray, then recycle it from LabPanelV2 without ever
// revealing its genome/phenotype. Parents 'a'/'b' are still in the
// collection (breeding never consumes them). ---
{
  const nearLabScreen3 = await worldToScreen(nearLabWorld.x, nearLabWorld.y);
  await page.mouse.click(nearLabScreen3.x, nearLabScreen3.y);
  let enteredLab3 = false;
  for (let i = 0; i < 10 && !enteredLab3; i++) {
    const labScreen = await worldToScreen(labWorld.x, labWorld.y - 40);
    await page.mouse.click(labScreen.x, labScreen.y);
    await page.waitForTimeout(500);
    enteredLab3 = await page.locator('.overhaul-mode-laboratory').isVisible().catch(() => false);
  }
  assert(enteredLab3, 'walked back into LaboratoryScene for Slice 7 recycling test');
  const canvasBox4 = await page.locator('canvas').boundingBox();
  await page.mouse.click(canvasBox4.x + startX, canvasBox4.y + hotspotY);
  await page.waitForTimeout(400);
}
// Tray may already carry a leftover, never-planted seed from the earlier
// paid-breed test (Test B3) — Test C only plants ONE seed by name
// ("Гибридное семя #1"), the script never asserted the tray was emptied by
// it. Assertions below are deliberately relative (delta-based), not pinned
// to an absolute "N/8" count, so this test doesn't depend on exactly how
// many seeds accumulated in earlier steps.
const trayLenBeforeSecondBreed = (
  await page.evaluate(() => JSON.parse(localStorage.getItem('genesis-garden-save-v1')))
).nurseryTray.length;
await page.locator('.specimen-card').nth(0).click();
await page.locator('.specimen-card').nth(1).click();
await page.waitForTimeout(200);
await page.locator('.sheet-buy-btn').click();
await page.waitForTimeout(300);
// Genetics V2 — Slice 12: close the Reveal screen this breed shows (same as
// the first breed above) before inspecting the returned-to lab UI below.
await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
await page.waitForTimeout(300);
const trayLenAfterSecondBreed = (
  await page.evaluate(() => JSON.parse(localStorage.getItem('genesis-garden-save-v1')))
).nurseryTray.length;
assert(
  trayLenAfterSecondBreed === trayLenBeforeSecondBreed + 1,
  `second real breedV2 added exactly one seed to the Nursery Tray (${trayLenBeforeSecondBreed} -> ${trayLenAfterSecondBreed})`
);
const seedRowsVisible = await page.locator('.sheet-list .sheet-row').count();
assert(
  seedRowsVisible === trayLenAfterSecondBreed,
  `LabPanelV2 lists exactly ${trayLenAfterSecondBreed} tray row(s), one per seed — no id/genome/rarity leaked (found ${seedRowsVisible})`
);
const anySeedLabelVisible = await page.getByText(/Семя №\d+/).first().isVisible().catch(() => false);
assert(anySeedLabelVisible, 'each tray row shows only a safe ordinal label ("Семя №N"), never genome/phenotype');
await shot('07-nursery-recycle-list');

// --- Test F1: opening the confirm step and clicking "Отмена" is a full
// no-op — no dust gained, seed count in the tray unchanged. ---
const dustBeforeCancel = (await page.evaluate(() => JSON.parse(localStorage.getItem('genesis-garden-save-v1')))).geneticDust;
await page.locator('.sheet-list').getByRole('button', { name: 'Переработать' }).first().click();
await page.waitForTimeout(200);
const confirmVisible = await page.getByText('Да, переработать').first().isVisible().catch(() => false);
assert(confirmVisible, 'clicking "Переработать" shows the mandatory confirm step before deletion');
await page.getByText('Отмена').first().click();
await page.waitForTimeout(200);
const stateAfterCancel = await page.evaluate(() => JSON.parse(localStorage.getItem('genesis-garden-save-v1')));
assert(stateAfterCancel.geneticDust === dustBeforeCancel, 'cancelling the confirm step changes nothing (no dust gained)');
assert(
  stateAfterCancel.nurseryTray.length === trayLenAfterSecondBreed,
  'seed count in the tray unchanged after cancelling recycle'
);

// --- Test F2: confirming recycles the seed — this is the FIRST-EVER
// recycle of this save (seed or specimen), so it tops up to at least 3 dust
// regardless of the seed's real (unseeded-RNG) rarity, and
// firstRecycleTopUpClaimed flips to true. ---
await page.locator('.sheet-list').getByRole('button', { name: 'Переработать' }).first().click();
await page.waitForTimeout(200);
await page.getByText('Да, переработать').first().click();
await page.waitForTimeout(300);
const recycleNotice = await page.getByText(/\+\d+ генетической пыли/).first().isVisible().catch(() => false);
assert(recycleNotice, 'first-ever recycle shows only the total "+N генетической пыли" (no tariff/top-up split shown)');
const afterSeedRecycle = await page.evaluate(() => JSON.parse(localStorage.getItem('genesis-garden-save-v1')));
assert(
  afterSeedRecycle.nurseryTray.length === trayLenAfterSecondBreed - 1,
  'exactly one seed removed from the tray after recycling'
);
assert(
  afterSeedRecycle.geneticDust >= 3,
  `first-ever recycle tops up to at least 3 dust regardless of rarity (got ${afterSeedRecycle.geneticDust})`
);
assert(afterSeedRecycle.firstRecycleTopUpClaimed === true, 'firstRecycleTopUpClaimed flipped to true after the first recycle');

// --- Slice 7 UI-фикс (defect report bug 2), exact assertions: after a
// successful Nursery Seed recycle, the "+N генетической пыли" total and the
// "Пыль пригодится в лаборатории" line must be TWO separate DOM elements,
// never joined with "·" or any other punctuation into one string. ---
const dustGainedFromSeed = afterSeedRecycle.geneticDust - dustBeforeCancel;
const seedPrimaryText = `+${dustGainedFromSeed} генетической пыли`;
const seedPrimaryVisible = await page.getByText(seedPrimaryText, { exact: true }).first().isVisible().catch(() => false);
assert(seedPrimaryVisible, `nursery seed recycle shows an exact separate element "${seedPrimaryText}"`);
const seedSecondaryVisible = await page
  .getByText('Пыль пригодится в лаборатории', { exact: true })
  .first()
  .isVisible()
  .catch(() => false);
assert(seedSecondaryVisible, 'nursery seed recycle shows an exact separate element "Пыль пригодится в лаборатории"');
const bodyTextAfterSeedRecycle = await page.locator('body').innerText();
assert(
  !bodyTextAfterSeedRecycle.includes('·'),
  'no "·"-joined combined recycle notice string appears anywhere on the page after the nursery seed recycle'
);

await page.locator('.sheet-close').click();
await page.waitForTimeout(200);

let backInEstate2 = false;
for (let i = 0; i < 10 && !backInEstate2; i++) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  backInEstate2 = await page.locator('.overhaul-mode-estate').isVisible().catch(() => false);
}
assert(backInEstate2, 'exited back to Estate after Slice 7 nursery recycle test');

// --- Test G: Slice 7 recycling from AlbumPanelV2 — recycle the grown mature
// specimen, which frees up its plot (contract §4.10.3). The mature hybrid
// specimen is the most recently created one, so it sorts first in the album
// grid (favorites-first, then newest-first — same sort as legacy AlbumPanel). ---
const beforeAlbumRecycle = await page.evaluate(() => JSON.parse(localStorage.getItem('genesis-garden-save-v1')));
const matureHybridPlot = beforeAlbumRecycle.plots.find((p) => p.hybridV2 && p.hybridV2.phase === 'mature');
assert(!!matureHybridPlot, 'save has a mature V2 plot before the album recycle test');
const matureSpecimenId = matureHybridPlot.hybridV2.specimenId;

await page.getByRole('button', { name: 'Альбом' }).click();
await page.waitForTimeout(400);
const albumCardsBeforeRecycle = await page.locator('.album-card').count();
assert(albumCardsBeforeRecycle === 3, `V2 album shows all 3 specimens before recycling (got ${albumCardsBeforeRecycle})`);
await page.locator('.album-card').nth(0).getByRole('button', { name: 'Переработать' }).click();
await page.waitForTimeout(200);
const matureWarningVisible = await page
  .getByText(/Растение будет удалено с грядки/)
  .first()
  .isVisible()
  .catch(() => false);
assert(matureWarningVisible, 'AlbumPanelV2 warns BEFORE confirmation that recycling this mature plant frees its plot');
await page.getByText('Да, переработать').first().click();
await page.waitForTimeout(300);
const albumRecycleNotice = await page.getByText(/генетической пыли/).first().isVisible().catch(() => false);
assert(albumRecycleNotice, 'AlbumPanelV2 shows the "+N генетической пыли" total after a successful recycle');
const albumCardsAfterRecycle = await page.locator('.album-card').count();
assert(albumCardsAfterRecycle === 2, `recycled specimen disappeared from the V2 album (${albumCardsAfterRecycle} left, expected 2)`);
await shot('08-album-v2-after-recycle');

const afterAlbumRecycle = await page.evaluate(() => JSON.parse(localStorage.getItem('genesis-garden-save-v1')));
assert(
  !afterAlbumRecycle.specimens.some((s) => s.id === matureSpecimenId),
  'recycled specimen removed from state.specimens'
);
const freedPlot = afterAlbumRecycle.plots.find((p) => p.id === matureHybridPlot.id);
assert(freedPlot.hybridV2 == null, 'the plot that held the recycled mature plant is now free (hybridV2 cleared)');
assert(afterAlbumRecycle.geneticDust > beforeAlbumRecycle.geneticDust, 'geneticDust increased after the album recycle');

// --- Slice 7 UI-фикс (defect report bug 2), exact assertions: after a
// successful Specimen recycle from AlbumPanelV2, the same two lines must
// appear as separate DOM elements, never joined with "·". ---
const dustGainedFromSpecimen = afterAlbumRecycle.geneticDust - beforeAlbumRecycle.geneticDust;
const specimenPrimaryText = `+${dustGainedFromSpecimen} генетической пыли`;
const specimenPrimaryVisible = await page
  .getByText(specimenPrimaryText, { exact: true })
  .first()
  .isVisible()
  .catch(() => false);
assert(specimenPrimaryVisible, `specimen recycle shows an exact separate element "${specimenPrimaryText}"`);
const specimenSecondaryVisible = await page
  .getByText('Пыль пригодится в лаборатории', { exact: true })
  .first()
  .isVisible()
  .catch(() => false);
assert(specimenSecondaryVisible, 'specimen recycle shows an exact separate element "Пыль пригодится в лаборатории"');
const bodyTextAfterSpecimenRecycle = await page.locator('body').innerText();
assert(
  !bodyTextAfterSpecimenRecycle.includes('·'),
  'no "·"-joined combined recycle notice string appears anywhere on the page after the specimen recycle'
);

// --- Test G2: favorite specimens are protected from recycling in the V2 album. ---
const remainingCards = page.locator('.album-card');
await remainingCards.nth(0).locator('.album-card-favorite').click();
await page.waitForTimeout(200);
await remainingCards.nth(0).getByRole('button', { name: 'Переработать' }).click().catch(() => {});
await page.waitForTimeout(200);
const favoriteProtectedVisible = await page
  .getByText(/сними звезду, чтобы переработать/)
  .first()
  .isVisible()
  .catch(() => false);
assert(favoriteProtectedVisible, 'favorite specimen shows a blocking message instead of a recycle confirm step');
const albumCardsAfterFavoriteAttempt = await page.locator('.album-card').count();
assert(albumCardsAfterFavoriteAttempt === 2, 'attempting to recycle a favorite specimen did not remove it');
await page.locator('.sheet-close').click();

// --- Test H: Slice 7 UI-фикс (defect report bug 1), exact assertions —
// force the Nursery Tray to 8/8 (localStorage injection, same time-travel
// technique the rest of this script uses) and verify the full-tray label and
// the hint below it are TWO separate DOM elements with the exact required
// text, not one element with the hint appended to the label. ---
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('genesis-garden-save-v1'));
  const template = state.specimens.find((s) => !!s.genomeV2).genomeV2;
  state.nurseryTray = Array.from({ length: 8 }, (_, i) => ({
    id: `synthetic-tray-full-${i}`,
    genomeV2: template,
    parentIds: ['synthetic-parent-a', 'synthetic-parent-b'],
    createdAt: Date.now(),
    plantedAt: null,
    plotId: null,
  }));
  localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();
{
  const nearLabScreenH = await worldToScreen(nearLabWorld.x, nearLabWorld.y);
  await page.mouse.click(nearLabScreenH.x, nearLabScreenH.y);
  let enteredLabH = false;
  for (let i = 0; i < 30 && !enteredLabH; i++) {
    const labScreen = await worldToScreen(labWorld.x, labWorld.y - 40);
    await page.mouse.click(labScreen.x, labScreen.y);
    await page.waitForTimeout(500);
    enteredLabH = await page.locator('.overhaul-mode-laboratory').isVisible().catch(() => false);
  }
  assert(enteredLabH, 'walked back into LaboratoryScene for the tray-full (8/8) UI-copy test');
  const canvasBoxH = await page.locator('canvas').boundingBox();
  await page.mouse.click(canvasBoxH.x + startX, canvasBoxH.y + hotspotY);
  await page.waitForTimeout(400);
}
const trayFullLabelVisible = await page
  .getByText('Питомник заполнен: 8/8', { exact: true })
  .first()
  .isVisible()
  .catch(() => false);
assert(trayFullLabelVisible, 'tray-full state shows an exact separate element "Питомник заполнен: 8/8" (nothing appended)');
const trayFullHintVisible = await page
  .getByText('Посади одно из семян на грядку или переработай его, чтобы освободить место.', { exact: true })
  .first()
  .isVisible()
  .catch(() => false);
assert(trayFullHintVisible, 'tray-full state shows the hint as an exact separate element');
await page.locator('.sheet-close').click();
await page.waitForTimeout(200);

const realErrors = errors.filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
assert(realErrors.length === 0, `no unexpected console/page errors (found: ${JSON.stringify(realErrors)})`);

console.log('CONSOLE/PAGE ERRORS:', errors.length ? errors : 'none');
await browser.close();
console.log('genetics v2 (Slice 5-7) e2e: OK');
