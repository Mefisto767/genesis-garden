import type { Entitlement, GameState, Plot, PlotHybridV2, Specimen } from './types';
import { MAX_PLOTS, START_UNLOCKED_PLOTS } from './types';
import { getSeedDef } from './seedCatalog';
import { breed, randomGenome, type BreedResult, type GeneLock } from './genetics';
import {
  ensureGenomeV2Sidecars,
  type GenomeV2LocusKey,
  type HybridSeedV2,
  type NaturalRevealResultV2,
} from './geneticsV2';
import { validateSupportedParentsV2, type BreedRejectionReasonV2 } from './inheritanceV2';
import { breedV2 } from './mutationV2';
import { breedCostV2, pollenRewardV2 } from './pollenV2';
import { grownRecycleDustV2, nurseryRecycleDustV2, firstRecycleTopUpV2 } from './recyclingV2';
import { GARDEN_CONFIG, BREEDING_CONFIG, STARTING_STATE_CONFIG } from './config';
import { activeGrowthBoostPercent, effectiveElapsedMs } from './entitlements';
import { advanceQuestProgress, canClaimQuest, QUEST_CATALOG } from './quests';
import { NURSERY_TRAY_CAPACITY, hybridGrowthStatusV2, regrowStatusV2, type GrowthStatusV2 } from './nurseryV2';
import { projectGenomeV2ToLegacy } from './legacyProjectionV2';
import { FIRST_HYBRID_POLLEN_GRANT, LAB_LEVEL_2, isSpeciesUnlockedV2 } from './labV2';
import { availableLociForRevealV2, MICROSCOPE_REVEAL_COST } from './microscopeV2';
import { resolveExtendedCard } from './phenotypeV2';
import type { RngFn } from './rng';
import { defaultRng, mulberry32 } from './rng';
import {
  secondTutorialLessonAvailable,
  shouldSeedTutorialStartersV2,
  tutorialBreedRngSeed,
  tutorialSunflowerPollenGenomeV2,
  tutorialSunflowerSeedGenomeV2,
} from './tutorialV2';
import { computeNaturalRevealsV2 } from './revealV2';
import type { LumiHintKeyV2 } from './lumiHintsV2';
import type { MutationTierV2 } from './rarityV2';

const SAVE_KEY = 'genesis-garden-save-v1';
const SAVE_VERSION = 4;

/**
 * Миграция `pityCounter` при переходе save V3->V4 (Genetics V2 Slice 1,
 * docs/GENETICS_TARGET_DELTA.md §6.3): `clamp(floor(existingPityCounter),0,9)`.
 * Чистая функция — экспортирована отдельно для прямого unit-теста на
 * граничных значениях (отрицательное/0/дробное/5/9/10/15), без обхода
 * через loadState()/localStorage.
 */
export function migratePityCounter(existingPityCounter: number): number {
  const floored = Math.floor(existingPityCounter);
  return Math.min(9, Math.max(0, floored));
}

/**
 * Критерий «save с историей скрещиваний» (Genetics V2 Slice 1,
 * docs/GENETICS_TARGET_DELTA.md §7 п.6) — хотя бы одно из трёх условий,
 * проверенных на состоянии save ДО миграции. Экспортирована отдельно для
 * прямого unit-теста на каждое условие в изоляции.
 */
export function hasBreedingHistory(state: {
  specimens?: unknown[];
  pityCounter?: number;
  geneticDust?: number;
}): boolean {
  const specimensCount = Array.isArray(state.specimens) ? state.specimens.length : 0;
  const pityCounter = typeof state.pityCounter === 'number' ? state.pityCounter : 0;
  const geneticDust = typeof state.geneticDust === 'number' ? state.geneticDust : 0;
  return specimensCount > 2 || pityCounter > 0 || geneticDust > 0;
}

function unlockCost(plotId: number): number {
  // Растёт с каждым следующим участком за пределами стартовых шести.
  const extraIndex = plotId - START_UNLOCKED_PLOTS; // 0-based среди платных
  return GARDEN_CONFIG.unlockCostBase + extraIndex * GARDEN_CONFIG.unlockCostStep;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `spec_${Date.now().toString(36)}_${idCounter}`;
}

function createInitialState(rng: RngFn): GameState {
  const plots: Plot[] = [];
  for (let i = 0; i < MAX_PLOTS; i++) {
    plots.push({
      id: i,
      unlocked: i < START_UNLOCKED_PLOTS,
      seedId: null,
      plantedAt: null,
    });
  }
  // Два стартовых экземпляра с геномом — чтобы можно было сразу пойти
  // в лабораторию и скрестить первую пару, не грея кнопки вслепую.
  const starterSpecimensRaw: Specimen[] = Array.from(
    { length: STARTING_STATE_CONFIG.startingSpecimenCount },
    () => ({ id: nextId(), genome: randomGenome(rng), createdAt: Date.now() })
  );
  // Новый save получает genomeV2 sidecar сразу для стартовых specimens
  // (Genetics V2 Slice 1, миграционная матрица docs/GENETICS_TARGET_DELTA.md
  // §7.1, строка «Новый») — тем же самым идемпотентным backfill-механизмом,
  // который используется для загрузки существующих save (см. loadState
  // ниже), не отдельной параллельной веткой кода.
  const starterSpecimens = ensureGenomeV2Sidecars(starterSpecimensRaw);
  return {
    coins: STARTING_STATE_CONFIG.startingCoins,
    plots,
    inventory: { sprout: STARTING_STATE_CONFIG.startingSprouts }, // стартовые бесплатные семена для первого сбора
    specimens: starterSpecimens,
    geneticDust: 0,
    pityCounter: 0,
    questProgress: {},
    questsClaimed: [],
    entitlements: [],
    // Genetics V2 Slice 1 — честные дефолты нового игрока (delta doc §7 п.8).
    pollen: 0,
    labLevel: 1,
    nurseryTray: [],
    firstBreedFreeClaimed: false,
    firstHybridRewardClaimed: false,
    firstRecycleTopUpClaimed: false,
    // Genetics V2 Slice 12 — честные дефолты нового игрока (аддитивные,
    // без бампа SAVE_VERSION — см. types.ts).
    geneticsTutorialStartersSeeded: false,
    geneticsTutorialBreedsCompleted: 0,
    geneticsIntroSeen: false,
    lumiHintsShown: [],
  };
}

/**
 * Результат загрузки save (Genetics V2 Slice 1 fix-pass —
 * docs/GENETICS_TARGET_DELTA.md §7.2 дополнено этим проходом контрактом
 * «мигрированное состояние персистится сразу, без ожидания игрового
 * действия»). `needsPersist` говорит вызывающей стороне (конструктору
 * `GameStore`), нужно ли немедленно записать `state` обратно в storage —
 * true ровно тогда, когда load() реально что-то изменил относительно того,
 * что физически лежит на диске (глобальная V3→V4 миграция версии и/или
 * backfill хотя бы одного отсутствовавшего `genomeV2` sidecar), false для
 * обычной загрузки уже полностью актуального save и для случая «нет save
 * вовсе / save повреждён» (создание новой игры не форсирует лишнюю запись
 * до первого реального игрового действия — это не регрессия, этот путь не
 * входит в описанный дефект).
 */
