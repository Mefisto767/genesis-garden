import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Genetics V2 — final Gate 1 canonical E2E (Slice 14, contract §4.15.5,
// delta doc §0.15 item 3). This is the SINGLE new scenario file the owner
// asked for on top of the whole Gate 1 package (carryover fix + Slice 13
// rarity calibration + this file) — it walks the full 37-point new-player
// journey end to end against a real Overhaul+Genetics V2 build (:4175), in
// two phases:
//
//   PHASE 1 (fresh, untouched save, real UI, real breedV2/RNG) — the
//   tutorial-critical path: no old 4-slide onboarding, contextual genetics
//   intro, two tutorial parents, first breed free, phenotype hidden until
//   maturity (through Nursery Tray -> planting -> growing -> reload),
//   Reveal at first maturity (Солнечник/Uncommon/9 traits/origin/no
//   mutation), Reveal acknowledgement persists across reload and never
//   repeats, first hybrid reward opens Lab L2, second tutorial breed costs
//   8 pollen (insufficient-pollen no-op, then exact debit), second
//   offspring hidden until ITS OWN maturity (guaranteed size_large, natural
//   reveal on both tutorial-starter parents with source "natural"), and
//   repeating the mature-tile interaction never reopens Reveal / never
//   duplicates the Specimen.
//
//   PHASE 2 (a second fresh page, injected fixture save — same
//   "time-travel" localStorage convention already used across the whole V2
//   e2e suite) — everything that does not depend on the tutorial's exact
//   RNG-seeded path: a real interspecies breedV2 call (1x2) whose Pollen
//   Parent is then recycled BEFORE the seed matures (the carryover-fix
//   regression, contract §4.15.1, exercised through the real rendered UI,
//   not just unit-tested), a reversed 2x1 breed confirming the child's
//   species always equals the Seed Parent's, the minimal microscope
//   (exact 3-dust debit, an already-revealed locus never re-offered),
//   recycling a Nursery Seed and a mature Specimen, a favorite specimen
//   protected from recycling, lineage shown for a specimen with one
//   missing parent (no raw id ever leaked), the Nursery Tray blocking a
//   9th breed at 8/8, the Botanical Book's five working sections plus one
//   honest "Скоро" section, a full tutorial-replay leaving the serialized
//   save byte-identical, Lumi never showing more than one hint bubble at
//   once, and a 360x800 mobile viewport with no horizontal overflow.
//
// Does NOT duplicate the exhaustive pure-logic/store-level coverage already
// in revealV2.test.ts / rarityV2.test.ts / rarityCalibrationV2.test.ts /
// store.revealLifecycleV2.test.ts (including its own carryover-fix unit
// regression) / tutorialV2.test.ts / lumiHintsV2.test.ts /
// store.nurseryV2.test.ts / store.labV2.test.ts / parentageV2.test.ts — nor
// the dedicated per-slice E2E files (test-e2e-genetics-v2.mjs,
// test-e2e-genetics-v2-slice8.mjs, -slice9.mjs, -slice10-11.mjs,
// -slice12.mjs, -legacy-isolation.mjs), all of which stay in the suite
// UNCHANGED and UNWEAKENED. This file is the one NEW canonical regression
// that walks every Gate 1 guarantee in a single continuous journey, so a
// future regression in any one of them shows up here even if a narrower
// slice-specific file is ever retired.

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const URL = process.argv[2] || 'http://localhost:4175/genesis-garden/';
const LEGACY_URL = process.argv[3] || 'http://localhost:4174/genesis-garden/';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const browser = await chromium.launch(launchOptions);
const errors = [];

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`OK: ${msg}`);
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
// pattern -> secondary collapses to primary, legacy invariant).
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

