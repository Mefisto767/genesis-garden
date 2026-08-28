// ============================================================================
// Genetics V2 — Slice 4: mutation roll, pity и полный `breedV2`.
//
// Реализует docs/GENETICS_TARGET_DELTA.md §4.2/§4.3 (pity-кривая, тиры
// мутации, каталог) и docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.7
// (точное правило mutation-аллеля + обязательный RNG call order), в объёме
// Slice 4 из delta-документа §12: интеграция mutation-события в `breedV2`
// как дополнительный шаг ДО обычного наследования (по порядку RNG-вызовов),
// но ПОСЛЕ валидации видов (Slice 3, `inheritanceV2.ts`) — эта функция не
// переопределяет ни валидацию, ни само наследование, а оборачивает их.
//
// Никакого store/GameStore/коллекции/Nursery Tray/пыльцы/переработки/
// микроскопа/межвидового скрещивания/родословной/Reveal/UI здесь нет и не
// должно быть — только чистый engine-код.
// ============================================================================

import type { AllelePair, AuraAllele, GenomeV2, MutationIdV2 } from './geneticsV2';
import type { RngFn } from './rng';
import {
  inheritGenomeV2,
  validateSameSpeciesParentsV2,
  type BreedRejectionReasonV2,
} from './inheritanceV2';
import { resolvePhenotypeV2, type PhenotypeV2 } from './phenotypeV2';
import { MUTATION_TIER_BY_ID, naturalScoreOfV2, rarityOfV2, type MutationTierV2, type RarityTierV2 } from './rarityV2';

// ----------------------------------------------------------------------------
// Pity-кривая (delta doc §4.2) — шанс mutation-события по текущему
// `pityCounter` (0..9, индекс = номер попытки-1 после последней мутации).
// Число попыток начинается заново (pityCounter=0) сразу после успешного
// mutation event — не после любого обычного скрещивания.
// ----------------------------------------------------------------------------
const PITY_CHANCE_BY_COUNTER: readonly number[] = [
  0.03, // pityCounter=0 -> попытка 1 -> 3%
  0.04, // pityCounter=1 -> попытка 2 -> 4%
  0.05, // pityCounter=2 -> попытка 3 -> 5%
  0.06, // pityCounter=3 -> попытка 4 -> 6%
  0.07, // pityCounter=4 -> попытка 5 -> 7%
  0.08, // pityCounter=5 -> попытка 6 -> 8%
  0.09, // pityCounter=6 -> попытка 7 -> 9%
  0.1, // pityCounter=7 -> попытка 8 -> 10%
  0.11, // pityCounter=8 -> попытка 9 -> 11%
  1, // pityCounter=9 -> попытка 10 -> 100% (гарантия)
];

/** Тот же принцип, что `migratePityCounter` в `store.ts` — защитно приводит
 * pityCounter к целому числу в диапазоне 0..9, не доверяя вызывающей
 * стороне слепо. Не читает и не пишет никакой `GameState`/`Specimen` —
 * чистая функция над переданным числом. */
function clampPityCounter(pityCounter: number): number {
  return Math.min(9, Math.max(0, Math.floor(pityCounter)));
}

/** Экспортируется для прямого unit-тестирования всех 10 ступеней кривой,
 * не только косвенно через `breedV2`. */
export function mutationEventChance(pityCounter: number): number {
  return PITY_CHANCE_BY_COUNTER[clampPityCounter(pityCounter)];
}

// ----------------------------------------------------------------------------
// Выбор тира и mutationId внутри успешного mutation event (delta doc §4.3,
// §9; contract §4.5.3). Веса тира — 70/25/5, не пересматриваются здесь.
// ----------------------------------------------------------------------------

const MINOR_MAJOR_BOUNDARY = 0.7; // [0, 0.70) -> Minor
const MAJOR_SIGNATURE_BOUNDARY = 0.95; // [0.70, 0.95) -> Major; [0.95, 1) -> Signature

