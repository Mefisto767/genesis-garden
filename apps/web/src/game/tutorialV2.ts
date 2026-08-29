// ============================================================================
// Genetics V2 — Slice 12: детерминированные tutorial fixtures.
//
// Реализует ТОЛЬКО docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.6
// (стартовые генотипы двух обучающих Солнечников + seed RNG первых двух
// обучающих скрещиваний) в объёме Slice 12 из docs/GENETICS_TARGET_DELTA.md
// §12. Чистые данные и чистые предикаты — никакого чтения/записи GameState,
// никакого RNG, никакого store здесь нет. `GameStore` (store.ts) использует
// эти константы/функции, но сама фикстура живёт здесь — тот же принцип, что
// уже применён в labV2.ts/microscopeV2.ts.
//
// Оба обучающих скрещивания идут через настоящий `breedV2` — этот файл НЕ
// подменяет результат, он только даёт вызывающей стороне (store.ts) знать,
// какие два стартовых генома и какой seed использовать, и только пока
// скрещивание реально относится к обучающему контуру (см.
// `shouldSeedTutorialStartersV2`/`tutorialBreedRngSeed` ниже — оба
// предиката специально написаны так, чтобы обычные последующие скрещивания
// и ветеранские save никогда под них не попадали, delta doc §12 Slice 12).
// ============================================================================

import type { GenomeV2 } from './geneticsV2';
import type { GameState } from './types';

function homo<T extends string>(value: T): { a: T; b: T } {
  return { a: value, b: value };
}

/** Первый обучающий Солнечник (contract §4.6.1) — единственный гетерозиготный
 * локус: `size` (несёт скрытый `size_large`). */
export function tutorialSunflowerSeedGenomeV2(): GenomeV2 {
  return {
    stemForm: homo('stem_standard'),
    leafForm: homo('leaf_broad'),
    flowerForm: homo('flower_fan'),
    primaryColor: homo('primary_honey'),
    secondaryColor: homo('secondary_sunset'),
    leafColor: homo('leaf_color_fresh'),
    pattern: homo('pattern_solid'),
    size: { a: 'size_normal', b: 'size_large' },
    aura: homo('aura_faint'),
    speciesId: 1,
    mutationId: null,
  };
}

/** Второй обучающий Солнечник (contract §4.6.2) — идентичен первому на семи
 * из девяти локусов, отличается основным/вторичным цветом. */
export function tutorialSunflowerPollenGenomeV2(): GenomeV2 {
  return {
    ...tutorialSunflowerSeedGenomeV2(),
    primaryColor: homo('primary_coral'),
    secondaryColor: homo('secondary_forest'),
  };
}

/** Seed RNG для первого обучающего скрещивания (contract §4.6.3). */
export const TUTORIAL_FIRST_BREED_SEED = 20260828;

/** Seed RNG для второго обучающего скрещивания (contract §4.6.4) — подобран
 * так, чтобы реальный `breedV2` детерминированно гарантировал требуемые
 * контрактом свойства (без мутации, естественно раскрывает `size_large` у
 * обоих родителей) — см. `mutationV2.test.ts` для прямой проверки на
 * реальном движке. */
export const TUTORIAL_SECOND_BREED_SEED = 6;

/** Seed для конкретного шага (0 — первое обучающее скрещивание, 1 — второе). */
export function tutorialBreedRngSeed(step: 0 | 1): number {
  return step === 0 ? TUTORIAL_FIRST_BREED_SEED : TUTORIAL_SECOND_BREED_SEED;
}

/**
 * Критерий «можно безопасно засеять обучающие фикстуры» — только честно
 * новая игра, ещё ни разу не тронувшая генетику (delta doc §12 Slice 12:
 * "не применяй tutorial-fixtures... к ветеранским save"). Тот же дух, что
 * `hasBreedingHistory` (store.ts), но чуть строже — здесь дополнительно
 * проверяется отсутствие предыдущего запуска этой же функции
 * (`geneticsTutorialStartersSeeded`), чтобы засев был строго одноразовым.
 */
