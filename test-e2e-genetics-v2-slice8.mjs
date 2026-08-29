import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Genetics V2 — Slice 8 dedicated smoke test (Overhaul+V2 build only, same
// :4175 build as test-e2e-genetics-v2.mjs — see CLAUDE.md for the
// VITE_VISUAL_OVERHAUL_ENABLED=true VITE_DIPLOID_GENETICS_ENABLED=true build
// command). Covers the 12 required steps for Lab L2 / the first-hybrid
// grant / Колокольник gating / the minimal microscope (contract §4.11).
// Step 12 was extended in the Slice 9 pass (contract §4.12): it originally
// asserted that an inter-species pair stayed "still locked" after L2 — Slice
// 9 supersedes that, so step 12 now covers the exact insufficient-pollen
// text/disabled-button state, then a successful inter-species breed (with
// the Seed Parent's speciesId/parentIds order verified), then the original
// same-species Колокольник check, unweakened. Does NOT re-exercise Slice 5-7
// breeding-UI plumbing (already covered by test-e2e-genetics-v2.mjs) — the
// growing V2 hybrid and, later, two Колокольник specimens are injected
// directly via localStorage time-travel, the same established technique
// test-e2e-genetics-v2.mjs (tray-full test) and
// test-e2e-genetics-v2-legacy-isolation.mjs already use for save states that
// are impractical to reach purely through UI flow (breeding a same-species
// Колокольник pair first requires two existing Колокольник specimens, which
// is exactly the chicken-and-egg the gate exists to prevent before Lab L2).
//
// Does NOT duplicate the pure-logic/store-level coverage already in
// labV2.test.ts / microscopeV2.test.ts / store.labV2.test.ts /
// store.microscopeV2.test.ts — this only checks that the real rendered UI
// wiring (ShopPanelV2/AlbumPanelV2/MicroscopePanel/LabPanelV2) is correct.

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
  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', `genetics-v2-slice8-${name}.png`) });
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
// Same hand-computed legacy projection as test-e2e-genetics-v2-legacy-isolation.mjs
// for this exact homozygous fixture (primary_honey/secondary_forest, solid
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

// Growing V2 hybrid on plot 0 — species 1 (Солнечник, never gated), with
// exactly two heterozygous loci (stemForm/leafForm) so the microscope steps
// below have a known, deterministic hidden allele to assert on. Not ready to
// harvest yet (plantedAt: now) — step 2 fast-forwards it.
const growingGenome = fixtureGenomeV2(1, {
  stemForm: { a: 'stem_standard', b: 'stem_climbing' }, // expressed stem_standard, hidden "Вьющийся"
  leafForm: { a: 'leaf_standard', b: 'leaf_broad' }, // expressed leaf_standard, hidden "Широкая"
});

function buildSave() {
  const plots = Array.from({ length: 24 }, (_, i) => ({ id: i, unlocked: i < 6, seedId: null, plantedAt: null }));
  plots[0] = {
    ...plots[0],
    hybridV2: {
      phase: 'growing',
      hybrid: {
        id: 'hybrid-1',
        genomeV2: growingGenome,
        parentIds: ['seed-a', 'seed-b'],
        createdAt: 0,
        plantedAt: Date.now(), // not ready — species 1 first growth is 5 min
        plotId: 0,
      },
    },
  };
  return {
    version: 4,
    coins: 100,
    plots,
    inventory: {},
    // 'spare-1' — a throwaway V2 specimen so step 1's "no Микроскоп button
    // before L2" check has a real card to look at (not just an empty album),
    // and so step 6 has something to recycle for dust.
    specimens: [{ id: 'spare-1', genome: legacyProjectionFor(fixtureGenomeV2(1)), genomeV2: fixtureGenomeV2(1), createdAt: 1 }],
    geneticDust: 0,
    pityCounter: 0,
    questProgress: {},
    questsClaimed: [],
    entitlements: [],
    pollen: 0,
    labLevel: 1,
    nurseryTray: [],
    firstBreedFreeClaimed: true, // irrelevant to Slice 8 — kept true so step 12's breed isn't also exercising the free-first-breed path
    firstHybridRewardClaimed: false,
    firstRecycleTopUpClaimed: false,
  };
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 8000 });
await page.waitForTimeout(1000);
await dismissOnboarding();

