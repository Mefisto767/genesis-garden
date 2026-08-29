// ============================================================================
// Genetics V2 — Slice 3: одновидовое наследование. Slice 9 (contract §4.12)
// снимает запрет на межвидовые пары 1×2/2×1 — см. правки ниже.
//
// Реализует ТОЛЬКО docs/GENETICS_TARGET_DELTA.md §4.1 (обычное наследование,
// без mutation roll) и §3 (политика доступа legacy species 3-8), в объёме
// Slice 3 из §12: чистый engine-код над уже существующей схемой `GenomeV2`
// (Slice 1) и резолвером `expressPhenotype` (Slice 2) — БЕЗ mutation
// roll/pity (Slice 4), БЕЗ store/GameStore/коллекции/Nursery Tray, БЕЗ
// React/UI/Phaser. Эти функции сознательно не реализованы в этом файле.
//
// Engine этого файла поддерживает ровно четыре комбинации родителей —
// species1×species1, species2×species2, species1×species2, species2×species1
// (contract §4.12, Slice 9 сняло прежний запрет на последние две) — species
// 3-8 как родители (Slice 11 снимает эту политику доступа для V2, не раньше)
// здесь не реализуются, только детерминированно отклоняются с явной причиной.
// ============================================================================

import type { AllelePair, GenomeV2 } from './geneticsV2';
import type { RngFn } from './rng';

/**
 * Один диплоидный коинфлип (contract §4.1, delta doc §4.1 — прямое
 * расширение уже существующего `inherit(a,b,rng)` из `genetics.ts:65-67` на
 * уровень отдельного аллеля, а не целого гена). Всегда возвращает ровно один
 * из двух переданных аллелей — никогда третье/смешанное значение и никогда
 * случайное значение стороннего пула (задание, п.3 — старый независимый
 * `GENE_MUTATE_CHANCE` не переносится в V2 ни в каком виде).
 */
export function inheritAlleleV2<T extends string>(pair: AllelePair<T>, rng: RngFn): T {
  return rng() < 0.5 ? pair.a : pair.b;
}

/**
 * Виды, которых engine этого slice поддерживает как родителей V2 (задание,
 * п.8) — Солнечник (`1`) и Колокольник (`2`). Species 3-8 физически не
 * запрещены резолвером фенотипа (Slice 2, `phenotypeV2.ts` — их мигрировавший
 * фенотип уже читается корректно), но не могут быть родителями до Slice 11
 * (delta doc §3 п.3) — здесь это ограничение проверяется до любого RNG.
 */
const SUPPORTED_PARENT_SPECIES_V2: readonly number[] = [1, 2];

/** Discriminated-контракт причины отказа скрещивания (задание — «безопасный
 * discriminated result... без разбора текста исключения»). Ровно одна
 * причина с Slice 9 (contract §4.12): `unsupported_species` — хотя бы один
 * родитель вне species 1-2 (Slice 11 ещё не реализован). Прежняя причина
 * `interspecies_locked` (оба родителя из поддерживаемого набора 1-2, но
 * разных видов) удалена этим slice — пары 1×2/2×1 больше не отклоняются. */
export type BreedRejectionReasonV2 = 'unsupported_species';

/**
 * Валидация пары родителей ДО любого обращения к RNG (задание, п.11 —
 * «отклонённая операция не должна потреблять RNG»). Переименована со Slice 9
 * (contract §4.12) из `validateSameSpeciesParentsV2` — имя больше не
 * подразумевает «только один вид»: функция проверяет ТОЛЬКО, что оба
 * родителя входят в уже поддерживаемый V2-набор (species 1-2), и ничего не
 * говорит о совпадении/несовпадении видов между собой — прежняя вторая,
 * отклоняющая межвидовые пары ветка снята этим slice.
 */
export function validateSupportedParentsV2(
  seedSpeciesId: number,
  pollenSpeciesId: number
): { ok: true } | { ok: false; reason: BreedRejectionReasonV2 } {
  if (
    !SUPPORTED_PARENT_SPECIES_V2.includes(seedSpeciesId) ||
    !SUPPORTED_PARENT_SPECIES_V2.includes(pollenSpeciesId)
  ) {
    return { ok: false, reason: 'unsupported_species' };
  }
  return { ok: true };
}