// ============================================================================
// PHASE 1 — fresh, untouched save, real UI, real breedV2/tutorial RNG.
// ============================================================================
async function runPhase1() {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('pageerror', (e) => errors.push(`[phase1] ${String(e)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[phase1] ${msg.text()}`);
  });

  async function shot(name) {
    await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', `genetics-v2-gate1-p1-${name}.png`) });
  }
  async function readSave() {
    return page.evaluate(() => JSON.parse(localStorage.getItem('genesis-garden-save-v1')));
  }
  async function noPhenotypeLeaked() {
    return page
      .getByText(/Основной цвет|Доп\. цвет|Аура:|Узор:|Редкость|Мутации не произошло|Необычн|Обычн|Редк|Эпическ|Легендарн|Мифическ/)
      .first()
      .isVisible()
      .catch(() => false);
  }

  // --- 1. New save; old 4-slide onboarding is absent under Genetics V2. ---
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 8000 });
  await page.waitForTimeout(1200);
  const oldOnboardingVisible = await page.locator('.onboarding-backdrop').isVisible().catch(() => false);
  assert(!oldOnboardingVisible, '1. new save: old 4-slide Onboarding.tsx does not show under Genetics V2');
  await shot('00-fresh-no-old-onboarding');

  const canvasBox = await page.locator('canvas').boundingBox();
  async function worldToScreen(worldX, worldY) {
    const debug = await page.evaluate(() => window.__overhaulDebug?.getEstateState());
    if (!debug) throw new Error('window.__overhaulDebug not available — EstateScene debug hook missing');
    return { x: canvasBox.x + (worldX - debug.cameraScrollX) * debug.cameraZoom, y: canvasBox.y + (worldY - debug.cameraScrollY) * debug.cameraZoom };
  }
  const plot0World = { x: 704, y: 720 };
  const plot1World = { x: 800, y: 720 };
  const labWorld = { x: 980, y: 892 };
  const nearLabWorld = { x: labWorld.x - 60, y: labWorld.y + 8 };

  async function walkIntoLab() {
    const nearLabScreen = await worldToScreen(nearLabWorld.x, nearLabWorld.y);
    await page.mouse.click(nearLabScreen.x, nearLabScreen.y);
    let entered = false;
    for (let i = 0; i < 30 && !entered; i++) {
      const labScreen = await worldToScreen(labWorld.x, labWorld.y - 40);
      await page.mouse.click(labScreen.x, labScreen.y);
      await page.waitForTimeout(500);
      entered = await page.locator('.overhaul-mode-laboratory').isVisible().catch(() => false);
    }
    return entered;
  }
  async function backToEstate() {
    let back = false;
    for (let i = 0; i < 10 && !back; i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      back = await page.locator('.overhaul-mode-estate').isVisible().catch(() => false);
    }
    return back;
  }

  await page.getByRole('button', { name: 'Лаборатория' }).click();
  await page.waitForTimeout(300);

  // --- 2. First contextual genetics intro screen, exact text. ---
  const introText = await page
    .getByText(
      'Выбери два растения. Новое растение получит часть признаков от каждого. Иногда появляется совершенно новый признак.',
      { exact: true }
    )
    .isVisible()
    .catch(() => false);
  assert(introText, '2. first contextual genetics explanation screen shows the exact required text');
  await page.getByRole('button', { name: 'Понятно, начать', exact: true }).click();
  await page.waitForTimeout(300);
  await shot('01-intro-dismissed');

  // --- 3. Two tutorial parents; 4. first breed free; 5. phenotype unknown. ---
  const candidateCount = await page.locator('.specimen-card').count();
  assert(candidateCount === 2, `3. fresh game has exactly two tutorial-starter candidates (got ${candidateCount})`);
  await page.locator('.specimen-card').nth(0).click();
  await page.locator('.specimen-card').nth(1).click();
  await page.waitForTimeout(200);
  const freeCostLabel = await page.getByText('Первое скрещивание: бесплатно', { exact: true }).isVisible().catch(() => false);
  assert(freeCostLabel, '4. first breed is free');
  await page.getByRole('button', { name: 'Скрестить', exact: true }).click();
  await page.waitForTimeout(400);
  const revealRightAfterBreed = await page.locator('.reveal-species-name').first().isVisible().catch(() => false);
  assert(!revealRightAfterBreed, '5. successful breed does not open Reveal / show phenotype immediately');
  const bredNoticeVisible = await page
    .getByText('Гибридное семя появилось в Питомнике! Посади его на грядку, чтобы увидеть, каким оно вырастет.', { exact: true })
    .isVisible()
    .catch(() => false);
  assert(bredNoticeVisible, '5. breed shows only the safe "seed appeared" notice');
  assert(!(await noPhenotypeLeaked()), '5. no phenotype/rarity leaked anywhere right after breeding');
  const stateAfterFirstBreed = await readSave();
  assert(stateAfterFirstBreed.pollen === 0, '5. first breed at pollen=0 stayed free');
  await shot('02-first-breed-no-reveal');

  // --- 6. Seed appears in Nursery Tray; 7. planting. ---
  await page.locator('.sheet-close').click();
  await page.waitForTimeout(200);
  assert(await backToEstate(), 'exited to Estate to plant the hybrid seed');
  let pickerOpen = false;
  for (let i = 0; i < 10 && !pickerOpen; i++) {
    const plot0Screen = await worldToScreen(plot0World.x, plot0World.y);
    await page.mouse.click(plot0Screen.x, plot0Screen.y);
    await page.waitForTimeout(400);
    pickerOpen = await page.locator('.sheet-backdrop').isVisible().catch(() => false);
  }
  const hybridRowVisible = pickerOpen && (await page.getByText('Гибридное семя #1', { exact: true }).isVisible().catch(() => false));
  assert(hybridRowVisible, '6. PlantPickerV2 lists the bred hybrid seed from the Nursery Tray, still an unknown/safe label');
  await page.getByText('Гибридное семя #1', { exact: true }).click();
  await page.waitForTimeout(400);
  assert(!(await page.locator('.sheet-backdrop').isVisible().catch(() => false)), '7. planting the hybrid seed closes the picker');
  await shot('03-hybrid-planted');

  // --- 8. Growing hybrid hides phenotype; 9. reload during growth hides phenotype. ---
  assert(!(await noPhenotypeLeaked()), '8. no phenotype leaked while the hybrid is growing');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  assert(!(await noPhenotypeLeaked()), '9. no phenotype leaked after reloading a still-growing hybrid plot');

  // --- 10. First maturity/harvest; 11. Reveal shows Солнечник/Uncommon/9 traits/origin/no mutation. ---
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('genesis-garden-save-v1'));
    const plot = state.plots.find((p) => p.hybridV2 && p.hybridV2.phase === 'growing');
    if (!plot) throw new Error('no growing V2 plot found to fast-forward');
    plot.hybridV2.hybrid.plantedAt = Date.now() - (5 * 60 * 1000 + 5000); // species 1: 5 min first growth
    localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  // Retry the tile click a few times — Phaser's own scene render
  // (EstateScene) can occasionally still be catching up to the
  // just-reloaded, fast-forwarded save on the first click.
  let rarityText = '';
  for (let i = 0; i < 6 && rarityText.trim() !== 'Необычная'; i++) {
    const plot0ScreenMature = await worldToScreen(plot0World.x, plot0World.y);
    await page.mouse.click(plot0ScreenMature.x, plot0ScreenMature.y);
    await page.waitForTimeout(500);
    rarityText = await page.locator('.lab-reveal-rarity').innerText().catch(() => '');
  }
  assert(rarityText.trim() === 'Необычная', `11. first mature interaction opens Reveal at exactly Uncommon (got "${rarityText}")`);
  assert(!(await page.locator('.lab-reveal-mutation').isVisible().catch(() => false)), '11. first tutorial breed has no mutation');
  const speciesNameVisible = await page.locator('.reveal-species-name').innerText().catch(() => '');
  assert(speciesNameVisible.trim() === 'Солнечник', `11. revealed child is a Солнечник (got "${speciesNameVisible}")`);
  const originLabelsText = await page.locator('.reveal-trait-origin').allInnerTexts();
  assert(originLabelsText.length === 9, `11. exactly nine trait rows with origin labels (got ${originLabelsText.length})`);
  const pageTextAtReveal = await page.locator('body').innerText();
  assert(!/size_large|size_normal|stem_standard|aura_faint|primary_honey|primary_coral/.test(pageTextAtReveal), '11. no raw allele id ever appears on the page');
  await shot('04-first-reveal-at-maturity');

  // --- 12. Reveal acknowledgement survives reload and doesn't repeat. ---
  const pendingBeforeAck = (await readSave()).specimens.find((s) => s.revealAcknowledged === false);
  assert(!!pendingBeforeAck, 'exactly one specimen pending Reveal before acknowledging');
  await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
  await page.waitForTimeout(300);
  assert(!(await page.locator('.reveal-species-name').first().isVisible().catch(() => false)), '12. acknowledging Reveal closes it');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  assert(!(await page.locator('.reveal-species-name').first().isVisible().catch(() => false)), '12. Reveal does not reopen after reload once acknowledged');
  const stateAfterAck = await readSave();
  assert(
    stateAfterAck.specimens.find((s) => s.id === pendingBeforeAck.id)?.revealAcknowledged === true,
    '12. revealAcknowledged persisted true across reload'
  );

  // --- 13. First hybrid reward opens Lab L2 + Колокольник. ---
  assert(stateAfterAck.firstHybridRewardClaimed === true, '13. firstHybridRewardClaimed flipped to true at first maturity');
  assert(stateAfterAck.labLevel >= 2, `13. labLevel opened to >=2 after the first hybrid matured (got ${stateAfterAck.labLevel})`);
  await page.getByRole('button', { name: 'Магазин' }).click();
  await page.waitForTimeout(300);
  const kolokolnikRow = page.locator('.sheet-row', { has: page.getByText('Обычный цветок', { exact: true }) });
  const kolokolnikLockedText = await kolokolnikRow
    .getByText('Этот вид пока недоступен — вырасти своего первого гибрида, чтобы открыть его', { exact: true })
    .isVisible()
    .catch(() => false);
  assert(!kolokolnikLockedText, '13. Колокольник is no longer locked in the shop after the first hybrid reward');
  await page.locator('.sheet-close').click();
  await page.waitForTimeout(200);

  // --- 14/15/16. Second tutorial breed costs 8 pollen; insufficient pollen no-op; success debits exactly 8. ---
  await page.getByRole('button', { name: 'Лаборатория' }).click();
  await page.waitForTimeout(300);
  const secondHintVisible = await page
    .getByText(
      'Один из признаков этого растения скрыт — потомок может унаследовать его, даже если у самого растения он не виден.',
      { exact: true }
    )
    .isVisible()
    .catch(() => false);
  assert(secondHintVisible, 'second-lesson hint appears now that the first Reveal is acknowledged');
  await page.locator('.sheet-close').click();
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('genesis-garden-save-v1'));
    state.pollen = 0;
    localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Лаборатория' }).click();
  await page.waitForTimeout(300);
  const stateBeforeInsufficient = await readSave();
  await page.locator('.specimen-card').nth(0).click();
  await page.locator('.specimen-card').nth(1).click();
  await page.waitForTimeout(200);
  assert(
    await page.getByText('Не хватает пыльцы: нужно 8, есть 0', { exact: true }).isVisible().catch(() => false),
    '15. exact insufficient-pollen text for the second tutorial pair'
  );
  assert(await page.locator('.sheet-buy-btn', { hasText: 'Скрестить' }).isDisabled(), '15. "Скрестить" disabled while pollen insufficient');
  await page.locator('.sheet-buy-btn', { hasText: 'Скрестить' }).click({ force: true }).catch(() => {});
  await page.waitForTimeout(200);
  const stateAfterInsufficient = await readSave();
  assert(stateAfterInsufficient.nurseryTray.length === stateBeforeInsufficient.nurseryTray.length, '15. tray unchanged after the blocked attempt');
  assert(stateAfterInsufficient.pollen === stateBeforeInsufficient.pollen, '15. pollen unchanged after the blocked attempt');
  assert(stateAfterInsufficient.pityCounter === stateBeforeInsufficient.pityCounter, '15. pityCounter unchanged (0 RNG calls) after the blocked attempt');
  await shot('05-second-breed-insufficient-pollen');

  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('genesis-garden-save-v1'));
    state.pollen = 8;
    localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Лаборатория' }).click();
  await page.waitForTimeout(300);
  await page.locator('.specimen-card').nth(0).click();
  await page.locator('.specimen-card').nth(1).click();
  await page.waitForTimeout(200);
  assert(
    await page.getByText('Стоимость: 8 пыльцы', { exact: true }).isVisible().catch(() => false),
    '14. second tutorial pair costs exactly 8 pollen (paid, not free)'
  );
  await page.getByRole('button', { name: 'Скрестить', exact: true }).click();
  await page.waitForTimeout(400);
  assert(!(await page.locator('.reveal-species-name').first().isVisible().catch(() => false)), '17. second breed also does not open Reveal immediately');
  const stateAfterSecondBreed = await readSave();
  assert(stateAfterSecondBreed.pollen === 0, `16. second breed deducted exactly 8 pollen (got ${stateAfterSecondBreed.pollen})`);
  await shot('06-second-breed-paid');

  // --- 17/18/19. Second offspring unknown until maturity; size_large appears; natural reveal on both parents. ---
  await page.locator('.sheet-close').click();
  await page.waitForTimeout(200);
  assert(await backToEstate(), 'exited to Estate to plant the second hybrid seed');
  let pickerOpen2 = false;
  for (let i = 0; i < 10 && !pickerOpen2; i++) {
    const plot1Screen = await worldToScreen(plot1World.x, plot1World.y);
    await page.mouse.click(plot1Screen.x, plot1Screen.y);
    await page.waitForTimeout(400);
    pickerOpen2 = await page.locator('.sheet-backdrop').isVisible().catch(() => false);
  }
  assert(pickerOpen2, 'PlantPickerV2 opens on the second empty plot');
  await page.getByText('Гибридное семя #1', { exact: true }).click();
  await page.waitForTimeout(400);
  assert(!(await noPhenotypeLeaked()), '17. no phenotype leaked right after planting the second hybrid seed');
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('genesis-garden-save-v1'));
    const plot = state.plots.find((p) => p.hybridV2 && p.hybridV2.phase === 'growing');
    if (!plot) throw new Error('no growing V2 plot found to fast-forward (second hybrid)');
    plot.hybridV2.hybrid.plantedAt = Date.now() - (5 * 60 * 1000 + 5000);
    localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  assert(!(await noPhenotypeLeaked()), '17. no phenotype leaked after reload of the still-growing second hybrid');
  let naturalHintVisible = false;
  for (let i = 0; i < 6 && !naturalHintVisible; i++) {
    const plot1Screen = await worldToScreen(plot1World.x, plot1World.y);
    await page.mouse.click(plot1Screen.x, plot1Screen.y);
    await page.waitForTimeout(500);
    naturalHintVisible = await page
      .getByText('Этот признак был скрыт у родителя — а у потомка стал видимым!', { exact: true })
      .isVisible()
      .catch(() => false);
  }
  assert(!(await page.locator('.lab-reveal-mutation').isVisible().catch(() => false)), '18. second tutorial breed has no mutation');
  assert(naturalHintVisible, '18. exact natural-reveal text on the second tutorial breed Reveal, confirming the guaranteed size_large trait was hidden-then-revealed');
  await shot('07-second-reveal-natural');
  await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
  await page.waitForTimeout(300);

  const saveAfterSecondMaturity = await readSave();
  const tutorialStartersFinal = saveAfterSecondMaturity.specimens.filter((s) => s.tutorialStarter === true);
  assert(tutorialStartersFinal.length === 2, `19. exactly two tutorial-starter specimens remain (got ${tutorialStartersFinal.length})`);
  for (const s of tutorialStartersFinal) {
    const sizeEntry = (s.revealedLoci ?? []).find((e) => e.locus === 'size');
    assert(!!sizeEntry, `19. tutorial-starter ${s.id} has a revealed "size" locus`);
    assert(sizeEntry.source === 'natural', `19. specimen ${s.id} "size" reveal source is "natural" (got "${sizeEntry?.source}")`);
  }

  // --- 20. Repeat harvest doesn't duplicate Specimen/Reveal. ---
  const specimenCountBeforeRepeat = saveAfterSecondMaturity.specimens.length;
  const plot1ScreenAgain = await worldToScreen(plot1World.x, plot1World.y);
  await page.mouse.click(plot1ScreenAgain.x, plot1ScreenAgain.y);
  await page.waitForTimeout(400);
  assert(!(await page.locator('.reveal-species-name').first().isVisible().catch(() => false)), '20. repeat interaction with the mature tile does not reopen Reveal');
  assert(await page.getByText('Постоянное растение').first().isVisible().catch(() => false), '20. repeat interaction opens the normal simple card instead');
  const saveAfterRepeat = await readSave();
  assert(saveAfterRepeat.specimens.length === specimenCountBeforeRepeat, '20. repeat harvest created no duplicate Specimen');
  await page.locator('.sheet-close').click();
  await page.waitForTimeout(200);

  // Lumi hint check during the tutorial flow.
  const lumiBubbleCountPhase1 = await page.locator('.lumi-hint-bubble').count();
  assert(lumiBubbleCountPhase1 <= 1, `at most one Lumi hint bubble visible during Phase 1 (got ${lumiBubbleCountPhase1})`);

  await shot('08-phase1-done');
  await page.close();
}

