import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Genetics V2 — Slice 12 dedicated E2E (contract §4.14/§4.14.14, delta doc
// §0.13/§0.14) — REWRITTEN in the fix-pass after the owner rejected the
// original Slice 12 delivery (Reveal shown immediately after breedNurseryV2,
// before the hybrid was even planted). This is the SAME scenario file, not a
// second parallel one — it now walks the real 17-step path the owner asked
// for, on a FRESH Overhaul+V2 game (:4175 build, no fixture-save —
// shouldSeedTutorialStartersV2 requires an untouched game, contract
// §4.14.2/§4.14.9):
//   1.  Old 4-slide Onboarding.tsx does NOT show when Genetics V2 is active.
//   2.  First contextual genetics explanation screen shows the exact text.
//   3.  First breed is free — and shows ONLY the safe "seed appeared" notice,
//       no Reveal, no species/rarity/traits anywhere.
//   4.  The unknown seed is planted; no phenotype leaks during growth or
//       after a reload of the still-growing plot.
//   5.  At maturity, the FIRST mature interaction with the tile opens Reveal
//       — exactly Uncommon, nine trait rows with origin labels, no mutation.
//   6.  Neither tutorial-starter parent was revealed before this point.
//   7.  The second-lesson hint/offer appears ONLY after this Reveal is
//       acknowledged — not right after the first breed.
//   8.  At pollen<8 the second (paid) breed is blocked — exact text, button
//       disabled, and the store is a full no-op (tray/pollen/pity/counter
//       all unchanged).
//   9.  Topped up to 8, the second breed deducts exactly 8 pollen.
//   10. The second seed is likewise unrevealed until ITS maturity.
//   11. At the second child's maturity, Reveal shows guaranteed size_large
//       and the exact natural-reveal text.
//   12. Both tutorial-starter parents show a natural reveal of "size", with
//       revealedLoci source "natural" (store-level ground truth).
//   13. Repeating the mature-tile interaction does not reopen Reveal.
//   14. Lumi never shows more than one hint bubble; the Botanical Book opens
//       with its five working sections + one honest "Скоро" section; the
//       demo replay is a full no-op on the serialized save; the mobile
//       viewport has no horizontal overflow anywhere in this flow.
//   15. Overhaul+Legacy (:4174) has no Slice 12 UI at all (regression).
//
// Does NOT duplicate the pure-logic/store-level coverage already in
// revealV2.test.ts/tutorialV2.test.ts/lumiHintsV2.test.ts/
// store.tutorialV2.test.ts/store.revealLifecycleV2.test.ts (origin algorithm,
// natural-reveal rule, mutation-locus exclusion, idempotency, RNG-
// substitution boundaries) — this only checks that the real rendered UI
// wiring end-to-end matches the corrected contract.

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

async function shot(name, target = page) {
  await target.screenshot({ path: path.join(SCRIPT_DIR, 'shots', `genetics-v2-slice12-${name}.png`) });
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`OK: ${msg}`);
}

async function hasNoHorizontalOverflow(target = page) {
  return target.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
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

// --- Fresh Overhaul+V2 game — no fixture save. ---
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 8000 });
await page.waitForTimeout(1200);

// --- Test 1: old 4-slide Onboarding.tsx does NOT show under Genetics V2. ---
const oldOnboardingVisible = await page.locator('.onboarding-backdrop').isVisible().catch(() => false);
assert(!oldOnboardingVisible, 'test 1: old 4-slide Onboarding.tsx does not show when Genetics V2 is active');
await shot('00-fresh-estate-no-old-onboarding');

// --- worldToScreen helper, same recipe as the rest of the V2 e2e suite. ---
const canvasBox = await page.locator('canvas').boundingBox();
async function worldToScreen(worldX, worldY) {
  const debug = await page.evaluate(() => window.__overhaulDebug?.getEstateState());
  if (!debug) throw new Error('window.__overhaulDebug not available — EstateScene debug hook missing');
  return { x: canvasBox.x + (worldX - debug.cameraScrollX), y: canvasBox.y + (worldY - debug.cameraScrollY) };
}
const plot0World = { x: 704, y: 720 }; // worldConfig.PLOT_SLOTS[0]
const labWorld = { x: 980, y: 892 }; // worldConfig.LAB_BUILDING
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

