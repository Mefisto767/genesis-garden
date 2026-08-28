import type { Entitlement, GameState, Plot, PlotHybridV2, Specimen } from './types';
import { MAX_PLOTS, START_UNLOCKED_PLOTS } from './types';
import { getSeedDef } from './seedCatalog';
import { breed, randomGenome, type BreedResult, type GeneLock } from './genetics';
import { ensureGenomeV2Sidecars, type HybridSeedV2 } from './geneticsV2';
import type { BreedRejectionReasonV2 } from './inheritanceV2';
import { breedV2 } from './mutationV2';
import { GARDEN_CONFIG, BREEDING_CONFIG, STARTING_STATE_CONFIG } from './config';
import { activeGrowthBoostPercent, effectiveElapsedMs } from './entitlements';
import { advanceQuestProgress, canClaimQuest, QUEST_CATALOG } from './quests';
import { NURSERY_TRAY_CAPACITY, hybridGrowthStatusV2, regrowStatusV2, type GrowthStatusV2 } from './nurseryV2';
import { projectGenomeV2ToLegacy } from './legacyProjectionV2';
import type { RngFn } from './rng';
import { defaultRng } from './rng';

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
): { state: GameState; needsPersist: boolean } {
  try {
    const raw = storage?.getItem(SAVE_KEY);
    if (!raw) return { state: createInitialState(rng), needsPersist: false };
    const parsed = JSON.parse(raw) as GameState & { version?: number };
    if (!parsed.plots || !Array.isArray(parsed.plots) || typeof parsed.coins !== 'number') {
      return { state: createInitialState(rng), needsPersist: false };
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

    return { state: parsed, needsPersist };
  } catch {
    return { state: createInitialState(rng), needsPersist: false };
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

/** Причины отказа `breedNurseryV2` (contract §4.8.7) — четыре новые store-
 * level причины плюс прозрачно прокинутые причины Slice 3-4 species-
 * валидации (`unsupported_species`/`interspecies_locked`), не переопределяя
 * и не заменяя их. */
export type BreedNurseryV2RejectionReason =
  | 'same_parent'
  | 'parent_not_found'
  | 'parent_missing_genome_v2'
  | 'nursery_tray_full'
  | BreedRejectionReasonV2;

export interface BreedNurseryV2Success {
  ok: true;
  hybridSeed: HybridSeedV2;
  mutated: boolean;
  nextPityCounter: number;
}

export interface BreedNurseryV2Failure {
  ok: false;
  reason: BreedNurseryV2RejectionReason;
}

export type BreedNurseryV2Result = BreedNurseryV2Success | BreedNurseryV2Failure;

/** Причины отказа `plantHybridSeedV2` (contract §4.8.2). */
export type PlantHybridV2RejectionReason = 'seed_not_found' | 'plot_not_found' | 'plot_locked' | 'plot_occupied';

export type PlantHybridV2Result = { ok: true } | { ok: false; reason: PlantHybridV2RejectionReason };

/** Статус роста/повторного цикла `Plot.hybridV2`, единая точка правды для UI
 * и `harvestHybridV2` (тот же принцип, что `PlotStatus`/`plotStatus()` выше). */
export type HybridPlotStatusV2 = GrowthStatusV2 & { phase: 'growing' | 'mature' };

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

  constructor(options: GameStoreOptions = {}) {
    this.rng = options.rng ?? defaultRng;
    this.storage = options.disablePersistence ? null : safeStorage();
    if (options.initialState) {
      // Тесты передают готовый сценарий напрямую — loadState()/persist() не
      // участвуют, это не проход через storage вообще.
      this.state = options.initialState;
      return;
    }
    const loaded = loadState(this.rng, this.storage);
    this.state = loaded.state;
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
  // Genetics V2 — Slice 5 (Nursery Tray, рост, постоянные растения).
  // docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.8. Экономика (coins/
  // pollen/geneticDust/три обучающих флага) сознательно НЕ читается и не
  // пишется ни одним из методов ниже — Slice 6/7 (delta doc §0.7 п.9).
  // --------------------------------------------------------------------

  /**
   * V2-скрещивание двух специменов из коллекции в `HybridSeedV2`,
   * помещаемый в Nursery Tray (не готовый `Specimen` — contract §4.8.7).
   * Все проверки ниже выполняются строго по порядку, ДО вызова `breedV2` —
   * при любом отказе `breedV2` не вызывается вообще: 0 RNG-вызовов,
   * `pityCounter`/родители/`nurseryTray`/остальной `GameState` не меняются.
   * Species-валидация (`unsupported_species`/`interspecies_locked`)
   * выполняется внутри самого `breedV2` (Slice 3-4, без изменений).
   */
  breedNurseryV2(seedParentId: string, pollenParentId: string): BreedNurseryV2Result {
    if (seedParentId === pollenParentId) return { ok: false, reason: 'same_parent' };
    const seedParent = this.state.specimens.find((s) => s.id === seedParentId);
    const pollenParent = this.state.specimens.find((s) => s.id === pollenParentId);
    if (!seedParent || !pollenParent) return { ok: false, reason: 'parent_not_found' };
    if (!seedParent.genomeV2 || !pollenParent.genomeV2) return { ok: false, reason: 'parent_missing_genome_v2' };
    if (this.state.nurseryTray.length >= NURSERY_TRAY_CAPACITY) return { ok: false, reason: 'nursery_tray_full' };

    const result = breedV2(seedParent.genomeV2, pollenParent.genomeV2, this.state.pityCounter, this.rng);
    if (!result.ok) return { ok: false, reason: result.reason };

    const hybridSeed: HybridSeedV2 = {
      id: nextId(),
      genomeV2: result.genomeV2,
      parentIds: [seedParentId, pollenParentId],
      createdAt: Date.now(),
      plantedAt: null,
      plotId: null,
    };
    this.state = {
      ...this.state,
      nurseryTray: [...this.state.nurseryTray, hybridSeed],
      pityCounter: result.nextPityCounter,
    };
    this.emit();
    return { ok: true, hybridSeed, mutated: result.mutated, nextPityCounter: result.nextPityCounter };
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
   * Сбор V2-гибрида на грядке (contract §4.8.4). Первый успешный сбор
   * созревшего `HybridSeedV2` создаёт РОВНО ОДИН `Specimen` и атомарно
   * переключает грядку в `mature` — присутствие `mature`-состояния с уже
   * установленным `specimenId` физически исключает повторное создание
   * `Specimen` на последующих вызовах (включая после reload). Повторный сбор
   * (уже `mature`) — идемпотентен: no-op до готовности повторного цикла,
   * иначе обновляет только `lastHarvestAt`, без экономической награды
   * (Slice 6/7). Растение никогда не удаляется с грядки этим методом.
   */
  harvestHybridV2(plotId: number, now: number = Date.now()): boolean {
    const plot = this.state.plots.find((p) => p.id === plotId);
    if (!plot || !plot.hybridV2) return false;

    if (plot.hybridV2.phase === 'growing') {
      const hybrid = plot.hybridV2.hybrid;
      const status = hybridGrowthStatusV2(hybrid, now);
      if (!status || !status.ready) return false;

      const specimen: Specimen = {
        id: nextId(),
        genome: projectGenomeV2ToLegacy(hybrid.genomeV2),
        genomeV2: hybrid.genomeV2,
        createdAt: now,
        parentIds: hybrid.parentIds,
      };
      const mature: PlotHybridV2 = { phase: 'mature', specimenId: specimen.id, lastHarvestAt: now };
      this.state = {
        ...this.state,
        specimens: [...this.state.specimens, specimen],
        plots: this.state.plots.map((p) => (p.id === plotId ? { ...p, hybridV2: mature } : p)),
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
    };
    this.emit();
    return true;
  }

  /** Только для тестов/отладки — добавить временный ускоритель роста. */
  grantEntitlement(entitlement: Entitlement): void {
    this.state = { ...this.state, entitlements: [...this.state.entitlements, entitlement] };
    this.emit();
  }
}

export const gameStore = new GameStore();
