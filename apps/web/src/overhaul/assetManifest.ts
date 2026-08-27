// ============================================================================
// Asset manifest — Visual Overhaul (см. docs/ASSET_MANIFEST.md для читаемой
// версии той же таблицы). Единственный источник правды для стабильных
// asset ID: код сцен (EstateScene/LaboratoryScene/RevealScene) ссылается
// ТОЛЬКО на id из этого файла, никогда на голые строки-имена файлов — так
// подстановка временного арта на финальный превращается в правку одной
// строки здесь, а не поиск по всему движку сцен.
//
// source:
//   { kind: 'file', path }      — реальный PNG из apps/web/public/assets/…
//   { kind: 'procedural', gen } — текстура/фон рисуется кодом в рантайме
//                                  (Phaser Graphics -> generateTexture),
//                                  gen — имя функции-генератора в
//                                  overhaul/proceduralAssets.ts
//
// status:
//   'approved'  — уже часть проверенного арт-пака (Fable, v0.2/v0.3), просто
//                 переиспользуется как есть, ничего не меняли.
//   'temporary' — существующий подходящий ассет временно исполняет чужую
//                 роль (например, building_storage.png как силуэт дома) ИЛИ
//                 аккуратный процедурный слот/dev-символ, явно временный.
//   'missing'   — в вертикальном срезе не нарисовано и не сгенерировано
//                 вообще; система честно это не показывает или показывает
//                 плейсхолдер с пометкой "скоро".
//   'final'     — не используется в этом манифесте, зарезервировано под
//                 будущий производственный арт-пасс (Этап C+ мастер-плана).
// ============================================================================

export type AssetStatus = 'approved' | 'temporary' | 'missing' | 'final';
export type AssetSource = { kind: 'file'; path: string } | { kind: 'procedural'; gen: string };
export type SortLayer = 'ground' | 'ground-decor' | 'world-object' | 'actor' | 'overlay' | 'ui';

export interface AssetManifestEntry {
  id: string;
  group: string;
  source: AssetSource;
  purpose: string;
  sizePx: [number, number];
  frameCount: number;
  anchor: [number, number]; // 0..1, доля ширины/высоты от левого верхнего угла
  collisionBox: [number, number, number, number] | null; // [x, y, w, h] в px от anchor-точки, null = нет коллизии
  animationFps: number | null;
  sortLayer: SortLayer;
  status: AssetStatus;
  note?: string;
}

