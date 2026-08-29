import type { PlantColorway } from './plantPalette';
import type { Genome } from './genetics';
import type { GenomeV2, HybridSeedV2, NaturalRevealResultV2, RevealedLocusEntry } from './geneticsV2';
import { GARDEN_CONFIG, type QuestGoalType } from './config';

export interface SeedDef {
  id: string;
  name: string;
  growMs: number;
  buyCost: number;
  sellValue: number;
  /** Вид растения (форма силуэта) из арт-пака — 1..8. */
  speciesId: number;
  /** Фиксированный окрас тира — базовая экономика, без генетики. */
  colorway: PlantColorway;
}

/** Экземпляр с геномом — продукт скрещивания (Этап 2), живёт в коллекции игрока. */
export interface Specimen {
  id: string;
  genome: Genome;
  createdAt: number;
  /**
   * Избранное (Этап 5) — чисто клиентский флаг для быстрой сортировки/защиты
   * от случайной переработки, пока не синхронизируется с сервером.
   * Необязательное поле: у сохранений до Этапа 5 его нет — undefined
   * читается как false, миграция SAVE_VERSION не нужна.
   */
  favorite?: boolean;
  /**
   * Genetics V2 sidecar (Slice 1, GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md
   * §4.1/§4.4). Legacy `genome` выше НЕ удаляется и не переписывается —
   * legacy-движок продолжает читать только его. `genomeV2` заполняется
   * `ensureGenomeV2Sidecars()` (game/geneticsV2.ts) при каждой загрузке save
   * для любого specimen, у которого его ещё нет; undefined до первого
   * прохода backfill. В Slice 1 никакая игровая логика это поле не читает.
   */
  genomeV2?: GenomeV2;
  /** Родословная (Slice 10) — не заполняется в Slice 1. */
  parentIds?: [string, string] | null;
  /** Раскрытые скрытые локусы (Slice 8, delta doc §6.1) — не заполняется в Slice 1. */
  revealedLoci?: RevealedLocusEntry[];
  /**
   * Genetics V2 — Slice 12 (delta doc §12, contract §4.14): помечает один из
   * двух детерминированных tutorial-стартовых Солнечников
   * (`game/tutorialV2.ts`), засеянных `GameStore.seedGeneticsTutorialV2()`.
   * Единственная роль поля — позволить `breedNurseryV2` безопасно определить
   * «это одно из первых двух обучающих скрещиваний» (оба родителя помечены и
   * обучающий счётчик ещё не исчерпан) без обращения к нестабильным `id`.
   * Никогда не устанавливается ни для одного другого specimen (включая
   * потомков этих двух растений) — не наследуется.
   */
  tutorialStarter?: boolean;

  // --- Genetics V2 — Slice 12 fix-pass (contract §4.14.14): Reveal is
  // deferred to first maturity, not shown at breed time. Additive optional
  // fields, no SAVE_VERSION bump — same discipline as `tutorialStarter`
  // above. Persisted lifecycle these fields encode, exactly:
  //   bred unknown seed (HybridSeedV2 in nurseryTray, no Specimen yet)
  //     -> planted/growing (Plot.hybridV2.phase==='growing')
  //     -> mature pending Reveal (Specimen exists, revealAcknowledged:false)
  //     -> Reveal acknowledged (revealAcknowledged:true)