/**
 * Genetics V2 — Slice 12 (onboarding spec §14, delta doc §12 Slice 12,
 * demo replay): точный геном потомка каждого из двух обучающих скрещиваний,
 * записанный ЛИТЕРАЛЬНО (не вызовом `breedV2`) — задание владельца прямо
 * запрещает демонстрационному повтору вызывать `breedV2` вообще, поэтому
 * результат просто переписан из уже подтверждённой контрактной таблицы
 * (§4.6.3/§4.6.4, независимо подтверждено прямым тестом реального `breedV2`
 * на тех же фикстурах в `mutationV2.test.ts`). Единственное отличие двух
 * шагов — локус `size`: `size_normal/size_normal` (не раскрыт) на первом
 * шаге, `size_large/size_large` (раскрыт естественно у обоих родителей) на
 * втором.
 */
export function tutorialReplayChildGenomeV2(step: 0 | 1): GenomeV2 {
  return {
    stemForm: homo('stem_standard'),
    leafForm: homo('leaf_broad'),
    flowerForm: homo('flower_fan'),
    primaryColor: { a: 'primary_honey', b: 'primary_coral' },
    secondaryColor: { a: 'secondary_sunset', b: 'secondary_forest' },
    leafColor: homo('leaf_color_fresh'),
    pattern: homo('pattern_solid'),
    size: step === 0 ? homo('size_normal') : homo('size_large'),
    aura: homo('aura_faint'),
    speciesId: 1,
    mutationId: null,
  };
}

export function shouldSeedTutorialStartersV2(state: Pick<
  GameState,
  'specimens' | 'pityCounter' | 'geneticDust' | 'firstBreedFreeClaimed' | 'geneticsTutorialStartersSeeded'
>): boolean {
  if (state.geneticsTutorialStartersSeeded) return false;
  if (state.firstBreedFreeClaimed) return false;
  if ((state.pityCounter ?? 0) > 0) return false;
  if ((state.geneticDust ?? 0) > 0) return false;
  if (!Array.isArray(state.specimens) || state.specimens.length !== 2) return false;
  return state.specimens.every((s) => !s.parentIds && !s.genomeV2?.mutationId);
}

/**
 * Genetics V2 — Slice 12 fix-pass (contract §4.14.14, owner review §4/§7):
 * single source of truth for "the second tutorial lesson is actually
 * unlocked" — used by BOTH `GameStore.breedNurseryV2` (to decide whether to
 * substitute the deterministic second-lesson RNG/`tutorialBreedStep`) and
 * `LabPanelV2`/`LumiHintBubble` (to decide whether to show the "hidden
 * trait" banner/hint). Deliberately NOT `firstBreedFreeClaimed` alone (owner
 * review §4: "не активировать подсказку только по firstBreedFreeClaimed") —
 * requires ALL of:
 *
 * 1. exactly one tutorial breed done so far (`geneticsTutorialBreedsCompleted
 *    === 1` — the first succeeded, the second has not happened yet);
 * 2. both original tutorial-starter specimens still exist (recycling either
 *    one permanently forfeits the guaranteed second lesson, same as any
 *    other specimen a player chooses to get rid of);
 * 3. the first lesson's own hybrid has matured AND its Reveal has actually
 *    been acknowledged by the player (`tutorialBreedStep===0` specimen with
 *    `revealAcknowledged===true`) — not merely bred, not merely planted.
 *
 * Breeding the same two tutorial-starter specimens again BEFORE this is true
 * is still allowed (nothing else blocks it) — it is simply treated as a
 * perfectly ordinary paid breed (normal RNG, normal cost, no
 * `tutorialBreedStep`), not "the" guaranteed second lesson. The guaranteed,
 * deterministic second lesson only fires once this predicate is actually
 * true.
 */
export function secondTutorialLessonAvailable(
  state: Pick<GameState, 'geneticsTutorialBreedsCompleted' | 'specimens'>
): boolean {
  if ((state.geneticsTutorialBreedsCompleted ?? 0) !== 1) return false;
  const startersStillPresent = state.specimens.filter((s) => s.tutorialStarter === true).length === 2;
  if (!startersStillPresent) return false;
  return state.specimens.some((s) => s.tutorialBreedStep === 0 && s.revealAcknowledged === true);
}
