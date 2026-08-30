import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Art Vertical Slice A — focused e2e (docs/ART_VERTICAL_SLICE_A.md). Runs
// against the real Overhaul+V2 build (:4175, same as test-e2e-visual-v1.mjs/
// test-e2e-genetics-v2*.mjs) — this is the only mode where the hybridV2
// lifecycle (neutral-unrevealed / mature-Sunflower branches) is reachable at
// all; the plot_empty swap is also exercised at Overhaul+Legacy (:4174) via
// a second, lighter pass (isolation only — plot_empty renders, hybrid/
// Sunflower assets are never touched there, per renderHybridPlotCellReadOnly).
//
// Covers the acceptance criteria from art_v2/README.md / the task's
// checklist:
//   1. distinct plot targeting (six plots, unique coords, no overlap)
//   2. neutral pre-Reveal sprite (plant_hybrid_unrevealed_v1, no phenotype
//      leak — same key regardless of hidden genome)
//   3. persistence through reload (hybridV2 state + asset wiring survive)
//   4. mature swap after Reveal (plant_sunflower_mature_v1 for the coral
//      Sunflower phenotype only; any other phenotype keeps the procedural
//      render — asserted via a second, non-coral fixture)
//   5. timer readability (explicit progress/remaining-time text, unaffected)
//   6. no overflow at 360×800 mobile
//
// Uses window.__overhaulDebug.getEstateState().plots[].{tileTextureKey,
// plantTextureKey} (EstateScene.ts) instead of pixel-diffing screenshots —
// same read-only debug-hook pattern as test-e2e-visual-v1.mjs.
// ============================================================================

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const URL = process.argv[2] || 'http://localhost:4175/genesis-garden/';
const LEGACY_URL = process.argv[3] || 'http://localhost:4174/genesis-garden/';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};
mkdirSync(path.join(SCRIPT_DIR, 'shots'), { recursive: true });

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`OK: ${msg}`);
}

const browser = await chromium.launch(launchOptions);
const errors = [];

async function debugState(page) {
  const s = await page.evaluate(() => window.__overhaulDebug?.getEstateState());
  if (!s) throw new Error('window.__overhaulDebug not available — EstateScene debug hook missing');
  return s;
}

async function loadSave(page, save) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 8000 });
  await page.waitForTimeout(800);
  await page.evaluate((s) => localStorage.setItem('genesis-garden-save-v1', JSON.stringify(s)), save);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 8000 });
  await page.waitForTimeout(1200);
}

