// ============================================================================
// Этап 10 — "новый игрок, полный путь" (сценарий 1 из 5 критических из
// мастер-промта). В отличие от test-e2e.mjs/test-e2e-genetics.mjs (которые
// проверяют отдельные механики), этот скрипт проходит онбординг ДО КОНЦА
// (не пропуская) и заявляет цель ("Цели"), а не только сажает/собирает/
// скрещивает — закрывает конкретный пробел Этапа 9: панель "Цели" и полный
// онбординг раньше не были покрыты никаким e2e.
//
// Сценарии 2–5 из мастер-промта (миграция старого локального пользователя,
// двойная трата подарка, sandbox-чекаут без дублирования entitlement,
// отклонение подделанных клиентом запросов сервером) требуют настоящего
// живого Supabase-проекта (GoTrue auth, реальные HTTP RPC) — в песочнице
// разработки его нет. Эти четыре сценария полностью покрыты РЕАЛЬНЫМИ
// тестами на уровне, где эта защита фактически реализована — SQL/RPC на
// локальном Postgres-стенде (supabase/tests/02_scenario_tests.sql,
// 04_social_tests.sql, 05_payments_tests.sql) — см. docs/TESTING.md за
// точным сопоставлением сценарий → тест → файл:строка.
// ============================================================================

import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const URL = process.argv[2] || 'http://localhost:4173/genesis-garden/';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

async function screenshot(name) {
  await page.screenshot({ path: path.join(SCRIPT_DIR, 'shots', `nu_${name}.png`) });
}

function fail(msg) {
  throw new Error('FAIL: ' + msg);
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 5000 });
await page.waitForTimeout(1500);

// --- 1. Онбординг проходится ДО КОНЦА, не пропускается ---
const onboardingVisible = await page.locator('.onboarding-backdrop').isVisible().catch(() => false);
if (!onboardingVisible) fail('онбординг не показался новому игроку (свежий localStorage)');
await screenshot('01_onboarding_step1');

let clicks = 0;
while ((await page.locator('.onboarding-backdrop').isVisible().catch(() => false)) && clicks < 10) {
  await page.locator('.onboarding-next').click();
  await page.waitForTimeout(150);
  clicks += 1;
}
if (clicks < 2) fail(`ожидалось несколько шагов онбординга, прошли только ${clicks}`);
if (await page.locator('.onboarding-backdrop').isVisible().catch(() => false)) {
  fail('онбординг не закрылся после прохождения всех шагов');
}
console.log(`Онбординг пройден полностью (${clicks} шагов).`);
await screenshot('02_onboarding_done');

// game.input.enabled должен снова быть true после закрытия онбординга —
// иначе игрок не сможет взаимодействовать с садом (регрессия Этапа 9 fix).
const coinsAfterOnboarding = await page.locator('.hud-coins').innerText();
if (coinsAfterOnboarding.trim() !== '50') {
  fail(`после честного прохождения онбординга монеты должны остаться 50, получили ${coinsAfterOnboarding}`);
}

// --- 2. HUD показывает кнопку "Цели" первой и без маячка (ничего не готово) ---
const firstHudBtn = await page.locator('.hud-btn').first().innerText();
if (!firstHudBtn.includes('Цели')) fail(`первая кнопка HUD должна быть "Цели", получили "${firstHudBtn}"`);
const badgeBefore = await page.locator('.hud-btn-badge').count();
if (badgeBefore !== 0) fail('маячок на кнопке "Цели" не должен появляться, пока ни одна цель не выполнена');

// --- 3. Посадить первое семя (квест "Первая посадка") ---
const canvasBox = await page.locator('canvas').boundingBox();
await page.mouse.click(canvasBox.x + 56, canvasBox.y + 227);
await page.waitForTimeout(300);
const sheetVisible = await page.locator('.sheet').isVisible().catch(() => false);
if (!sheetVisible) fail('плантпикер не открылся по клику на пустую грядку');
await page.locator('.sheet-row-clickable').first().click();
await page.waitForTimeout(300);
await screenshot('03_planted');

