import type { Entitlement, GameState, Plot, Specimen } from './types';
import { MAX_PLOTS, START_UNLOCKED_PLOTS } from './types';
import { getSeedDef } from './seedCatalog';
import { breed, randomGenome, type BreedResult } from './genetics';
import { GARDEN_CONFIG, BREEDING_CONFIG, STARTING_STATE_CONFIG } from './config';
import { activeGrowthBoostPercent, effectiveElapsedMs } from './entitlements';
import { advanceQuestProgress, canClaimQuest, QUEST_CATALOG } from './quests';
import type { RngFn } from './rng';
import { defaultRng } from './rng';

const SAVE_KEY = 'genesis-garden-save-v1';
const SAVE_VERSION = 3;

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
  const starterSpecimens: Specimen[] = Array.from(
    { length: STARTING_STATE_CONFIG.startingSpecimenCount },
    () => ({ id: nextId(), genome: randomGenome(rng), createdAt: Date.now() })
  );
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
  };
}

function loadState(rng: RngFn, storage: StorageLike | null): GameState {
  try {
    const raw = storage?.getItem(SAVE_KEY);
    if (!raw) return createInitialState(rng);
    const parsed = JSON.parse(raw) as GameState & { version?: number };
    if (!parsed.plots || !Array.isArray(parsed.plots) || typeof parsed.coins !== 'number') {
      return createInitialState(rng);
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
    return parsed;
  } catch {
    return createInitialState(rng);
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
}

export interface PlotStatus {
  ready: boolean;
  /** 0..1, время роста с учётом ускорителей. */
  progress: number;
  /** Остаток времени в мс с учётом ускорителей (0 если уже готово). */
  remainingMs: number;
  growMs: number;
}

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
    this.state = options.initialState ?? loadState(this.rng, this.storage);
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
    if (!plot || !plot.unlocked || plot.seedId !== null) return false;
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
   */
  breedSpecimens(idA: string, idB: string): BreedOutcome | null {
    if (idA === idB) return null;
    const a = this.state.specimens.find((s) => s.id === idA);
    const b = this.state.specimens.find((s) => s.id === idB);
    if (!a || !b) return null;
    if (this.state.coins < BREED_COST) return null;

    const result = breed(a.genome, b.genome, this.state.pityCounter, this.rng);
    const dustGained =
      DUST_REWARD_MIN + Math.floor(this.rng() * (DUST_REWARD_MAX - DUST_REWARD_MIN + 1));
    const specimen: Specimen = { id: nextId(), genome: result.genome, createdAt: Date.now() };

    this.state = {
      ...this.state,
      coins: this.state.coins - BREED_COST,
      geneticDust: this.state.geneticDust + dustGained,
      pityCounter: result.nextPityCounter,
      specimens: [...this.state.specimens, specimen],
      questProgress: advanceQuestProgress(this.state.questProgress, 'breed'),
    };
    this.emit();
    return { specimen, result, dustGained };
  }

  sellSpecimen(id: string): boolean {
    const specimen = this.state.specimens.find((s) => s.id === id);
    if (!specimen) return false;
    // Простая база продажи под геном; полноценная оценка редкости — по мере
    // роста экономики (Этап 4), сейчас достаточно, чтобы коллекция не была
    // единственным способом использовать дубликаты.
    const value = BREEDING_CONFIG.sellSpecimenValue;
    this.state = {
      ...this.state,
      coins: this.state.coins + value,
      specimens: this.state.specimens.filter((s) => s.id !== id),
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

  /** Только для тестов/отладки — добавить временный ускоритель роста. */
  grantEntitlement(entitlement: Entitlement): void {
    this.state = { ...this.state, entitlements: [...this.state.entitlements, entitlement] };
    this.emit();
  }
}

export const gameStore = new GameStore();
