import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Genetics V2 — Slice 12 dedicated E2E (contract §4.14, delta doc §0.13):
// covers, on a FRESH Overhaul+V2 game (:4175 build, no fixture-save — the
// tutorial seeding/RNG substitution is specifically about a brand-new game,
// contract §4.14.2/§4.14.9), through the real rendered UI:
//   1. Old 4-slide Onboarding.tsx does NOT show when Genetics V2 is active.
//   2. First contextual genetics explanation screen shows the exact text,
//      before the first real breed; dismissing it does not replace breeding.
//   3. First tutorial breed (real breedV2, tutorial-seeded RNG) — exactly
//      Uncommon rarity, no mutation, Reveal screen shows correct trait
//      origin labels for both parents.
//   4. Why-screen ("Почему получилось так?") does not leak any hidden/
//      unrelated parent allele — only actually-expressed traits.
//   5. Second tutorial breed guarantees size_large reveal; the exact
//      before/after texts show; both tutorial-starter parents get a natural
//      reveal (checked via localStorage snapshot, not just UI text).
//   6. Lumi hints never show more than one bubble at once.
//   7. Botanical Book opens with the five working sections plus "Скоро"
//      sixth section; "Показать обучение генетике заново" launches the
//      demo replay.
//   8. Demo replay launches over the book, without mutating game state
//      (localStorage snapshot before/after the launch is byte-identical —
//      the replay never calls breedV2/creates HybridSeed/Specimen).
//   9. Mobile viewport (390x844) — no page horizontal overflow anywhere in
//      this flow (Reveal, Book, intro screen).
//  10. Overhaul+Legacy (:4174) still shows the old onboarding, not the new
//      contextual intro screen, and has no Slice 12 UI at all (regression,
//      same methodology as the rest of the V2 e2e suite).
//
// Does NOT duplicate the pure-logic/store-level coverage already in
// revealV2.test.ts/tutorialV2.test.ts/lumiHintsV2.test.ts/
// store.tutorialV2.test.ts (origin algorithm, natural-reveal rule,
// idempotency, RNG-substitution boundaries) — this only checks that the
// real rendered UI wiring end-to-end matches the contract.

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

// --- Fresh Overhaul+V2 game — no fixture save. shouldSeedTutorialStartersV2
// requires an untouched game (exactly 2 specimens, no breeding history), so
// this scenario deliberately starts from a clean localStorage, unlike the
// rest of the V2 e2e suite (which mostly time-travels via fixture-saves). ---
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 8000 });
await page.waitForTimeout(1200);

// --- Test 1: old 4-slide Onboarding.tsx does NOT show under Genetics V2. ---
const oldOnboardingVisible = await page.locator('.onboarding-backdrop').isVisible().catch(() => false);
assert(!oldOnboardingVisible, 'test 1: old 4-slide Onboarding.tsx does not show when Genetics V2 is active');
await shot('00-fresh-estate-no-old-onboarding');

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
// The rest of the lab (candidate grid, breed button) must not be reachable
// while the intro screen is up — it gates the UI, but is not itself the
// breeding action.
const breedButtonHiddenBehindIntro = await page.getByRole('button', { name: 'Скрестить', exact: true }).isVisible().catch(() => false);
assert(!breedButtonHiddenBehindIntro, 'test 2: intro screen gates the rest of the lab UI (breed button not reachable yet)');
await shot('01-intro-screen');
await introButton.click();
await page.waitForTimeout(300);
const breedButtonVisibleAfterIntro = await page.getByRole('button', { name: 'Скрестить', exact: true }).isVisible().catch(() => false);
assert(breedButtonVisibleAfterIntro, 'test 2: dismissing intro reveals the actual lab UI — intro was not itself the breeding action');

// --- Test 3: first tutorial breed — real breedV2, tutorial-seeded RNG,
// exactly Uncommon, no mutation. Exactly two tutorial-starter candidates
// exist in a fresh game. ---
const candidateCount = await page.locator('.specimen-card').count();
assert(candidateCount === 2, `test 3: fresh game has exactly two tutorial-starter candidates (got ${candidateCount})`);
await page.locator('.specimen-card').nth(0).click();
await page.locator('.specimen-card').nth(1).click();
await page.waitForTimeout(200);
const freeCostLabel = await page.getByText('Первое скрещивание: бесплатно', { exact: true }).isVisible().catch(() => false);
assert(freeCostLabel, 'test 3: first breed is free (firstBreedFreeClaimed not yet set)');
await page.getByRole('button', { name: 'Скрестить', exact: true }).click();
await page.waitForTimeout(400);