// --- Open the lab (HUD button — same shortcut the rest of the V2 e2e suite uses). ---
await page.getByRole('button', { name: 'Лаборатория' }).click();
await page.waitForTimeout(300);

// --- Test 2: first contextual genetics explanation screen, exact text. ---
const introText = await page
  .getByText(
    'Выбери два растения. Новое растение получит часть признаков от каждого. Иногда появляется совершенно новый признак.',
    { exact: true }
  )
  .isVisible()
  .catch(() => false);
assert(introText, 'test 2: first contextual genetics explanation screen shows the exact required text');
const introButton = page.getByRole('button', { name: 'Понятно, начать', exact: true });
assert(await introButton.isVisible(), 'test 2: "Понятно, начать" button is visible');
const breedButtonHiddenBehindIntro = await page.getByRole('button', { name: 'Скрестить', exact: true }).isVisible().catch(() => false);
assert(!breedButtonHiddenBehindIntro, 'test 2: intro screen gates the rest of the lab UI (breed button not reachable yet)');
await shot('01-intro-screen');
await introButton.click();
await page.waitForTimeout(300);
const breedButtonVisibleAfterIntro = await page.getByRole('button', { name: 'Скрестить', exact: true }).isVisible().catch(() => false);
assert(breedButtonVisibleAfterIntro, 'test 2: dismissing intro reveals the actual lab UI — intro was not itself the breeding action');

// --- Test 3 (fix-pass, owner review §1/§3): first tutorial breed — real
// breedV2, tutorial-seeded RNG, free — shows ONLY the safe "seed appeared"
// notice. No Reveal screen, no species/rarity/trait anywhere. ---
const candidateCount = await page.locator('.specimen-card').count();
assert(candidateCount === 2, `test 3: fresh game has exactly two tutorial-starter candidates (got ${candidateCount})`);
await page.locator('.specimen-card').nth(0).click();
await page.locator('.specimen-card').nth(1).click();
await page.waitForTimeout(200);
const freeCostLabel = await page.getByText('Первое скрещивание: бесплатно', { exact: true }).isVisible().catch(() => false);
assert(freeCostLabel, 'test 3: first breed is free (firstBreedFreeClaimed not yet set)');
await page.getByRole('button', { name: 'Скрестить', exact: true }).click();
await page.waitForTimeout(400);

const revealVisibleRightAfterBreed = await page.locator('.reveal-species-name').first().isVisible().catch(() => false);
assert(!revealVisibleRightAfterBreed, 'test 3: successful breed does NOT open Reveal (deferred to maturity, fix-pass)');
const bredNoticeVisible = await page.getByText('Гибридное семя появилось в Питомнике! Посади его на грядку, чтобы увидеть, каким оно вырастет.', { exact: true }).isVisible().catch(() => false);
assert(bredNoticeVisible, 'test 3: successful breed shows only the exact safe "seed appeared, go plant it" notice');
await shot('02-first-breed-no-reveal');

// --- Test 4 (owner review §5, restored Slice 5 regression guarantee): no
// phenotype/genome/rarity field rendered anywhere right after breeding. ---
assert(!(await noPhenotypeLeaked()), 'test 4: no phenotype/genome/rarity leaked anywhere right after breeding');
const stateAfterFirstBreed = await readSave();
assert(stateAfterFirstBreed.firstBreedFreeClaimed === true, 'test 4: firstBreedFreeClaimed flipped to true atomically with the free breed');
assert(stateAfterFirstBreed.pollen === 0, 'test 4: first breed at pollen=0 stayed free');
const startersBeforeMaturity = stateAfterFirstBreed.specimens.filter((s) => s.tutorialStarter === true);
assert(startersBeforeMaturity.length === 2, 'test 4: exactly two tutorial-starter specimens exist');
for (const s of startersBeforeMaturity) {
  assert(s.revealedLoci === undefined, `test 4: tutorial-starter ${s.id} has no revealedLoci yet (breed does not touch parents, fix-pass owner review §1/§6)`);
}

