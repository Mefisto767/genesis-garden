// Фича-флаг Visual Overhaul (см. docs/FINAL_VISION.md, docs/ARCHITECTURE.md).
// Держать false в production, пока владелец явно не решит включить новый
// визуальный режим для всех — см. .env.example. Флаг переключает ТОЛЬКО
// презентационный слой (App.tsx -> ClassicApp | OverhaulApp); игровая модель
// (game/store.ts, genetics.ts, config.ts) и формат localStorage-сохранения
// общие для обоих режимов, поэтому старое сохранение открывается в новом
// визуальном режиме без миграции.
export const VISUAL_OVERHAUL_ENABLED =
  (import.meta.env.VITE_VISUAL_OVERHAUL_ENABLED as string | undefined) === 'true';