export function rollMutationTier(rng: RngFn): MutationTierV2 {
  const draw = rng();
  if (draw < MINOR_MAJOR_BOUNDARY) return 'Minor';
  if (draw < MAJOR_SIGNATURE_BOUNDARY) return 'Major';
  return 'Signature';
}

/**
 * Обратный индекс тир -> список ID, построенный из `MUTATION_TIER_BY_ID`
 * (Slice 3, `rarityV2.ts`) — единственный источник истины для «какой ID
 * какого тира», не дублируется здесь заново. Порядок внутри каждого списка
 * — порядок ключей `MUTATION_TIER_BY_ID` (стабильный порядок вставки
 * строковых ключей объекта в JS) — детерминирован, не имеет значения для
 * равновероятного выбора ниже.
 */
const MUTATION_IDS_BY_TIER: Record<MutationTierV2, MutationIdV2[]> = { Minor: [], Major: [], Signature: [] };
(Object.keys(MUTATION_TIER_BY_ID) as MutationIdV2[]).forEach((id) => {
  MUTATION_IDS_BY_TIER[MUTATION_TIER_BY_ID[id]].push(id);
});

/** Равновероятный выбор конкретного `mutationId` СТРОГО внутри переданного
 * тира — физически не может вернуть ID другого тира, потому что список
 * кандидатов уже отфильтрован по тиру до вызова `rng()`. */
export function rollMutationId(tier: MutationTierV2, rng: RngFn): MutationIdV2 {
  const candidates = MUTATION_IDS_BY_TIER[tier];
  const index = Math.min(candidates.length - 1, Math.floor(rng() * candidates.length));
  return candidates[index];
}

// ----------------------------------------------------------------------------
// Применение mutation-аллеля к унаследованной паре `aura` (contract §4.7.2).
// ----------------------------------------------------------------------------

export function rollAuraMutationSide(rng: RngFn): 'a' | 'b' {
  return rng() < 0.5 ? 'a' : 'b';
}

/**
 * Три взаимоисключающих случая (contract §4.7.2): ни одного `aura_radiant`
 * -> выбранный draw'ом слот заменяется; ровно один -> заменяется ВТОРОЙ
 * (детерминированно, не тем же draw'ом); оба -> без изменений. `side`
 * передаётся уже выбранным (draw потреблён ранее, в `breedV2`, независимо
 * от того, действительно ли он здесь используется) — эта функция сама
 * никогда не обращается к RNG.
 */
export function applyMutationAlleleToAura(
  pair: AllelePair<AuraAllele>,
  side: 'a' | 'b'
): AllelePair<AuraAllele> {
  const aRadiant = pair.a === 'aura_radiant';
  const bRadiant = pair.b === 'aura_radiant';

  if (aRadiant && bRadiant) return pair;
  if (aRadiant !== bRadiant) {
    return aRadiant ? { a: pair.a, b: 'aura_radiant' } : { a: 'aura_radiant', b: pair.b };
  }
  return side === 'a' ? { a: 'aura_radiant', b: pair.b } : { a: pair.a, b: 'aura_radiant' };
}

// ----------------------------------------------------------------------------
// breedV2 — полный engine: валидация видов (Slice 3) -> mutation event
// (Slice 4) -> наследование (Slice 3, `inheritGenomeV2`) -> применение
// mutation-аллеля -> phenotype/naturalScore/rarity (Slice 2/3).
// ----------------------------------------------------------------------------

/** Успешный результат — минимум полей из задания владельца: итоговый
 * геном, выраженный фенотип, naturalScore, итоговая rarity, флаг мутации,
 * тир/ID мутации (`null`, если события не было) и pity для следующей
 * попытки. НИКАКИХ изменений `GameState`/`Specimen`/коллекции здесь и не
 * возникает — вызывающая сторона (будущий Slice 5+, вне объёма этого
 * прохода) сама решает, что делать с этим результатом. */