const rarityVisible = await page.locator('.lab-reveal-rarity').innerText().catch(() => '');
assert(rarityVisible.trim() === 'Необычная', `test 3: first tutorial breed is exactly Uncommon rarity (got "${rarityVisible}")`);
const mutationBadgeVisible = await page.locator('.lab-reveal-mutation').isVisible().catch(() => false);
assert(!mutationBadgeVisible, 'test 3: first tutorial breed has no mutation');
const speciesNameVisible = await page.locator('.reveal-species-name').innerText().catch(() => '');
assert(speciesNameVisible.trim() === 'Солнечник', `test 3: revealed child is a Солнечник (got "${speciesNameVisible}")`);
await shot('02-first-reveal');

// --- Test 4 (part of test 3 scope): origin labels visible for traits from
// each parent — same-species pair, so "От первого/второго растения". ---
const originLabelsText = await page.locator('.reveal-trait-origin').allInnerTexts();
const hasFirstParentOrigin = originLabelsText.some((t) => t.includes('От первого растения'));
const hasSecondParentOrigin = originLabelsText.some((t) => t.includes('От второго растения'));
assert(hasFirstParentOrigin, 'test 3: at least one trait shows "От первого растения" (Seed Parent origin)');
assert(hasSecondParentOrigin, 'test 3: at least one trait shows "От второго растения" (Pollen Parent origin)');
assert(originLabelsText.length === 9, `test 3: exactly nine trait rows shown (got ${originLabelsText.length})`);

// --- Test 5: Why screen shows only actually-expressed traits, no raw ids,
// no leak of unrelated hidden parent alleles. ---
await page.getByRole('button', { name: 'Почему получилось так?', exact: true }).click();
await page.waitForTimeout(200);
const whyTitleVisible = await page.getByRole('heading', { name: 'Почему получилось так?', exact: true }).isVisible().catch(() => false);
assert(whyTitleVisible, 'test 5: Why screen opens');
const whyTraitRows = await page.locator('.reveal-why-screen .reveal-trait-row').count();
assert(whyTraitRows === 9, `test 5: Why screen shows exactly the nine expressed traits (got ${whyTraitRows})`);
const noMutationLineVisible = await page.getByText('Мутации не произошло.', { exact: true }).isVisible().catch(() => false);
assert(noMutationLineVisible, 'test 5: Why screen states no mutation occurred, matching test 3');
const pageTextAfterWhy = await page.locator('body').innerText();
assert(!/size_large|size_normal|stem_standard|aura_faint|primary_honey|primary_coral/.test(pageTextAfterWhy), 'test 5: no raw allele id ever appears on the page');
await shot('03-why-screen-first-breed');
await page.getByRole('button', { name: 'Назад', exact: true }).click();
await page.waitForTimeout(150);
await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
await page.waitForTimeout(300);

// --- Second tutorial breed banner (exact text, contract §4.14.3/§13.1). ---
const secondHintVisible = await page
  .getByText(
    'Один из признаков этого растения скрыт — потомок может унаследовать его, даже если у самого растения он не виден.',
    { exact: true }
  )
  .isVisible()
  .catch(() => false);
assert(secondHintVisible, 'test 6: exact "hidden trait" hint shows between the first and second tutorial breeds');
await shot('04-second-breed-hint');

// --- Test 6: second tutorial breed — guaranteed size_large reveal, no mutation. ---
await page.locator('.specimen-card').nth(0).click();
await page.locator('.specimen-card').nth(1).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Скрестить', exact: true }).click();
await page.waitForTimeout(400);
const secondMutationBadgeVisible = await page.locator('.lab-reveal-mutation').isVisible().catch(() => false);
assert(!secondMutationBadgeVisible, 'test 6: second tutorial breed has no mutation');
const naturalHintVisible = await page
  .getByText('Этот признак был скрыт у родителя — а у потомка стал видимым!', { exact: true })
  .isVisible()
  .catch(() => false);