  /**
   * `false` from the moment `GameStore.harvestHybridV2` creates this Specimen
   * (first maturity) until `GameStore.acknowledgeRevealV2` is called;
   * `true` once the player has closed the Reveal screen once — permanently,
   * repeat harvests/reloads never flip it back or re-show the Reveal;
   * `undefined` for any specimen this mechanism does not apply to (legacy
   * specimen, specimen created before this fix-pass, or any specimen that
   * never went through `harvestHybridV2`'s first-maturity branch).
   */
  revealAcknowledged?: boolean;
  /**
   * `[seedSpeciesId, pollenSpeciesId]` captured at first maturity — lets the
   * Reveal screen render correct "От первого/второго растения" / "← [вид]"
   * origin labels even if a parent is later recycled before the player
   * actually looks at the Reveal (parents remain in the collection after
   * breeding, but nothing prevents the player from recycling one before
   * planting/harvesting the resulting seed).
   */
  revealParentSpecies?: [number, number];
  /**
   * Which loci, if any, were naturally revealed on the seed/pollen parent by
   * THIS specimen's first maturity (`computeNaturalRevealsV2`, revealV2.ts)
   * — captured once at harvest time so the Reveal screen's "Этот признак был
   * скрыт..." text reflects exactly this harvest's natural reveal, not a
   * recomputation against whatever the parents' genomes/revealedLoci happen
   * to look like whenever the player eventually opens the Reveal screen.
   */
  revealNaturalReveal?: NaturalRevealResultV2;
  /**
   * Which of the two guaranteed tutorial breeds (contract §4.6.3/§4.6.4)
   * produced this specimen — `0` first lesson, `1` second lesson,
   * `undefined` for any non-tutorial specimen. Copied from
   * `HybridSeedV2.tutorialBreedStep` at first maturity; lets
   * `tutorialV2.ts secondTutorialLessonAvailable` find "the first lesson's
   * hybrid, actually revealed" unambiguously.
   */
  tutorialBreedStep?: 0 | 1;
}

/**
 * Genetics V2 nursery lifecycle (Slice 5,
 * docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.8.1). Единственный
 * источник истины по посаженному/зрелому V2-гибриду на грядке — сознательно
 * НЕ отдельный массив `GameState.plantedHybrids` (владелец, pre-Slice-5
 * contract-lock pass).
 *
 * `growing` хранит ПОЛНЫЙ `HybridSeedV2` (включая `genomeV2`) — тот же
 * объект, что лежал в `nurseryTray`, без пересборки; геном игроку не
 * показывается до созревания (ограничение UI, не данных).
 *
 * `mature` хранит только `specimenId`/`lastHarvestAt` — геном/фенотип/
 * родословная читаются исключительно из `GameState.specimens`, не
 * дублируются здесь. Присутствие `mature`-состояния с уже установленным
 * `specimenId` — единственный и достаточный идемпотентный guard против
 * повторного создания `Specimen` (см. `store.ts` `harvestHybridV2`).
 */
export type PlotHybridV2 =
  | { phase: 'growing'; hybrid: HybridSeedV2 }
  | { phase: 'mature'; specimenId: string; lastHarvestAt: number };

export interface Plot {
  id: number;
  unlocked: boolean;
  seedId: string | null;
  plantedAt: number | null;
  /**
   * Genetics V2 nursery lifecycle (Slice 5) — аддитивное nullable поле.
   * Отсутствует/`undefined` у любой грядки, никогда не тронутой V2-кодом
   * (Classic, Overhaul+Legacy, старые save до Slice 5) — не требует миграции
   * или бампа `SAVE_VERSION` (contract §4.8.9).
   *
   * Инвариант: `hybridV2` (в любой фазе) и legacy-посадка (`seedId!==null`)
   * никогда не сосуществуют на одной грядке одновременно — обеспечивается
   * проверками в `GameStore.plantSeed()`/`GameStore.plantHybridSeedV2()`, не
   * структурой типа.
   */
  hybridV2?: PlotHybridV2 | null;
}

/** Временный буст (сейчас пусто — Этап 7 заполнит покупками ускорений). */
export interface Entitlement {
  id: string;
  type: 'growth_boost';
  /** Доля ускорения, напр. 0.1 = +10% к скорости роста. */
  percent: number;
  /** null = бессрочно (не используется в MVP, задел на сезонные покупки). */
  expiresAt: number | null;
}