// --- Fixture: plot 0 growing hybridV2 (pending Reveal), plot 1 mature
// hybridV2 coral Sunflower (speciesId 1, primary_coral), plot 2 mature
// hybridV2 non-coral (speciesId 1, primary_honey — same species, different
// color, must NOT get the static sprite), plot 3 empty. ---
function buildSave(now) {
  const plots = Array.from({ length: 24 }, (_, i) => ({ id: i, unlocked: i < 6, seedId: null, plantedAt: null, hybridV2: null }));
  plots[0] = {
    ...plots[0],
    hybridV2: {
      phase: 'growing',
      hybrid: {
        id: 'seed-growing',
        genomeV2: {
          stemForm: { a: 'stem_standard', b: 'stem_standard' },
          leafForm: { a: 'leaf_standard', b: 'leaf_standard' },
          flowerForm: { a: 'flower_standard', b: 'flower_standard' },
          primaryColor: { a: 'primary_coral', b: 'primary_coral' },
          secondaryColor: { a: 'secondary_amber', b: 'secondary_amber' },
          leafColor: { a: 'leaf_color_fresh', b: 'leaf_color_fresh' },
          pattern: { a: 'pattern_solid', b: 'pattern_solid' },
          size: { a: 'size_normal', b: 'size_normal' },
          aura: { a: 'aura_none', b: 'aura_none' },
          speciesId: 1,
          mutationId: null,
        },
        parentIds: ['coral-sunflower', 'honey-sunflower'],
        createdAt: now - 6000,
        plantedAt: now - 5000, // firstGrowMs for speciesId 1 is 5min — still growing, not ready
        plotId: 0,
      },
    },
  };
  plots[1] = {
    ...plots[1],
    seedId: null,
    hybridV2: { phase: 'mature', specimenId: 'coral-sunflower', lastHarvestAt: now - 1000 },
  };
  plots[2] = {
    ...plots[2],
    seedId: null,
    hybridV2: { phase: 'mature', specimenId: 'honey-sunflower', lastHarvestAt: now - 1000 },
  };
  return {
    version: 4,
    coins: 100,
    plots,
    inventory: {},
    specimens: [
      {
        id: 'coral-sunflower',
        genome: { shape: 1, primary: '#FF8C77', secondary: '#F5A623', leaf: '#6FBE44', pattern: 'solid', size: 'normal', aura: 'none', mutationId: null },
        createdAt: 1,
        genomeV2: {
          stemForm: { a: 'stem_standard', b: 'stem_standard' },
          leafForm: { a: 'leaf_standard', b: 'leaf_standard' },
          flowerForm: { a: 'flower_standard', b: 'flower_standard' },
          primaryColor: { a: 'primary_coral', b: 'primary_coral' },
          secondaryColor: { a: 'secondary_amber', b: 'secondary_amber' },
          leafColor: { a: 'leaf_color_fresh', b: 'leaf_color_fresh' },
          pattern: { a: 'pattern_solid', b: 'pattern_solid' },
          size: { a: 'size_normal', b: 'size_normal' },
          aura: { a: 'aura_none', b: 'aura_none' },
          speciesId: 1,
          mutationId: null,
        },
      },
      {
        id: 'honey-sunflower',
        genome: { shape: 1, primary: '#FFC85C', secondary: '#F5A623', leaf: '#6FBE44', pattern: 'solid', size: 'normal', aura: 'none', mutationId: null },
        createdAt: 2,
        genomeV2: {
          stemForm: { a: 'stem_standard', b: 'stem_standard' },
          leafForm: { a: 'leaf_standard', b: 'leaf_standard' },
          flowerForm: { a: 'flower_standard', b: 'flower_standard' },
          primaryColor: { a: 'primary_honey', b: 'primary_honey' },
          secondaryColor: { a: 'secondary_amber', b: 'secondary_amber' },
          leafColor: { a: 'leaf_color_fresh', b: 'leaf_color_fresh' },
          pattern: { a: 'pattern_solid', b: 'pattern_solid' },
          size: { a: 'size_normal', b: 'size_normal' },
          aura: { a: 'aura_none', b: 'aura_none' },
          speciesId: 1,
          mutationId: null,
        },
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
    firstBreedFreeClaimed: true,
    firstHybridRewardClaimed: true,
    firstRecycleTopUpClaimed: true,
    geneticsIntroSeen: true,
    geneticsTutorialBreedsCompleted: 2,
  };
}

async function runDesktop() {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('pageerror', (e) => errors.push(`[desktop] ${String(e)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[desktop] ${msg.text()}`);
  });

  await loadSave(page, buildSave(Date.now()));
  const onboardingVisible = await page.locator('.onboarding-backdrop').isVisible().catch(() => false);
  if (onboardingVisible) {
    await page.locator('.onboarding-skip').click().catch(() => {});
    await page.waitForTimeout(300);
  }

  const d = await debugState(page);
  assert(d.plots.length === 6, '[desktop] debug snapshot exposes all six plots');

  // --- 1. Distinct plot targeting: unique coords, unique 64px footprints. ---
  const coordKeys = new Set(d.plots.map((p) => `${p.x},${p.y}`));
  assert(coordKeys.size === 6, '[desktop] all six plots have unique, non-overlapping world coordinates');
  assert(d.plots.every((p) => p.size === 64), '[desktop] every plot footprint is 64px (contract §5)');

  // --- plot_empty_v1 wired for the base tile of every open cell. ---
  const plot3 = d.plots.find((p) => p.plotId === 3);
  assert(plot3.tileTextureKey === 'plot_empty_v1', '[desktop] plot 3 (truly empty) uses the plot_empty_v1 base tile');
  const plot0 = d.plots.find((p) => p.plotId === 0);
  assert(plot0.tileTextureKey === 'plot_empty_v1', '[desktop] plot 0 (growing hybridV2) also uses plot_empty_v1 as its base tile');

  // --- 2. Neutral pre-Reveal sprite: same key regardless of hidden genome. ---
  assert(plot0.plantTextureKey === 'plant_hybrid_unrevealed_v1', '[desktop] growing/pending-Reveal plot shows the neutral unrevealed sprite');
  const saveBefore = JSON.parse(await page.evaluate(() => localStorage.getItem('genesis-garden-save-v1')));
  const revealedInDom = await page.locator('body').innerText();
  assert(!revealedInDom.includes('primary_coral') && !revealedInDom.includes('#FF8C77'), '[desktop] no raw genome/phenotype string leaked into the DOM for the growing plot');
  assert(saveBefore.plots[0].hybridV2.hybrid.genomeV2.speciesId === 1, '[desktop] sanity: fixture growing hybrid really is speciesId 1 (would leak shape via the OLD per-species procedural render)');

  // --- 4. Mature swap after Reveal: coral Sunflower gets the static sprite,
  // same-species-different-color mature plant keeps the procedural render. ---
  const plot1 = d.plots.find((p) => p.plotId === 1);
  const plot2 = d.plots.find((p) => p.plotId === 2);
  assert(plot1.plantTextureKey === 'plant_sunflower_mature_v1', '[desktop] mature coral Sunflower (speciesId 1, primary_coral) uses the static plant_sunflower_mature_v1 sprite');
  assert(plot2.plantTextureKey === null, '[desktop] mature honey-primary Sunflower (same species, different color) keeps the procedural render, not the coral static sprite');

  // --- 5. Timer readability: explicit remaining-time text for the growing plot on hover. ---
  const canvasBox = await page.locator('canvas').boundingBox();
  const worldToScreen = (wx, wy) => ({
    x: canvasBox.x + (wx - d.cameraScrollX) * d.cameraZoom,
    y: canvasBox.y + (wy - d.cameraScrollY) * d.cameraZoom,
  });
  const p0Screen = worldToScreen(plot0.x, plot0.y);
  await page.mouse.move(p0Screen.x, p0Screen.y);
  // renderPlots() redraws all plot tiles on a 250ms loop (EstateScene.ts) —
  // poll with margin instead of a single fixed wait, same idiom as the
  // "hiddenAfterLeave" retry loop in test-e2e-visual-v1.mjs, so a redraw
  // landing exactly on the sampling instant does not flake this assertion.
  let timerShown = false;
  for (let i = 0; i < 6 && !timerShown; i++) {
    await page.waitForTimeout(300);
    const d2 = await debugState(page);
    timerShown = d2.plots.find((p) => p.plotId === 0)?.timerVisible === true;
  }
  assert(timerShown, '[desktop] hovering the growing hybridV2 plot shows its explicit timer');

  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', 'art-slice-a-desktop.png') });

  // --- 3. Persistence through reload. ---
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 8000 });
  await page.waitForTimeout(1200);
  const d3 = await debugState(page);
  const plot0Reload = d3.plots.find((p) => p.plotId === 0);
  const plot1Reload = d3.plots.find((p) => p.plotId === 1);
  const plot2Reload = d3.plots.find((p) => p.plotId === 2);
  assert(plot0Reload.plantTextureKey === 'plant_hybrid_unrevealed_v1', '[desktop] neutral unrevealed sprite survives reload');
  assert(plot1Reload.plantTextureKey === 'plant_sunflower_mature_v1', '[desktop] mature coral Sunflower sprite survives reload');
  assert(plot2Reload.plantTextureKey === null, '[desktop] non-coral mature plant still on the procedural render after reload (no drift)');
  const saveAfter = JSON.parse(await page.evaluate(() => localStorage.getItem('genesis-garden-save-v1')));
  assert(saveAfter.plots[0].hybridV2.phase === 'growing' && saveAfter.plots[1].hybridV2.phase === 'mature', '[desktop] hybridV2 lifecycle state itself is unchanged by the asset swap');

  await page.close();
}

