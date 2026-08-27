// ============================================================================
// Квесты — минимальный модуль Этапа 2: посадить/собрать/скрестить N раз,
// получить награду. Прогресс живёт в GameState.questProgress, обновляется
// событийно из GameStore при plantSeed/harvest/breedSpecimens.
// ============================================================================

import { QUEST_CATALOG, type QuestDef, type QuestGoalType } from './config';
import type { GameState } from './types';

export type { QuestDef, QuestGoalType };
export { QUEST_CATALOG };

export interface QuestStatus extends QuestDef {
  progress: number;
  claimed: boolean;
  completed: boolean;
}

export function questStatuses(state: GameState): QuestStatus[] {
  return QUEST_CATALOG.map((q) => {
    const progress = state.questProgress[q.id] ?? 0;
    return {
      ...q,
      progress,
      claimed: state.questsClaimed.includes(q.id),
      completed: progress >= q.target,
    };
  });
}

/** Новый счётчик прогресса всех квестов данного типа после одного события. */
export function advanceQuestProgress(
  progress: Record<string, number>,
  goalType: QuestGoalType
): Record<string, number> {
  const next = { ...progress };
  for (const q of QUEST_CATALOG) {
    if (q.goalType !== goalType) continue;
    const current = next[q.id] ?? 0;
    if (current < q.target) next[q.id] = current + 1;
  }
  return next;
}

export function canClaimQuest(state: GameState, questId: string): boolean {
  const def = QUEST_CATALOG.find((q) => q.id === questId);
  if (!def) return false;
  if (state.questsClaimed.includes(questId)) return false;
  return (state.questProgress[questId] ?? 0) >= def.target;
}
