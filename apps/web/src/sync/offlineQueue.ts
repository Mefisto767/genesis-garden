// ============================================================================
// Этап 4 — офлайн-очередь: если запрос к серверу не удался из-за сети (не
// из-за бизнес-логики), действие сохраняется здесь с ТЕМ ЖЕ request_id и
// повторяется при восстановлении сети. Тот же request_id гарантирует, что
// повтор безопасен (см. Этап 3 — идемпотентность RPC по request_id) — это
// прямо требование мастер-промта: "защита от повторной отправки очереди".
// ============================================================================

const QUEUE_KEY = 'genesis-garden-offline-queue-v1';

export interface QueuedAction {
  requestId: string;
  kind: string;
  args: Record<string, unknown>;
  createdAt: number;
  attempts: number;
}

export type ActionExecutor = (action: QueuedAction) => Promise<ExecuteResult>;

export interface ExecuteResult {
  /** true — действие обработано (успех ИЛИ окончательный business-отказ), убрать из очереди. */
  done: boolean;
  /** true — сетевая ошибка, есть смысл повторить позже; останавливает дальнейший дренаж. */
  networkError: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class OfflineQueue {
  private storage: StorageLike | null;

  constructor(storage: StorageLike | null = safeLocalStorage()) {
    this.storage = storage;
  }

  list(): QueuedAction[] {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(QUEUE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private persist(items: QueuedAction[]): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(QUEUE_KEY, JSON.stringify(items));
    } catch {
      // Нет места/недоступно — действие просто не переживёт перезагрузку,
      // не роняем приложение.
    }
  }

  enqueue(kind: string, args: Record<string, unknown>, requestId: string): QueuedAction {
    const items = this.list();
    // Один и тот же requestId не дублируем в очереди (например, повторный
    // клик до того, как первая попытка успела уйти в очередь).
    if (items.some((i) => i.requestId === requestId)) {
      return items.find((i) => i.requestId === requestId)!;
    }
    const action: QueuedAction = { requestId, kind, args, createdAt: Date.now(), attempts: 0 };
    items.push(action);
    this.persist(items);
    return action;
  }

  remove(requestId: string): void {
    this.persist(this.list().filter((i) => i.requestId !== requestId));
  }

  size(): number {
    return this.list().length;
  }

  /**
   * Обрабатывает очередь ПО ПОРЯДКУ (действия зависят друг от друга —
   * например, купить семя нужно раньше, чем его посадить). Останавливается
   * на первой сетевой ошибке, не перепрыгивая через неё, чтобы не нарушить
   * порядок операций игрока.
   */
  async drain(execute: ActionExecutor): Promise<{ processed: number; remaining: number }> {
    const items = this.list();
    let processed = 0;
    for (const action of items) {
      const result = await execute({ ...action, attempts: action.attempts + 1 });
      if (result.networkError) {
        // Обновляем счётчик попыток и останавливаемся — остальное подождёт.
        const updated = this.list().map((i) =>
          i.requestId === action.requestId ? { ...i, attempts: i.attempts + 1 } : i
        );
        this.persist(updated);
        break;
      }
      // done (успех или окончательный бизнес-отказ) — убираем из очереди в любом случае:
      // повторять запрос, который сервер уже один раз содержательно обработал
      // или отверг по правилам игры, бессмысленно.
      this.remove(action.requestId);
      processed += 1;
    }
    return { processed, remaining: this.size() };
  }
}

function safeLocalStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}