// ============================================================================
// PHASE 2 — injected fixture save, everything not tied to tutorial RNG.
// ============================================================================
async function runPhase2() {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('pageerror', (e) => errors.push(`[phase2] ${String(e)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[phase2] ${msg.text()}`);
  });

  async function shot(name) {
    await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', `genetics-v2-gate1-p2-${name}.png`) });
  }
  async function readSave() {
    return page.evaluate(() => JSON.parse(localStorage.getItem('genesis-garden-save-v1')));
  }
  async function writeSave(save) {
    await page.evaluate((s) => localStorage.setItem('genesis-garden-save-v1', JSON.stringify(s)), save);
  }
  // Mirrors AlbumPanelV2's own sort (favorites-first, then createdAt
  // descending) against the CURRENT save, so index-based card lookups stay
  // correct even after harvestHybridV2 injects a brand-new specimen (real
  // Date.now() createdAt) that a hand-picked constant index can't predict.
  async function albumCardIndexOf(specimenId) {
    const save = await readSave();
    const sorted = [...save.specimens.filter((s) => !!s.genomeV2)].sort((a, b) => {
      if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
    const idx = sorted.findIndex((s) => s.id === specimenId);
    if (idx < 0) throw new Error(`albumCardIndexOf: specimen "${specimenId}" not found in current save`);
    return idx;
  }

  const MISSING_PARENT_ID = 'ghost-parent-recycled-marker-gate1';
  const microGenome = fixtureGenomeV2(1, {
    stemForm: { a: 'stem_standard', b: 'stem_climbing' }, // expressed standard, hidden "Вьющийся"
    leafForm: { a: 'leaf_standard', b: 'leaf_broad' }, // expressed standard, hidden "Широкая"
  });

  function buildSave() {
    const plots = Array.from({ length: 24 }, (_, i) => ({ id: i, unlocked: i < 6, seedId: null, plantedAt: null }));
    return {
      version: 4,
      coins: 100,
      plots,
      inventory: {},
      // Specimen order controls .specimen-card index order in LabPanelV2
      // (candidates = specimens.filter(...), no re-sorting).
      specimens: [
        { id: 'sun-1', genome: legacyProjectionFor(fixtureGenomeV2(1)), genomeV2: fixtureGenomeV2(1), createdAt: 1 }, // index 0
        { id: 'kolo-1', genome: legacyProjectionFor(fixtureGenomeV2(2)), genomeV2: fixtureGenomeV2(2), createdAt: 2 }, // index 1 — recycled before its child matures (carryover fix)
        { id: 'sun-2', genome: legacyProjectionFor(fixtureGenomeV2(1)), genomeV2: fixtureGenomeV2(1), createdAt: 3 }, // index 2
        { id: 'kolo-2', genome: legacyProjectionFor(fixtureGenomeV2(2)), genomeV2: fixtureGenomeV2(2), createdAt: 4 }, // index 3
        { id: 'micro-1', genome: legacyProjectionFor(microGenome), genomeV2: microGenome, createdAt: 5 }, // index 4 — microscope target
        { id: 'lineage-parent-a', genome: legacyProjectionFor(fixtureGenomeV2(1)), genomeV2: fixtureGenomeV2(1), createdAt: 6 }, // index 5
        {
          id: 'lineage-child',
          genome: legacyProjectionFor(fixtureGenomeV2(1)),
          genomeV2: fixtureGenomeV2(1),
          createdAt: 7,
          parentIds: ['lineage-parent-a', MISSING_PARENT_ID],
        }, // index 6
        { id: 'recycle-me', genome: legacyProjectionFor(fixtureGenomeV2(1)), genomeV2: fixtureGenomeV2(1), createdAt: 8 }, // index 7
        { id: 'favorite-me', genome: legacyProjectionFor(fixtureGenomeV2(1)), genomeV2: fixtureGenomeV2(1), createdAt: 9 }, // index 8
      ],
      geneticDust: 0,
      pityCounter: 0,
      questProgress: {},
      questsClaimed: [],
      entitlements: [],
      pollen: 30, // covers 12 (1x2) + 12 (2x1) with 6 left over
      labLevel: 2,
      nurseryTray: [
        {
          id: 'nursery-recycle-seed',
          genomeV2: fixtureGenomeV2(1),
          parentIds: ['sun-1', 'sun-2'],
          createdAt: 0,
          plantedAt: null,
          plotId: null,
        },
      ],
      firstBreedFreeClaimed: true,
      firstHybridRewardClaimed: true,
      firstRecycleTopUpClaimed: true,
      geneticsIntroSeen: true,
    };
  }

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 8000 });
  await page.waitForTimeout(1000);
  await writeSave(buildSave());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await shot('00-loaded-fixture');

  // --- 26/27. Interspecies 1x2: sun-1 (Seed) x kolo-1 (Pollen) — cost 12,
  // resulting hybrid seed speciesId equals the Seed Parent (species 1). ---
  await page.getByRole('button', { name: 'Лаборатория' }).click();
  await page.waitForTimeout(300);
  const specimenCardCount = await page.locator('.specimen-card').count();
  assert(specimenCardCount === 9, `lab shows all nine V2-eligible fixture specimens (got ${specimenCardCount})`);
  await page.locator('.specimen-card').nth(0).click(); // sun-1
  await page.locator('.specimen-card').nth(1).click(); // kolo-1
  await page.waitForTimeout(200);
  assert(await page.getByText('Стоимость: 12 пыльцы', { exact: true }).isVisible().catch(() => false), '26. exact "Стоимость: 12 пыльцы" for the 1x2 interspecies pair');
  await page.getByRole('button', { name: 'Скрестить', exact: true }).click();
  await page.waitForTimeout(400);
  const stateAfter1x2 = await readSave();
  assert(stateAfter1x2.pollen === 18, `26. interspecies breed deducted exactly 12 pollen (30 -> 18, got ${stateAfter1x2.pollen})`);
  const seed1x2 = stateAfter1x2.nurseryTray.find((s) => s.parentIds.includes('sun-1') && s.parentIds.includes('kolo-1'));
  assert(!!seed1x2, '26. bred 1x2 hybrid seed added to the Nursery Tray');
  assert(seed1x2.genomeV2.speciesId === 1, `27. 1x2 hybrid seed speciesId equals the Seed Parent species (Солнечник, got ${seed1x2.genomeV2.speciesId})`);
  assert(
    Array.isArray(seed1x2.parentSpeciesIds) && seed1x2.parentSpeciesIds[0] === 1 && seed1x2.parentSpeciesIds[1] === 2,
    `carryover fix: HybridSeedV2.parentSpeciesIds captured [1,2] directly at breed time (got ${JSON.stringify(seed1x2.parentSpeciesIds)})`
  );

  // --- 27 (reverse). Interspecies 2x1: kolo-2 (Seed) x sun-2 (Pollen) — child species always equals the Seed Parent, this time species 2. ---
  await page.locator('.specimen-card').nth(0).click(); // deselect sun-1
  await page.locator('.specimen-card').nth(1).click(); // deselect kolo-1
  await page.locator('.specimen-card').nth(3).click(); // kolo-2 (Seed)
  await page.locator('.specimen-card').nth(2).click(); // sun-2 (Pollen)
  await page.waitForTimeout(200);
  assert(await page.getByText('Стоимость: 12 пыльцы', { exact: true }).isVisible().catch(() => false), '26. exact "Стоимость: 12 пыльцы" for the reversed 2x1 interspecies pair');
  await page.getByRole('button', { name: 'Скрестить', exact: true }).click();
  await page.waitForTimeout(400);
  const stateAfter2x1 = await readSave();
  assert(stateAfter2x1.pollen === 6, `2x1 interspecies breed deducted exactly 12 pollen (18 -> 6, got ${stateAfter2x1.pollen})`);
  const seed2x1 = stateAfter2x1.nurseryTray.find((s) => s.parentIds.includes('kolo-2') && s.parentIds.includes('sun-2'));
  assert(!!seed2x1, '26. bred reversed 2x1 hybrid seed added to the Nursery Tray');
  assert(seed2x1.genomeV2.speciesId === 2, `27. reversed 2x1 hybrid seed speciesId equals its Seed Parent species (Колокольник, got ${seed2x1.genomeV2.speciesId})`);
  await shot('01-interspecies-both-directions-bred');

  // --- Plant the 1x2 seed, then recycle its Pollen Parent (kolo-1) BEFORE it matures — the carryover-fix regression through the real UI. ---
  await page.locator('.sheet-close').click();
  await page.waitForTimeout(200);
  let backToEstateOk = false;
  for (let i = 0; i < 10 && !backToEstateOk; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    backToEstateOk = await page.locator('.overhaul-mode-estate').isVisible().catch(() => false);
  }
  assert(backToEstateOk, 'exited to Estate to plant the 1x2 hybrid seed');
  const canvasBox = await page.locator('canvas').boundingBox();
  async function worldToScreen(worldX, worldY) {
    const debug = await page.evaluate(() => window.__overhaulDebug?.getEstateState());
    return { x: canvasBox.x + (worldX - debug.cameraScrollX) * debug.cameraZoom, y: canvasBox.y + (worldY - debug.cameraScrollY) * debug.cameraZoom };
  }
  const plot0World = { x: 704, y: 720 };
  let pickerOpen = false;
  for (let i = 0; i < 10 && !pickerOpen; i++) {
    const plot0Screen = await worldToScreen(plot0World.x, plot0World.y);
    await page.mouse.click(plot0Screen.x, plot0Screen.y);
    await page.waitForTimeout(400);
    pickerOpen = await page.locator('.sheet-backdrop').isVisible().catch(() => false);
  }
  assert(pickerOpen, 'PlantPickerV2 opens on the first plot');
  // Three hybrid seeds are now in the tray: the pre-existing fixture seed
  // ("Гибридное семя #1"), then the 1x2 seed bred above ("#2"), then the 2x1
  // seed ("#3") — tray order matches array order, breeds append. Plant #2.
  await page.getByText('Гибридное семя #2', { exact: true }).click();
  await page.waitForTimeout(400);
  assert(!(await page.locator('.sheet-backdrop').isVisible().catch(() => false)), 'planting the 1x2 hybrid seed closed the picker');

  await page.getByRole('button', { name: 'Альбом' }).click();
  await page.waitForTimeout(300);
  const kolo1CardBeforeRecycle = page.locator('.album-card').nth(await albumCardIndexOf('kolo-1'));
  await kolo1CardBeforeRecycle.getByRole('button', { name: 'Переработать' }).click();
  await page.waitForTimeout(200);
  await page.getByText('Да, переработать').click();
  await page.waitForTimeout(300);
  const stateAfterKolo1Recycle = await readSave();
  assert(!stateAfterKolo1Recycle.specimens.some((s) => s.id === 'kolo-1'), '29. kolo-1 (the 1x2 pair\'s Pollen Parent) successfully recycled BEFORE its child matures');
  await page.locator('.sheet-close').click();
  await page.waitForTimeout(200);

  // --- Fast-forward to maturity; Reveal must still show the correct
  // interspecies origin labels even though the Pollen Parent is gone. ---
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('genesis-garden-save-v1'));
    const plot = state.plots.find((p) => p.hybridV2 && p.hybridV2.phase === 'growing');
    if (!plot) throw new Error('no growing V2 plot found to fast-forward (1x2 hybrid)');
    plot.hybridV2.hybrid.plantedAt = Date.now() - (5 * 60 * 1000 + 5000); // species 1 (Seed Parent) growth timing
    localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  // Retry the tile click — Phaser's own "ready" render (EstateScene) can
  // occasionally still be catching up to the just-reloaded, fast-forwarded
  // save on the first click, same flakiness-tolerant pattern the rest of the
  // V2 e2e suite uses for scene-dependent interactions.
  let revealOpenedAfterRecycle = false;
  for (let i = 0; i < 6 && !revealOpenedAfterRecycle; i++) {
    const plot0Screen = await worldToScreen(plot0World.x, plot0World.y);
    await page.mouse.click(plot0Screen.x, plot0Screen.y);
    await page.waitForTimeout(500);
    revealOpenedAfterRecycle = await page.locator('.reveal-species-name').first().isVisible().catch(() => false);
  }
  assert(revealOpenedAfterRecycle, '29. Reveal opens at the 1x2 hybrid\'s maturity even with its Pollen Parent already recycled');
  // traitOriginLabelsV2 compares the two PARENTS' species to each other (not
  // to the child's species) — sun-1 (species 1) x kolo-1 (species 2) are
  // different species, so BOTH sides use the interspecies arrow label. This
  // is exactly the carryover-fix regression: without parentSpeciesIds,
  // kolo-1 being gone would make the live-parent lookup fall back to the
  // child's own species for the missing side, wrongly turning "← Колокольник"
  // into "От второго растения".
  const originLabelsAfterRecycle = await page.locator('.reveal-trait-origin').allInnerTexts();
  assert(
    originLabelsAfterRecycle.some((t) => t.includes('← Солнечник')),
    '29. Seed side correctly shows "← Солнечник" (interspecies label, not same-species fallback)'
  );
  assert(
    originLabelsAfterRecycle.some((t) => t.includes('← Колокольник')),
    '29. carryover fix: Pollen side still correctly shows "← Колокольник" (interspecies label), not mislabeled as same-species, even though kolo-1 was recycled'
  );
  const pageTextAtRecycledReveal = await page.locator('body').innerText();
  assert(!pageTextAtRecycledReveal.includes('kolo-1'), '29. no raw specimen id ever leaks onto the Reveal screen');
  await shot('02-reveal-after-parent-recycled-carryover-fix');
  await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
  await page.waitForTimeout(300);

  // --- 24/25. Microscope: exact 3-dust debit; already-revealed locus never re-offered. ---
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('genesis-garden-save-v1'));
    state.geneticDust = 6; // enough for two reveals, kept independent of the recycle-dust amounts above
    localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Альбом' }).click();
  await page.waitForTimeout(300);
  const microCard = page.locator('.album-card').filter({ hasText: 'Микроскоп' }).filter({ has: page.locator('.album-card-favorite') });
  // Locate micro-1's card directly by opening the microscope for every
  // candidate card until the expected "Вьющийся"/"Широкая" hidden pair shows
  // up — simplest robust approach given album sort order is not otherwise
  // controlled by this fixture beyond createdAt (favorites-first, then
  // newest-first; micro-1 is not a favorite and not the newest).
  const albumCards = page.locator('.album-card');
  const albumCount = await albumCards.count();
  let microscoped = false;
  for (let i = 0; i < albumCount && !microscoped; i++) {
    const card = albumCards.nth(i);
    const hasMicroscopeBtn = await card.getByRole('button', { name: 'Микроскоп' }).isVisible().catch(() => false);
    if (!hasMicroscopeBtn) continue;
    await card.getByRole('button', { name: 'Микроскоп' }).click();
    await page.waitForTimeout(250);
    const isTarget = await page.getByText('Стебель: видно — Обычный, скрыто — Не исследован', { exact: true }).isVisible().catch(() => false);
    if (isTarget) {
      microscoped = true;
      break;
    }
    await page.locator('.sheet-close').last().click();
    await page.waitForTimeout(150);
  }
  assert(microscoped, 'found and opened the microscope on the hetero-locus specimen (micro-1)');
  const revealButtonsBefore = await page.getByRole('button', { name: 'Раскрыть за 3 пыли' }).count();
  assert(revealButtonsBefore === 2, `24. exactly two reveal buttons before any reveal (got ${revealButtonsBefore})`);
  const dustBeforeReveal = (await readSave()).geneticDust;
  const stemRow = page.locator('.sheet-row', { has: page.getByText('Стебель', { exact: true }) });
  await stemRow.getByRole('button', { name: 'Раскрыть за 3 пыли' }).click();
  await page.waitForTimeout(300);
  assert(await page.getByText('Признак раскрыт', { exact: true }).isVisible().catch(() => false), '24. exact success text after reveal');
  const dustAfterReveal = (await readSave()).geneticDust;
  assert(dustAfterReveal === dustBeforeReveal - 3, `24. microscope debited exactly 3 dust (before=${dustBeforeReveal}, after=${dustAfterReveal})`);
  const revealButtonsAfter = await page.getByRole('button', { name: 'Раскрыть за 3 пыли' }).count();
  assert(revealButtonsAfter === 1, `25. exactly one reveal button remains for the still-hidden locus (got ${revealButtonsAfter})`);
  const stemRevealButtonGoneNow = (await stemRow.getByRole('button', { name: 'Раскрыть за 3 пыли' }).count()) === 0;
  assert(stemRevealButtonGoneNow, '25. the already-revealed locus is never offered for reveal again');
  await page.locator('.sheet-close').last().click();
  await page.locator('.sheet-close').first().click();
  await page.waitForTimeout(200);

  // --- 21. Recycle a Nursery Seed. ---
  await page.getByRole('button', { name: 'Лаборатория' }).click();
  await page.waitForTimeout(300);
  const trayLenBefore = (await readSave()).nurseryTray.length;
  const nurseryRecycleRow = page.locator('.sheet-list .sheet-row', { has: page.getByText('Семя №', { exact: false }) }).last();
  await nurseryRecycleRow.getByRole('button', { name: 'Переработать' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Да, переработать' }).click();
  await page.waitForTimeout(300);
  const stateAfterSeedRecycle = await readSave();
  assert(stateAfterSeedRecycle.nurseryTray.length === trayLenBefore - 1, '21. Nursery Seed recycled successfully (tray shrank by one)');
  await page.locator('.sheet-close').click();
  await page.waitForTimeout(200);

  // --- 22. Recycle a mature Specimen; 23. favorite protected. ---
  await page.getByRole('button', { name: 'Альбом' }).click();
  await page.waitForTimeout(300);
  const specimensBeforeRecycle = (await readSave()).specimens.length;
  const recycleMeCard = page.locator('.album-card').nth(await albumCardIndexOf('recycle-me'));
  await recycleMeCard.getByRole('button', { name: 'Переработать' }).click();
  await page.waitForTimeout(200);
  await page.getByText('Да, переработать').click();
  await page.waitForTimeout(300);
  const stateAfterSpecimenRecycle = await readSave();
  assert(!stateAfterSpecimenRecycle.specimens.some((s) => s.id === 'recycle-me'), '22. recycle-me successfully recycled from the Album');
  assert(stateAfterSpecimenRecycle.specimens.length === specimensBeforeRecycle - 1, '22. specimen count decreased by exactly one after the recycle');
  await shot('03-after-recycles');

  // --- 23. Favorite protected from recycling. ---
  const favoriteMeCardBefore = page.locator('.album-card').nth(await albumCardIndexOf('favorite-me'));
  await favoriteMeCardBefore.locator('.album-card-favorite').click();
  await page.waitForTimeout(200);
  // Favoriting moves the card to the front of the sort (favorites-first) —
  // re-resolve its index rather than reusing the pre-click locator.
  const favoriteMeCard = page.locator('.album-card').nth(await albumCardIndexOf('favorite-me'));
  const stillHasRecycleAfterFavorite = await favoriteMeCard.getByRole('button', { name: 'Переработать' }).isVisible().catch(() => false);
  assert(!stillHasRecycleAfterFavorite, '23. favoriting a specimen hides its recycle button');
  const protectedTextVisible = await favoriteMeCard
    .getByText('В избранном — сними звезду, чтобы переработать', { exact: true })
    .isVisible()
    .catch(() => false);
  assert(protectedTextVisible, '23. favoriting a specimen shows the exact recycle-blocked message');
  const stateAfterFavorite = await readSave();
  assert(stateAfterFavorite.specimens.some((s) => s.id === 'favorite-me'), '23. favorite specimen was not removed');
  assert(stateAfterFavorite.specimens.find((s) => s.id === 'favorite-me')?.favorite === true, '23. favorite flag persisted on favorite-me');

  // --- 28. Lineage shown without raw IDs. ---
  const lineageCard = page.locator('.album-card').filter({ hasText: 'Родитель недоступен' }).first();
  const lineageFirstParentVisible = await lineageCard.getByText('Первый родитель: Солнечник', { exact: true }).isVisible().catch(() => false);
  assert(lineageFirstParentVisible, '28. the found parent shows its species name');
  const lineageSecondParentVisible = await lineageCard.getByText('Второй родитель: Родитель недоступен', { exact: true }).isVisible().catch(() => false);
  assert(lineageSecondParentVisible, '28. the missing parent shows exactly "Родитель недоступен"');
  const bodyTextForLineage = await page.locator('body').innerText();
  assert(!bodyTextForLineage.includes(MISSING_PARENT_ID), '28. the raw missing parent id never leaks onto the page');
  await page.locator('.sheet-close').click();
  await page.waitForTimeout(200);

  // --- 30. Nursery Tray 8/8 blocks a 9th breed. ---
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
  await page.getByRole('button', { name: 'Лаборатория' }).click();
  await page.waitForTimeout(300);
  const trayFullLabelVisible = await page.getByText('Питомник заполнен: 8/8', { exact: true }).first().isVisible().catch(() => false);
  assert(trayFullLabelVisible, '30. exact "Питомник заполнен: 8/8" shown at capacity');
  const trayFullHintVisible = await page
    .getByText('Посади одно из семян на грядку или переработай его, чтобы освободить место.', { exact: true })
    .first()
    .isVisible()
    .catch(() => false);
  assert(trayFullHintVisible, '30. tray-full hint shown');
  const trayLenBeforeBlockedAttempt = (await readSave()).nurseryTray.length;
  const pollenBeforeBlockedAttempt = (await readSave()).pollen;
  const remainingSpecimenCards = await page.locator('.specimen-card').count();
  if (remainingSpecimenCards >= 2) {
    await page.locator('.specimen-card').nth(0).click();
    await page.locator('.specimen-card').nth(1).click();
    await page.waitForTimeout(200);
    await page.locator('.sheet-buy-btn', { hasText: 'Скрестить' }).click({ force: true }).catch(() => {});
    await page.waitForTimeout(200);
  }
  const stateAfterBlockedNinth = await readSave();
  assert(stateAfterBlockedNinth.nurseryTray.length === trayLenBeforeBlockedAttempt, '30. a 9th breed attempt at 8/8 is a full no-op (tray unchanged)');
  assert(stateAfterBlockedNinth.pollen === pollenBeforeBlockedAttempt, '30. pollen unchanged by the blocked 9th-breed attempt');
  await shot('04-nursery-tray-full');
  await page.locator('.sheet-close').click();
  await page.waitForTimeout(200);

  // --- 33. Lumi max 1 hint (checked again in this fixture-driven phase). ---
  const lumiBubbleCountPhase2 = await page.locator('.lumi-hint-bubble').count();
  assert(lumiBubbleCountPhase2 <= 1, `33. at most one Lumi hint bubble visible at a time (got ${lumiBubbleCountPhase2})`);

  // --- 31. Botanical Book — five working sections + one honest "Скоро". ---
  async function walkIntoLab() {
    const nearLabScreen = await worldToScreen(920, 900);
    await page.mouse.click(nearLabScreen.x, nearLabScreen.y);
    let entered = false;
    for (let i = 0; i < 30 && !entered; i++) {
      const labScreen = await worldToScreen(980, 852);
      await page.mouse.click(labScreen.x, labScreen.y);
      await page.waitForTimeout(500);
      entered = await page.locator('.overhaul-mode-laboratory').isVisible().catch(() => false);
    }
    return entered;
  }
  let backToEstateOk2 = false;
  for (let i = 0; i < 10 && !backToEstateOk2; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    backToEstateOk2 = await page.locator('.overhaul-mode-estate').isVisible().catch(() => false);
  }
  assert(await walkIntoLab(), 'walked into LaboratoryScene to reach the book hotspot');
  await page.locator('canvas').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('3'); // book is the third of five hotspots
  await page.waitForTimeout(300);
  let bookHeaderVisible = await page.getByRole('heading', { name: 'Ботаническая книга — Генетика', exact: true }).isVisible().catch(() => false);
  if (!bookHeaderVisible) {
    const bookScreenX = canvasBox.x + canvasBox.width / 2;
    const bookScreenY = canvasBox.y + canvasBox.height * 0.68;
    await page.mouse.click(bookScreenX, bookScreenY);
    await page.waitForTimeout(300);
    bookHeaderVisible = await page.getByRole('heading', { name: 'Ботаническая книга — Генетика', exact: true }).isVisible().catch(() => false);
  }
  assert(bookHeaderVisible, '31. Botanical Book opens (Genetics section)');
  const bookNavButtons = await page.locator('.book-nav-btn').allInnerTexts();
  const expectedSections = ['Родители', 'Наследование', 'Скрытые признаки', 'Мутации и pity', 'Пыльца и генетическая пыль', 'Ночные и погодные условия'];
  for (const label of expectedSections) {
    assert(bookNavButtons.some((t) => t.includes(label)), `31. book nav shows section "${label}"`);
  }
  assert(await page.getByText('Скоро', { exact: true }).isVisible().catch(() => false), '31. sixth section is honestly marked "Скоро"');
  await shot('05-botanical-book');

  // --- 32. Tutorial replay leaves serialized gameplay/economy state unchanged. ---
  const saveBeforeReplay = await page.evaluate(() => localStorage.getItem('genesis-garden-save-v1'));
  await page.getByRole('button', { name: 'Показать обучение генетике заново', exact: true }).click();
  await page.waitForTimeout(300);
  assert(await page.getByText('Демонстрация обучения', { exact: true }).isVisible().catch(() => false), '32. demo replay launches over the book');
  await page.getByRole('button', { name: 'Понятно, начать', exact: true }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Скрестить ещё раз', exact: true }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
  await page.waitForTimeout(200);
  assert(
    await page.getByText('Демонстрация завершена — это не повлияло на твою игру.', { exact: true }).isVisible().catch(() => false),
    '32. replay reaches its honest completion screen'
  );
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.waitForTimeout(200);
  const saveAfterReplay = await page.evaluate(() => localStorage.getItem('genesis-garden-save-v1'));
  assert(saveBeforeReplay === saveAfterReplay, '32. full demo replay leaves the serialized save byte-identical');
  await shot('06-replay-unchanged');

  // --- 34. Mobile viewport (360x800) has no horizontal overflow. ---
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(300);
  const hasNoOverflowWithBook = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  assert(hasNoOverflowWithBook, '34. no horizontal page overflow at 360x800 with the book open');
  await page.locator('.sheet-close').first().click().catch(() => {});
  await page.waitForTimeout(200);
  const hasNoOverflowAfterClose = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  assert(hasNoOverflowAfterClose, '34. no horizontal page overflow at 360x800 after closing the book');
  await shot('07-mobile-360x800');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(200);

  // --- SAVE_VERSION stays 4 throughout the whole phase. ---
  const finalState = await readSave();
  assert(finalState.version === 4, `SAVE_VERSION stays 4 (got ${finalState.version})`);

  await page.close();
}

// ============================================================================
// Overhaul+Legacy (:4174) regression: no V2 UI at all, byte-identical V2
// state round-trip is untouched (delegated to test-e2e-genetics-v2-legacy-
// isolation.mjs — not duplicated here beyond a light sanity spot-check).
// ============================================================================
async function runLegacySpotCheck() {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('pageerror', (e) => errors.push(`[legacy] ${String(e)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[legacy] ${msg.text()}`);
  });
  await page.goto(LEGACY_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 8000 });
  await page.waitForTimeout(1200);
  const oldOnboardingVisible = await page.locator('.onboarding-backdrop').isVisible().catch(() => false);
  assert(oldOnboardingVisible, 'Overhaul+Legacy still shows the OLD 4-slide onboarding on a fresh game');
  if (oldOnboardingVisible) {
    await page.locator('.onboarding-skip').click();
    await page.waitForTimeout(300);
  }
  await page.getByRole('button', { name: 'Лаборатория' }).click();
  await page.waitForTimeout(300);
  const legacyIntroTextVisible = await page
    .getByText('Выбери два растения. Новое растение получит часть признаков от каждого.', { exact: false })
    .isVisible()
    .catch(() => false);
  assert(!legacyIntroTextVisible, 'Overhaul+Legacy never shows the Slice 12 contextual intro screen');
  const legacyHeaderVisible = await page.getByRole('heading', { name: 'Лаборатория скрещивания', exact: true }).isVisible().catch(() => false);
  assert(legacyHeaderVisible, 'Overhaul+Legacy opens the plain legacy LabPanel, not LabPanelV2');
  const legacyRevealVisible = await page.locator('.reveal-species-name').first().isVisible().catch(() => false);
  assert(!legacyRevealVisible, 'Overhaul+Legacy never renders a Slice 12/14 Reveal screen');
  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', 'genetics-v2-gate1-legacy-no-v2-ui.png') });
  await page.close();
}

await runPhase1();
await runPhase2();
await runLegacySpotCheck();

const realErrors = errors.filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
assert(realErrors.length === 0, `35. no unexpected console/page errors across the whole Gate 1 journey (found: ${JSON.stringify(realErrors)})`);
console.log('CONSOLE/PAGE ERRORS:', errors.length ? errors : 'none');

await browser.close();
console.log('genetics v2 Gate 1 final canonical e2e (carryover fix + Slice 13 calibration guarantees + full new-player journey): OK');
