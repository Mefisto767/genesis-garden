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
    purpose: 'Ворота на границе сектора (2 из 4 boundary transitions — восток/юг)',
    sizePx: [96, 64],
    frameCount: 1,
    anchor: [0.5, 1],
    collisionBox: [-48, -64, 96, 64],
    animationFps: null,
    sortLayer: 'world-object',
    status: 'temporary',
    note: 'Честная "заглушка будущего": подпись "Скоро" вместо попытки нарисовать реальные ворота.',
  },
  {
    id: 'prop_ruined_passage',
    group: 'paths_water_fences',
    source: { kind: 'procedural', gen: 'generateRuinedPassageTexture' },
    purpose: 'Разрушенный проход на границе сектора (2 из 4 boundary transitions — север/запад)',
    sizePx: [90, 70],
    frameCount: 1,
    anchor: [0.5, 1],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'world-object',
    status: 'temporary',
    note: 'Вариация того же приёма, что fence_gate, но другой силуэт (осыпавшиеся колонны) — по ТЗ допускаются оба варианта "ворота или разрушенные проходы".',
  },
  {
    id: 'landmark_clearing',
    group: 'paths_water_fences',
    source: { kind: 'procedural', gen: 'generateLandmarkClearingTexture' },
    purpose: 'Расчищенная поляна на месте зарезервированного landmark_central (см. estateBlueprint.ts)',
    sizePx: [64, 64],
    frameCount: 1,
    anchor: [0.5, 0.5],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'ground-decor',
    status: 'temporary',
    note: 'Никакого монумента не нарисовано — только нейтрально расчищенный участок земли, честно "место зарезервировано".',
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
    purpose: 'Теплица — reserved building slot зоны "Рабочая ферма" (см. docs/ESTATE_LAYOUT_BLUEPRINT.md), в Stage-1 не рендерится',
    sizePx: [1024, 1024],
    frameCount: 1,
    anchor: [0.5, 0.92],
    collisionBox: [-130, -150, 260, 170],
    animationFps: null,
    sortLayer: 'world-object',
    status: 'approved',
    note: 'Зона "Рабочая ферма" ещё закрыта (status: reserved в estateBlueprint.ts) — здание существует как ассет, но не размещено в открытом стартовом секторе. Было временно видно в предыдущей версии вертикального среза; теперь корректно вынесено в свою зону.',
  },
  {
    id: 'building_storage_shed',
    group: 'buildings',
    source: { kind: 'procedural', gen: 'generateStorageShedTexture' },
    purpose: 'Небольшой склад стартового сада (building_storage slot, см. estateBlueprint.ts)',
    sizePx: [70, 70],
    frameCount: 1,
    anchor: [0.5, 0.92],
    collisionBox: [-22, -24, 44, 24],
    animationFps: null,
    sortLayer: 'world-object',
    status: 'temporary',
    note: 'Честный процедурный силуэт сарая — отдельный от building_house (тот временно переиспользует building_storage.png v0.3-пака), чтобы два разных здания не выглядели одинаково.',
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

  // ---- companion Lumi (см. lumiBehavior.ts + docs/ESTATE_LAYOUT_BLUEPRINT.md) -
  // Только idle/glow/station реализованы простыми временными представлениями
  // на этом этапе (Task3: "пока используются только простые временные
  // представления"). move/point/work честно НЕ нарисованы — заглушки под них
  // не создавались, чтобы не подделывать позы, которых на самом деле нет.
  {
    id: 'companion_lumi_idle',
    group: 'companion_lumi',
    source: { kind: 'procedural', gen: 'generateLumiIdleTexture' },
    purpose: 'Базовый вид Люми — используется и для idle, и для follow (поза не меняется на этом этапе)',
    sizePx: [28, 36],
    frameCount: 1,
    anchor: [0.5, 0.92],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'actor',
    status: 'temporary',
    note: 'Латунный корпус-семя + стеклянная колба + росток, нарисовано Phaser Graphics. Не финальный арт — ждёт партии по разделу "Люми" GDD.',
  },
  {
    id: 'companion_lumi_move',
    group: 'companion_lumi',
    source: { kind: 'procedural', gen: 'n/a' },
    purpose: 'Отдельная поза движения Люми (будущее — сейчас переиспользуется companion_lumi_idle)',
    sizePx: [28, 36],
    frameCount: 0,
    anchor: [0.5, 0.92],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'actor',
    status: 'missing',
  },
  {
    id: 'companion_lumi_point',
    group: 'companion_lumi',
    source: { kind: 'procedural', gen: 'n/a' },
    purpose: 'Отдельная поза "указывает на объект" (будущее — сейчас передаётся только состоянием, без новой графики)',
    sizePx: [28, 36],
    frameCount: 0,
    anchor: [0.5, 0.92],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'actor',
    status: 'missing',
  },
  {
    id: 'companion_lumi_work',
    group: 'companion_lumi',
    source: { kind: 'procedural', gen: 'n/a' },
    purpose: 'Поза "занята помощью" — поздняя функция (ежедневная помощь), не реализована в этом этапе',
    sizePx: [28, 36],
    frameCount: 0,
    anchor: [0.5, 0.92],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'actor',
    status: 'missing',
  },
  {
    id: 'companion_lumi_glow',
    group: 'companion_lumi',
    source: { kind: 'procedural', gen: 'generateLumiGlowTexture' },
    purpose: 'Пульсирующее свечение живого ростка внутри колбы Люми',
    sizePx: [20, 20],
    frameCount: 1,
    anchor: [0.5, 0.5],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'actor',
    status: 'temporary',
    note: 'Alpha-tween поверх companion_lumi_idle, тот же приём, что мерцание воды (tile_water_alt) — не отдельный спрайт-лист.',
  },
  {
    id: 'building_lumi_station',
    group: 'companion_lumi',
    source: { kind: 'procedural', gen: 'generateLumiStationTexture' },
    purpose: 'Станция/насест Люми в стартовом саду (см. estateBlueprint.ts building_lumi_station slot)',
    sizePx: [44, 56],
    frameCount: 1,
    anchor: [0.5, 0.92],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'world-object',
    status: 'temporary',
    note: 'Не блокирует движение намеренно (см. lumiBehavior.ts) — декоративная точка появления/отдыха Люми, не здание с коллизией.',
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

  // ---- Art Vertical Slice A (см. docs/ART_VERTICAL_SLICE_A.md) -------------
  {
    id: 'plot_empty',
    group: 'art_vertical_slice_a',
    source: { kind: 'file', path: 'assets/tiles/plot_empty.png' },
    purpose: 'Базовый тайл грядки — первый production-art ассет, заменяет tile_soil для незаблокированных грядок',
    sizePx: [64, 64],
    frameCount: 1,
    anchor: [0.5, 0.5],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'ground-decor',
    status: 'approved',
  },
  {
    id: 'plant_hybrid_unrevealed',
    group: 'art_vertical_slice_a',
    source: { kind: 'file', path: 'assets/plants/plant_hybrid_unrevealed.png' },
    purpose: 'Нейтральный species-neutral спрайт гибрида (hybridV2 phase=growing, до Reveal) — не раскрывает фенотип/редкость',
    sizePx: [64, 96],
    frameCount: 1,
    anchor: [0.5, 1],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'world-object',
    status: 'approved',
  },
  {
    id: 'plant_sunflower_mature',
    group: 'art_vertical_slice_a',
    source: { kind: 'file', path: 'assets/plants/plant_sunflower_mature.png' },
    purpose: 'Mature-рендер только для speciesId===1 (Солнечник) с primary===primary_coral; любой другой фенотип остаётся на процедурном рендере',
    sizePx: [64, 96],
    frameCount: 1,
    anchor: [0.5, 1],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'world-object',
    status: 'approved',
  },

  // ---- Environment Art Slice B (см. docs/ENVIRONMENT_ART_SLICE_B.md) -------
  // Six 32×32 material textures, composited deterministically per adjacency
  // mask by overhaul/terrainTextures.ts (pure mask/hash logic in
  // overhaul/terrainComposition.ts) — replaces the four procedural
  // grass/path/water/thicket prototype tiles above.
  {
    id: 'tile_grass_v1',
    group: 'environment_art_slice_b',
    source: { kind: 'file', path: 'assets/terrain/tile_grass_v1.png' },
    purpose: 'Базовый материал травы всего открытого сектора',
    sizePx: [32, 32],
    frameCount: 1,
    anchor: [0, 0],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'ground',
    status: 'approved',
  },
  {
    id: 'tile_grass_v1_alt',
    group: 'environment_art_slice_b',
    source: { kind: 'file', path: 'assets/terrain/tile_grass_v1_alt.png' },
    purpose: 'Разреженная вариация травы, выбирается чистым хэшем (col,row) — не игровым RNG',
    sizePx: [32, 32],
    frameCount: 1,
    anchor: [0, 0],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'ground',
    status: 'approved',
  },
  {
    id: 'tile_path_earth_v1',
    group: 'environment_art_slice_b',
    source: { kind: 'file', path: 'assets/terrain/tile_path_earth_v1.png' },
    purpose: 'Материал дорожки — заливка внутри органичной формы, композитится по 4-битной маске связности (terrainTextures.ts)',
    sizePx: [32, 32],
    frameCount: 1,
    anchor: [0, 0],
    collisionBox: null,
    animationFps: null,
    sortLayer: 'ground',
    status: 'approved',
  },
  {
    id: 'tile_water_v1',
    group: 'environment_art_slice_b',
    source: { kind: 'file', path: 'assets/terrain/tile_water_v1.png' },
    purpose: 'Базовый кадр пруда — заливка внутри органичной формы, берег строится из воды/не-воды adjacency',
    sizePx: [32, 32],
    frameCount: 1,
    anchor: [0, 0],
    collisionBox: [0, 0, 32, 32],
    animationFps: null,
    sortLayer: 'ground',
    status: 'approved',
  },
  {
    id: 'tile_water_v1_alt',
    group: 'environment_art_slice_b',
    source: { kind: 'file', path: 'assets/terrain/tile_water_v1_alt.png' },
    purpose: 'Кадр мерцания пруда — alpha-tween поверх базового кадра, отключается при prefers-reduced-motion',
    sizePx: [32, 32],
    frameCount: 1,
    anchor: [0, 0],
    collisionBox: null,
    animationFps: 1,
    sortLayer: 'ground',
    status: 'approved',
    note: 'Не отдельная коллизия — коллизия пруда уже задаётся tile_water_v1/POND, этот кадр только presentational.',
  },
  {
    id: 'tile_thicket_v1',
    group: 'environment_art_slice_b',
    source: { kind: 'file', path: 'assets/terrain/tile_thicket_v1.png' },
    purpose: 'Материал непроходимой границы сектора — рисуется напрямую, без компоновки по маске (не требуется контрактом)',
    sizePx: [32, 32],
    frameCount: 1,
    anchor: [0, 0],
    collisionBox: [0, 0, 32, 32],
    animationFps: null,
    sortLayer: 'ground',
    status: 'approved',
  },
];

export function assetById(id: string): AssetManifestEntry | undefined {
  return ASSET_MANIFEST.find((a) => a.id === id);
}
