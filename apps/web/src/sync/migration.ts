// ============================================================================
// Этап 4 — сравнение локального прогресса с облачным перед первым переносом.
// Чистые функции (без сети/React) — реальный RPC-вызов делает gameApi.ts,
// эта логика только решает ЧТО показать игроку и что отправить на сервер.
// ============================================================================

import type { GameState } from '../game/types';

export const MIGRATION_DONE_KEY = 'genesis-garden-migrated-v1';

export interface ProgressSummary {
  coins: number;
  geneticDust: number;
  plantsCount: number;
  unlockedPlots: number;
}

export function summarizeLocalState(state: GameState): ProgressSummary {
  return {
    coins: state.coins,
    geneticDust: state.geneticDust,
    plantsCount: state.specimens.length,
    unlockedPlots: state.plots.filter((p) => p.unlocked).length,
  };
}

export type MigrationChoice = 'keep_local' | 'keep_cloud' | 'merge';

export interface MigrationOption {
  choice: MigrationChoice;
  label: string;
  description: string;
}

/**
 * Есть ли вообще смысл спрашивать игрока? Если локальный прогресс —
 * это буквально свежий старт (тот же баланс, что выдаётся новому игроку,
 * и никаких дополнительных растений/грядок), сравнивать нечего — экономим
 * игроку клик и сразу используем облако.
 */
export function shouldPromptMigration(local: ProgressSummary, startingCoins: number): boolean {
  const isFreshStart = local.coins === startingCoins && local.plantsCount <= 2 && local.unlockedPlots <= 6;
  return !isFreshStart;
}

export function migrationOptions(local: ProgressSummary, cloud: ProgressSummary): MigrationOption[] {
  const options: MigrationOption[] = [
    {
      choice: 'keep_cloud',
      label: 'Оставить облачный',
      description: `Монет: ${cloud.coins}, пыли: ${cloud.geneticDust}, растений: ${cloud.plantsCount}. Локальный прогресс на этом устройстве будет отброшен.`,
    },
    {
      choice: 'keep_local',
      label: 'Оставить локальный',
      description: `Монет: ${local.coins}, пыли: ${local.geneticDust}, растений: ${local.plantsCount}. Заменит текущий облачный прогресс аккаунта.`,
    },
  ];
  // "Объединить" предлагаем только когда оба источника реально что-то
  // содержат — иначе это неотличимо от "оставить непустой" и только
  // запутывает выбор.
  if (local.plantsCount > 0 && cloud.plantsCount > 0) {
    options.push({
      choice: 'merge',
      label: 'Объединить',
      description:
        'Возьмёт максимум монет/пыли из двух источников (не сумму — ресурсы не задваиваются) и добавит уникальные растения из обоих.',
    });
  }
  return options;
}

/** Полезная нагрузка, которую клиент отправляет в migrate_local_progress RPC. */
export function buildMigrationPayload(state: GameState): Record<string, unknown> {
  return {
    coins: state.coins,
    geneticDust: state.geneticDust,
    plots: state.plots.map((p) => ({ id: p.id, unlocked: p.unlocked })),
    specimens: state.specimens.map((s) => ({ genome: s.genome })),
  };
}

export function markMigrationDone(storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(MIGRATION_DONE_KEY, 'true');
  } catch {
    // localStorage недоступен — не критично, просто предложим перенос снова
    // в следующей сессии (безопасно: migrate_local_progress идемпотентен).
  }
}

export function isMigrationDone(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(MIGRATION_DONE_KEY) === 'true';
  } catch {
    return false;
  }
}