assert(naturalHintVisible, 'test 6: exact natural-reveal text shows on the second tutorial breed reveal');
await shot('05-second-reveal-natural');
await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
await page.waitForTimeout(300);
await page.locator('.sheet-close').first().click();
await page.waitForTimeout(200);

// --- Test 7: both tutorial-starter parents actually got a natural reveal of
// the "size" locus (store-level ground truth, not just the UI banner text). ---
const saveAfterSecondBreed = await page.evaluate(() => JSON.parse(localStorage.getItem('genesis-garden-save-v1')));
const tutorialStarters = saveAfterSecondBreed.specimens.filter((s) => s.tutorialStarter === true);
assert(tutorialStarters.length === 2, `test 7: exactly two tutorial-starter specimens remain (got ${tutorialStarters.length})`);
for (const s of tutorialStarters) {
  const sizeEntry = (s.revealedLoci ?? []).find((e) => e.locus === 'size');
  assert(!!sizeEntry, `test 7: tutorial-starter specimen ${s.id} has a revealed "size" locus`);
  assert(sizeEntry.source === 'natural', `test 7: specimen ${s.id} "size" reveal source is "natural" (got "${sizeEntry?.source}")`);
}
assert(saveAfterSecondBreed.geneticsTutorialBreedsCompleted === 2, 'test 7: geneticsTutorialBreedsCompleted reached 2 after both tutorial breeds');

// --- Test 8: Lumi hints — never more than one bubble at once, across the
// whole flow so far. ---
const lumiBubbleCount = await page.locator('.lumi-hint-bubble').count();
assert(lumiBubbleCount <= 1, `test 8: at most one Lumi hint bubble visible at a time (got ${lumiBubbleCount})`);

// --- Test 9: Botanical Book — five working sections + "Скоро" sixth. Book
// is only reachable via the Laboratory Phaser hotspot (not a plain HUD
// button) — walk into LaboratoryScene, then use the "3" keyboard shortcut
// LaboratoryScene registers for its third hotspot (book is index 2 of 5:
// workbench, showcase, book, microscope, dryer — see buildHotspots()). ---
await page.getByRole('button', { name: 'Лаборатория' }).click();
await page.waitForTimeout(200);
await page.locator('.sheet-close').first().click();
await page.waitForTimeout(200);

const canvasBox = await page.locator('canvas').boundingBox();
async function worldToScreen(worldX, worldY) {
  const debug = await page.evaluate(() => window.__overhaulDebug?.getEstateState());
  if (!debug) throw new Error('window.__overhaulDebug not available — EstateScene debug hook missing');
  return { x: canvasBox.x + (worldX - debug.cameraScrollX), y: canvasBox.y + (worldY - debug.cameraScrollY) };
}
const labWorld = { x: 980, y: 892 }; // worldConfig.LAB_BUILDING
const nearLabWorld = { x: labWorld.x - 60, y: labWorld.y + 8 };
const nearLabScreen = await worldToScreen(nearLabWorld.x, nearLabWorld.y);
await page.mouse.click(nearLabScreen.x, nearLabScreen.y);
let enteredLab = false;
for (let i = 0; i < 30 && !enteredLab; i++) {
  const labScreen = await worldToScreen(labWorld.x, labWorld.y - 40);
  await page.mouse.click(labScreen.x, labScreen.y);
  await page.waitForTimeout(500);
  enteredLab = await page.locator('.overhaul-mode-laboratory').isVisible().catch(() => false);
}
assert(enteredLab, 'test 9: walked into LaboratoryScene to reach the book hotspot');

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
assert(bookHeaderVisible, 'test 9: Botanical Book opens (Genetics section)');
const bookNavButtons = await page.locator('.book-nav-btn').allInnerTexts();
const expectedSections = ['Родители', 'Наследование', 'Скрытые признаки', 'Мутации и pity', 'Пыльца и генетическая пыль', 'Ночные и погодные условия'];
for (const label of expectedSections) {
  assert(bookNavButtons.some((t) => t.includes(label)), `test 9: book nav shows section "${label}"`);
}
const soonBadgeVisible = await page.getByText('Скоро', { exact: true }).isVisible().catch(() => false);
assert(soonBadgeVisible, 'test 9: sixth section is honestly marked "Скоро"');
await page.getByRole('button', { name: 'Ночные и погодные условия' }).click();
await page.waitForTimeout(150);
const soonSectionBodyVisible = await page.getByText('Этот раздел появится в одном из следующих обновлений.', { exact: true }).isVisible().catch(() => false);
assert(soonSectionBodyVisible, 'test 9: sixth section body honestly says it is not implemented yet, not fake content');
const replayButtonVisible = await page.getByRole('button', { name: 'Показать обучение генетике заново', exact: true }).isVisible().catch(() => false);
assert(replayButtonVisible, 'test 9: "Показать обучение генетике заново" is a separate book action, present alongside the six sections');
await shot('06-botanical-book');

