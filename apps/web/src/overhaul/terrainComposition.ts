// ============================================================================
// Environment Art Slice B — pure adjacency/hash logic (docs/ENVIRONMENT_ART_SLICE_B.md).
// Phaser-free and fully unit-testable, same split as camera.ts/movement.ts/
// lumiBehavior.ts: this module decides WHICH material/shape a terrain cell
// gets; the actual pixel compositing (Canvas 2D drawImage/clip calls against
// the loaded material textures) lives in the thin Phaser-side consumer
// (game/scenes/terrainTextures.ts), which is not unit-tested the same way
// none of EstateScene's other draw calls are — only the decision logic here
// is.
//
// Nothing here touches worldConfig.ts's authoritative occupancy/collision
// data (terrainAt/collisionRects/pathTileKeySet/POND) — this module only
// CONSUMES those via the generic 4-neighbour mask helper below, exactly as
// the task requires ("derive adjacency/connectivity purely from that
// existing data, never inventing new geometry").
// ============================================================================

export type Dir = 'N' | 'E' | 'S' | 'W';

/** Bit layout of the 4-neighbour adjacency mask: N=1, E=2, S=4, W=8 (0..15). */
export const DIR_BITS: Record<Dir, number> = { N: 1, E: 2, S: 4, W: 8 };

const ALL_DIRS: readonly Dir[] = ['N', 'E', 'S', 'W'];

export function computeNeighbourMask(hasN: boolean, hasE: boolean, hasS: boolean, hasW: boolean): number {
  return (hasN ? DIR_BITS.N : 0) | (hasE ? DIR_BITS.E : 0) | (hasS ? DIR_BITS.S : 0) | (hasW ? DIR_BITS.W : 0);
}

/**
 * Generic 4-neighbour mask for tile (col,row): asks `isMember` about the
 * four orthogonal neighbours only (never diagonals — the task specifies
 * "four-neighbour adjacency bitmasking" throughout). Reused for path
 * connectivity, pond water/non-water adjacency, and bank adjacency — the
 * only thing that differs between callers is what `isMember` checks.
 */
export function neighbourMaskAt(col: number, row: number, isMember: (col: number, row: number) => boolean): number {
  return computeNeighbourMask(
    isMember(col, row - 1), // N
    isMember(col + 1, row), // E
    isMember(col, row + 1), // S
    isMember(col - 1, row) // W
  );
}

export type AdjacencyShapeKind = 'isolated' | 'end' | 'straight' | 'corner' | 't' | 'cross';

export interface AdjacencyShape {
  mask: number;
  kind: AdjacencyShapeKind;
  /** Directions in which this cell connects to a same-kind neighbour. */
  openDirs: Dir[];
}

/**
 * Classifies one of the 16 four-neighbour masks into the shape families the
 * contract calls out by name: isolated (mask 0), end (1 neighbour, ×4),
 * straight (2 opposite neighbours, ×2: N+S / E+W), corner (2 adjacent
 * neighbours, ×4: NE/ES/SW/WN), T (3 neighbours, ×4 — named by the one
 * missing direction), cross (4 neighbours, mask 15). 1+4+2+4+4+1 = 16.
 */
export function classifyFourNeighbourMask(mask: number): AdjacencyShape {
  const openDirs = ALL_DIRS.filter((d) => (mask & DIR_BITS[d]) !== 0);
  const n = openDirs.length;
  let kind: AdjacencyShapeKind;
  if (n === 0) kind = 'isolated';
  else if (n === 1) kind = 'end';
  else if (n === 3) kind = 't';
  else if (n === 4) kind = 'cross';
  else {
    const isNS = (mask & DIR_BITS.N) !== 0 && (mask & DIR_BITS.S) !== 0;
    const isEW = (mask & DIR_BITS.E) !== 0 && (mask & DIR_BITS.W) !== 0;
    kind = isNS || isEW ? 'straight' : 'corner';
  }
  return { mask, kind, openDirs };
}

/**
 * Small deterministic integer hash (a "mix" of the Jenkins/xorshift family) —
 * NOT the game RNG (game/rng.ts, seeded and persisted) and NOT Math.random.
 * Pure function of (a,b): same input always produces the same output, no
 * global/module-level state, nothing persisted. Used only to pick between
 * two visually-near-identical material textures / a sparse decor flag —
 * never anything that affects gameplay.
 */
function mixHash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

/** Fraction (out of 100) of grass tiles that get the `_alt` variant. Kept
 * low — "sparse variation", not a second base color. */
const GRASS_ALT_PERCENT = 12;

/** true = use tile_grass_v1_alt for this cell, false = tile_grass_v1. Pure
 * coordinate hash (docs/ART_SLICE_B_CONTRACT.md "Grass variation is
 * selected by a pure coordinate hash, never game RNG"). */
export function grassVariantAlt(col: number, row: number): boolean {
  return mixHash(col, row) % 100 < GRASS_ALT_PERCENT;
}

/** One of eight deterministic crop/rotation variants for the organic hedge
 * source. Pure presentation data: never touches the game RNG or collision. */
export function boundaryFoliageVariant(col: number, row: number): number {
  return mixHash(col * 3 + 17, row * 5 - 11) % 8;
}

export type BankDecor = 'none' | 'stone' | 'reed';

/** Deterministic, sparse, mutually-exclusive per-tile decor pick for bank
 * (grass-adjacent-to-water) cells — restrained by design: most bank tiles
 * get nothing, a few get one small stone or reed, never both. */
export function bankDecorAt(col: number, row: number): BankDecor {
  const h = mixHash(col * 2 + 1, row * 2 + 1) % 100;
  if (h < 7) return 'stone';
  if (h < 13) return 'reed';
  return 'none';
}

/** Water shimmer respects prefers-reduced-motion: in reduced motion, only
 * the base frame is ever shown (no alternation/crossfade). Trivial on
 * purpose — the point is that the decision lives in one named, tested
 * function instead of being inlined ad hoc at each call site. */
export function waterAnimatesFor(prefersReducedMotion: boolean): boolean {
  return !prefersReducedMotion;
}