await writeSave(buildSave());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();
await shot('00-loaded-lab-l1');

// --- Step 1: before unlock — Lab L1, microscope unavailable, Колокольник
// locked with the exact required text (contract §4.11.2). ---
await page.getByRole('button', { name: 'Магазин' }).click();
await page.waitForTimeout(300);
const sproutRow = page.locator('.sheet-row', { has: page.getByText('Росток', { exact: true }) });
const commonRow = page.locator('.sheet-row', { has: page.getByText('Обычный цветок', { exact: true }) });
assert(await sproutRow.locator('.sheet-row-sub').innerText().then((t) => !t.includes('пока недоступен')), 'Солнечник (Росток) seed row is NOT locked before Lab L2');
const lockedTextVisible = await commonRow
  .getByText('Этот вид пока недоступен — вырасти своего первого гибрида, чтобы открыть его', { exact: true })
  .isVisible()
  .catch(() => false);
assert(lockedTextVisible, 'Колокольник (Обычный цветок) shop row shows the exact required locked text before Lab L2');
const commonBuyDisabled = await commonRow.locator('.sheet-buy-btn').isDisabled();
assert(commonBuyDisabled, 'Колокольник buy button is disabled before Lab L2');
await shot('01-shop-kolokolnik-locked');
await page.locator('.sheet-close').click();
await page.waitForTimeout(200);

await page.getByRole('button', { name: 'Альбом' }).click();
await page.waitForTimeout(300);
const albumCardsPre = await page.locator('.album-card').count();
assert(albumCardsPre === 1, `album shows the one spare V2 specimen before unlock (got ${albumCardsPre})`);
const microscopeButtonsPre = await page.getByRole('button', { name: 'Микроскоп' }).count();
assert(microscopeButtonsPre === 0, 'no "Микроскоп" button anywhere in the album before Lab L2');
await page.locator('.sheet-close').click();
await page.waitForTimeout(200);

// --- Step 2: grow and collect the first hybrid, for the first time. ---
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('genesis-garden-save-v1'));
  const plot = state.plots.find((p) => p.hybridV2 && p.hybridV2.phase === 'growing');
  plot.hybridV2.hybrid.plantedAt = Date.now() - (5 * 60 * 1000 + 5000); // species 1: 5 min first growth
  localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();

const canvasBox = await page.locator('canvas').boundingBox();
async function worldToScreen(worldX, worldY) {
  const debug = await page.evaluate(() => window.__overhaulDebug?.getEstateState());
  if (!debug) throw new Error('window.__overhaulDebug not available — EstateScene debug hook missing');
  return { x: canvasBox.x + (worldX - debug.cameraScrollX), y: canvasBox.y + (worldY - debug.cameraScrollY) };
}
const plot0World = { x: 780, y: 732 }; // worldConfig.PLOT_SLOTS[0], same constant test-e2e-genetics-v2.mjs uses
const plot0Screen = await worldToScreen(plot0World.x, plot0World.y);
await page.mouse.click(plot0Screen.x, plot0Screen.y);
await page.waitForTimeout(500);
await shot('02-first-hybrid-collected');

// --- Step 3: firstHybridRewardClaimed=true, labLevel>=2, normal pollen +
// exactly 8 bonus (contract §4.11.1). Species 1 base pollen is 2, Common
// rarity (no mutation) bonus 0 -> 2+8=10. ---
const afterHarvest = await readSave();
assert(afterHarvest.firstHybridRewardClaimed === true, 'firstHybridRewardClaimed flipped to true on first collection');
assert(afterHarvest.labLevel >= 2, `labLevel opened to >=2 (got ${afterHarvest.labLevel})`);
assert(afterHarvest.pollen === 10, `pollen = normal reward (2) + exactly 8 bonus (got ${afterHarvest.pollen})`);
const harvestedSpecimen = afterHarvest.specimens.find((s) => s.id !== 'spare-1');
assert(!!harvestedSpecimen && !!harvestedSpecimen.genomeV2, 'harvest created the new Specimen with genomeV2');

