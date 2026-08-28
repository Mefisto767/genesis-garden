// Простая типизированная шина событий между Phaser-сценой и React-оверлеем,
// чтобы не тащить в проект отдельную стейт-менеджмент библиотеку ради MVP.
type Handler<T> = (payload: T) => void;

export class Emitter<Events extends object> {
  private handlers: { [K in keyof Events]?: Set<Handler<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    const set = this.handlers[event] ?? new Set<Handler<Events[K]>>();
    set.add(handler);
    this.handlers[event] = set;
    return () => set.delete(handler);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.handlers[event]?.forEach((h) => h(payload));
  }
}

export interface GardenEvents {
  requestPlant: { plotId: number };
  toast: { text: string };
  /**
   * Genetics V2 — Slice 5 (contract §4.8.4, delta doc §0.7 п.11): открыть
   * минимальную простую карточку постоянного V2-растения на грядке. Эмитится
   * только из EstateScene при клике по грядке в фазе `mature`
   * (`Plot.hybridV2.phase === 'mature'`) — растущий гибрид (`growing`) этот
   * ивент не эмитит, геном ещё не раскрыт.
   */
  requestHybridCard: { plotId: number };
}

export const gardenEvents = new Emitter<GardenEvents>();