// Квест "Первая посадка" должен стать выполненным — маячок появляется.
const badgeAfterPlant = await page.locator('.hud-btn-badge').count();
if (badgeAfterPlant !== 1) fail('после первой посадки маячок "Цели" должен появиться (квест выполнен)');

// --- 4. Забрать награду за посадку в панели "Цели" ---
await page.locator('.hud-btn', { hasText: 'Цели' }).click();
await page.waitForTimeout(300);
const coinsBeforeClaim = Number((await page.locator('.hud-coins span').textContent()).trim());
const claimButtons = page.locator('.quest-claim-btn');
if ((await claimButtons.count()) < 1) fail('не найдена кнопка "Забрать" для выполненного квеста "Первая посадка"');
await claimButtons.first().click();
await page.waitForTimeout(300);
const coinsAfterClaim = Number((await page.locator('.hud-coins span').textContent()).trim());
if (coinsAfterClaim - coinsBeforeClaim !== 5) {
  fail(`награда за "Первая посадка" должна быть +5 монет, получили +${coinsAfterClaim - coinsBeforeClaim}`);
}
await screenshot('04_quest_claimed');
await page.locator('.sheet-close').click();
await page.waitForTimeout(200);

// --- 5. Купить семя в магазине ---
const coinsBeforeBuy = coinsAfterClaim;
await page.locator('.hud-btn', { hasText: 'Магазин' }).click();
await page.waitForTimeout(300);
await page.locator('.sheet-buy-btn').first().click();
await page.waitForTimeout(300);
await page.locator('.sheet-close').click();
const coinsAfterBuy = Number((await page.locator('.hud-coins span').textContent()).trim());
if (coinsAfterBuy >= coinsBeforeBuy) fail('покупка семени должна списать монеты');

// --- 6. Скрестить двух стартовых особей в лаборатории ---
await page.locator('.hud-btn', { hasText: 'Лаборатория' }).click();
await page.waitForTimeout(300);
const specimenCards = await page.locator('.specimen-card').all();
if (specimenCards.length < 2) fail(`ожидалось минимум 2 особи для скрещивания, найдено ${specimenCards.length}`);
await specimenCards[0].click();
await specimenCards[1].click();
await page.locator('.lab-footer .sheet-buy-btn').click();
await page.waitForTimeout(700);
const rarityVisible = await page.locator('.lab-reveal-rarity').isVisible().catch(() => false);
if (!rarityVisible) fail('результат скрещивания (редкость) не отобразился');
await screenshot('05_bred');
await page.locator('.lab-reveal-btn').first().click();
await page.waitForTimeout(200);
await page.locator('.sheet-close').click();

// --- 7. Перезагрузка — весь прогресс должен пережить reload ---
const coinsBeforeReload = await page.locator('.hud-coins').innerText();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
// Онбординг НЕ должен показаться повторно.
if (await page.locator('.onboarding-backdrop').isVisible().catch(() => false)) {
  fail('онбординг показался повторно после reload — localStorage-флаг не сохранился');
}
const coinsAfterReload = await page.locator('.hud-coins').innerText();
if (coinsAfterReload !== coinsBeforeReload) {
  fail(`монеты не пережили reload: было ${coinsBeforeReload}, стало ${coinsAfterReload}`);
}
await page.locator('.hud-btn', { hasText: 'Альбом' }).click();
await page.waitForTimeout(300);
const albumCount = await page.locator('.album-card').count();
if (albumCount !== 3) fail(`после скрещивания в альбоме должно быть 3 особи, получили ${albumCount}`);
await screenshot('06_after_reload');

const realErrors = errors.filter((e) => !e.includes('ERR_TUNNEL_CONNECTION_FAILED'));
if (realErrors.length) fail(`page errors: ${realErrors.join(', ')}`);

console.log(
  'new-user journey e2e: OK — онбординг пройден, квест "Первая посадка" забран (+5), покупка/скрещивание отработали,',
  'весь прогресс пережил reload (монеты:', coinsAfterReload, ', альбом:', albumCount, 'особей).'
);

await browser.close();
