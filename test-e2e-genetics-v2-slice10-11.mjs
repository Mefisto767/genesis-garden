import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Genetics V2 — Slice 10-11 dedicated E2E (contract §4.13.5, delta doc §0.12):
// a compact focused scenario, NOT a full breeding cycle — built entirely
// around a ready-made localStorage fixture-save (the same "time-travel"
// convention already used across the V2 e2e suite), checking only:
//   1. AlbumPanelV2 shows the "Родители" block, correct Seed/Pollen order,
//      for a specimen that already has `parentIds`.
//   2. A specimen without `parentIds` shows no such block at all.
//   3. A specimen whose parentIds reference a missing (recycled) parent shows
//      "Родитель недоступен" for that role — and the raw missing id never
//      appears anywhere on the page.
//   4. A legacy species-5 specimen is visible in AlbumPanelV2, can still be
//      favorited (Slice 11 does not remove/hide legacy species from the
//      album).
//   5. Opening LabPanelV2, the species-5 specimen is absent from the parent
//      candidate grid, while the species 1/2 specimens remain.
//   6. Overhaul+Legacy (:4174) still does not render any V2 UI.
//
// Does NOT duplicate the pure-logic/store-level coverage already in
// parentageV2.test.ts (view-model rules, JSON round-trip, no raw-id leak at
// the data level) or inheritanceV2.test.ts/store.legacySpeciesV2.test.ts
// (isSupportedParentSpeciesV2 predicate, store-level unsupported_species
// regression) — this only checks that the real rendered UI wiring
// (AlbumPanelV2, HybridCardPanel, LabPanelV2) is correct end-to-end, the
// same division of labor already established by the rest of the V2 e2e
// suite. Does NOT copy the full Slice 9 E2E (13-step real breeding cycle).

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
  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', `genetics-v2-slice10-11-${name}.png`) });
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`OK: ${msg}`);
}