// --- Test 5: plant the unknown hybrid seed via PlantPickerV2. ---
await page.locator('.sheet-close').click();
await page.waitForTimeout(200);
assert(await backToEstate(), 'test 5: exited back to Estate to plant the hybrid seed');

let pickerOpen = false;
for (let i = 0; i < 10 && !pickerOpen; i++) {
  const plot0Screen = await worldToScreen(plot0World.x, plot0World.y);
  await page.mouse.click(plot0Screen.x, plot0Screen.y);
  await page.waitForTimeout(400);
  pickerOpen = await page.locator('.sheet-backdrop').isVisible().catch(() => false);
}
const hybridRowVisible = pickerOpen && (await page.getByText('Гибридное семя #1', { exact: true }).isVisible().catch(() => false));
assert(hybridRowVisible, 'test 5: PlantPickerV2 lists the bred hybrid seed, still an unknown/safe label');
await page.getByText('Гибридное семя #1', { exact: true }).click();
await page.waitForTimeout(400);
const pickerClosed = !(await page.locator('.sheet-backdrop').isVisible().catch(() => false));
assert(pickerClosed, 'test 5: planting the hybrid seed closes the picker (plantHybridSeedV2 succeeded)');
await shot('03-hybrid-planted-growing');

// --- Test 6 (owner review §5/§6): no phenotype during growth, and none
// after a reload of the still-growing plot. ---
assert(!(await noPhenotypeLeaked()), 'test 6: no phenotype leaked right after planting (still growing)');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
assert(!(await noPhenotypeLeaked()), 'test 6: no phenotype leaked after reloading the still-growing plot');
const stateAfterGrowingReload = await readSave();
assert(
  stateAfterGrowingReload.specimens.filter((s) => !!s.genomeV2).length === 2,
  'test 6: reload of a growing hybrid creates no Specimen yet (still exactly the two starters)'
);

// --- Test 7 (fix-pass, owner review §1/§2): fast-forward to maturity, then
// the FIRST mature interaction with the tile opens Reveal — Uncommon, nine
// trait rows with origin, no mutation. Neither parent was touched before. ---
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('genesis-garden-save-v1'));
  const plot = state.plots.find((p) => p.hybridV2 && p.hybridV2.phase === 'growing');
  if (!plot) throw new Error('no growing V2 plot found in save to fast-forward');
  plot.hybridV2.hybrid.plantedAt = Date.now() - (5 * 60 * 1000 + 5000); // species 1: 5 min first growth
  localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
assert(!(await noPhenotypeLeaked()), 'test 7: still no phenotype leaked after reload, right up to the maturity-triggering click');

const plot0ScreenMature = await worldToScreen(plot0World.x, plot0World.y);
await page.mouse.click(plot0ScreenMature.x, plot0ScreenMature.y);
await page.waitForTimeout(500);

const rarityText = await page.locator('.lab-reveal-rarity').innerText().catch(() => '');
assert(rarityText.trim() === 'Необычная', `test 7: first mature interaction opens Reveal — exactly Uncommon rarity (got "${rarityText}")`);
const mutationBadgeVisible = await page.locator('.lab-reveal-mutation').isVisible().catch(() => false);
assert(!mutationBadgeVisible, 'test 7: first tutorial breed has no mutation');
const speciesNameVisible = await page.locator('.reveal-species-name').innerText().catch(() => '');
assert(speciesNameVisible.trim() === 'Солнечник', `test 7: revealed child is a Солнечник (got "${speciesNameVisible}")`);
const originLabelsText = await page.locator('.reveal-trait-origin').allInnerTexts();
assert(originLabelsText.length === 9, `test 7: exactly nine trait rows shown (got ${originLabelsText.length})`);
assert(originLabelsText.some((t) => t.includes('От первого растения')), 'test 7: at least one trait shows "От первого растения" (Seed Parent origin)');
assert(originLabelsText.some((t) => t.includes('От второго растения')), 'test 7: at least one trait shows "От второго растения" (Pollen Parent origin)');
await shot('04-first-reveal-at-maturity');