export interface BreedV2SuccessResult {
  ok: true;
  genomeV2: GenomeV2;
  phenotype: PhenotypeV2;
  naturalScore: number;
  rarity: RarityTierV2;
  mutated: boolean;
  mutationTier: MutationTierV2 | null;
  mutationId: MutationIdV2 | null;
  nextPityCounter: number;
}

/** Отклонённый результат — не содержит `nextPityCounter`: отклонённая
 * валидацией видов операция не меняет pity вообще (задание, Slice 3 п.11 +
 * Slice 4 «pity не сбрасывается по другим причинам»), у вызывающей стороны
 * просто остаётся её собственный, не тронутый этим вызовом pityCounter. */
export interface BreedV2FailureResult {
  ok: false;
  reason: BreedRejectionReasonV2;
}

export type BreedV2Result = BreedV2SuccessResult | BreedV2FailureResult;

/**
 * `breedV2` (delta doc §12 Slice 3+4, contract §4.7.3 — обязательный RNG
 * call order). Порядок операций и RNG-вызовов:
 *
 * 1. Валидация видов (Slice 3, БЕЗ RNG) — при отказе возвращает `{ok:false}`
 *    немедленно, ни одного вызова `rng()` не происходит, `pityCounter`
 *    вызывающей стороны не нужно менять (эта функция его и не видела бы).
 * 2. Mutation-event roll — ОДИН draw, всегда, даже при гарантированных
 *    100% на `pityCounter=9` (contract §4.7.3, шаг 1).
 * 3. Если событие сработало — ровно три дополнительных draw'а (тир, ID
 *    внутри тира, сторона мутации для `aura`) — сторона потребляется, даже
 *    если по факту не понадобится (оба/один аллель уже `aura_radiant`).
 * 4. Ровно 18 inheritance draws (`inheritGenomeV2`, Slice 3) — всегда,
 *    независимо от исхода mutation event, и всегда ПОСЛЕ шагов 2-3.
 * 5. Если событие сработало — mutation-аллель применяется к УЖЕ
 *    унаследованной паре `aura` (шаг 4), не до неё.
 */
export function breedV2(
  seedGenome: GenomeV2,
  pollenGenome: GenomeV2,
  pityCounter: number,
  rng: RngFn
): BreedV2Result {
  const validation = validateSameSpeciesParentsV2(seedGenome.speciesId, pollenGenome.speciesId);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }

  const currentPity = clampPityCounter(pityCounter);
  const chance = PITY_CHANCE_BY_COUNTER[currentPity];

  // Шаг 2 — event-roll, ВСЕГДА один draw, до всего остального.
  const eventDraw = rng();
  const mutated = eventDraw < chance;

  let mutationTier: MutationTierV2 | null = null;
  let mutationId: MutationIdV2 | null = null;
  let auraMutationSide: 'a' | 'b' = 'a';

  if (mutated) {
    // Шаг 3 — ровно три дополнительных draw'а, в этом порядке.
    mutationTier = rollMutationTier(rng);
    mutationId = rollMutationId(mutationTier, rng);
    auraMutationSide = rollAuraMutationSide(rng);
  }

  // Шаг 4 — 18 inheritance draws, всегда, независимо от исхода шага 2-3.
  const inherited = inheritGenomeV2(seedGenome, pollenGenome, rng);

  // Шаг 5 — применение уже выбранного mutation-аллеля к унаследованной aura.
  const genomeV2: GenomeV2 = mutated
    ? { ...inherited, aura: applyMutationAlleleToAura(inherited.aura, auraMutationSide), mutationId }
    : inherited;

  const nextPityCounter = mutated ? 0 : Math.min(9, currentPity + 1);

  return {
    ok: true,
    genomeV2,
    phenotype: resolvePhenotypeV2(genomeV2),
    naturalScore: naturalScoreOfV2(genomeV2),
    rarity: rarityOfV2(genomeV2, mutationId),
    mutated,
    mutationTier,
    mutationId,
    nextPityCounter,
  };
}