// --- Step 4: Колокольник and the microscope become available. ---
await page.getByRole('button', { name: 'Магазин' }).click();
await page.waitForTimeout(300);
const commonRowAfter = page.locator('.sheet-row', { has: page.getByText('Обычный цветок', { exact: true }) });
const lockedTextGoneAfter = await commonRowAfter
  .getByText('Этот вид пока недоступен', { exact: false })
  .isVisible()
  .catch(() => false);
assert(!lockedTextGoneAfter, 'Колокольник shop row no longer shows the locked text after Lab L2');
await commonRowAfter.locator('.sheet-buy-btn').click();
await page.waitForTimeout(300);
const afterBuyKolokolnik = await readSave();
assert((afterBuyKolokolnik.inventory.common ?? 0) === 1, 'buying Колокольник succeeds after Lab L2 (buySeedV2)');
await page.locator('.sheet-close').click();
await page.waitForTimeout(200);

await page.getByRole('button', { name: 'Альбом' }).click();
await page.waitForTimeout(300);
const microscopeButtonsAfter = await page.getByRole('button', { name: 'Микроскоп' }).count();
assert(microscopeButtonsAfter >= 1, 'at least one "Микроскоп" button available in the album after Lab L2');

// --- Step 5: before any reveal, the hidden allele value appears nowhere,
// and the extended-card status line matches the exact required format
// (fix-pass, unified visibility contract): "[Категория]: видно —
// [выраженный], скрыто — Не исследован". ---
// Open the microscope on the freshly harvested specimen — it's the newest
// card, sorted first (favorites-first, then newest-first).
await page.locator('.album-card').first().getByRole('button', { name: 'Микроскоп' }).click();
await page.waitForTimeout(300);
const microscopeTitleVisible = await page.getByRole('heading', { name: 'Микроскоп' }).isVisible().catch(() => false);
assert(microscopeTitleVisible, 'MicroscopePanel opened with the exact title "Микроскоп"');
const promptVisible = await page.getByText('Выбери скрытый признак', { exact: true }).isVisible().catch(() => false);
assert(promptVisible, 'exact selection prompt "Выбери скрытый признак" shown');
const hiddenValueLeakedBefore = await page.getByText('Вьющийся', { exact: true }).isVisible().catch(() => false);
assert(!hiddenValueLeakedBefore, 'hidden allele value ("Вьющийся") is NOT shown anywhere before payment');
const dominanceLeakedBefore = await page.getByText('доминирует', { exact: false }).isVisible().catch(() => false);
assert(!dominanceLeakedBefore, 'no dominance line ("доминирует") is shown anywhere before any reveal');
// "Не исследован" is now embedded inside the full status-line sentence
// ("Категория: видно — X, скрыто — Не исследован"), not a standalone
// element — count status lines containing it directly, rather than an
// exact-text match that would no longer find anything.
const statusLineTextsBefore = await page.locator('.sheet-row-count').allInnerTexts();
const unresearchedCountBefore = statusLineTextsBefore.filter((t) => t.includes('Не исследован')).length;
assert(unresearchedCountBefore === 2, `both heterozygous loci show "Не исследован" before any reveal (got ${unresearchedCountBefore})`);
const stemStatusLineBefore = await page
  .getByText('Стебель: видно — Обычный, скрыто — Не исследован', { exact: true })
  .isVisible()
  .catch(() => false);
assert(stemStatusLineBefore, 'before payment, the status line contains the exact expressed allele + "Не исследован" ("Стебель: видно — Обычный, скрыто — Не исследован")');
const revealButtonsBefore = await page.getByRole('button', { name: 'Раскрыть за 3 пыли' }).count();
assert(revealButtonsBefore === 2, `exactly two reveal buttons before any reveal (got ${revealButtonsBefore})`);
await shot('03-microscope-before-reveal');
// MicroscopePanel is rendered as a DOM sibling AFTER AlbumPanelV2's own
// backdrop (see AlbumPanelV2.tsx) — .last() is the microscope's own close
// button, closing only it and leaving the album open underneath.
await page.locator('.sheet-close').last().click();
await page.waitForTimeout(200);

