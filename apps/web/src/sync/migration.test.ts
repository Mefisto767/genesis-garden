import { describe, expect, it } from 'vitest';
import {
  buildMigrationPayload,
  isMigrationDone,
  markMigrationDone,
  migrationOptions,
  shouldPromptMigration,
  summarizeLocalState,
  type ProgressSummary,
} from './migration';
import { STARTING_STATE_CONFIG } from '../game/config';
import type { GameState } from '../game/types';

function stateWith(overrides: Partial<GameState>): GameState {
  return {
    coins: STARTING_STATE_CONFIG.startingCoins,
    plots: Array.from({ length: 24 }, (_, i) => ({ id: i, unlocked: i < 6, seedId: null, plantedAt: null })),
    inventory: {},
    specimens: [],
    geneticDust: 0,
    pityCounter: 0,
    questProgress: {},
    questsClaimed: [],
    entitlements: [],
    ...overrides,
  };
}

describe('shouldPromptMigration', () => {
  it('не спрашивает, если локальный прогресс — это буквально свежий старт', () => {
    const fresh = summarizeLocalState(stateWith({}));
    expect(shouldPromptMigration(fresh, STARTING_STATE_CONFIG.startingCoins)).toBe(false);
  });

  it('спрашивает, если у игрока есть реальный прогресс (больше стартовых монет)', () => {
    const progressed = summarizeLocalState(stateWith({ coins: 500 }));
    expect(shouldPromptMigration(progressed, STARTING_STATE_CONFIG.startingCoins)).toBe(true);
  });

  it('спрашивает, если разблокировано больше стартовых 6 грядок даже при стартовых монетах', () => {
    const state = stateWith({
      plots: Array.from({ length: 24 }, (_, i) => ({ id: i, unlocked: i < 10, seedId: null, plantedAt: null })),
    });
    expect(shouldPromptMigration(summarizeLocalState(state), STARTING_STATE_CONFIG.startingCoins)).toBe(true);
  });
});

describe('migrationOptions', () => {
  it('всегда предлагает keep_local и keep_cloud', () => {
    const local: ProgressSummary = { coins: 10, geneticDust: 0, plantsCount: 0, unlockedPlots: 6 };
    const cloud: ProgressSummary = { coins: 50, geneticDust: 0, plantsCount: 2, unlockedPlots: 6 };
    const options = migrationOptions(local, cloud);
    expect(options.map((o) => o.choice)).toContain('keep_local');
    expect(options.map((o) => o.choice)).toContain('keep_cloud');
  });

  it('предлагает merge только когда у ОБОИХ источников есть растения', () => {
    const localEmpty: ProgressSummary = { coins: 10, geneticDust: 0, plantsCount: 0, unlockedPlots: 6 };
    const cloudWithPlants: ProgressSummary = { coins: 50, geneticDust: 0, plantsCount: 2, unlockedPlots: 6 };
    expect(migrationOptions(localEmpty, cloudWithPlants).map((o) => o.choice)).not.toContain('merge');

    const localWithPlants: ProgressSummary = { coins: 10, geneticDust: 0, plantsCount: 3, unlockedPlots: 6 };
    expect(migrationOptions(localWithPlants, cloudWithPlants).map((o) => o.choice)).toContain('merge');
  });
});

describe('buildMigrationPayload', () => {
  it('сериализует только нужные поля (без служебных id) для передачи на сервер', () => {
    const state = stateWith({
      coins: 777,
      specimens: [{ id: 'local_1', genome: { shape: 1 } as never, createdAt: 0 }],
    });
    const payload = buildMigrationPayload(state);
    expect(payload.coins).toBe(777);
    expect((payload.specimens as unknown[]).length).toBe(1);
    expect((payload.specimens as { genome: unknown }[])[0].genome).toEqual({ shape: 1 });
  });
});

describe('флаг "уже перенесено" — не спрашиваем повторно', () => {
  it('markMigrationDone делает isMigrationDone true', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(isMigrationDone(storage)).toBe(false);
    markMigrationDone(storage);
    expect(isMigrationDone(storage)).toBe(true);
  });
});