export interface GameState {
  coins: number;
  plots: Plot[];
  inventory: Record<string, number>;
  /** Коллекция экземпляров с геномом — Этап 2. */
  specimens: Specimen[];
  /** Побочный ресурс от скрещивания; задел под будущую экономику (Этап 4). */
  geneticDust: number;
  /** Счётчик скрещиваний без мутации гена — pity-система. */
  pityCounter: number;
  /** Прогресс по квестам: questId -> текущий счётчик. */
  questProgress: Record<string, number>;
  /** id квестов, награда за которые уже забрана. */
  questsClaimed: string[];
  /** Активные ускорители (сейчас всегда []; Этап 7 подключит покупки). */
  entitlements: Entitlement[];

  // --- Genetics V2 — Slice 1 (save/state/feature flags), см.
  // docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.1 и
  // docs/GENETICS_TARGET_DELTA.md §12 Slice 1. Никакая игровая логика,
  // кроме миграции default-значений, эти поля в Slice 1 не читает и не
  // пишет — экономика/UI/breed подключаются в Slice 3+.

  /** Пыльца — новая валюта Genetics V2 (Slice 6). В Slice 1 только хранится. */
  pollen: number;
  /** Уровень лаборатории (1-4). В Slice 1 только мигрирует/хранится. */
  labLevel: number;
  /** Nursery Tray, вместимость 8 (Slice 5). В Slice 1 всегда пуст. */
  nurseryTray: HybridSeedV2[];
  /** Бесплатное первое скрещивание уже использовано (delta doc §6.2). */
  firstBreedFreeClaimed: boolean;
  /** Обучающий грант пыльцы + открытие Колокольника/Lab L2 уже выдан (delta doc §6.2). */
  firstHybridRewardClaimed: boolean;
  /** Компенсация пыли до 3 при первой переработке уже выдана (delta doc §6.2). */
  firstRecycleTopUpClaimed: boolean;

  // --- Genetics V2 — Slice 12 (Reveal, контекстный onboarding, Люми-
  // подсказки, Ботаническая книга), см. docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md
  // §4.14 и docs/GENETICS_TARGET_DELTA.md §12 Slice 12. Аддитивные
  // ОПЦИОНАЛЬНЫЕ поля (без бампа SAVE_VERSION, тот же приём, что
  // `Plot.hybridV2`) — старый V4-save без них читает `undefined` как честный
  // "ещё не видел"/"ещё не засеяно"/0/[] дефолт всюду, где эти поля
  // читаются (store.ts) — миграция не нужна, `SAVE_VERSION` остаётся 4.

  /** Одноразовый засев двух tutorial-Солнечников контрактным геномом
   * (`tutorialV2.ts`) уже выполнен — `GameStore.seedGeneticsTutorialV2()`
   * идемпотентен благодаря этому флагу. `undefined`/`false` — ещё нет
   * (включая любой существующий V4-save до Slice 12 — ветеранский или нет). */
  geneticsTutorialStartersSeeded?: boolean;
  /** Сколько из двух обучающих V2-скрещиваний (contract §4.6.3/§4.6.4) уже
   * реально прошли через `breedV2` с зафиксированным seed — 0, 1 или 2.
   * `undefined` читается как 0. После 2 обычные последующие скрещивания той
   * же пары (или любой другой) используют обычный `this.rng`, не seed. */
  geneticsTutorialBreedsCompleted?: number;
  /** Первый контекстный экран объяснения генетики (onboarding spec §3.1) уже
   * показан и закрыт кнопкой «Понятно, начать». `undefined`/`false` — ещё
   * нет. Не путать с legacy `hasSeenOnboarding()` (`onboardingState.ts`) —
   * два независимых флага для двух разных обучающих потоков (onboarding
   * spec §14). */
  geneticsIntroSeen?: boolean;
  /** Ключи уже показанных Люми-подсказок (onboarding spec §7) — once-per-
   * event, `undefined` читается как []. */
  lumiHintsShown?: string[];
}

export type { QuestGoalType };
export const MAX_PLOTS = GARDEN_CONFIG.maxPlots;
export const START_UNLOCKED_PLOTS = GARDEN_CONFIG.startUnlockedPlots;