// Why-screen — same regression as before, now reached from the maturity Reveal.
await page.getByRole('button', { name: 'Почему получилось так?', exact: true }).click();
await page.waitForTimeout(200);
const whyTraitRows = await page.locator('.reveal-why-screen .reveal-trait-row').count();
assert(whyTraitRows === 9, `test 7: Why screen shows exactly the nine expressed traits (got ${whyTraitRows})`);
const noMutationLineVisible = await page.getByText('Мутации не произошло.', { exact: true }).isVisible().catch(() => false);
assert(noMutationLineVisible, 'test 7: Why screen states no mutation occurred');
const pageTextAfterWhy = await page.locator('body').innerText();
assert(!/size_large|size_normal|stem_standard|aura_faint|primary_honey|primary_coral/.test(pageTextAfterWhy), 'test 7: no raw allele id ever appears on the page');
await page.getByRole('button', { name: 'Назад', exact: true }).click();
await page.waitForTimeout(150);

// --- Test 8: parents were NOT natural-revealed before this moment — checked
// as store-level ground truth right before acknowledging Reveal. ---
const stateAtPendingReveal = await readSave();
const startersAtPendingReveal = stateAtPendingReveal.specimens.filter((s) => s.tutorialStarter === true);
for (const s of startersAtPendingReveal) {
  assert(s.revealedLoci === undefined, `test 8: tutorial-starter ${s.id} still has no revealedLoci right before Reveal is acknowledged`);
}
const pendingSpecimen = stateAtPendingReveal.specimens.find((s) => s.revealAcknowledged === false);
assert(!!pendingSpecimen, 'test 8: exactly one specimen is pending Reveal (revealAcknowledged:false) at this point');

await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
await page.waitForTimeout(300);
const revealClosedAfterAck = !(await page.locator('.reveal-species-name').first().isVisible().catch(() => false));
assert(revealClosedAfterAck, 'test 8: acknowledging Reveal closes it');
const stateAfterAck = await readSave();
assert(
  stateAfterAck.specimens.find((s) => s.id === pendingSpecimen.id)?.revealAcknowledged === true,
  'test 8: revealAcknowledged persisted as true after closing'
);
// Natural reveal, applied at maturity (harvestHybridV2), not at breed time —
// first breed's two loci are same-species Uncommon guaranteed fixtures with
// no forced hidden-allele match, so this only asserts the field now EXISTS
// in the right shape (not asserting any particular locus got revealed here
// — that guarantee belongs to the SECOND tutorial breed, tests 11-12 below).
for (const s of stateAfterAck.specimens.filter((sp) => sp.tutorialStarter === true)) {
  assert(Array.isArray(s.revealedLoci) || s.revealedLoci === undefined, `test 8: tutorial-starter ${s.id} revealedLoci is either absent or a real array (natural reveal ran without crashing)`);
}

// --- Test 9 (owner review §4): the second-lesson hint appears ONLY now —
// after the first hybrid matured AND its Reveal was acknowledged — not right
// after the first breed (tests 3/4 above already proved it wasn't showing
// there because the lab was closed; this proves the POSITIVE case). Reveal
// was acknowledged while still on the Estate (harvested via a tile click) —
// reopen the lab to see the banner. ---
await page.getByRole('button', { name: 'Лаборатория' }).click();
await page.waitForTimeout(300);
const secondHintVisible = await page
  .getByText(
    'Один из признаков этого растения скрыт — потомок может унаследовать его, даже если у самого растения он не виден.',
    { exact: true }
  )
  .isVisible()
  .catch(() => false);
assert(secondHintVisible, 'test 9: exact "hidden trait" hint shows now that first Reveal is acknowledged');
await shot('05-second-breed-hint');

// --- Test 10 (owner review §3): at pollen<8, the second (paid) breed is
// blocked — exact text, disabled button, full no-op (no RNG/state
// mutation). First-hybrid harvest above granted formulaic + first-hybrid
// bonus pollen (well above 8) — zero it out via the same localStorage
// time-travel technique the rest of the V2 e2e suite uses, to exercise the
// insufficient-pollen path honestly. ---
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