export const ASSET_MANIFEST: AssetManifestEntry[] = [
  // ---- terrain tiles ------------------------------------------------------
  {
    id: 'tile_grass',
    group: 'terrain',
    source: { kind: 'procedural', gen: 'generateGrassTile' },
    purpose: 'Базовый тайл травы EstateScene',
    sizePx: [32, 32],
    frameCount: 1,
    anchor: [0, 0],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'ground',
    status: 'temporary',
    note: 'Код-плейсхолдер (тёплый зелёный + лёгкий спекл), как и весь terrain по assets-and-prompts.md. Кандидат на замену production-тайлом позже, не блокирует срез.',
  },
  {
    id: 'tile_path',
    group: 'terrain',
    source: { kind: 'procedural', gen: 'generatePathTile' },
    purpose: 'Дорожка между домом/грядками/лабораторией',
    sizePx: [32, 32],
    frameCount: 1,
    anchor: [0, 0],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'ground',
    status: 'temporary',
  },
  {
    id: 'tile_water',
    group: 'terrain',
    source: { kind: 'procedural', gen: 'generateWaterTile' },
    purpose: 'Маленький пруд (декоративная зона среза)',
    sizePx: [32, 32],
    frameCount: 2,
    anchor: [0, 0],
    collisionBox: [0, 0, 32, 32],
    animationFps: 1,
    sortLayer: 'ground',
    status: 'temporary',
    note: '2 кадра — тихое мерцание бликов (Phaser tween alpha, не спрайт-анимация).',
  },
  {
    id: 'tile_soil',
    group: 'terrain',
    source: { kind: 'file', path: 'assets/tiles/tile_soil.png' },
    purpose: 'Открытая грядка (существующий ассет v0.3-pixel)',
    sizePx: [64, 64],
    frameCount: 1,
    anchor: [0.5, 0.5],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'ground-decor',
    status: 'approved',
  },
  {
    id: 'tile_soil_locked',
    group: 'terrain',
    source: { kind: 'file', path: 'assets/tiles/tile_soil_locked.png' },
    purpose: 'Заблокированная грядка (существующий ассет)',
    sizePx: [64, 64],
    frameCount: 1,
    anchor: [0.5, 0.5],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'ground-decor',
    status: 'approved',
  },

  // ---- paths/water/fences (декоративный периметр) -------------------------
  {
    id: 'fence_gate',
    group: 'paths_water_fences',
    source: { kind: 'procedural', gen: 'generateGateTexture' },
    purpose: 'Ворота будущего расширения участка (видны, не проходимы)',
    sizePx: [96, 64],
    frameCount: 1,
    anchor: [0.5, 1],
    collisionBox: [-48, -64, 96, 64],
    animationFps: null,
    sortLayer: 'world-object',
    status: 'temporary',
    note: 'Честная "заглушка будущего": подпись "Скоро" вместо попытки нарисовать реальные ворота.',
  },

  // ---- buildings ------------------------------------------------------------
  {
    id: 'building_house',
    group: 'buildings',
    source: { kind: 'file', path: 'assets/buildings/building_storage.png' },
    purpose: 'Дом владельца (временный силуэт вертикального среза)',
    sizePx: [1024, 1024],
    frameCount: 1,
    anchor: [0.5, 0.92],
    collisionBox: [-140, -170, 280, 190],
    animationFps: null,
    sortLayer: 'world-object',
    status: 'temporary',
    note: 'В production-арт-паке нет отдельного "дома" — переиспользован building_storage.png как силуэт-заглушка. Нужен отдельный ассет building_house (см. missing ниже).',
  },
  {
    id: 'building_house_final',
    group: 'buildings',
    source: { kind: 'file', path: 'assets/buildings/building_house.png' },
    purpose: 'Целевой финальный ассет дома владельца (не существует)',
    sizePx: [1024, 1024],
    frameCount: 1,
    anchor: [0.5, 0.92],
    collisionBox: [-140, -170, 280, 190],
    animationFps: null,
    sortLayer: 'world-object',
    status: 'missing',
  },
  {
    id: 'building_lab',
    group: 'buildings',
    source: { kind: 'file', path: 'assets/buildings/building_lab.png' },
    purpose: 'Здание лаборатории на карте поместья (существующий ассет)',
    sizePx: [1024, 1024],
    frameCount: 1,
    anchor: [0.5, 0.92],
    collisionBox: [-150, -180, 300, 200],
    animationFps: null,
    sortLayer: 'world-object',
    status: 'approved',
  },
  {
    id: 'building_greenhouse',
    group: 'buildings',
    source: { kind: 'file', path: 'assets/buildings/building_greenhouse.png' },
    purpose: 'Теплица (видна в секторе как декор будущей зоны, не интерактивна в срезе)',
    sizePx: [1024, 1024],
    frameCount: 1,
    anchor: [0.5, 0.92],
    collisionBox: [-130, -150, 260, 170],
    animationFps: null,
    sortLayer: 'world-object',
    status: 'approved',
    note: 'Интерактивность (открытие) — вне объёма вертикального среза, см. ограничения в финальном отчёте.',
  },

  // ---- character movement/actions -----------------------------------------
  {
    id: 'char_avatar',
    group: 'character',
    source: { kind: 'procedural', gen: 'generateCharacterPlaceholder' },
    purpose: 'Игровой персонаж — перемещение, коллизии, взаимодействие',
    sizePx: [32, 48],
    frameCount: 1,
    anchor: [0.5, 0.92],
    collisionBox: [-10, -14, 20, 16],
    animationFps: null,
    sortLayer: 'actor',
    status: 'temporary',
    note: 'Нейтральный геометрический токен (капсула + треугольник направления взгляда), НЕ финальный арт. Ждём партию персонажа (4 направления, ходьба/полив/сбор/перенос) по разделу 14 GDD.',
  },

  // ---- NPC ------------------------------------------------------------------
  {
    id: 'npc_mascot_patrol',
    group: 'npc',
    source: { kind: 'file', path: 'assets/ui/mascot_neutral.png' },
    purpose: 'Временный NPC-маршрут (маскот вместо полноценного NPC уровня 10)',
    sizePx: [512, 512],
    frameCount: 1,
    anchor: [0.5, 0.92],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'actor',
    status: 'temporary',
    note: 'Существующий маскот из UI-пака переиспользован как "один NPC или тестовый маршрут" по ТЗ этапа. Реальные 6-7 NPC — отдельный трек (раздел 10 GDD).',
  },

  // ---- plant stages / phenotype layers (без изменений, см. game/plantArt.ts) -
  {
    id: 'plant_layers_existing',
    group: 'plant_phenotype_layers',
    source: { kind: 'file', path: 'assets/plants/*' },
    purpose: 'Существующая послойная система растений (leaf/primary/secondary маски + line), не тронута',
    sizePx: [1024, 1024],
    frameCount: 3,
    anchor: [0.5, 0.5],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'world-object',
    status: 'approved',
    note: 'Полностью переиспользована из buildPlantSprite() (game/plantArt.ts) без изменений — грядки внутри EstateScene используют тот же рендерер, что и классическая сетка.',
  },

  // ---- laboratory background/layers ----------------------------------------
  {
    id: 'lab_bg_level1',
    group: 'laboratory_background',
    source: { kind: 'procedural', gen: 'generateLabBackdrop' },
    purpose: 'Фон LaboratoryScene, уровень 1 (старое помещение)',
    sizePx: [1920, 1080],
    frameCount: 1,
    anchor: [0, 0],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'ground',
    status: 'temporary',
    note: 'ЧЕСТНО ВРЕМЕННО: тёмно-зелёный градиент + виньетка + подпись-водяной знак "временный фон" в углу (виден только в dev/на скриншотах ревью, см. LaboratoryScene). НЕ выдаётся за финальный иллюстрированный фон из раздела 12 GDD — тот требует реального иллюстратора/AI-прохода по fable-art-brief.md и не входит в вертикальный срез.',
  },
  {
    id: 'lab_bg_final',
    group: 'laboratory_background',
    source: { kind: 'file', path: 'assets/lab/lab_bg_level1.png' },
    purpose: 'Целевой детализированный иллюстрированный фон лаборатории (раздел 12 GDD)',
    sizePx: [1920, 1080],
    frameCount: 1,
    anchor: [0, 0],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'ground',
    status: 'missing',
  },

  // ---- UI icons/panels (переиспользуем существующие + новые hotspot-иконки) -
  {
    id: 'ui_panel_cream',
    group: 'ui',
    source: { kind: 'file', path: 'assets/ui/panel_cream.png' },
    purpose: 'Существующая деревянная панель для HUD-подсказок overhaul-режима',
    sizePx: [512, 512],
    frameCount: 1,
    anchor: [0.5, 0.5],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'ui',
    status: 'approved',
  },
  {
    id: 'hotspot_icon_workbench',
    group: 'ui_lab_hotspots',
    source: { kind: 'procedural', gen: 'generateHotspotIcon' },
    purpose: 'Иконка hotspot "Рабочий стол" (скрещивание)',
    sizePx: [48, 48],
    frameCount: 1,
    anchor: [0.5, 0.5],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'overlay',
    status: 'temporary',
    note: 'Нейтральный нарисованный кодом геометрический символ + подпись, явно помечен temporary. Не эмодзи, не системная иконка ОС.',
  },
  {
    id: 'hotspot_icon_showcase',
    group: 'ui_lab_hotspots',
    source: { kind: 'procedural', gen: 'generateHotspotIcon' },
    purpose: 'Иконка hotspot "Витрина" (коллекция/альбом)',
    sizePx: [48, 48],
    frameCount: 1,
    anchor: [0.5, 0.5],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'overlay',
    status: 'temporary',
  },
  {
    id: 'hotspot_icon_book',
    group: 'ui_lab_hotspots',
    source: { kind: 'procedural', gen: 'generateHotspotIcon' },
    purpose: 'Иконка hotspot "Архивная книга" (энциклопедия — не в объёме среза)',
    sizePx: [48, 48],
    frameCount: 1,
    anchor: [0.5, 0.5],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'overlay',
    status: 'temporary',
  },
  {
    id: 'hotspot_icon_microscope',
    group: 'ui_lab_hotspots',
    source: { kind: 'procedural', gen: 'generateHotspotIcon' },
    purpose: 'Иконка hotspot "Микроскоп" (не в объёме среза)',
    sizePx: [48, 48],
    frameCount: 1,
    anchor: [0.5, 0.5],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'overlay',
    status: 'temporary',
  },
  {
    id: 'hotspot_icon_dryer',
    group: 'ui_lab_hotspots',
    source: { kind: 'procedural', gen: 'generateHotspotIcon' },
    purpose: 'Иконка hotspot "Сушильный шкаф" (переработка — есть в AlbumPanel, отдельного hotspot-экрана нет)',
    sizePx: [48, 48],
    frameCount: 1,
    anchor: [0.5, 0.5],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'overlay',
    status: 'temporary',
  },
  {
    id: 'hud_interact_prompt',
    group: 'ui',
    source: { kind: 'procedural', gen: 'generateInteractPrompt' },
    purpose: 'Контекстная подсказка взаимодействия у лаборатории/грядки',
    sizePx: [160, 40],
    frameCount: 1,
    anchor: [0.5, 1],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'overlay',
    status: 'temporary',
  },

  // ---- particles/weather (не входят в вертикальный срез) -------------------
  {
    id: 'weather_rain',
    group: 'particles_weather',
    source: { kind: 'procedural', gen: 'n/a' },
    purpose: 'Дождь/смена погоды (раздел 12 GDD)',
    sizePx: [0, 0],
    frameCount: 0,
    anchor: [0, 0],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'overlay',
    status: 'missing',
    note: 'Осознанно вне объёма Этапа B (вертикальный срез) — раздел 18 GDD относит погоду к Этапу C.',
  },

  // ---- reveal effects ---------------------------------------------------------
  {
    id: 'reveal_backdrop',
    group: 'reveal_effects',
    source: { kind: 'procedural', gen: 'generateRevealBackdrop' },
    purpose: 'Полноэкранный фон RevealScene (тёмный, отделён от обычных модалок)',
    sizePx: [1920, 1080],
    frameCount: 1,
    anchor: [0, 0],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'overlay',
    status: 'temporary',
  },
  {
    id: 'reveal_pedestal',
    group: 'reveal_effects',
    source: { kind: 'procedural', gen: 'generateRevealPedestal' },
    purpose: 'Стеклянная подставка под раскрываемый гибрид',
    sizePx: [280, 120],
    frameCount: 1,
    anchor: [0.5, 1],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'overlay',
    status: 'temporary',
    note: 'Сам специмен рисуется существующим SpecimenThumbnail/specimenRender.ts (approved) — подставка вокруг него временная.',
  },
];

export function assetById(id: string): AssetManifestEntry | undefined {
  return ASSET_MANIFEST.find((a) => a.id === id);
}
