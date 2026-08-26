import { useSyncExternalStore } from 'react';
import { gameStore } from './store';
import type { GameState } from './types';

export function useGameState(): GameState {
  return useSyncExternalStore(
    (listener) => gameStore.subscribe(listener),
    () => gameStore.getState()
  );
}