function loadState(
  rng: RngFn,
  storage: StorageLike | null
): { state: GameState; needsPersist: boolean; isBrandNewSave: boolean } {
  try {
    const raw = storage?.getItem(SAVE_KEY);
    if (!raw) return { state: createInitialState(rng), needsPersist: false, isBrandNewSave: true };
    const parsed = JSON.parse(raw) as GameState & { version?: number };
    if (!parsed.plots || !Array.isArray(parsed.plots) || typeof parsed.coins !== 'number') {
      return { state: createInitialState(rng), needsPersist: false, isBrandNewSave: false };
    }
    // Миграции без потери прогресса игрока — каждая версия добавляет только
    // недостающие поля, никогда не удаляет и не обнуляет существующие.
    const version = parsed.version ?? 1;
    if (version < 2) {
      if (!Array.isArray(parsed.specimens)) {
        parsed.specimens = Array.from({ length: STARTING_STATE_CONFIG.startingSpecimenCount }, () => ({
          id: nextId(),
          genome: randomGenome(rng),
          createdAt: Date.now(),
        }));
      }
      if (typeof parsed.geneticDust !== 'number') parsed.geneticDust = 0;
      if (typeof parsed.pityCounter !== 'number') parsed.pityCounter = 0;
    }
    if (version < 3) {
      if (!parsed.questProgress || typeof parsed.questProgress !== 'object') parsed.questProgress = {};
      if (!Array.isArray(parsed.questsClaimed)) parsed.questsClaimed = [];
      if (!Array.isArray(parsed.entitlements)) parsed.entitlements = [];
    }
    // Genetics V2 Slice 1 — глобальная миграция save-уровневых полей
    // (docs/GENETICS_TARGET_DELTA.md §7/§7.2, механизм 1). Запускается РОВНО
    // ОДИН РАЗ, только при version<4 — критерий «история скрещиваний»
    // считается по состоянию save ДО этой миграции (§7 п.6), не после.
    // Не трогает coins/plots/inventory/geneticDust/квесты/entitlements/legacy
    // genome ни одного specimen (§7.2) — эта миграция касается ровно шести
    // новых save-уровневых полей ниже.
    if (version < 4) {
      const hasHistory = hasBreedingHistory(parsed);
      if (typeof parsed.pollen !== 'number') parsed.pollen = hasHistory ? 24 : 0;
      if (typeof parsed.labLevel !== 'number') parsed.labLevel = hasHistory ? 3 : 1;
      if (!Array.isArray(parsed.nurseryTray)) parsed.nurseryTray = [];
      if (typeof parsed.firstBreedFreeClaimed !== 'boolean') parsed.firstBreedFreeClaimed = hasHistory;
      if (typeof parsed.firstHybridRewardClaimed !== 'boolean') parsed.firstHybridRewardClaimed = hasHistory;
      if (typeof parsed.firstRecycleTopUpClaimed !== 'boolean') parsed.firstRecycleTopUpClaimed = hasHistory;
      parsed.pityCounter = migratePityCounter(
        typeof parsed.pityCounter === 'number' ? parsed.pityCounter : 0
      );
    }
    // Genetics V2 Slice 1 — ensureGenomeV2Sidecars (механизм 2, §7.2).
    // Запускается БЕЗУСЛОВНО на КАЖДОЙ загрузке, независимо от SAVE_VERSION —
    // после глобальной миграции выше (порядок обязателен, §7.2), чтобы
    // и новый V4-специмен, и любой legacy-specimen без sidecar (включая
    // сценарий V2->Legacy breed->V2, §7.2) гарантированно получили genomeV2
    // за один проход загрузки. Идемпотентно: specimen с уже существующим
    // genomeV2 не трогается вообще — `ensureGenomeV2Sidecars` возвращает тот
    // же самый объект по ссылке для такого specimen (см. geneticsV2.ts), что
    // и используется ниже для честного обнаружения «а backfill вообще что-то
    // сделал в этот раз?», без отдельного параллельного учёта.
    let sidecarsCreated = false;
    if (Array.isArray(parsed.specimens)) {
      const beforeSpecimens = parsed.specimens;
      const migratedSpecimens = ensureGenomeV2Sidecars(beforeSpecimens);
      sidecarsCreated = migratedSpecimens.some((specimen, i) => specimen !== beforeSpecimens[i]);
      parsed.specimens = migratedSpecimens;
    }

    // Fix-pass (defect report): персистить нужно ровно тогда, когда load()
    // реально изменил save относительно диска — версия была ниже текущей
    // (V3→V4 и любая более старая, п.1), или backfill создал хотя бы один
    // ранее отсутствовавший sidecar на уже-V4 save (п.2). Обычная загрузка
    // полностью актуального V4-save (все specimens уже с genomeV2) не
    // форсирует запись (п.3).
    const needsPersist = version < SAVE_VERSION || sidecarsCreated;

    // Fix-pass (defect report, п.4): версия самого возвращаемого
    // (в памяти) состояния тоже должна стать актуальной сразу же — раньше
    // здесь бампилось только то, что летит в persist()'е при следующем
    // emit(), а getState() сразу после `new GameStore()` всё ещё видел
    // старую version. Нормализация ничего не пишет в storage сама по себе —
    // запись решает только needsPersist выше.
    parsed.version = SAVE_VERSION;

    return { state: parsed, needsPersist, isBrandNewSave: false };
  } catch {
    return { state: createInitialState(rng), needsPersist: false, isBrandNewSave: false };
  }
}

type Listener = () => void;

export const BREED_COST = BREEDING_CONFIG.breedCost; // монет за попытку скрещивания
export const DUST_REWARD_MIN = BREEDING_CONFIG.dustRewardMin;
export const DUST_REWARD_MAX = BREEDING_CONFIG.dustRewardMax;

export interface BreedOutcome {
  specimen: Specimen;
  result: BreedResult;
  dustGained: number;
  /** Сколько пыли ушло на блокировку гена в этом скрещивании (0, если lock не передавался). */
  dustSpentOnLock: number;
}

export type { GeneLock } from './genetics';

export interface PlotStatus {
  ready: boolean;
  /** 0..1, время роста с учётом ускорителей. */
  progress: number;
  /** Остаток времени в мс с учётом ускорителей (0 если уже готово). */
  remainingMs: number;
  growMs: number;
}

// ----------------------------------------------------------------------------
// Genetics V2 — Slice 5 (Nursery Tray, рост, постоянные растения).
// docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.8.
// ----------------------------------------------------------------------------

/** Причины отказа `breedNurseryV2` (contract §4.8.7, расширено §4.9.3 —
 * Slice 6 добавляет `insufficient_pollen`) — store-level причины плюс
 * прозрачно прокинутая причина Slice 3-4 species-валидации
 * (`unsupported_species`), не переопределяя и не заменяя её.
 * `interspecies_locked` удалена этим типом со Slice 9 (contract §4.12) —
 * поддерживаемые межвидовые пары (1×2/2×1) больше не отклоняются. */
export type BreedNurseryV2RejectionReason =
  | 'same_parent'
  | 'parent_not_found'
  | 'parent_missing_genome_v2'
  // Slice 8 (contract §4.11.2): либо родитель — Колокольник, а Lab L2 ещё не
  // открыт. Проверяется ДО nursery_tray_full и species-валидации Slice 3-4
  // (см. breedNurseryV2 ниже) — запрещённый по лабу вид никогда не
  // маскируется переполненным треем или неподдерживаемой парой.
  | 'species_locked'
  | 'nursery_tray_full'
  | BreedRejectionReasonV2
  | 'insufficient_pollen';

export interface BreedNurseryV2Success {
  ok: true;
  hybridSeed: HybridSeedV2;
  mutated: boolean;
  /** Genetics V2 — Slice 12 (contract §4.14): тир мутации, если она
   * произошла — нужен UI ("Почему получилось так?") для описания тира
   * человеческим языком, без дублирования вызова `rarityOfV2`/`breedV2`. */
  mutationTier: MutationTierV2 | null;
  nextPityCounter: number;
}

/**
 * `insufficient_pollen` несёт точные значения (contract §4.9.3 п.6) — не
 * просто причину строкой, чтобы UI мог показать дословный текст «Не хватает
 * пыльцы: нужно N, есть M» без повторного пересчёта стоимости на своей
 * стороне.
 */
export type BreedNurseryV2Failure =
  | { ok: false; reason: Exclude<BreedNurseryV2RejectionReason, 'insufficient_pollen'> }
  | { ok: false; reason: 'insufficient_pollen'; requiredPollen: number; availablePollen: number };

export type BreedNurseryV2Result = BreedNurseryV2Success | BreedNurseryV2Failure;

/** Причины отказа `plantHybridSeedV2` (contract §4.8.2). */
export type PlantHybridV2RejectionReason = 'seed_not_found' | 'plot_not_found' | 'plot_locked' | 'plot_occupied';

export type PlantHybridV2Result = { ok: true } | { ok: false; reason: PlantHybridV2RejectionReason };

/** Статус роста/повторного цикла `Plot.hybridV2`, единая точка правды для UI
 * и `harvestHybridV2` (тот же принцип, что `PlotStatus`/`plotStatus()` выше). */
export type HybridPlotStatusV2 = GrowthStatusV2 & { phase: 'growing' | 'mature' };

// ----------------------------------------------------------------------------
// Genetics V2 — Slice 7 (переработка HybridSeed/Specimen в генетическую
// пыль). Contract §4.10.
// ----------------------------------------------------------------------------

/** Причина отказа `recycleNurserySeedV2` (contract §4.10.2) — единственная,
 * потому что посаженный растущий гибрид уже физически не в `nurseryTray`
 * (см. `plantHybridSeedV2`) и эта операция его не видит вообще. */
export type RecycleNurserySeedV2RejectionReason = 'seed_not_found';

export interface RecycleV2Success {
  ok: true;
  baseDust: number;
  topUpDust: number;
  dustGained: number;
}

