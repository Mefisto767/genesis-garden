// ============================================================================
// Этап 2 — генетика растений: 8 параметров, скрещивание, pity-система.
//
// Честная оговорка по охвату (см. claude/status.md в проекте): у нас пока
// нет отдельных арт-ассетов на "узор" и "форма листа" как геометрию — это
// не нарисовано. Поэтому 8 параметров из ТЗ реализованы так, чтобы каждый
// был РЕАЛЬНО читаем в текущем арт-паке:
//   1. shape       — вид/силуэт растения (speciesId 1-8, из арт-пака)
//   2. primary     — основной цвет (тонирует mask_primary)
//   3. secondary   — доп. цвет (тонирует mask_secondary)
//   4. leaf        — цвет листвы (тонирует mask_leaf)
//   5. pattern     — solid (доп.цвет = осн.цвет, монохромный) | duotone (контраст)
//   6. size        — масштаб спрайта: small/normal/large/giant
//   7. aura        — интенсивность свечения редкости: none/faint/glow/radiant
//   8. mutation    — редкий особый трейт (золотой контур, звёздная пыльца, ...)
//                    или null у большинства растений
//
// Как только появится арт для настоящих узоров/форм листа, меняется только
// SHAPE-независимая часть ниже (POOLS, MUTATIONS) — движок скрещивания и
// сторона игрока (specimens[]) не меняются.
// ============================================================================

export type Pattern = 'solid' | 'duotone';
export type SizeTier = 'small' | 'normal' | 'large' | 'giant';
export type AuraTier = 'none' | 'faint' | 'glow' | 'radiant';
export type RarityTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface Mutation {
  id: string;
  name: string;
  /** Принудительно поднимает редкость минимум до этого уровня. */
  minRarity: RarityTier;
}

export const MUTATIONS: Mutation[] = [
  { id: 'golden_vein', name: 'Золотая жилка', minRarity: 'rare' },
  { id: 'stardust', name: 'Звёздная пыльца', minRarity: 'epic' },
  { id: 'prism', name: 'Призма', minRarity: 'epic' },
  { id: 'phoenix', name: 'Феникс', minRarity: 'legendary' },
];

export interface Genome {
  shape: number; // 1-8
  primary: string;
  secondary: string;
  leaf: string;
  pattern: Pattern;
  size: SizeTier;
  aura: AuraTier;
  mutationId: string | null;
}

const SHAPES = [1, 2, 3, 4, 5, 6, 7, 8];

// Цветовые пулы — берём строго из палитры style guide, чтобы новые особи
// всегда попадали в фирменную гамму проекта.
const PRIMARY_POOL = ['#FF8C77', '#FF6F59', '#F5A623', '#FFC85C', '#B678D9', '#CFA1E8', '#89D65C', '#CBE9F2'];
const SECONDARY_POOL = ['#F5A623', '#FF6F59', '#9457BC', '#57993A', '#E05543', '#A9D4E2', '#D98C12'];
const LEAF_POOL = ['#6FBE44', '#89D65C', '#57993A'];
const SIZE_TIERS: SizeTier[] = ['small', 'normal', 'normal', 'large', 'giant']; // giant редкий по весу
const AURA_TIERS: AuraTier[] = ['none', 'none', 'none', 'faint', 'faint', 'glow'];

const PITY_THRESHOLD = 10; // гарантированная мутация после стольки скрещиваний без неё
const MUTATION_CHANCE = 0.06; // базовый шанс мутации на скрещивание
const GENE_MUTATE_CHANCE = 0.08; // шанс отдельному гену "сойти с рельс" при скрещивании

function pick<T>(pool: T[], rng: () => number): T {
  return pool[Math.floor(rng() * pool.length)];
}

function inherit<T>(a: T, b: T, rng: () => number): T {
  return rng() < 0.5 ? a : b;
}

