import type { GameState, Plot } from './types';
import { MAX_PLOTS, START_UNLOCKED_PLOTS } from './types';
import { getSeedDef } from './seedCatalog';

const SAVE_KEY = 'genesis-garden-save-v1';

function unlockCost(plotId: number): number {
  // Растёт с каждым следующим участком за пределами стартовых шести.
  const extraIndex = plotId - START_UNLOCKED_PLOTS; // 0-based среди платных
  return 20 + extraIndex * 12;
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
  return {
    coins: 50,
    plots,
    inventory: { sprout: 3 }, // стартовые бесплатные семена для первого скрещивания/сбора
  };
}

function loadState(): GameState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as GameState;
    // Явная проверка формы на случай будущих миграций схемы.
    if (!parsed.plots || !Array.isArray(parsed.plots) || typeof parsed.coins !== 'number') {
      return createInitialState();
    }
    return parsed;
  } catch {
    return createInitialState();
  }
}

type Listener = () => void;

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
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
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
}

export const gameStore = new GameStore();