async function dismissOnboarding(target = page) {
  const visible = await target.locator('.onboarding-backdrop').isVisible().catch(() => false);
  if (visible) {
    await target.locator('.onboarding-skip').click();
    await target.waitForTimeout(300);
  }
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
// Same hand-computed legacy projection as the rest of the V2 e2e suite for
// this exact homozygous fixture (primary_honey/secondary_forest solid
// pattern -> secondary collapses to primary, legacy invariant). speciesId is
// used verbatim as `shape` — good enough for species 1/2/5, all rendered the
// same way by SpecimenThumbnail for this fixture.
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

const MISSING_PARENT_ID = 'ghost-parent-recycled-marker-4d81ac';

function buildSave() {
  const plots = Array.from({ length: 24 }, (_, i) => ({ id: i, unlocked: i < 6, seedId: null, plantedAt: null }));
  const sunGenome = fixtureGenomeV2(1);
  const koloGenome = fixtureGenomeV2(2);
  const childGenome = fixtureGenomeV2(1);
  const brokenChildGenome = fixtureGenomeV2(2);
  const legacyGenome = fixtureGenomeV2(5);
  return {
    version: 4,
    coins: 100,
    plots,
    inventory: {},
    specimens: [
      // Two direct parents — no parentIds of their own (created "by hand",
      // not by V2 breeding).
      { id: 'seed-1', genome: legacyProjectionFor(sunGenome), genomeV2: sunGenome, createdAt: 1 },
      { id: 'pollen-1', genome: legacyProjectionFor(koloGenome), genomeV2: koloGenome, createdAt: 2 },
      // Mature descendant with parentIds pointing at both — the main Slice 10 case.
      {
        id: 'child-1',
        genome: legacyProjectionFor(childGenome),
        genomeV2: childGenome,
        createdAt: 3,
        parentIds: ['seed-1', 'pollen-1'],
      },
      // Specimen with no parentIds at all — block must be entirely absent.
      { id: 'orphan-1', genome: legacyProjectionFor(sunGenome), genomeV2: sunGenome, createdAt: 4 },
      // Descendant whose Pollen Parent was already recycled/deleted.
      {
        id: 'broken-child',
        genome: legacyProjectionFor(brokenChildGenome),
        genomeV2: brokenChildGenome,
        createdAt: 5,
        parentIds: ['seed-1', MISSING_PARENT_ID],
      },
      // Legacy species 5 — Slice 11: stays in the album/favorites/recycling,
      // must NOT appear as a V2 breeding parent candidate.
      { id: 'legacy-5', genome: legacyProjectionFor(legacyGenome), genomeV2: legacyGenome, createdAt: 6 },
    ],
    geneticDust: 0,
    pityCounter: 0,
    questProgress: {},
    questsClaimed: [],
    entitlements: [],
    pollen: 30,
    labLevel: 2, // Lab L2 already open — species 2 is a candidate, not locked.
    nurseryTray: [],
    firstBreedFreeClaimed: true,
    firstHybridRewardClaimed: true,
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
await shot('00-loaded-fixture-save');

// --- Open AlbumPanelV2. Cards sort favorites-first, then newest-first — all
// six fixtures start non-favorite, so the order by createdAt descending is:
// legacy-5, broken-child, orphan-1, child-1, pollen-1, seed-1. ---
await page.getByRole('button', { name: 'Альбом' }).click();
await page.waitForTimeout(300);
const albumCards = page.locator('.album-card');
const albumCardCount = await albumCards.count();
assert(albumCardCount === 6, `album shows all six fixture specimens (got ${albumCardCount})`);
await shot('01-album-all-six');

// --- Test 1: child-1 (index 3) shows "Родители" with the correct Seed/Pollen order. ---
const childCard = albumCards.nth(3);
const childParentageVisible = await childCard.getByText('Родители', { exact: true }).isVisible().catch(() => false);
assert(childParentageVisible, 'test 1: mature descendant with parentIds shows the "Родители" block');
const childFirstParentText = await childCard.getByText('Первый родитель: Солнечник', { exact: true }).isVisible().catch(() => false);
assert(childFirstParentText, 'test 1: "Первый родитель" row shows the Seed Parent species name (Солнечник)');
const childSecondParentText = await childCard.getByText('Второй родитель: Колокольник', { exact: true }).isVisible().catch(() => false);
assert(childSecondParentText, 'test 1: "Второй родитель" row shows the Pollen Parent species name (Колокольник)');
await shot('02-child-parentage-block');

// --- Test 2: orphan-1 (index 2, no parentIds) shows no "Родители" block. ---
const orphanCard = albumCards.nth(2);
const orphanParentageVisible = await orphanCard.getByText('Родители', { exact: true }).isVisible().catch(() => false);
assert(!orphanParentageVisible, 'test 2: specimen without parentIds shows no "Родители" block at all');

// --- Test 3: broken-child (index 1) — one parent found, one missing. Exact
// "Родитель недоступен" text, and the raw missing id never leaks into the page. ---
const brokenCard = albumCards.nth(1);
const brokenFirstParentText = await brokenCard.getByText('Первый родитель: Солнечник', { exact: true }).isVisible().catch(() => false);
assert(brokenFirstParentText, 'test 3: the found parent (Seed) still shows its species name');
const brokenSecondParentText = await brokenCard.getByText('Второй родитель: Родитель недоступен', { exact: true }).isVisible().catch(() => false);
assert(brokenSecondParentText, 'test 3: the missing parent (Pollen) shows exactly "Родитель недоступен"');
await shot('03-broken-parent-unavailable');
const pageText = await page.locator('body').innerText();
assert(!pageText.includes(MISSING_PARENT_ID), 'test 3: the raw missing parentId never appears anywhere on the page');

// --- Test 4: legacy-5 (index 0) is visible in the album and can be favorited. ---
const legacyCard = albumCards.nth(0);
const legacyParentageVisible = await legacyCard.getByText('Родители', { exact: true }).isVisible().catch(() => false);
assert(!legacyParentageVisible, 'test 4: legacy species-5 specimen (no parentIds) shows no "Родители" block');
await legacyCard.locator('.album-card-favorite').click();
await page.waitForTimeout(200);
const legacyFavoriteState = await legacyCard.locator('.album-card-favorite').getAttribute('aria-pressed');
assert(legacyFavoriteState === 'true', 'test 4: legacy species-5 specimen can still be favorited (Slice 11 does not touch favorite/recycling)');
const albumCardCountAfterFavorite = await page.locator('.album-card').count();
assert(albumCardCountAfterFavorite === 6, 'test 4: favoriting the legacy specimen does not remove it from the album');
await shot('04-legacy-species-favorited');

// --- Test 5: open LabPanelV2 — species 5 is absent from the parent
// candidate grid; species 1/2 specimens remain. ---
await page.locator('.sheet-close').click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Лаборатория' }).click();
await page.waitForTimeout(300);
const labHeaderV2Visible = await page
  .getByRole('heading', { name: 'Лаборатория — V2 скрещивание', exact: true })
  .isVisible()
  .catch(() => false);
assert(labHeaderV2Visible, 'test 5: Overhaul+V2 opens the V2 lab header');
const labCandidateCount = await page.locator('.specimen-card').count();
// Five of the six fixtures are species 1/2 (seed-1, pollen-1, child-1,
// orphan-1, broken-child) — only legacy-5 (species 5) is filtered out by
// isSupportedParentSpeciesV2 (Slice 11, contract §4.13.3).
assert(labCandidateCount === 5, `test 5: exactly the five species-1/2 specimens remain as breeding candidates (got ${labCandidateCount}, legacy species-5 excluded)`);
const insufficientCandidatesTextVisible = await page
  .getByText('Нужно как минимум две особи поддерживаемых видов.', { exact: true })
  .isVisible()
  .catch(() => false);
assert(!insufficientCandidatesTextVisible, 'test 5: enough supported-species candidates remain — the empty-state text is not shown');
await shot('05-lab-species5-excluded');
await page.locator('.sheet-close').click();
await page.waitForTimeout(200);

// --- Test 6: Overhaul+Legacy (:4174) still does not render any V2 UI, and
// loading the same save there leaves it byte-identical (regression, same
// methodology as test-e2e-genetics-v2-legacy-isolation.mjs). ---
const v2StateJson = await page.evaluate(() => localStorage.getItem('genesis-garden-save-v1'));

const legacyPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const legacyErrors = [];
legacyPage.on('pageerror', (e) => legacyErrors.push(String(e)));
legacyPage.on('console', (msg) => {
  if (msg.type() === 'error') legacyErrors.push(msg.text());
});
await legacyPage.goto(LEGACY_URL, { waitUntil: 'networkidle' });
await legacyPage.waitForSelector('canvas', { timeout: 8000 });
await legacyPage.waitForTimeout(1000);
await dismissOnboarding(legacyPage);
await legacyPage.evaluate((json) => localStorage.setItem('genesis-garden-save-v1', json), v2StateJson);
await legacyPage.reload({ waitUntil: 'networkidle' });
await legacyPage.waitForTimeout(1000);
await dismissOnboarding(legacyPage);

await legacyPage.getByRole('button', { name: 'Лаборатория' }).click();
await legacyPage.waitForTimeout(300);
const legacyHeaderVisible = await legacyPage
  .getByRole('heading', { name: 'Лаборатория скрещивания', exact: true })
  .isVisible()
  .catch(() => false);
assert(legacyHeaderVisible, 'test 6: Overhaul+Legacy opens the plain LabPanel header, not the V2 one');
const v2HeaderVisibleInLegacy = await legacyPage
  .getByRole('heading', { name: 'Лаборатория — V2 скрещивание', exact: true })
  .isVisible()
  .catch(() => false);
assert(!v2HeaderVisibleInLegacy, 'test 6: Overhaul+Legacy never renders the V2 lab header');
await legacyPage.locator('.sheet-close').click();
await legacyPage.waitForTimeout(200);
await legacyPage.getByRole('button', { name: 'Альбом' }).click();
await legacyPage.waitForTimeout(300);
const legacyParentageBlockVisible = await legacyPage.getByText('Родители', { exact: true }).isVisible().catch(() => false);
assert(!legacyParentageBlockVisible, 'test 6: Overhaul+Legacy album never renders the Slice 10 "Родители" block');
await legacyPage.screenshot({ path: path.join(SCRIPT_DIR, 'shots', 'genetics-v2-slice10-11-06-legacy-no-v2-ui.png') });

const legacyStateJson = await legacyPage.evaluate(() => localStorage.getItem('genesis-garden-save-v1'));
const legacyState = JSON.parse(legacyStateJson);
const v2State = JSON.parse(v2StateJson);
assert(
  JSON.stringify(legacyState.specimens) === JSON.stringify(v2State.specimens),
  'test 6: Overhaul+Legacy round-trip leaves specimens[] (incl. parentIds/genomeV2) byte-identical'
);

const realErrors = errors
  .concat(legacyErrors)
  .filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
assert(realErrors.length === 0, `no unexpected console/page errors (found: ${JSON.stringify(realErrors)})`);

console.log('CONSOLE/PAGE ERRORS:', errors.length + legacyErrors.length ? [...errors, ...legacyErrors] : 'none');
await legacyPage.close();
await browser.close();
console.log('genetics v2 slice 10-11 (parentage display + legacy species filtering): OK');