async function runMobile() {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  page.on('pageerror', (e) => errors.push(`[mobile] ${String(e)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[mobile] ${msg.text()}`);
  });

  await loadSave(page, buildSave(Date.now()));
  const onboardingVisible = await page.locator('.onboarding-backdrop').isVisible().catch(() => false);
  if (onboardingVisible) {
    await page.locator('.onboarding-skip').click().catch(() => {});
    await page.waitForTimeout(300);
  }

  // --- 6. No horizontal overflow at 360x800. ---
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  assert(noHScroll, '[mobile] no horizontal overflow at 360x800 with the new art wired in');

  const d = await debugState(page);
  const plot0 = d.plots.find((p) => p.plotId === 0);
  const plot1 = d.plots.find((p) => p.plotId === 1);
  assert(plot0.plantTextureKey === 'plant_hybrid_unrevealed_v1', '[mobile] neutral unrevealed sprite renders on mobile too');
  assert(plot1.plantTextureKey === 'plant_sunflower_mature_v1', '[mobile] mature coral Sunflower sprite renders on mobile too');

  // Touch targets stay >=44 CSS px (plot footprint unaffected by the asset swap).
  assert(64 * d.cameraZoom >= 44, `[mobile] plot touch target is still ${(64 * d.cameraZoom).toFixed(0)} CSS px (>=44)`);

  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', 'art-slice-a-mobile.png') });
  await page.close();
}