/**
 * Чистое наследование полного `GenomeV2` (задание, п.1-2 — ПОСЛЕ того, как
 * пара родителей уже прошла валидацию видов). Потомок получает по одному
 * аллелю от каждого родителя на каждый из девяти локусов: `a` — от Seed
 * Parent, `b` — от Pollen Parent (задание, п.2 — фиксированное соответствие
 * поля/родителя, не два независимых коинфлипа на родителя). Ровно 18 RNG
 * draws — по два на локус (contract §4.7.3, шаг 4): по одному вызову
 * `inheritAlleleV2` на выбор аллеля Seed Parent и на выбор аллеля Pollen
 * Parent для каждого локуса.
 *
 * `speciesId` копируется от Seed Parent целиком, без RNG (задание, п.5).
 * `mutationId` потомка без mutation event — всегда `null` (задание, п.6):
 * родительские `mutationId` никогда не участвуют в наследовании — эта
 * функция их даже не читает. Mutation event (Slice 4) — отдельный шаг,
 * применяемый ПОСЛЕ вызова этой функции, не внутри неё.
 *
 * Не мутирует ни `seedGenome`, ни `pollenGenome` — строит новый объект.
 */
export function inheritGenomeV2(seedGenome: GenomeV2, pollenGenome: GenomeV2, rng: RngFn): GenomeV2 {
  return {
    stemForm: {
      a: inheritAlleleV2(seedGenome.stemForm, rng),
      b: inheritAlleleV2(pollenGenome.stemForm, rng),
    },
    leafForm: {
      a: inheritAlleleV2(seedGenome.leafForm, rng),
      b: inheritAlleleV2(pollenGenome.leafForm, rng),
    },
    flowerForm: {
      a: inheritAlleleV2(seedGenome.flowerForm, rng),
      b: inheritAlleleV2(pollenGenome.flowerForm, rng),
    },
    primaryColor: {
      a: inheritAlleleV2(seedGenome.primaryColor, rng),
      b: inheritAlleleV2(pollenGenome.primaryColor, rng),
    },
    secondaryColor: {
      a: inheritAlleleV2(seedGenome.secondaryColor, rng),
      b: inheritAlleleV2(pollenGenome.secondaryColor, rng),
    },
    leafColor: {
      a: inheritAlleleV2(seedGenome.leafColor, rng),
      b: inheritAlleleV2(pollenGenome.leafColor, rng),
    },
    pattern: {
      a: inheritAlleleV2(seedGenome.pattern, rng),
      b: inheritAlleleV2(pollenGenome.pattern, rng),
    },
    size: {
      a: inheritAlleleV2(seedGenome.size, rng),
      b: inheritAlleleV2(pollenGenome.size, rng),
    },
    aura: {
      a: inheritAlleleV2(seedGenome.aura, rng),
      b: inheritAlleleV2(pollenGenome.aura, rng),
    },
    speciesId: seedGenome.speciesId,
    mutationId: null,
  };
}

/** Успешный результат скрещивания поддерживаемой пары (species 1-2, любая из
 * четырёх комбинаций — Slice 9, contract §4.12) — только унаследованный
 * геном, без mutation/rarity/phenotype (те приходят со Slice 4, полный
 * `breedV2`, поверх этого же примитива). Переименовано со Slice 9 из
 * `BreedSameSpeciesSuccessV2` — имя больше не подразумевает «только один
 * вид». */
export interface BreedSupportedSpeciesSuccessV2 {
  ok: true;
  genomeV2: GenomeV2;
}

export interface BreedSupportedSpeciesFailureV2 {
  ok: false;
  reason: BreedRejectionReasonV2;
}

export type BreedSupportedSpeciesResultV2 = BreedSupportedSpeciesSuccessV2 | BreedSupportedSpeciesFailureV2;

/**
 * Engine этого файла целиком: валидация поддерживаемых родителей (без RNG,
 * §4.12) → наследование (18 draws) — для любой из четырёх комбинаций
 * species1×species1/species2×species2/species1×species2/species2×species1.
 * Отклонённая пара не вызывает `inheritGenomeV2` вообще — значит, не
 * потребляет RNG (задание, п.11) — проверено явным regression-тестом
 * (счётчик вызовов `rng`, не просто «результат корректный»). Переименовано
 * со Slice 9 из `breedSameSpeciesV2`.
 */
export function breedSupportedSpeciesV2(
  seedGenome: GenomeV2,
  pollenGenome: GenomeV2,
  rng: RngFn
): BreedSupportedSpeciesResultV2 {
  const validation = validateSupportedParentsV2(seedGenome.speciesId, pollenGenome.speciesId);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }
  return { ok: true, genomeV2: inheritGenomeV2(seedGenome, pollenGenome, rng) };
}