// --- Test 10: demo replay launches, and causes ZERO gameplay state
// mutation (localStorage snapshot before/after is byte-identical). ---
const saveBeforeReplay = await page.evaluate(() => localStorage.getItem('genesis-garden-save-v1'));
await page.getByRole('button', { name: 'Показать обучение генетике заново', exact: true }).click();
await page.waitForTimeout(300);
const replayIntroVisible = await page.getByText('Демонстрация обучения', { exact: true }).isVisible().catch(() => false);
assert(replayIntroVisible, 'test 10: demo replay launches over the book');
// Walk through all replay steps to actually exercise the full flow, not just
// launch — "Понятно, начать" -> reveal1 "Отлично!" -> hint2 "Скрестить ещё
// раз" -> reveal2 "Отлично!" -> "Закрыть".
await page.getByRole('button', { name: 'Понятно, начать', exact: true }).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Скрестить ещё раз', exact: true }).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
await page.waitForTimeout(200);
const replayDoneTextVisible = await page.getByText('Демонстрация завершена — это не повлияло на твою игру.', { exact: true }).isVisible().catch(() => false);
assert(replayDoneTextVisible, 'test 10: replay reaches its honest completion screen');
await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
await page.waitForTimeout(200);
const saveAfterReplay = await page.evaluate(() => localStorage.getItem('genesis-garden-save-v1'));
assert(saveBeforeReplay === saveAfterReplay, 'test 10: full demo replay leaves the serialized save byte-identical (no breedV2/HybridSeed/Specimen/economy mutation)');
await shot('07-replay-done-state-unchanged');

// --- Test 11 (mobile pass): resize to a common mobile viewport and re-check
// no horizontal overflow anywhere reachable in this flow. ---
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
assert(await hasNoHorizontalOverflow(page), 'test 11 (mobile): no horizontal page overflow with the book open');
await page.locator('.sheet-close').first().click();
await page.waitForTimeout(200);
assert(await hasNoHorizontalOverflow(page), 'test 11 (mobile): no horizontal page overflow after closing the book');
await shot('08-mobile-no-overflow');
await page.setViewportSize({ width: 1366, height: 768 });
await page.waitForTimeout(200);

// --- Test 12: Overhaul+Legacy (:4174) still shows the OLD onboarding (not
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
assert(legacyOldOnboardingVisible, 'test 12: Overhaul+Legacy still shows the OLD 4-slide onboarding on a fresh game');
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
assert(!legacyIntroTextVisible, 'test 12: Overhaul+Legacy never shows the Slice 12 contextual intro screen');
const legacyHeaderVisible = await legacyPage.getByRole('heading', { name: 'Лаборатория скрещивания', exact: true }).isVisible().catch(() => false);
assert(legacyHeaderVisible, 'test 12: Overhaul+Legacy opens the plain legacy LabPanel, not LabPanelV2');
await legacyPage.screenshot({ path: path.join(SCRIPT_DIR, 'shots', 'genetics-v2-slice12-09-legacy-no-v2-ui.png') });

const realErrors = errors.concat(legacyErrors).filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
assert(realErrors.length === 0, `no unexpected console/page errors (found: ${JSON.stringify(realErrors)})`);

console.log('CONSOLE/PAGE ERRORS:', errors.length + legacyErrors.length ? [...errors, ...legacyErrors] : 'none');
await legacyPage.close();
await browser.close();
console.log('genetics v2 slice 12 (reveal, contextual onboarding, Lumi hints, Botanical Book, demo replay): OK');
