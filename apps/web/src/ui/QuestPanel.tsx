import type { GameState } from '../game/types';
import { gameStore } from '../game/store';
import { questStatuses, type QuestStatus } from '../game/quests';
import { gardenEvents } from '../game/events';

interface QuestPanelProps {
  state: GameState;
  onClose: () => void;
}

function rewardText(q: QuestStatus): string {
  const parts: string[] = [];
  if (q.rewardCoins > 0) parts.push(`${q.rewardCoins} монет`);
  if (q.rewardDust > 0) parts.push(`${q.rewardDust} пыли`);
  return parts.join(' + ');
}

export function QuestPanel({ state, onClose }: QuestPanelProps) {
  const quests = questStatuses(state);

  function claim(id: string) {
    const ok = gameStore.claimQuest(id);
    if (ok) gardenEvents.emit('toast', { text: 'Награда получена!' });
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Цели</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="sheet-list">
          {quests.map((q) => {
            const shown = Math.min(q.progress, q.target);
            const pct = Math.min(100, (q.progress / q.target) * 100);
            return (
              <div className="quest-row" key={q.id}>
                <div className="quest-row-title">{q.title}</div>
                <div className="quest-row-desc">{q.description}</div>
                <div className="quest-progress-track">
                  <div className="quest-progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="quest-row-footer">
                  <span className="quest-row-count">
                    {shown}/{q.target}
                  </span>
                  {q.claimed ? (
                    <span className="quest-claimed-label">Получено ✓</span>
                  ) : q.completed ? (
                    <button className="sheet-buy-btn quest-claim-btn" onClick={() => claim(q.id)}>
                      Забрать · {rewardText(q)}
                    </button>
                  ) : (
                    <span className="quest-reward-hint">{rewardText(q)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