// --- Step 6: recycle to get at least 3 dust — recycle the spare specimen
// (first-ever recycle of this save, tops up to at least 3 regardless of
// rarity, same rule as Slice 7). ---
const albumCardsBeforeRecycle = await page.locator('.album-card').count();
assert(albumCardsBeforeRecycle === 2, `album shows both specimens before recycling the spare (got ${albumCardsBeforeRecycle})`);
await page.locator('.album-card').last().getByRole('button', { name: 'Переработать' }).click();
await page.waitForTimeout(200);
await page.getByText('Да, переработать').click();
await page.waitForTimeout(300);
const afterRecycle = await readSave();
assert(afterRecycle.geneticDust >= 3, `recycling the spare specimen granted at least 3 dust (got ${afterRecycle.geneticDust})`);
const dustBeforeReveal = afterRecycle.geneticDust;

// --- Step 7/8: select the specimen and an available hidden trait, pay
// exactly 3 dust, see "Признак раскрыт". ---
await page.locator('.album-card').first().getByRole('button', { name: 'Микроскоп' }).click();
await page.waitForTimeout(300);
const stemRow = page.locator('.sheet-row', { has: page.getByText('Стебель', { exact: true }) });
await stemRow.getByRole('button', { name: 'Раскрыть за 3 пыли' }).click();
await page.waitForTimeout(300);
const successNoticeVisible = await page.getByText('Признак раскрыт', { exact: true }).isVisible().catch(() => false);
assert(successNoticeVisible, 'exact success text "Признак раскрыт" shown after reveal');
const afterReveal = await readSave();
assert(afterReveal.geneticDust === dustBeforeReveal - 3, `exactly 3 dust deducted (before=${dustBeforeReveal}, after=${afterReveal.geneticDust})`);

// --- Step 9: exact revealed value shown, "Не исследован" for the rest,
// exact status/dominance/source lines (fix-pass, unified visibility
// contract) — all three as SEPARATE elements, not one joined string. ---
// "Вьющийся" now legitimately appears in TWO separate elements within this
// row (the status line AND the dominance line) — .first() avoids a
// strict-mode violation on the ambiguous locator (which .catch(() => false)
// would otherwise silently swallow as "not visible").
const revealedValueVisible = await stemRow.getByText('Вьющийся', { exact: false }).first().isVisible().catch(() => false);
assert(revealedValueVisible, 'exact revealed hidden allele value ("Вьющийся") shown for the revealed locus');
const revealedStatusLineVisible = await stemRow
  .getByText('Стебель: видно — Обычный, скрыто — Вьющийся', { exact: true })
  .isVisible()
  .catch(() => false);
assert(revealedStatusLineVisible, 'after payment, the status line contains both the expressed and hidden allele ("Стебель: видно — Обычный, скрыто — Вьющийся")');
const dominanceLineVisible = await stemRow
  .getByText('Обычный доминирует над Вьющийся', { exact: true })
  .isVisible()
  .catch(() => false);
assert(dominanceLineVisible, 'exact dominance line shown ("Обычный доминирует над Вьющийся")');
const revealedSourceVisible = await stemRow.getByText('Раскрыт микроскопом', { exact: true }).isVisible().catch(() => false);
assert(revealedSourceVisible, 'revealed row shows the microscope source as a separate exact element ("Раскрыт микроскопом")');
const leafRow = page.locator('.sheet-row', { has: page.getByText('Форма листвы', { exact: true }) });
const leafStatusLineText = await leafRow.locator('.sheet-row-count').innerText();
const leafStillUnresearched = leafStatusLineText.includes('Не исследован');
assert(leafStillUnresearched, 'the other heterozygous locus ("Форма листвы") still shows "Не исследован"');
const revealButtonsAfter = await page.getByRole('button', { name: 'Раскрыть за 3 пыли' }).count();
assert(revealButtonsAfter === 1, `exactly one reveal button remains (the other locus) after revealing one (got ${revealButtonsAfter})`);
await shot('04-microscope-after-reveal');
await page.locator('.sheet-close').last().click(); // microscope first (DOM-last sibling)
await page.locator('.sheet-close').first().click(); // then the album underneath
await page.waitForTimeout(200);

