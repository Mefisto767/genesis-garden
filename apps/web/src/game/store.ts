import type { GameState, Plot, Specimen } from './types';
import { MAX_PLOTS, START_UNLOCKED_PLOTS } from './types';
import { getSeedDef } from './seedCatalog';
import { breed, randomGenome, type BreedResult } from './genetics';

const SAVE_KEY = 'genesis-garden-save-v1';
const SAVE_VERSION = 2;

function unlockCost(plotId: number): number {
  // Растёт с каждым следующим участком за пределами стартовых шести.
  const extraIndex = plotId - START_UNLOCKED_PLOTS; // 0-based среди платных
  return 20 + extraIndex * 12;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `spec_${Date.now().toString(36)}_${idCounter}`;
}

function createInitialState(): GameState {
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
  const starterSpecimens: Specimen[] = [
    { id: nextId(), genome: randomGenome(), createdAt: Date.now() },
    { id: nextId(), genome: randomGenome(), createdAt: Date.now() },
  ];
  return {
    coins: 50,
    plots,
    inventory: { sprout: 3 }, // стартовые бесплатные семена для первого сбора
    specimens: starterSpecimens,
    geneticDust: 0,
    pityCounter: 0,
  };
}

function loadState(): GameState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as GameState & { version?: number };
    if (!parsed.plots || !Array.isArray(parsed.plots) || typeof parsed.coins !== 'number') {
      return createInitialState();
    }
    // Миграция v1 (до генетики) -> v2: добавляем поля, не теряя прогресс игрока.
    if (!parsed.version || parsed.version < SAVE_VERSION) {
      if (!Array.isArray(parsed.specimens)) {
        parsed.specimens = [
          { id: nextId(), genome: randomGenome(), createdAt: Date.now() },
          { id: nextId(), genome: randomGenome(), createdAt: Date.now() },
        ];
      }
      if (typeof parsed.geneticDust !== 'number') parsed.geneticDust = 0;
      if (typeof parsed.pityCounter !== 'number') parsed.pityCounter = 0;
    }
    return parsed;
  } catch {
    return createInitialState();
  }
}

type Listener = () => void;

export const BREED_COST = 12; // монет за попытку скрещивания
export const DUST_REWARD_MIN = 2;
export const DUST_REWARD_MAX = 5;

export interface BreedOutcome {
  specimen: Specimen;
  result: BreedResult;
  dustGained: number;
}

class GameStore {
  private state: GameState = loadState();
  private listeners = new Set<Listener>();

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
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ...this.state, version: SAVE_VERSION }));
    } catch {
      // localStorage может быть недоступен (приватный режим) — не роняем игру.
    }
  }

  unlockCostFor(plotId: number): number {
    return unlockCost(plotId);
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
    };
    this.emit();
    return true;
  }

  harvest(plotId: number): boolean {
    const plot = this.state.plots.find((p) => p.id === plotId);
    if (!plot || !plot.seedId || plot.plantedAt === null) return false;
    const def = getSeedDef(plot.seedId);
    if (!def) return false;
    const elapsed = Date.now() - plot.plantedAt;
    if (elapsed < def.growMs) return false; // ещё не созрело — сервер в будущем перепроверит это же условие
    this.state = {
      ...this.state,
      coins: this.state.coins + def.sellValue,
      plots: this.state.plots.map((p) =>
        p.id === plotId ? { ...p, seedId: null, plantedAt: null } : p
      ),
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

    const result = breed(a.genome, b.genome, this.state.pityCounter);
    const dustGained = DUST_REWARD_MIN + Math.floor(Math.random() * (DUST_REWARD_MAX - DUST_REWARD_MIN + 1));
    const specimen: Specimen = { id: nextId(), genome: result.genome, createdAt: Date.now() };

    this.state = {
      ...this.state,
      coins: this.state.coins - BREED_COST,
      geneticDust: this.state.geneticDust + dustGained,
      pityCounter: result.nextPityCounter,
      specimens: [...this.state.specimens, specimen],
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
    const value = 15;
    this.state = {
      ...this.state,
      coins: this.state.coins + value,
      specimens: this.state.specimens.filter((s) => s.id !== id),
    };
    this.emit();
    return true;
  }
}

export const gameStore = new GameStore();
