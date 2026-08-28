// Фича-флаг Visual Overhaul (см. docs/FINAL_VISION.md, docs/ARCHITECTURE.md).
// Держать false в production, пока владелец явно не решит включить новый
// визуальный режим для всех — см. .env.example. Флаг переключает ТОЛЬКО
// презентационный слой (App.tsx -> ClassicApp | OverhaulApp); игровая модель
// (game/store.ts, genetics.ts, config.ts) и формат localStorage-сохранения
// общие для обоих режимов, поэтому старое сохранение открывается в новом
// визуальном режиме без миграции.
export const VISUAL_OVERHAUL_ENABLED =
  (import.meta.env.VITE_VISUAL_OVERHAUL_ENABLED as string | undefined) === 'true';

// Фича-флаг Genetics V2 / диплоидная генетика (Gate 1, ветка visual-overhaul,
// см. docs/GENETICS_TARGET_DELTA.md §8, docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md).
// Slice 1 (текущий): флаг только читается и хранится — никакая V2-игровая
// логика (expressPhenotype/rarityOfV2/breedV2/Nursery Tray/микроскоп/UI) на
// него ещё не завязана, это будет подключено начиная со Slice 2+.
export const DIPLOID_GENETICS_ENABLED =
  (import.meta.env.VITE_DIPLOID_GENETICS_ENABLED as string | undefined) === 'true';

/**
 * Genetics V2 активна только при одновременном включении Visual Overhaul и
 * диплоидной генетики (delta doc §8 п.2). Classic UI (`ClassicApp.tsx`)
 * физически не импортирует и не проверяет этот флаг ни в каком виде — он
 * всегда на legacy-генетике, вне зависимости от значения `VITE_DIPLOID_GENETICS_ENABLED`
 * (делта doc §8 п.3). Экспортируется уже в Slice 1 как единая точка правды
 * на будущее (Slice 2+), но в Slice 1 никем ещё не используется для
 * переключения игровой логики.
 */
export const GENETICS_V2_ENABLED = VISUAL_OVERHAUL_ENABLED && DIPLOID_GENETICS_ENABLED;