export type RecycleNurserySeedV2Result =
  | RecycleV2Success
  | { ok: false; reason: RecycleNurserySeedV2RejectionReason };

/** Причины отказа `recycleSpecimenV2` (contract §4.10.3). */
export type RecycleSpecimenV2RejectionReason =
  | 'specimen_not_found'
  | 'missing_genome_v2'
  | 'favorite'
  | 'ambiguous_plot_reference';

export type RecycleSpecimenV2Result =
  | RecycleV2Success
  | { ok: false; reason: RecycleSpecimenV2RejectionReason };

// ----------------------------------------------------------------------------
// Genetics V2 — Slice 8 (Lab L2 + минимальный микроскоп). Contract §4.11.
// Отдельные V2-обёртки над legacy `buySeed()`/`plantSeed()` (contract
// §4.11.2 — "не менять общие legacy ShopPanel/PlantPicker/buySeed/plantSeed
// так, чтобы изменилось Classic/Overhaul+Legacy поведение"): каждая
// добавляет РОВНО ОДНУ дополнительную проверку — `isSpeciesUnlockedV2` — ДО
// вызова немодифицированного legacy-метода, никак иначе не меняя его
// семантику/побочные эффекты/атомарность.
// ----------------------------------------------------------------------------

export type BuySeedV2RejectionReason = 'seed_not_found' | 'species_locked' | 'insufficient_coins';
export type BuySeedV2Result = { ok: true } | { ok: false; reason: BuySeedV2RejectionReason };

export type PlantSeedV2RejectionReason = 'species_locked' | 'rejected';
export type PlantSeedV2Result = { ok: true } | { ok: false; reason: PlantSeedV2RejectionReason };

/** Причины отказа `revealHiddenLocusV2` (contract §4.11.3) — ровно порядок
 * проверок задания: Lab L2 открыт → specimen существует → есть `genomeV2` →
 * признак реально доступен → минимум 3 пыли. */
export type RevealHiddenLocusV2RejectionReason =
  | 'lab_locked'
  | 'specimen_not_found'
  | 'missing_genome_v2'
  | 'locus_not_available'
  | 'insufficient_dust';

export interface RevealHiddenLocusV2Success {
  ok: true;
  locus: GenomeV2LocusKey;
  /** Точное значение раскрытого скрытого аллеля (raw ID) — UI переводит в
   * русское название через `alleleLabelV2` (hybridCardViewModel.ts). */
  revealedAllele: string;
  dustSpent: number;
}

export type RevealHiddenLocusV2Result =
  | RevealHiddenLocusV2Success
  | { ok: false; reason: Exclude<RevealHiddenLocusV2RejectionReason, 'insufficient_dust'> }
  | { ok: false; reason: 'insufficient_dust'; requiredDust: number; availableDust: number };

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function safeStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export interface GameStoreOptions {
  /** Источник случайности — по умолчанию Math.random, тесты передают seeded rng. */
  rng?: RngFn;
  /** Отключить чтение/запись localStorage (для unit-тестов и SSR). */
  disablePersistence?: boolean;
  /** Готовое начальное состояние — тесты могут задать конкретный сценарий. */
  initialState?: GameState;
}

export class GameStore {
  private state: GameState;
  private listeners = new Set<Listener>();
  private rng: RngFn;
  private storage: StorageLike | null;
  /**
   * Genetics V2 — Slice 12 (contract §4.14.2, refinement of this
   * implementation pass): true ONLY when this GameStore was constructed with
   * literally no save present in storage at all (a genuinely brand-new
   * browser/game) — NOT merely "shape happens to look untouched" (2
   * specimens, no history), which `shouldSeedTutorialStartersV2` alone
   * cannot distinguish from an older fixture/test save that intentionally
   * mimics a fresh state to test unrelated mechanics (e.g.
   * test-e2e-genetics-v2.mjs's version:3 two-specimen fixture). `false` for
   * a corrupted/unparseable save too (conservative — it existed, it just
   * couldn't be read). `initialState` (test harness, direct construction)
   * counts as brand-new only in the sense that it bypassed storage entirely;
   * UI code (`OverhaulApp.tsx`) is the only reader of this flag, deciding
   * whether to call `seedGeneticsTutorialV2()` on mount — the store method
   * itself is NOT gated by this (store tests call it directly, unaffected).
   */
  private readonly brandNewSave: boolean;

  constructor(options: GameStoreOptions = {}) {
    this.rng = options.rng ?? defaultRng;
    this.storage = options.disablePersistence ? null : safeStorage();
    if (options.initialState) {
      // Тесты передают готовый сценарий напрямую — loadState()/persist() не
      // участвуют, это не проход через storage вообще.
      this.state = options.initialState;
      this.brandNewSave = false;
      return;
    }
    const loaded = loadState(this.rng, this.storage);
    this.state = loaded.state;
    this.brandNewSave = loaded.isBrandNewSave;
    // Fix-pass (defect report): V3→V4-миграция и/или backfill отсутствовавших
    // genomeV2 sidecars, случившиеся при загрузке, должны сразу лечь на диск
    // — не ждать первого игрового действия, вызывающего emit(). persist()
    // сама решает, есть ли вообще storage, и сама глотает ошибку
    // storage.setItem() (переполнение квоты/приватный режим) — падение записи
    // здесь не откатывает this.state и не запускает createInitialState():
    // мигрированное состояние остаётся корректным в памяти, просто не
    // записанным на этот раз (defect report п.5).
    if (loaded.needsPersist) {
      this.persist();
    }
  }

  getState(): GameState {
    return this.state;
  }

  /** Genetics V2 — Slice 12: see `brandNewSave` field doc comment above. */
  isBrandNewGameV2(): boolean {
    return this.brandNewSave;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.persist();
    this.listeners.forEach((l) => l());
  }