export function randomGenome(rng: () => number = Math.random): Genome {
  const primary = pick(PRIMARY_POOL, rng);
  let secondary = pick(SECONDARY_POOL, rng);
  const pattern: Pattern = rng() < 0.5 ? 'solid' : 'duotone';
  if (pattern === 'solid') secondary = primary;
  return {
    shape: pick(SHAPES, rng),
    primary,
    secondary,
    leaf: pick(LEAF_POOL, rng),
    pattern,
    size: pick(SIZE_TIERS, rng),
    aura: pick(AURA_TIERS, rng),
    mutationId: null,
  };
}

export interface BreedResult {
  genome: Genome;
  mutated: boolean;
  pityTriggered: boolean;
  nextPityCounter: number;
}

/**
 * Скрещивание: каждый ген независимо наследуется 50/50 от одного из
 * родителей, с шансом GENE_MUTATE_CHANCE «сорваться» на случайное значение
 * из пула (это и есть видимая генетическая мутация отдельного признака).
 * Плюс pity-система: если давно не было ни одной мутации гена — следующее
 * скрещивание гарантированно даёт мутацию хотя бы одного гена и подбирает
 * итоговой особи специальный mutationId.
 */
export function breed(a: Genome, b: Genome, pityCounter: number, rng: () => number = Math.random): BreedResult {
  let mutated = false;
  const forceGeneMutation = pityCounter >= PITY_THRESHOLD;
  let forcedOnce = false;

  function gene<T>(pa: T, pb: T, pool: T[]): T {
    const shouldMutate = rng() < GENE_MUTATE_CHANCE || (forceGeneMutation && !forcedOnce && rng() < 0.7);
    if (shouldMutate) {
      mutated = true;
      forcedOnce = true;
      return pick(pool, rng);
    }
    return inherit(pa, pb, rng);
  }

  const shape = gene(a.shape, b.shape, SHAPES);
  const primary = gene(a.primary, b.primary, PRIMARY_POOL);
  let secondary = gene(a.secondary, b.secondary, SECONDARY_POOL);
  const leaf = gene(a.leaf, b.leaf, LEAF_POOL);
  const pattern = gene(a.pattern, b.pattern, ['solid', 'duotone'] as Pattern[]);
  const size = gene(a.size, b.size, SIZE_TIERS);
  const aura = gene(a.aura, b.aura, AURA_TIERS);
  if (pattern === 'solid') secondary = primary;

  const pityTriggered = forceGeneMutation && mutated;
  const nextPityCounter = mutated ? 0 : pityCounter + 1;

  // Особая мутация (трейт) — реже, и только если ген вообще "сорвался" в этом скрещивании
  let mutationId: string | null = null;
  if (mutated && rng() < MUTATION_CHANCE) {
    mutationId = pick(MUTATIONS, rng).id;
  }
  if (pityTriggered && !mutationId) {
    // pity гарантирует хотя бы визуальную мутацию гена; шанс на именной
    // трейт тут ниже полного MUTATION_CHANCE, чтобы не обесценивать редкость.
    if (rng() < 0.35) mutationId = pick(MUTATIONS, rng).id;
  }

  const genome: Genome = { shape, primary, secondary, leaf, pattern, size, aura, mutationId };
  return { genome, mutated, pityTriggered, nextPityCounter };
}

export function rarityOf(genome: Genome): RarityTier {
  if (genome.mutationId) {
    const m = MUTATIONS.find((x) => x.id === genome.mutationId);
    if (m) return m.minRarity;
  }
  let score = 0;
  if (genome.size === 'giant') score += 2;
  if (genome.size === 'large') score += 1;
  if (genome.aura === 'radiant') score += 3;
  if (genome.aura === 'glow') score += 2;
  if (genome.aura === 'faint') score += 1;
  if (genome.pattern === 'duotone') score += 1;
  if (score >= 5) return 'epic';
  if (score >= 3) return 'rare';
  if (score >= 1) return 'uncommon';
  return 'common';
}

export function sizeScale(size: SizeTier): number {
  return { small: 0.75, normal: 1, large: 1.25, giant: 1.55 }[size];
}

export function mutationName(id: string | null): string | null {
  if (!id) return null;
  return MUTATIONS.find((m) => m.id === id)?.name ?? null;
}