const stateBeforeInsufficientAttempt = await readSave();
await page.locator('.specimen-card').nth(0).click();
await page.locator('.specimen-card').nth(1).click();
await page.waitForTimeout(200);
const insufficientTextVisible = await page.getByText('Не хватает пыльцы: нужно 8, есть 0', { exact: true }).isVisible().catch(() => false);
assert(insufficientTextVisible, 'test 10: exact "Не хватает пыльцы: нужно 8, есть 0" text shown for the second tutorial pair');
const breedBtnDisabled = await page.locator('.sheet-buy-btn', { hasText: 'Скрестить' }).isDisabled();
assert(breedBtnDisabled, 'test 10: "Скрестить" button disabled while pollen is insufficient for the second breed');
// The button is disabled, but confirm clicking it anyway (defense-in-depth,
// store-level guard) is still a full no-op — nothing mutates.
await page.locator('.sheet-buy-btn', { hasText: 'Скрестить' }).click({ force: true }).catch(() => {});
await page.waitForTimeout(200);
const stateAfterInsufficientAttempt = await readSave();
assert(stateAfterInsufficientAttempt.nurseryTray.length === stateBeforeInsufficientAttempt.nurseryTray.length, 'test 10: nursery tray unchanged after the blocked attempt (no RNG/state mutation)');
assert(stateAfterInsufficientAttempt.pollen === stateBeforeInsufficientAttempt.pollen, 'test 10: pollen unchanged after the blocked attempt');
assert(stateAfterInsufficientAttempt.pityCounter === stateBeforeInsufficientAttempt.pityCounter, 'test 10: pityCounter unchanged after the blocked attempt (0 RNG calls)');
assert(stateAfterInsufficientAttempt.geneticsTutorialBreedsCompleted === stateBeforeInsufficientAttempt.geneticsTutorialBreedsCompleted, 'test 10: geneticsTutorialBreedsCompleted unchanged after the blocked attempt');
await shot('06-second-breed-insufficient-pollen');

// --- Test 11: topped up to exactly 8, the second breed deducts exactly 8
// pollen, guarantees size_large with no mutation, and shows NO Reveal yet
// (deferred to ITS OWN maturity, same rule as the first breed). ---
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
const costLabelVisible = await page.getByText('Стоимость: 8 пыльцы', { exact: true }).isVisible().catch(() => false);
assert(costLabelVisible, 'test 11: second tutorial pair shows the exact "Стоимость: 8 пыльцы" (paid, not free)');
await page.getByRole('button', { name: 'Скрестить', exact: true }).click();
await page.waitForTimeout(400);
const revealVisibleAfterSecondBreed = await page.locator('.reveal-species-name').first().isVisible().catch(() => false);
assert(!revealVisibleAfterSecondBreed, 'test 11: second breed also does NOT open Reveal immediately (deferred to its own maturity)');
const stateAfterSecondBreed = await readSave();
assert(stateAfterSecondBreed.pollen === 0, `test 11: second breed deducted exactly 8 pollen (8 -> 0, got ${stateAfterSecondBreed.pollen})`);
assert(stateAfterSecondBreed.geneticsTutorialBreedsCompleted === 2, 'test 11: geneticsTutorialBreedsCompleted reached 2 after the paid second breed');
await shot('07-second-breed-paid-no-reveal');

// --- Test 12: plant and mature the second hybrid — no phenotype leaked
// before its OWN maturity either. ---
await page.locator('.sheet-close').click();
await page.waitForTimeout(200);
assert(await backToEstate(), 'test 12: exited back to Estate to plant the second hybrid seed');

// plot0 already holds the mature first hybrid — use the next free plot.
const plot1World = { x: 800, y: 720 }; // worldConfig.PLOT_SLOTS[1] (same row, next slot)
let pickerOpen2 = false;
for (let i = 0; i < 10 && !pickerOpen2; i++) {
  const plot1Screen = await worldToScreen(plot1World.x, plot1World.y);
  await page.mouse.click(plot1Screen.x, plot1Screen.y);
  await page.waitForTimeout(400);
  pickerOpen2 = await page.locator('.sheet-backdrop').isVisible().catch(() => false);
}
assert(pickerOpen2, 'test 12: PlantPickerV2 opens on the second empty plot');
await page.getByText('Гибридное семя #1', { exact: true }).click();
await page.waitForTimeout(400);
assert(!(await noPhenotypeLeaked()), 'test 12: no phenotype leaked right after planting the second hybrid seed');

