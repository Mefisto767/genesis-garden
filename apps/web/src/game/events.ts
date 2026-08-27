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
}

export const gardenEvents = new Emitter<GardenEvents>();