// --- Step 10: reload the page and confirm persistence. ---
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();
await page.getByRole('button', { name: 'Альбом' }).click();
await page.waitForTimeout(300);
await page.locator('.album-card').first().getByRole('button', { name: 'Микроскоп' }).click();
await page.waitForTimeout(300);
const stemRowAfterReload = page.locator('.sheet-row', { has: page.getByText('Стебель', { exact: true }) });
const revealedSurvivedReload = await stemRowAfterReload.getByText('Вьющийся', { exact: false }).first().isVisible().catch(() => false);
assert(revealedSurvivedReload, 'the revealed locus survived a full page reload (persistent forever for this specimen)');

// --- Step 11: re-revealing the same trait is impossible, dust not deducted
// again. ---
const stemRevealButtonGone = (await stemRowAfterReload.getByRole('button', { name: 'Раскрыть за 3 пыли' }).count()) === 0;
assert(stemRevealButtonGone, 'no reveal button remains for the already-revealed locus (cannot pay for it again)');
const dustAfterReload = (await readSave()).geneticDust;
assert(dustAfterReload === afterReveal.geneticDust, 'dust unchanged by the reload/re-open (no repeated deduction)');
await page.locator('.sheet-close').last().click(); // microscope first (DOM-last sibling)
await page.locator('.sheet-close').first().click(); // then the album underneath
await page.waitForTimeout(200);

// --- Step 11.5 (fix-pass, bug 2): favorite does NOT block the microscope.
// The harvested specimen still has one unrevealed locus (leafForm/"Форма
// листвы") — favorite it, confirm the "Микроскоп" button is still there and
// clickable, reveal the remaining locus successfully, then confirm favorite
// survived the operation unchanged. The earlier stemForm reveal (step 7/8)
// already spent the exact 3-dust first-recycle top-up down to 0 — top up
// dust again here via the same established localStorage-injection technique
// already used elsewhere in this file, purely as test setup for this one
// additional reveal (not something the reveal operation itself grants).
await page.evaluate((cost) => {
  const state = JSON.parse(localStorage.getItem('genesis-garden-save-v1'));
  state.geneticDust += cost;
  localStorage.setItem('genesis-garden-save-v1', JSON.stringify(state));
}, 3);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();
await page.getByRole('button', { name: 'Альбом' }).click();
await page.waitForTimeout(300);
const harvestedCard = page.locator('.album-card').first();
await harvestedCard.locator('.album-card-favorite').click();
await page.waitForTimeout(200);
const favoriteAfterToggle = await readSave();
const harvestedIdForFavorite = favoriteAfterToggle.specimens.find((s) => s.id !== 'spare-1' && s.id !== 'kolo-1' && s.id !== 'kolo-2')?.id;
const favoriteFlagSet = favoriteAfterToggle.specimens.find((s) => s.id === harvestedIdForFavorite)?.favorite === true;
assert(favoriteFlagSet, 'specimen is favorited (setup for the favorite/microscope isolation check)');
const recycleHiddenForFavorite = await harvestedCard.getByText('В избранном — сними звезду, чтобы переработать', { exact: true }).isVisible().catch(() => false);
assert(recycleHiddenForFavorite, 'favorited card blocks recycling with the expected message (unchanged behaviour)');
const microscopeButtonOnFavorite = await harvestedCard.getByRole('button', { name: 'Микроскоп' }).isVisible().catch(() => false);
assert(microscopeButtonOnFavorite, 'favorite-specimen keeps access to the "Микроскоп" button (fix-pass bug 2 — favorite no longer hides it)');
await harvestedCard.getByRole('button', { name: 'Микроскоп' }).click();
await page.waitForTimeout(300);
const leafRowForFavorite = page.locator('.sheet-row', { has: page.getByText('Форма листвы', { exact: true }) });
await leafRowForFavorite.getByRole('button', { name: 'Раскрыть за 3 пыли' }).click();
await page.waitForTimeout(300);
const favoriteRevealSucceeded = await page.getByText('Признак раскрыт', { exact: true }).isVisible().catch(() => false);
assert(favoriteRevealSucceeded, 'reveal succeeds normally for a favorited specimen (labLevel>=2, enough dust, locus available)');
await page.locator('.sheet-close').last().click(); // microscope first (DOM-last sibling)
await page.waitForTimeout(200);
const stateAfterFavoriteReveal = await readSave();
const stillFavorite = stateAfterFavoriteReveal.specimens.find((s) => s.id === harvestedIdForFavorite)?.favorite === true;
assert(stillFavorite, 'favorite remains true after a successful reveal (the microscope operation does not touch it)');
await page.locator('.sheet-close').first().click(); // close the album
await page.waitForTimeout(200);