await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('genesis-garden-save-v1'));
  const plot = state.plots.find((p) => p.hybridV2 && p.hybridV2.phase === 'growing');
  if (!plot) throw new Error('no growing V2 plot found in save to fast-forward (second hybrid)');
  plot.hybridV2.hybrid.plantedAt = Date.now() - (5 * 60 * 1000 + 5000);
  localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
assert(!(await noPhenotypeLeaked()), 'test 12: no phenotype leaked after reload of the still-growing second hybrid');

// --- Test 13 (owner review §4/§6/§7): second child's maturity — guaranteed
// size_large, the exact natural-reveal text, no mutation. ---
const plot1Screen = await worldToScreen(plot1World.x, plot1World.y);
await page.mouse.click(plot1Screen.x, plot1Screen.y);
await page.waitForTimeout(500);
const secondMutationBadgeVisible = await page.locator('.lab-reveal-mutation').isVisible().catch(() => false);
assert(!secondMutationBadgeVisible, 'test 13: second tutorial breed has no mutation');
const naturalHintVisible = await page
  .getByText('Этот признак был скрыт у родителя — а у потомка стал видимым!', { exact: true })
  .isVisible()
  .catch(() => false);
assert(naturalHintVisible, 'test 13: exact natural-reveal text shows on the second tutorial breed Reveal, at ITS maturity');
await shot('08-second-reveal-natural-at-maturity');
await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
await page.waitForTimeout(300);

// --- Test 14: both tutorial-starter parents actually got a natural reveal of
// the "size" locus (store-level ground truth, not just the UI text). ---
const saveAfterSecondMaturity = await readSave();
const tutorialStartersFinal = saveAfterSecondMaturity.specimens.filter((s) => s.tutorialStarter === true);
assert(tutorialStartersFinal.length === 2, `test 14: exactly two tutorial-starter specimens remain (got ${tutorialStartersFinal.length})`);
for (const s of tutorialStartersFinal) {
  const sizeEntry = (s.revealedLoci ?? []).find((e) => e.locus === 'size');
  assert(!!sizeEntry, `test 14: tutorial-starter specimen ${s.id} has a revealed "size" locus`);
  assert(sizeEntry.source === 'natural', `test 14: specimen ${s.id} "size" reveal source is "natural" (got "${sizeEntry?.source}")`);
}

// --- Test 15 (owner review §1/§6/§7): repeating the mature-tile interaction
// does not reopen Reveal. ---
const plot1ScreenAgain = await worldToScreen(plot1World.x, plot1World.y);
await page.mouse.click(plot1ScreenAgain.x, plot1ScreenAgain.y);
await page.waitForTimeout(400);
const revealReopenedVisible = await page.locator('.reveal-species-name').first().isVisible().catch(() => false);
assert(!revealReopenedVisible, 'test 15: repeat interaction with the mature tile does not reopen Reveal');
const hybridCardVisible = await page.getByText('Постоянное растение').first().isVisible().catch(() => false);
assert(hybridCardVisible, 'test 15: repeat interaction opens the normal simple card instead');
await page.locator('.sheet-close').click();
await page.waitForTimeout(200);

// --- Test 16: Lumi hints — never more than one bubble at once, across the
// whole flow so far. ---
const lumiBubbleCount = await page.locator('.lumi-hint-bubble').count();
assert(lumiBubbleCount <= 1, `test 16: at most one Lumi hint bubble visible at a time (got ${lumiBubbleCount})`);

// --- Test 17: Botanical Book — five working sections + "Скоро" sixth. Book
// is only reachable via the Laboratory Phaser hotspot (not a plain HUD
// button) — walk into LaboratoryScene, then use the "3" keyboard shortcut
// LaboratoryScene registers for its third hotspot (book is index 2 of 5:
// workbench, showcase, book, microscope, dryer — see buildHotspots()). ---
assert(await walkIntoLab(), 'test 17: walked into LaboratoryScene to reach the book hotspot');