// --- Overhaul + Legacy Genetics (:4174): plot_empty renders (shared base
// tile, not V2-specific), hybrid/Sunflower assets are provably never reached
// — renderHybridPlotCellReadOnly() never calls addBottomAnchoredPlantSprite.
async function runLegacyIsolationSpotCheck() {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('pageerror', (e) => errors.push(`[legacy] ${String(e)}`));
  await page.goto(LEGACY_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 8000 });
  await page.waitForTimeout(1200);
  const onboardingVisible = await page.locator('.onboarding-backdrop').isVisible().catch(() => false);
  if (onboardingVisible) {
    await page.locator('.onboarding-skip').click().catch(() => {});
    await page.waitForTimeout(300);
  }
  const d = await debugState(page);
  assert(d.plots.length === 6, '[legacy] Overhaul+Legacy still exposes six plots');
  assert(
    d.plots.every((p) => p.tileTextureKey === 'plot_empty_v1' || p.tileTextureKey === 'tile_soil_locked'),
    '[legacy] Overhaul+Legacy plot base tiles also use plot_empty_v1 (shared, non-V2-specific asset)'
  );
  assert(
    d.plots.every((p) => p.plantTextureKey !== 'plant_hybrid_unrevealed_v1' && p.plantTextureKey !== 'plant_sunflower_mature_v1'),
    '[legacy] Overhaul+Legacy never shows the V2-only hybrid/Sunflower sprites (renderHybridPlotCellReadOnly path)'
  );
  await page.close();
}

await runDesktop();
await runMobile();
await runLegacyIsolationSpotCheck();

const realErrors = errors.filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
assert(realErrors.length === 0, `no unexpected console/page errors across the whole Art Vertical Slice A journey (found: ${JSON.stringify(realErrors)})`);

await browser.close();
console.log('art vertical slice A e2e: OK');