// --- Step 12: inter-species pair is now ALLOWED after L2 (Slice 9, contract
// §4.12 — supersedes the Slice 8-era "still locked" behavior) — plus,
// alongside it, confirm a same-species Колокольник pair is still allowed too
// (contract §4.11.2, unchanged). Two Колокольник specimens injected directly
// (breeding one normally first requires an existing pair — exactly the
// chicken-and-egg the gate exists to prevent pre-L2). Pollen intentionally
// stays at 10 (its value since step 3) for the first assertion below —
// exactly enough to prove the interspecies pair's insufficient-pollen path
// before it's topped up for the two real breeds that follow. ---
{
  const state = await readSave();
  const koloGenome = fixtureGenomeV2(2);
  state.specimens.push(
    { id: 'kolo-1', genome: legacyProjectionFor(koloGenome), genomeV2: koloGenome, createdAt: 100 },
    { id: 'kolo-2', genome: legacyProjectionFor(koloGenome), genomeV2: koloGenome, createdAt: 101 }
  );
  await writeSave(state);
}
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();
await page.getByRole('button', { name: 'Лаборатория' }).click();
await page.waitForTimeout(300);
const specimenCards = page.locator('.specimen-card');
const specimenCardCount = await specimenCards.count();
assert(specimenCardCount === 3, `lab shows all 3 V2-eligible specimens (Солнечник + 2 Колокольник, got ${specimenCardCount})`);
// Cards render in specimens[] order: [harvested Солнечник, kolo-1, kolo-2].
await specimenCards.nth(0).click();
await specimenCards.nth(1).click();
await page.waitForTimeout(200);
const firstParentLabelVisible = await page.getByText('Первый родитель', { exact: true }).isVisible().catch(() => false);
assert(firstParentLabelVisible, 'inter-species selection shows the "Первый родитель" (Seed Parent) slot label (Slice 9)');
const secondParentLabelVisible = await page.getByText('Второй родитель', { exact: true }).isVisible().catch(() => false);
assert(secondParentLabelVisible, 'inter-species selection shows the "Второй родитель" (Pollen Parent) slot label (Slice 9)');
const interspeciesInsufficientTextVisible = await page
  .getByText('Не хватает пыльцы: нужно 12, есть 10', { exact: true })
  .isVisible()
  .catch(() => false);
assert(interspeciesInsufficientTextVisible, 'inter-species (Солнечник x Колокольник) pair shows the exact insufficient-pollen text (нужно 12, есть 10) before top-up');
const breedBtnDisabledInsufficient = await page.locator('.sheet-buy-btn', { hasText: 'Скрестить' }).isDisabled();
assert(breedBtnDisabledInsufficient, '"Скрестить" button disabled while pollen (10) is below the inter-species cost (12)');

// Top up pollen to exactly cover both remaining breeds this step performs:
// 12 (inter-species) + 8 (same-species Колокольник, after) = 20.
{
  const state = await readSave();
  state.pollen = 20;
  await writeSave(state);
}
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await dismissOnboarding();
await page.getByRole('button', { name: 'Лаборатория' }).click();
await page.waitForTimeout(300);
await specimenCards.nth(0).click();
await specimenCards.nth(1).click();
await page.waitForTimeout(200);
const interspeciesCostVisible = await page.getByText('Стоимость: 12 пыльцы', { exact: true }).isVisible().catch(() => false);
assert(interspeciesCostVisible, 'inter-species pair shows the exact "Стоимость: 12 пыльцы" text once pollen is sufficient');
const breedBtnEnabledInterspecies = await page.locator('.sheet-buy-btn', { hasText: 'Скрестить' }).isEnabled();
assert(breedBtnEnabledInterspecies, '"Скрестить" button enabled for the inter-species pair now that pollen covers the cost');