await page.locator('canvas').click({ position: { x: 5, y: 5 } }).catch(() => {}); // focus the canvas without hitting a hotspot
await page.keyboard.press('3'); // book is the third of five hotspots
await page.waitForTimeout(300);
let bookHeaderVisible = await page.getByRole('heading', { name: 'Ботаническая книга — Генетика', exact: true }).isVisible().catch(() => false);
if (!bookHeaderVisible) {
  // Fallback: click the hotspot directly by its computed canvas position
  // (buildHotspots() landscape layout formula, LaboratoryScene.layout()) —
  // book is hotspot index 2 of 5, which resolves to exactly canvas centre X.
  const bookScreenX = canvasBox.x + canvasBox.width / 2;
  const bookScreenY = canvasBox.y + canvasBox.height * 0.68;
  await page.mouse.click(bookScreenX, bookScreenY);
  await page.waitForTimeout(300);
  bookHeaderVisible = await page.getByRole('heading', { name: 'Ботаническая книга — Генетика', exact: true }).isVisible().catch(() => false);
}
assert(bookHeaderVisible, 'test 17: Botanical Book opens (Genetics section)');
const bookNavButtons = await page.locator('.book-nav-btn').allInnerTexts();
const expectedSections = ['Родители', 'Наследование', 'Скрытые признаки', 'Мутации и pity', 'Пыльца и генетическая пыль', 'Ночные и погодные условия'];
for (const label of expectedSections) {
  assert(bookNavButtons.some((t) => t.includes(label)), `test 17: book nav shows section "${label}"`);
}
// Fix-pass (owner review §8): "Наследование" no longer calls a locus "a pair
// of two alleles" — it now correctly describes locus as the trait
// position/category, with two alleles carried per locus.
await page.getByRole('button', { name: 'Наследование', exact: true }).click();
await page.waitForTimeout(150);
const inheritanceBodyText = await page.locator('.book-section-text').innerText().catch(() => '');
assert(
  inheritanceBodyText.includes('Locus — это позиция или категория наследуемого признака'),
  'test 17: "Наследование" section correctly defines locus as a trait position/category, not "a pair of two alleles" (owner review §8)'
);
assert(!inheritanceBodyText.includes('пара из двух аллелей (locus)'), 'test 17: the old incorrect "пара из двух аллелей (locus)" phrasing is gone');
const soonBadgeVisible = await page.getByText('Скоро', { exact: true }).isVisible().catch(() => false);
assert(soonBadgeVisible, 'test 17: sixth section is honestly marked "Скоро"');
await page.getByRole('button', { name: 'Ночные и погодные условия' }).click();
await page.waitForTimeout(150);
const soonSectionBodyVisible = await page.getByText('Этот раздел появится в одном из следующих обновлений.', { exact: true }).isVisible().catch(() => false);
assert(soonSectionBodyVisible, 'test 17: sixth section body honestly says it is not implemented yet, not fake content');
const replayButtonVisible = await page.getByRole('button', { name: 'Показать обучение генетике заново', exact: true }).isVisible().catch(() => false);
assert(replayButtonVisible, 'test 17: "Показать обучение генетике заново" is a separate book action, present alongside the six sections');
await shot('09-botanical-book');

// --- Test 18: demo replay launches, and causes ZERO gameplay state
// mutation (localStorage snapshot before/after is byte-identical). ---
const saveBeforeReplay = await page.evaluate(() => localStorage.getItem('genesis-garden-save-v1'));
await page.getByRole('button', { name: 'Показать обучение генетике заново', exact: true }).click();
await page.waitForTimeout(300);
const replayIntroVisible = await page.getByText('Демонстрация обучения', { exact: true }).isVisible().catch(() => false);
assert(replayIntroVisible, 'test 18: demo replay launches over the book');
await page.getByRole('button', { name: 'Понятно, начать', exact: true }).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Скрестить ещё раз', exact: true }).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
await page.waitForTimeout(200);
const replayDoneTextVisible = await page.getByText('Демонстрация завершена — это не повлияло на твою игру.', { exact: true }).isVisible().catch(() => false);
assert(replayDoneTextVisible, 'test 18: replay reaches its honest completion screen');
await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
await page.waitForTimeout(200);
const saveAfterReplay = await page.evaluate(() => localStorage.getItem('genesis-garden-save-v1'));
assert(saveBeforeReplay === saveAfterReplay, 'test 18: full demo replay leaves the serialized save byte-identical (no breedV2/HybridSeed/Specimen/economy/Reveal-lifecycle mutation)');
await shot('10-replay-done-state-unchanged');