  private persist() {
    if (!this.storage) return;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify({ ...this.state, version: SAVE_VERSION }));
    } catch {
      // localStorage может быть недоступен (приватный режим) — не роняем игру.
    }
  }

  unlockCostFor(plotId: number): number {
    return unlockCost(plotId);
  }

  /** Статус роста грядки с учётом активных ускорителей (Этап 7). Единая
   * точка правды — используется и в GameStore.harvest(), и в GardenScene,
   * чтобы UI и фактическое начисление никогда не расходились. */
  plotStatus(plot: Plot, now: number = Date.now()): PlotStatus | null {
    if (!plot.seedId || plot.plantedAt === null) return null;
    const def = getSeedDef(plot.seedId);
    if (!def) return null;
    const boost = activeGrowthBoostPercent(this.state.entitlements, now);
    const realElapsed = Math.max(0, now - plot.plantedAt);
    const elapsed = effectiveElapsedMs(realElapsed, boost);
    const ready = elapsed >= def.growMs;
    return {
      ready,
      progress: Math.min(1, elapsed / def.growMs),
      remainingMs: Math.max(0, def.growMs - elapsed),
      growMs: def.growMs,
    };
  }

  buySeed(seedId: string, qty = 1): boolean {
    const def = getSeedDef(seedId);
    if (!def) return false;
    const totalCost = def.buyCost * qty;
    if (this.state.coins < totalCost) return false;
    this.state = {
      ...this.state,
      coins: this.state.coins - totalCost,
      inventory: {
        ...this.state.inventory,
        [seedId]: (this.state.inventory[seedId] ?? 0) + qty,
      },
    };
    this.emit();
    return true;
  }

  /**
   * Genetics V2 — Slice 8 (contract §4.11.2): V2-обёртка над `buySeed()` для
   * Overhaul+V2 UI (`ShopPanelV2`) — добавляет ровно одну проверку
   * (`isSpeciesUnlockedV2`) ДО вызова немодифицированного `buySeed()` выше.
   * `buySeed()` сам не меняется и продолжает использоваться Classic/
   * Overhaul+Legacy (`ShopPanel`) без единого отличия в поведении. Отказ по
   * `species_locked` — полный no-op, `buySeed()` не вызывается вообще, ни
   * монеты, ни инвентарь не трогаются.
   */
  buySeedV2(seedId: string, qty = 1): BuySeedV2Result {
    const def = getSeedDef(seedId);
    if (!def) return { ok: false, reason: 'seed_not_found' };
    if (!isSpeciesUnlockedV2(def.speciesId, this.state.labLevel)) {
      return { ok: false, reason: 'species_locked' };
    }
    return this.buySeed(seedId, qty) ? { ok: true } : { ok: false, reason: 'insufficient_coins' };
  }

  unlockPlot(plotId: number): boolean {
    const plot = this.state.plots.find((p) => p.id === plotId);
    if (!plot || plot.unlocked) return false;
    const cost = unlockCost(plotId);
    if (this.state.coins < cost) return false;
    this.state = {
      ...this.state,
      coins: this.state.coins - cost,
      plots: this.state.plots.map((p) => (p.id === plotId ? { ...p, unlocked: true } : p)),
    };
    this.emit();
    return true;
  }

  plantSeed(plotId: number, seedId: string): boolean {
    const plot = this.state.plots.find((p) => p.id === plotId);
    const owned = this.state.inventory[seedId] ?? 0;
    // Genetics V2 Slice 5 — mutual-exclusion invariant (contract §4.8.1):
    // `hybridV2` (в любой фазе) и legacy-посадка никогда не сосуществуют на
    // одной грядке. `plot.hybridV2` всегда `undefined`/`null` вне V2-пути
    // (Classic/Overhaul+Legacy), поэтому это НЕ меняет поведение для них.
    if (!plot || !plot.unlocked || plot.seedId !== null || plot.hybridV2 != null) return false;
    if (owned <= 0) return false;
    this.state = {
      ...this.state,
      inventory: { ...this.state.inventory, [seedId]: owned - 1 },
      plots: this.state.plots.map((p) =>
        p.id === plotId ? { ...p, seedId, plantedAt: Date.now() } : p
      ),
      questProgress: advanceQuestProgress(this.state.questProgress, 'plant'),
    };
    this.emit();
    return true;
  }

  /**
   * Genetics V2 — Slice 8 (contract §4.11.2): V2-обёртка над `plantSeed()`
   * для Overhaul+V2 UI (`PlantPickerV2`) — добавляет ровно одну проверку
   * (`isSpeciesUnlockedV2`) ДО вызова немодифицированного `plantSeed()`
   * выше. `plantSeed()` сам не меняется и продолжает использоваться Classic/
   * Overhaul+Legacy (`PlantPicker`) без единого отличия в поведении.
   * Покрывает и обычный магазинный посев уже лежащего в инвентаре семени
   * Колокольника (редкий путь — возможен только если семя туда попало до
   * открытия Lab L2, например через legacy-миграцию) — отказ по
   * `species_locked` — полный no-op, `plantSeed()` не вызывается вообще.
   */
  plantSeedV2(plotId: number, seedId: string): PlantSeedV2Result {
    const def = getSeedDef(seedId);
    if (def && !isSpeciesUnlockedV2(def.speciesId, this.state.labLevel)) {
      return { ok: false, reason: 'species_locked' };
    }
    return this.plantSeed(plotId, seedId) ? { ok: true } : { ok: false, reason: 'rejected' };
  }

  /**
   * Идемпотентно относительно повторного вызова на одной и той же грядке:
   * второй вызов harvest() для уже собранной грядки не проходит проверку
   * `plot.seedId` и не начисляет награду второй раз — это гарантия «повторный
   * запрос одной операции не начисляет награду второй раз» из мастер-промта
   * (реальная server-side идемпотентность по request_id — Этап 3).
   */
  harvest(plotId: number, now: number = Date.now()): boolean {
    const plot = this.state.plots.find((p) => p.id === plotId);
    if (!plot || !plot.seedId || plot.plantedAt === null) return false;
    const def = getSeedDef(plot.seedId);
    if (!def) return false;
    const status = this.plotStatus(plot, now);
    if (!status || !status.ready) return false; // ещё не созрело — сервер в будущем перепроверит это же условие
    this.state = {
      ...this.state,
      coins: this.state.coins + def.sellValue,
      plots: this.state.plots.map((p) =>
        p.id === plotId ? { ...p, seedId: null, plantedAt: null } : p
      ),
      questProgress: advanceQuestProgress(this.state.questProgress, 'harvest'),
    };
    this.emit();
    return true;
  }

  /**
   * Скрещивание двух экземпляров из коллекции. Родители не расходуются
   * (питомник, не единственная копия) — так проще для MVP; экономику
   * (кулдауны/расход) можно добавить на Этапе 4 без переделки движка генов.
   *
   * `lock` (Этап 5) — потратить `BREEDING_CONFIG.dustCostPerLockedGene` пыли,
   * чтобы зафиксировать один наследуемый ген от выбранного родителя без
   * шанса на мутацию именно этого гена (см. genetics.ts `GeneLock`). Если
   * пыли не хватает — скрещивание не проводится вообще (null), деньги/пыль
   * не списываются частично.
   */
  breedSpecimens(idA: string, idB: string, lock?: GeneLock): BreedOutcome | null {
    if (idA === idB) return null;
    const a = this.state.specimens.find((s) => s.id === idA);
    const b = this.state.specimens.find((s) => s.id === idB);
    if (!a || !b) return null;
    if (this.state.coins < BREED_COST) return null;
    const lockCost = lock ? BREEDING_CONFIG.dustCostPerLockedGene : 0;
    if (this.state.geneticDust < lockCost) return null;

    const result = breed(a.genome, b.genome, this.state.pityCounter, this.rng, lock);
    const dustGained =
      DUST_REWARD_MIN + Math.floor(this.rng() * (DUST_REWARD_MAX - DUST_REWARD_MIN + 1));
    const specimen: Specimen = { id: nextId(), genome: result.genome, createdAt: Date.now() };

    this.state = {
      ...this.state,
      coins: this.state.coins - BREED_COST,
      geneticDust: this.state.geneticDust + dustGained - lockCost,
      pityCounter: result.nextPityCounter,
      specimens: [...this.state.specimens, specimen],
      questProgress: advanceQuestProgress(this.state.questProgress, 'breed'),
    };
    this.emit();
    return { specimen, result, dustGained, dustSpentOnLock: lockCost };
  }

  /**
   * Переработка лишнего специмена в генетическую пыль (Этап 5) — заменяет
   * прежнюю продажу за монеты (`sellSpecimenValue`), чтобы совпасть с уже
   * реализованной на сервере `recycle_plant()` (см. docs/ECONOMY.md,
   * раздел «Сознательное расхождение: recycle vs sell» — расхождение
   * устранено этим изменением). Возвращает количество полученной пыли,
   * null если специмена не существует, или 'favorite' если специмен в
   * избранном (защита от случайной переработки — нужно сперва снять звезду).
   */
  recycleSpecimen(id: string): number | null | 'favorite' {
    const specimen = this.state.specimens.find((s) => s.id === id);
    if (!specimen) return null;
    if (specimen.favorite) return 'favorite';
    // Genetics V2 Slice 5 — defensive guard, not requested by any single
    // decision but necessary to avoid a real data-corruption bug: a specimen
    // still referenced as the permanent plant on a Plot
    // (`Plot.hybridV2.specimenId`, contract §4.8.1/§4.8.4) must not be
    // removed by this unrelated legacy flat-rate mechanic — doing so would
    // leave that Plot's `hybridV2` reference dangling (the plot could never
    // progress or be collected again). Tiered nursery/grown-specimen
    // recycling itself is Slice 7 scope (not implemented here) — this guard
    // only protects the existing mechanic from corrupting V2 plot state.
    // From the caller's perspective this is indistinguishable from "not
    // found" (`null`), matching how AlbumPanel already treats other no-op
    // outcomes — no UI change needed.
    const onPlot = this.state.plots.some(
      (p) => p.hybridV2?.phase === 'mature' && p.hybridV2.specimenId === id
    );
    if (onPlot) return null;
    const dustGained = BREEDING_CONFIG.recycleDustReward;
    this.state = {
      ...this.state,
      geneticDust: this.state.geneticDust + dustGained,
      specimens: this.state.specimens.filter((s) => s.id !== id),
    };
    this.emit();
    return dustGained;
  }

  /** Переключить избранное у специмена (Этап 5) — чисто клиентский флаг, см. types.ts. */
  toggleFavorite(id: string): boolean {
    const specimen = this.state.specimens.find((s) => s.id === id);
    if (!specimen) return false;
    this.state = {
      ...this.state,
      specimens: this.state.specimens.map((s) => (s.id === id ? { ...s, favorite: !s.favorite } : s)),
    };
    this.emit();
    return true;
  }

  /** Идемпотентно: повторный claimQuest на уже забранный квест — no-op. */
  claimQuest(questId: string): boolean {
    if (!canClaimQuest(this.state, questId)) return false;
    const def = QUEST_CATALOG.find((q) => q.id === questId);
    if (!def) return false;
    this.state = {
      ...this.state,
      coins: this.state.coins + def.rewardCoins,
      geneticDust: this.state.geneticDust + def.rewardDust,
      questsClaimed: [...this.state.questsClaimed, questId],
    };
    this.emit();
    return true;
  }

  // --------------------------------------------------------------------
  // Genetics V2 — Slice 5 (Nursery Tray, рост, постоянные растения) +
  // Slice 6 (пыльца как ресурс + стоимость скрещивания). Persisted lifecycle
  // — docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.8; пыльцевая
  // экономика — §4.9. `breedNurseryV2`/`harvestHybridV2` теперь читают и
  // пишут `pollen`/`firstBreedFreeClaimed` (Slice 6, delta doc §0.8);
  // `coins`/`geneticDust`/`firstHybridRewardClaimed`/`firstRecycleTopUpClaimed`/
  // `labLevel` по-прежнему не читаются и не пишутся ни одним из методов
  // ниже — Slice 7/8 (delta doc §0.8 п.4).
  // --------------------------------------------------------------------

  /**
   * V2-скрещивание двух специменов из коллекции в `HybridSeedV2`,
   * помещаемый в Nursery Tray (не готовый `Specimen` — contract §4.8.7,
   * расширено §4.9.3 для пыльцевой экономики Slice 6). Все проверки ниже
   * выполняются строго по порядку, ДО вызова `breedV2` — при любом отказе на
   * шагах 1-7 `breedV2` не вызывается вообще: 0 RNG-вызовов,
   * `pollen`/`pityCounter`/`firstBreedFreeClaimed`/родители/`nurseryTray`/
   * остальной `GameState` не меняются ни на бит. Species-валидация
   * (`unsupported_species` — Slice 9, contract §4.12, снявший прежнюю
   * причину `interspecies_locked` для поддерживаемых пар 1×2/2×1)
   * выполняется здесь ЯВНО, шагом 6 — ДО денежной проверки (contract §4.9.3),
   * чтобы запрещённая пара никогда не маскировалась ошибкой недостатка
   * пыльцы; `breedV2` (Slice 3-4, без изменений) сам повторно проверяет то же
   * самое перед реальным наследованием/mutation RNG — не убирается, просто
   * становится избыточным defence-in-depth для этого пути.
   *
   * Genetics V2 — Slice 12 fix-pass (contract §4.14.14, owner review §1/§2/
   * §3/§4): this method no longer reveals ANYTHING about the resulting
   * genome/phenotype/rarity/mutation to the caller beyond the safe fact "a
   * hybrid seed exists" — the result's genome is still fully known
   * internally (unavoidable, `breedV2` computes it immediately), but Reveal
   * and natural-reveal-of-parents are both deferred to first maturity
   * (`harvestHybridV2` below), not applied here. Economics are also
   * corrected: only ever ONE free breed exists — the very first successful
   * V2 breed (`!firstBreedFreeClaimed`) — a tutorial pair's SECOND
   * (guaranteed) breed costs the normal `breedCostV2` same-species price
   * (8 pollen), same as any other post-first breed. Only the deterministic
   * RNG substitution (so the guaranteed outcome is reproducible) survives
   * from the original Slice 12 tutorial design — never a cost override.
   */
  breedNurseryV2(seedParentId: string, pollenParentId: string): BreedNurseryV2Result {
    // 1. Разные parent IDs.
    if (seedParentId === pollenParentId) return { ok: false, reason: 'same_parent' };
    // 2. Оба specimens существуют.
    const seedParent = this.state.specimens.find((s) => s.id === seedParentId);
    const pollenParent = this.state.specimens.find((s) => s.id === pollenParentId);
    if (!seedParent || !pollenParent) return { ok: false, reason: 'parent_not_found' };
    // 3. У обоих есть genomeV2.
    if (!seedParent.genomeV2 || !pollenParent.genomeV2) return { ok: false, reason: 'parent_missing_genome_v2' };
    // 4. Slice 8 (contract §4.11.2) — ни один родитель не Колокольник до
    //    открытия Lab L2. Проверяется раньше nursery_tray_full и
    //    unsupported_species (шаг 6), чтобы запрещённый по лабу вид никогда
    //    не маскировался переполненным треем или species-отказом.
    if (
      !isSpeciesUnlockedV2(seedParent.genomeV2.speciesId, this.state.labLevel) ||
      !isSpeciesUnlockedV2(pollenParent.genomeV2.speciesId, this.state.labLevel)
    ) {
      return { ok: false, reason: 'species_locked' };
    }
    // 5. Nursery Tray не заполнен.
    if (this.state.nurseryTray.length >= NURSERY_TRAY_CAPACITY) return { ok: false, reason: 'nursery_tray_full' };
    // 6. Чистая species-валидация без RNG — раньше денег, чтобы
    //    unsupported_species никогда не маскировался insufficient_pollen.
    //    Slice 9 (contract §4.12): пропускает 1×2/2×1 наравне с 1×1/2×2.
    const speciesValidation = validateSupportedParentsV2(
      seedParent.genomeV2.speciesId,
      pollenParent.genomeV2.speciesId
    );
    if (!speciesValidation.ok) return { ok: false, reason: speciesValidation.reason };

    // 7. Genetics V2 — Slice 12 fix-pass (contract §4.14.14): tutorial-seeded
    //    RNG for the two guaranteed tutorial breeds — deterministic
    //    `mulberry32` instead of `this.rng`, purely so the outcome is
    //    reproducible. The FIRST tutorial breed only needs both parents
    //    marked `tutorialStarter` and the counter still at 0. The SECOND
    //    tutorial breed additionally requires `secondTutorialLessonAvailable`
    //    (tutorialV2.ts, owner review §4) — i.e. the first lesson's own
    //    hybrid has matured AND its Reveal has been acknowledged — not just
    //    "counter is 1". Breeding the same two tutorial-starter specimens
    //    again before that gate is satisfied is still allowed, but is then a
    //    perfectly ordinary paid breed (normal `this.rng`, normal cost, no
    //    `tutorialBreedStep`) — never treated as "the" guaranteed lesson.
    const tutorialBreedsCompleted = this.state.geneticsTutorialBreedsCompleted ?? 0;
    const bothTutorialStarters = seedParent.tutorialStarter === true && pollenParent.tutorialStarter === true;
    const isFirstTutorialBreed = bothTutorialStarters && tutorialBreedsCompleted === 0;
    const isSecondTutorialBreed = bothTutorialStarters && secondTutorialLessonAvailable(this.state);
    const isTutorialBreed = isFirstTutorialBreed || isSecondTutorialBreed;
    const tutorialStep: 0 | 1 | undefined = isFirstTutorialBreed ? 0 : isSecondTutorialBreed ? 1 : undefined;
    const breedRng: RngFn = isTutorialBreed ? mulberry32(tutorialBreedRngSeed(tutorialStep as 0 | 1)) : this.rng;

    // 8. Genetics V2 — Slice 12 fix-pass (contract §4.14.14, owner review §3):
    //    ONLY the very first successful V2 breed is free — the tutorial
    //    pair's guaranteed second breed is a normal, paid breed at the usual
    //    same-species price (both tutorial starters are always the same
    //    species). `isTutorialBreed` no longer overrides cost at all — it
    //    only ever selects which RNG function to use (step 7 above).
    const cost = !this.state.firstBreedFreeClaimed
      ? 0
      : breedCostV2(seedParent.genomeV2.speciesId, pollenParent.genomeV2.speciesId);
    // 9. Проверка баланса пыльцы — ДО вызова breedV2, поэтому недостаток
    //    пыльцы (в т.ч. для гарантированного второго обучающего скрещивания)
    //    не потребляет ни один RNG-вызов, включая tutorial-seeded RNG выше
    //    (та переменная лишь ВЫБРАНА, ещё не использована ни разу).
    if (this.state.pollen < cost) {
      return { ok: false, reason: 'insufficient_pollen', requiredPollen: cost, availablePollen: this.state.pollen };
    }

    // 10. Вызов breedV2 — единственное место реального наследования/mutation RNG.
    const result = breedV2(seedParent.genomeV2, pollenParent.genomeV2, this.state.pityCounter, breedRng);
    if (!result.ok) return { ok: false, reason: result.reason };

    const hybridSeed: HybridSeedV2 = {
      id: nextId(),
      genomeV2: result.genomeV2,
      parentIds: [seedParentId, pollenParentId],
      createdAt: Date.now(),
      plantedAt: null,
      plotId: null,
      tutorialBreedStep: tutorialStep,
    };

    // 11. Genetics V2 — Slice 12 fix-pass (contract §4.14.14, owner review
    //     §1/§2): ONE atomic update — HybridSeed, pity, pollen,
    //     firstBreedFreeClaimed, tutorial counter. Deliberately does NOT
    //     touch `specimens` (parents' `revealedLoci` are untouched by breed —
    //     owner review §1: "breed не меняет revealedLoci родителей") and
    //     does NOT compute/return genome/phenotype/rarity/mutation/natural-
    //     reveal to the caller — that all happens at first maturity in
    //     `harvestHybridV2` below, not here.
    this.state = {
      ...this.state,
      nurseryTray: [...this.state.nurseryTray, hybridSeed],
      pityCounter: result.nextPityCounter,
      pollen: this.state.pollen - cost,
      firstBreedFreeClaimed: true,
      geneticsTutorialBreedsCompleted: isTutorialBreed
        ? Math.min(2, tutorialBreedsCompleted + 1)
        : tutorialBreedsCompleted,
    };
    this.emit();
    return {
      ok: true,
      hybridSeed,
      mutated: result.mutated,
      mutationTier: result.mutationTier,
      nextPityCounter: result.nextPityCounter,
    };
  }

  /**
   * Genetics V2 — Slice 12 (contract §4.14): одноразовый детерминированный
   * засев двух стартовых Солнечников контрактным tutorial-геномом
   * (`tutorialV2.ts` §4.6.1/§4.6.2) — заменяет их `genomeV2` (и
   * соответствующим образом спроецированный legacy `genome`, чтобы миниатюра
   * тоже совпадала) и помечает `tutorialStarter:true`. Строго одноразово —
   * `shouldSeedTutorialStartersV2` отказывает, если засев уже был выполнен
   * (`geneticsTutorialStartersSeeded`), если игрок уже успел скрестить/
   * накопить пыль/pity (честная защита ветеранских и просто не совсем новых
   * save — delta doc §12 Slice 12 "не применяй tutorial-fixtures... к
   * ветеранским save"), или если стартовых specimens не ровно два без
   * родословной. Вызывается один раз V2 UI-слоем (`OverhaulApp.tsx`) при
   * монтировании — сам store не завязан ни на один feature-флаг.
   */
  seedGeneticsTutorialV2(): boolean {
    if (!shouldSeedTutorialStartersV2(this.state)) return false;
    const [first, second] = this.state.specimens;
    if (!first || !second) return false;
    const seedGenome = tutorialSunflowerSeedGenomeV2();
    const pollenGenome = tutorialSunflowerPollenGenomeV2();
    const updatedFirst: Specimen = {
      ...first,
      genome: projectGenomeV2ToLegacy(seedGenome),
      genomeV2: seedGenome,
      tutorialStarter: true,
    };
    const updatedSecond: Specimen = {
      ...second,
      genome: projectGenomeV2ToLegacy(pollenGenome),
      genomeV2: pollenGenome,
      tutorialStarter: true,
    };
    this.state = {
      ...this.state,
      specimens: [updatedFirst, updatedSecond],
      geneticsTutorialStartersSeeded: true,
    };
    this.emit();
    return true;
  }

  /** Genetics V2 — Slice 12 (onboarding spec §3.1): первый контекстный экран
   * объяснения генетики закрыт кнопкой «Понятно, начать» — персистентно,
   * идемпотентно (повторный вызов — no-op, не эмитит лишний раз). */
  markGeneticsIntroSeenV2(): void {
    if (this.state.geneticsIntroSeen) return;
    this.state = { ...this.state, geneticsIntroSeen: true };
    this.emit();
  }

  /** Genetics V2 — Slice 12 (onboarding spec §7): одна событийная Люми-
   * подсказка показана и больше не должна повторяться — персистентно,
   * идемпотентно (повторная запись того же ключа не дублируется). */
  markLumiHintShownV2(key: LumiHintKeyV2): void {
    const shown = this.state.lumiHintsShown ?? [];
    if (shown.includes(key)) return;
    this.state = { ...this.state, lumiHintsShown: [...shown, key] };
    this.emit();
  }

  /**
   * Посадить `HybridSeedV2` из Nursery Tray на конкретную грядку (contract
   * §4.8.2). Неуспех — полный no-op: семя остаётся в трее, грядка не
   * меняется. Проверки строго по порядку.
   */
  plantHybridSeedV2(hybridId: string, plotId: number): PlantHybridV2Result {
    const seed = this.state.nurseryTray.find((h) => h.id === hybridId);
    if (!seed) return { ok: false, reason: 'seed_not_found' };
    const plot = this.state.plots.find((p) => p.id === plotId);
    if (!plot) return { ok: false, reason: 'plot_not_found' };
    if (!plot.unlocked) return { ok: false, reason: 'plot_locked' };
    if (plot.seedId !== null || plot.hybridV2 != null) return { ok: false, reason: 'plot_occupied' };

    const plantedAt = Date.now();
    const plantedSeed: HybridSeedV2 = { ...seed, plantedAt, plotId };
    const growing: PlotHybridV2 = { phase: 'growing', hybrid: plantedSeed };
    this.state = {
      ...this.state,
      nurseryTray: this.state.nurseryTray.filter((h) => h.id !== hybridId),
      plots: this.state.plots.map((p) => (p.id === plotId ? { ...p, hybridV2: growing } : p)),
    };
    this.emit();
    return { ok: true };
  }

  /** Статус роста (`growing`) или повторного цикла (`mature`) V2-гибрида на
   * грядке — единая точка правды для UI и `harvestHybridV2` (тот же принцип,
   * что `plotStatus()` выше). `null`, если на грядке нет V2-гибрида, или если
   * данные повреждены (mature-грядка ссылается на несуществующий specimen). */
  hybridPlotStatusV2(plot: Plot, now: number = Date.now()): HybridPlotStatusV2 | null {
    const hybridV2 = plot.hybridV2;
    if (!hybridV2) return null;
    if (hybridV2.phase === 'growing') {
      const status = hybridGrowthStatusV2(hybridV2.hybrid, now);
      return status ? { ...status, phase: 'growing' } : null;
    }
    const specimen = this.state.specimens.find((s) => s.id === hybridV2.specimenId);
    if (!specimen || !specimen.genomeV2) return null;
    const status = regrowStatusV2(specimen.genomeV2.speciesId, hybridV2.lastHarvestAt, now);
    return status ? { ...status, phase: 'mature' } : null;
  }

  /**
   * Сбор V2-гибрида на грядке (contract §4.8.4, расширено §4.9.2 для
   * пыльцевой экономики Slice 6 и §4.11.1 для обучающего гранта Slice 8).
   * Первый успешный сбор созревшего `HybridSeedV2` создаёт РОВНО ОДИН
   * `Specimen` и атомарно переключает грядку в `mature` — присутствие
   * `mature`-состояния с уже установленным `specimenId` физически исключает
   * повторное создание `Specimen` на последующих вызовах (включая после
   * reload). Повторный сбор (уже `mature`) — идемпотентен: no-op до
   * готовности повторного цикла, иначе обновляет только `lastHarvestAt`. Оба
   * успешных пути начисляют `pollenRewardV2(genomeV2)` тем же атомарным
   * обновлением состояния, что и остальные изменения этого сбора. Растение
   * никогда не удаляется с грядки этим методом.
   *
   * Обучающий грант «Первое открытие» (contract §4.11.1) — ровно 8 пыльцы
   * ПОВЕРХ обычной `pollenRewardV2`, `firstHybridRewardClaimed=true`,
   * `labLevel=Math.max(currentLabLevel, 2)` — гейтится ЕДИНСТВЕННЫМ условием
   * `!this.state.firstHybridRewardClaimed`, проверенным в ОБЕИХ ветках ниже
   * (не только в `growing→mature`). Это осознанное расширение сверх
   * буквального «при первом успешном переходе growing→mature» (тот же
   * прецедент, что defensive guard в `recycleSpecimen()` выше): существующие
   * Slice 5-7 save, где зрелый V2-гибрид уже существует, но
   * `firstHybridRewardClaimed` ещё `false` (сам флаг появился только в этом
   * slice — до него ни один переход growing→mature не мог его установить),
   * иначе никогда не получили бы грант — потому что их единственный
   * `growing→mature` переход уже состоялся ДО того, как этот код начал
   * существовать, а требование задания прямо запрещает вынуждать игрока
   * «вырастить ещё один первый гибрид». Проверка `!firstHybridRewardClaimed`
   * в обеих ветках даёт грант ровно один раз — на первом же успешном сборе
   * (растущего ИЛИ уже зрелого гибрида, что наступит раньше) — и после
   * установки флага `true` ни одна из веток больше никогда не выдаёт его
   * повторно, в том числе после reload (флаг персистентен). Ранний сбор,
   * повреждённые данные, повторный вызов на уже собранной фазе — все они
   * возвращают `false` до этой точки (см. `status.ready` проверки выше по
   * каждой ветке) и потому тоже не выдают грант. Legacy `harvest()` этот
   * метод не переиспользует и не читает `firstHybridRewardClaimed`/`labLevel`
   * вообще — legacy-сбор ничего не открывает.
   *
   * Genetics V2 — Slice 12 fix-pass (contract §4.14.14, owner review §1/§2):
   * the `growing`→`mature` transition below (first-ever harvest of this
   * hybrid, exactly once per plot thanks to the same `specimenId`
   * presence-guard that already made `Specimen` creation idempotent) is now
   * ALSO the single point where natural reveal is computed/applied and the
   * new Specimen's Reveal lifecycle is stamped `revealAcknowledged:false`
   * ("mature pending Reveal") — not `breedNurseryV2` above. Parent genomes
   * are looked up by `hybrid.parentIds` against the CURRENT `this.state.
   * specimens` (a parent's `genomeV2` never changes after breeding, so this
   * is exactly equivalent to using a snapshot taken at breed time); if a
   * parent was recycled before this maturity, natural reveal simply does not
   * apply to that missing side (nothing to reveal on a specimen that no
   * longer exists) — a safe, honest degradation, not a crash.
   */
  harvestHybridV2(plotId: number, now: number = Date.now()): boolean {
    const plot = this.state.plots.find((p) => p.id === plotId);
    if (!plot || !plot.hybridV2) return false;

    const grantFirstHybridReward = !this.state.firstHybridRewardClaimed;
    const firstHybridBonus: Partial<GameState> = grantFirstHybridReward
      ? { firstHybridRewardClaimed: true, labLevel: Math.max(this.state.labLevel, LAB_LEVEL_2) }
      : {};
    const pollenBonus = grantFirstHybridReward ? FIRST_HYBRID_POLLEN_GRANT : 0;

    if (plot.hybridV2.phase === 'growing') {
      const hybrid = plot.hybridV2.hybrid;
      const status = hybridGrowthStatusV2(hybrid, now);
      if (!status || !status.ready) return false;

      const [seedParentId, pollenParentId] = hybrid.parentIds;
      const seedParent = this.state.specimens.find((s) => s.id === seedParentId);
      const pollenParent = this.state.specimens.find((s) => s.id === pollenParentId);
      const mutated = hybrid.genomeV2.mutationId !== null;
      const naturalReveal: NaturalRevealResultV2 = computeNaturalRevealsV2(
        hybrid.genomeV2,
        seedParent?.genomeV2 ?? null,
        pollenParent?.genomeV2 ?? null,
        mutated
      );

      function withNaturalReveal(specimen: Specimen, loci: readonly GenomeV2LocusKey[]): Specimen {
        if (loci.length === 0) return specimen;
        const existing = specimen.revealedLoci ?? [];
        const existingLoci = new Set(existing.map((e) => e.locus));
        const additions = loci
          .filter((locus) => !existingLoci.has(locus))
          .map((locus) => ({ locus, source: 'natural' as const }));
        if (additions.length === 0) return specimen;
        return { ...specimen, revealedLoci: [...existing, ...additions] };
      }

      const specimen: Specimen = {
        id: nextId(),
        genome: projectGenomeV2ToLegacy(hybrid.genomeV2),
        genomeV2: hybrid.genomeV2,
        createdAt: now,
        parentIds: hybrid.parentIds,
        revealAcknowledged: false,
        revealParentSpecies: [
          seedParent?.genomeV2?.speciesId ?? hybrid.genomeV2.speciesId,
          pollenParent?.genomeV2?.speciesId ?? hybrid.genomeV2.speciesId,
        ],
        revealNaturalReveal: naturalReveal,
        tutorialBreedStep: hybrid.tutorialBreedStep,
      };
      const mature: PlotHybridV2 = { phase: 'mature', specimenId: specimen.id, lastHarvestAt: now };
      this.state = {
        ...this.state,
        specimens: [
          ...this.state.specimens.map((s) => {
            if (s.id === seedParentId) return withNaturalReveal(s, naturalReveal.seedLoci);
            if (s.id === pollenParentId) return withNaturalReveal(s, naturalReveal.pollenLoci);
            return s;
          }),
          specimen,
        ],
        plots: this.state.plots.map((p) => (p.id === plotId ? { ...p, hybridV2: mature } : p)),
        pollen: this.state.pollen + pollenRewardV2(hybrid.genomeV2) + pollenBonus,
        ...firstHybridBonus,
      };
      this.emit();
      return true;
    }

    // phase === 'mature' — повторный цикл. Идемпотентный guard — грядка уже
    // не в состоянии 'growing', эта ветка не может создать второй Specimen.
    const matureState = plot.hybridV2;
    const specimen = this.state.specimens.find((s) => s.id === matureState.specimenId);
    if (!specimen || !specimen.genomeV2) return false;
    const status = regrowStatusV2(specimen.genomeV2.speciesId, matureState.lastHarvestAt, now);
    if (!status || !status.ready) return false;

    const updated: PlotHybridV2 = { phase: 'mature', specimenId: matureState.specimenId, lastHarvestAt: now };
    this.state = {
      ...this.state,
      plots: this.state.plots.map((p) => (p.id === plotId ? { ...p, hybridV2: updated } : p)),
      pollen: this.state.pollen + pollenRewardV2(specimen.genomeV2) + pollenBonus,
      ...firstHybridBonus,
    };
    this.emit();
    return true;
  }

  /**
   * Genetics V2 — Slice 12 fix-pass (contract §4.14.14): closes the pending
   * Reveal screen for a specimen — the persisted "Reveal acknowledged" step
   * of the lifecycle `bred unknown seed -> planted/growing -> mature pending
   * Reveal -> Reveal acknowledged`. Idempotent no-op (no state change, no
   * `emit()`) unless the specimen exists AND is currently
   * `revealAcknowledged===false` — calling it again after acknowledgment, on
   * a specimen this mechanism never applied to (`undefined`), or on a
   * nonexistent id, does nothing. There is no path back from `true` to
   * `false` — once acknowledged, a repeat mature interaction or a reload
   * never re-opens the Reveal screen for this specimen again.
   */
  acknowledgeRevealV2(specimenId: string): void {
    const specimen = this.state.specimens.find((s) => s.id === specimenId);
    if (!specimen || specimen.revealAcknowledged !== false) return;
    this.state = {
      ...this.state,
      specimens: this.state.specimens.map((s) => (s.id === specimenId ? { ...s, revealAcknowledged: true } : s)),
    };
    this.emit();
  }

  // --------------------------------------------------------------------
  // Genetics V2 — Slice 7 (переработка HybridSeed/Specimen в генетическую
  // пыль). Contract §4.10. Отдельные V2-операции — legacy `recycleSpecimen()`
  // (плоская экономика, фиксированная награда) не меняется и не расширяется
  // тарифами этого slice (contract §4.10.4); legacy `ui/AlbumPanel.tsx`
  // продолжает вызывать именно его.
  // --------------------------------------------------------------------

  /**
   * Переработать `HybridSeedV2`, ещё лежащий в Nursery Tray (не выращенный) —
   * contract §4.10.2. Единственная проверка: семя должно существовать именно
   * в `nurseryTray` (посаженный растущий гибрид уже не в трее — эта операция
   * его физически не видит и не может обработать). Успех — один атомарный
   * `this.state = {...}`: семя удаляется из `nurseryTray`, `geneticDust`
   * увеличивается на `dustGained` (половинный тариф + первая компенсация,
   * если применимо), `firstRecycleTopUpClaimed` безусловно становится `true`
   * (идемпотентно, если уже был `true`). `pollen`/`coins`/`pityCounter`/
   * родители/`plots`/`specimens`/`labLevel` не читаются и не пишутся.
   * Геном/фенотип семени нигде не раскрываются этим методом.
   */
  recycleNurserySeedV2(hybridSeedId: string): RecycleNurserySeedV2Result {
    const seed = this.state.nurseryTray.find((h) => h.id === hybridSeedId);
    if (!seed) return { ok: false, reason: 'seed_not_found' };

    const baseDust = nurseryRecycleDustV2(seed.genomeV2);
    const { topUpDust, dustGained } = firstRecycleTopUpV2(baseDust, this.state.firstRecycleTopUpClaimed);

    this.state = {
      ...this.state,
      nurseryTray: this.state.nurseryTray.filter((h) => h.id !== hybridSeedId),
      geneticDust: this.state.geneticDust + dustGained,
      firstRecycleTopUpClaimed: true,
    };
    this.emit();
    return { ok: true, baseDust, topUpDust, dustGained };
  }

  /**
   * Переработать выращенный `Specimen` — contract §4.10.3. Проверки строго по
   * порядку: (1) specimen существует; (2) есть `genomeV2` (защитный путь —
   * legacy-specimen без sidecar, тот же принцип, что `breedNurseryV2` шаг 3);
   * (3) не `favorite` (тот же принцип, что legacy `recycleSpecimen()`);
   * (4) если найдено БОЛЬШЕ ОДНОЙ mature-грядки, ссылающейся на этот
   * `specimenId` — повреждённый save, безопасный отказ без единого изменения
   * (не удаление нескольких растений). Растущий (`growing`) гибрид на грядке
   * — не `Specimen` (contract §4.8.1), физически не проходит проверку (1) ни
   * при каких условиях и недоступен этой операции.
   *
   * Успех — один атомарный `this.state = {...}`: specimen удаляется из
   * коллекции; если найдена ровно одна связанная mature-грядка — её
   * `hybridV2` очищается тем же обновлением (грядка становится свободной);
   * если specimen не на грядке — `plots` не трогаются вообще; `geneticDust`
   * увеличивается на `dustGained` (полный тариф + первая компенсация, если
   * применимо); `firstRecycleTopUpClaimed` — то же правило, что
   * `recycleNurserySeedV2`. `parentIds` других specimens не переписываются —
   * никакого каскадного удаления потомков. `pollen`/`coins`/`pityCounter`/
   * `nurseryTray`/`labLevel` не меняются.
   */
  recycleSpecimenV2(specimenId: string): RecycleSpecimenV2Result {
    const specimen = this.state.specimens.find((s) => s.id === specimenId);
    if (!specimen) return { ok: false, reason: 'specimen_not_found' };
    if (!specimen.genomeV2) return { ok: false, reason: 'missing_genome_v2' };
    if (specimen.favorite) return { ok: false, reason: 'favorite' };

    const linkedPlots = this.state.plots.filter(
      (p) => p.hybridV2?.phase === 'mature' && p.hybridV2.specimenId === specimenId
    );
    if (linkedPlots.length > 1) return { ok: false, reason: 'ambiguous_plot_reference' };

    const baseDust = grownRecycleDustV2(specimen.genomeV2);
    const { topUpDust, dustGained } = firstRecycleTopUpV2(baseDust, this.state.firstRecycleTopUpClaimed);
    const linkedPlotId = linkedPlots[0]?.id;

    this.state = {
      ...this.state,
      specimens: this.state.specimens.filter((s) => s.id !== specimenId),
      plots:
        linkedPlotId === undefined
          ? this.state.plots
          : this.state.plots.map((p) => (p.id === linkedPlotId ? { ...p, hybridV2: null } : p)),
      geneticDust: this.state.geneticDust + dustGained,
      firstRecycleTopUpClaimed: true,
    };
    this.emit();
    return { ok: true, baseDust, topUpDust, dustGained };
  }

  // --------------------------------------------------------------------
  // Genetics V2 — Slice 8 (минимальный микроскоп). Contract §4.11.3. Ровно
  // одна операция: раскрыть один скрытый аллель конкретного specimen
  // навсегда, за 3 генетической пыли.
  // --------------------------------------------------------------------

  /**
   * Раскрыть скрытый аллель одного локуса конкретного `Specimen` (contract
   * §4.11.3) — доступно только при `labLevel>=2`. Проверки СТРОГО в этом
   * порядке (задание владельца, дословно):
   *
   * 1. Lab L2 открыт (`this.state.labLevel >= LAB_LEVEL_2`).
   * 2. Specimen существует.
   * 3. У specimen есть `genomeV2`.
   * 4. Признак реально доступен для раскрытия — `resolveExtendedCard` (Slice
   *    2) даёт `unresearched` для этого локуса: не гомозиготный (у него нет
   *    скрытого состояния вообще) и ещё не раскрыт (микроскопом или
   *    естественно). Кодоминантные локусы в Gate 1 не существуют (contract
   *    §4.3) — гетерозиготный локус без раскрытия физически всегда ровно
   *    `unresearched`, отдельной ветки для «признака без единственного
   *    скрытого аллеля» не требуется.
   * 5. Есть минимум 3 `geneticDust`.
   * 6. Одно атомарное списание и раскрытие: `geneticDust -= 3`, в
   *    `Specimen.revealedLoci` добавляется РОВНО ОДНА новая запись
   *    `{ locus, source: 'microscope' }` — без дубликатов (шаг 4 уже
   *    гарантирует, что для этого локуса записи ещё не было) и без
   *    перезаписи существующих записей `source: 'natural'` других локусов
   *    того же specimen (immutable append, не замена массива). Остальные
   *    поля `specimen`/`GameState` (включая `pollen`/`coins`/`labLevel`/
   *    `firstBreedFreeClaimed`/`firstHybridRewardClaimed`/
   *    `firstRecycleTopUpClaimed`) не меняются.
   *
   * Любой отказ на шагах 1-5 — полный no-op: `geneticDust` и
   * `specimens`/`revealedLoci` не меняются ни на бит, `this.emit()` не
   * вызывается. Раскрытие персистентно только для ЭТОГО specimen —
   * `revealedLoci` живёт на самом `Specimen`, не на виде/геноме/родителе/
   * потомке, поэтому раскрытие одного растения физически не может повлиять
   * на другой specimen (даже с идентичным `genomeV2`).
   */
  revealHiddenLocusV2(specimenId: string, locus: GenomeV2LocusKey): RevealHiddenLocusV2Result {
    // 1. Lab L2 открыт.
    if (this.state.labLevel < LAB_LEVEL_2) return { ok: false, reason: 'lab_locked' };
    // 2. Specimen существует.
    const specimen = this.state.specimens.find((s) => s.id === specimenId);
    if (!specimen) return { ok: false, reason: 'specimen_not_found' };
    // 3. У specimen есть genomeV2.
    if (!specimen.genomeV2) return { ok: false, reason: 'missing_genome_v2' };
    // 4. Признак реально доступен для раскрытия.
    const revealedLoci = specimen.revealedLoci ?? [];
    const available = availableLociForRevealV2(specimen.genomeV2, revealedLoci);
    if (!available.includes(locus)) return { ok: false, reason: 'locus_not_available' };
    // 5. Минимум 3 geneticDust.
    if (this.state.geneticDust < MICROSCOPE_REVEAL_COST) {
      return {
        ok: false,
        reason: 'insufficient_dust',
        requiredDust: MICROSCOPE_REVEAL_COST,
        availableDust: this.state.geneticDust,
      };
    }

    // 6. Одно атомарное списание и раскрытие. Шаг 4 уже гарантировал, что
    // этот локус гетерозиготен и не раскрыт — resolveExtendedCard() здесь
    // используется только для того, чтобы узнать, какой из двух аллелей
    // пары (`a`/`b`) сейчас ВЫРАЖЕН, а другой — скрытый (extended-view
    // `unresearched` намеренно не отдаёт наружу скрытое значение, задание
    // п.«до оплаты — только название категории»).
    const card = resolveExtendedCard(specimen.genomeV2, revealedLoci);
    const view = card[locus];
    // Недостижимо после шага 4 (available гарантирует unresearched), но
    // TypeScript не умеет вывести это из отдельного вызова — явная защита
    // вместо небезопасного приведения типа.
    if (view.state !== 'unresearched') return { ok: false, reason: 'locus_not_available' };
    const pair = specimen.genomeV2[locus] as { a: string; b: string };
    const revealedAllele = pair.a === view.expressed ? pair.b : pair.a;

    this.state = {
      ...this.state,
      geneticDust: this.state.geneticDust - MICROSCOPE_REVEAL_COST,
      specimens: this.state.specimens.map((s) =>
        s.id === specimenId
          ? { ...s, revealedLoci: [...revealedLoci, { locus, source: 'microscope' as const }] }
          : s
      ),
    };
    this.emit();
    return { ok: true, locus, revealedAllele, dustSpent: MICROSCOPE_REVEAL_COST };
  }

  /** Только для тестов/отладки — добавить временный ускоритель роста. */
  grantEntitlement(entitlement: Entitlement): void {
    this.state = { ...this.state, entitlements: [...this.state.entitlements, entitlement] };
    this.emit();
  }
}

export const gameStore = new GameStore();