const stateBeforeInterspeciesBreed = await readSave();
await page.locator('.sheet-buy-btn', { hasText: 'Скрестить' }).click();
await page.waitForTimeout(300);
// Genetics V2 — Slice 12: a successful breed now shows the fullscreen
// Reveal screen first — close it ("Отлично!") to get back to the lab notice.
await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
await page.waitForTimeout(300);
const interspeciesBredNoticeVisible = await page.getByText(/Гибридное семя появилось/).isVisible().catch(() => false);
assert(interspeciesBredNoticeVisible, 'inter-species Солнечник x Колокольник pair breeds successfully after Lab L2 (Slice 9)');
const stateAfterInterspeciesBreed = await readSave();
assert(
  stateAfterInterspeciesBreed.nurseryTray.length === stateBeforeInterspeciesBreed.nurseryTray.length + 1,
  'the inter-species breed added exactly one hybrid seed to the Nursery Tray'
);
assert(stateAfterInterspeciesBreed.pollen === 8, `inter-species breed deducted exactly 12 pollen (20 -> 8, got ${stateAfterInterspeciesBreed.pollen})`);
const interspeciesSeed = stateAfterInterspeciesBreed.nurseryTray[stateAfterInterspeciesBreed.nurseryTray.length - 1];
assert(interspeciesSeed.genomeV2.speciesId === 1, `inter-species hybrid seed speciesId equals the Seed Parent (Солнечник, id=1) — Slice 9 contract §4.12 (got ${interspeciesSeed.genomeV2.speciesId})`);
assert(
  interspeciesSeed.parentIds[0] === harvestedIdForFavorite && interspeciesSeed.parentIds[1] === 'kolo-1',
  'parentIds preserved as [seedParentId, pollenParentId] for the inter-species pair'
);
await shot('05-interspecies-breed');

// Reselect: kolo-1 (index 1) + kolo-2 (index 2) -> same-species Колокольник
// pair, still allowed after L2 (contract §4.11.2, unchanged by Slice 9).
await specimenCards.nth(1).click();
await specimenCards.nth(2).click();
await page.waitForTimeout(200);
const sameSpeciesCostVisible = await page.getByText('Стоимость: 8 пыльцы', { exact: true }).isVisible().catch(() => false);
assert(sameSpeciesCostVisible, 'same-species Колокольник pair shows the exact "Стоимость: 8 пыльцы" text');
const stateBeforeSameSpeciesBreed = await readSave();
await page.locator('.sheet-buy-btn', { hasText: 'Скрестить' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Отлично!', exact: true }).first().click();
await page.waitForTimeout(300);
const bredNoticeVisible = await page.getByText(/Гибридное семя появилось/).isVisible().catch(() => false);
assert(bredNoticeVisible, 'same-species Колокольник x Колокольник pair breeds successfully after Lab L2');
const stateAfterSameSpeciesBreed = await readSave();
assert(
  stateAfterSameSpeciesBreed.nurseryTray.length === stateBeforeSameSpeciesBreed.nurseryTray.length + 1,
  'the same-species Колокольник breed added exactly one hybrid seed to the Nursery Tray'
);
assert(stateAfterSameSpeciesBreed.pollen === 0, `same-species breed deducted exactly 8 pollen (8 -> 0, got ${stateAfterSameSpeciesBreed.pollen})`);
await shot('06-kolokolnik-same-species-breed');
await page.locator('.sheet-close').click();
await page.waitForTimeout(200);

const realErrors = errors.filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
assert(realErrors.length === 0, `no unexpected console/page errors (found: ${JSON.stringify(realErrors)})`);

console.log('CONSOLE/PAGE ERRORS:', errors.length ? errors : 'none');
await browser.close();
console.log('genetics v2 Slice 8 (Lab L2 + microscope) e2e: OK');