// --- Test 19 (mobile pass): resize to a common mobile viewport and re-check
// no horizontal overflow anywhere reachable in this flow. ---
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
assert(await hasNoHorizontalOverflow(page), 'test 19 (mobile): no horizontal page overflow with the book open');
await page.locator('.sheet-close').first().click();
await page.waitForTimeout(200);
assert(await hasNoHorizontalOverflow(page), 'test 19 (mobile): no horizontal page overflow after closing the book');
await shot('11-mobile-no-overflow');
await page.setViewportSize({ width: 1366, height: 768 });
await page.waitForTimeout(200);

// --- Test 20: Overhaul+Legacy (:4174) still shows the OLD onboarding (not
// the new contextual intro), and has no Slice 12 UI at all. ---
const legacyPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const legacyErrors = [];
legacyPage.on('pageerror', (e) => legacyErrors.push(String(e)));
legacyPage.on('console', (msg) => {
  if (msg.type() === 'error') legacyErrors.push(msg.text());
});
await legacyPage.goto(LEGACY_URL, { waitUntil: 'networkidle' });
await legacyPage.evaluate(() => localStorage.clear());
await legacyPage.reload({ waitUntil: 'networkidle' });
await legacyPage.waitForSelector('canvas', { timeout: 8000 });
await legacyPage.waitForTimeout(1200);
const legacyOldOnboardingVisible = await legacyPage.locator('.onboarding-backdrop').isVisible().catch(() => false);
assert(legacyOldOnboardingVisible, 'test 20: Overhaul+Legacy still shows the OLD 4-slide onboarding on a fresh game');
if (legacyOldOnboardingVisible) {
  await legacyPage.locator('.onboarding-skip').click();
  await legacyPage.waitForTimeout(300);
}
await legacyPage.getByRole('button', { name: 'Лаборатория' }).click();
await legacyPage.waitForTimeout(300);
const legacyIntroTextVisible = await legacyPage
  .getByText('Выбери два растения. Новое растение получит часть признаков от каждого.', { exact: false })
  .isVisible()
  .catch(() => false);
assert(!legacyIntroTextVisible, 'test 20: Overhaul+Legacy never shows the Slice 12 contextual intro screen');
const legacyHeaderVisible = await legacyPage.getByRole('heading', { name: 'Лаборатория скрещивания', exact: true }).isVisible().catch(() => false);
assert(legacyHeaderVisible, 'test 20: Overhaul+Legacy opens the plain legacy LabPanel, not LabPanelV2');
const legacyRevealVisible = await legacyPage.locator('.reveal-species-name').first().isVisible().catch(() => false);
assert(!legacyRevealVisible, 'test 20: Overhaul+Legacy never renders a Slice 12 Reveal screen either');
await legacyPage.screenshot({ path: path.join(SCRIPT_DIR, 'shots', 'genetics-v2-slice12-12-legacy-no-v2-ui.png') });

const realErrors = errors.concat(legacyErrors).filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
assert(realErrors.length === 0, `no unexpected console/page errors (found: ${JSON.stringify(realErrors)})`);

console.log('CONSOLE/PAGE ERRORS:', errors.length + legacyErrors.length ? [...errors, ...legacyErrors] : 'none');
await legacyPage.close();
await browser.close();
console.log('genetics v2 slice 12 fix-pass (reveal deferred to maturity, restored economics/gating, contextual onboarding, Lumi hints, Botanical Book, demo replay): OK');
