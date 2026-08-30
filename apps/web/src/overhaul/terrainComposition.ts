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

// ============================================================================
// Visual Correction (docs/ENVIRONMENT_ART_SLICE_B_VISUAL_CORRECTION.md) —
// added on top of the original Slice B pure logic above (unchanged). Same
// split as before: this module only decides WHAT to draw (variant indices,
// corner geometry, shadow dimensions) via pure coordinate-hash functions —
// the actual Canvas 2D pixel drawing lives in terrainTextures.ts.
// ============================================================================

/** Grass tone variants: at least 3, hash-selected per tile, applied ON TOP
 * of whichever of the two approved source PNGs (`tile_grass_v1`/`_alt`,
 * still picked by `grassVariantAlt` above, unchanged) forms the base — a
 * per-tile hue/brightness/fleck-noise treatment so no two adjacent tiles of
 * the same source render pixel-identical (owner complaint #1: "too flat/
 * uniform"). Pure coordinate hash, never game RNG. */
export const GRASS_TONE_VARIANT_COUNT = 3;

export function grassToneVariant(col: number, row: number): number {
  return mixHash(col * 3 + 1, row * 3 + 1) % GRASS_TONE_VARIANT_COUNT;
}

/** Per-tile deterministic seed for the fleck/noise pattern drawn into the
 * grass texture — NOT the tone variant (that picks a color treatment; this
 * seeds where individual flecks land) so two tiles sharing a tone variant
 * still don't look identical. Pure function of (col,row). */
export function grassNoiseSeed(col: number, row: number): number {
  return mixHash(col * 7 + 3, row * 7 + 3);
}

/** Boundary-hedge (thicket) variants: at least 3, same hash pattern as
 * grass, so the repeating tile pattern owner complaint #6 called out is
 * broken up. Rendering-only — occupancy/collision (`collisionRects()`) is
 * untouched by this or any other part of this pass. */
export const THICKET_VARIANT_COUNT = 3;

export function thicketVariantIndex(col: number, row: number): number {
  return mixHash(col * 5 + 2, row * 5 + 2) % THICKET_VARIANT_COUNT;
}

/** Per-tile deterministic seed for thicket fleck/leaf-cluster noise — same
 * role as `grassNoiseSeed` for grass. Required because the single approved
 * `tile_thicket_v1` source is symmetric under horizontal-flip and 180°-
 * rotate (confirmed byte-identical), so those two transforms alone (used by
 * `thicketVariantIndex`'s variant 1/2) are visually inert; without per-tile
 * noise on top, caching a shared texture per variant (3 total images)
 * across the whole boundary ring reproduces the exact repeating pattern
 * from owner complaint #6, just with a 3-tile period instead of a 1-tile
 * period. This seed drives real per-(col,row) fleck placement so no two
 * boundary tiles render pixel-identical. Pure function of (col,row). */
export function thicketNoiseSeed(col: number, row: number): number {
  return mixHash(col * 11 + 5, row * 11 + 5);
}

// ---- organic silhouette corner geometry (path + pond) ----------------------

/**
 * Root-cause fix for owner complaint #4 (square green protrusions on the
 * pond's north shore) and #2 (hard right-angle path corners): the OLD
 * silhouette compositor (`terrainTextures.ts` pre-correction) unioned a
 * rounded-corner "core" rect with sharp-cornered rectangular "arms" per open
 * direction. At any corner where exactly one of the two adjacent directions
 * is open, the sharp arm rectangle's corner sits exactly where the core's
 * smooth arc should have been, flattening it into a hard square notch —
 * every real perimeter tile of a rectangular pond has exactly this shape
 * (one lateral neighbour open, the shore-facing neighbour closed), so this
 * was systematic, not incidental.
 *
 * The fix: classify each of the 4 corners by its two adjacent directions —
 * both open -> 'flush' (interior corner, no visible shore there, safe to
 * leave sharp/full-bleed); both closed -> 'rounded' (an isolated/outer
 * corner of the shape, gets a normal small rounded corner); exactly one open
 * -> 'wedge' (a real shoreline/path-edge transition — gets a wide, smooth
 * diagonal blend instead of ever being flush/square). 'wedge' is the corner
 * kind that never existed as a distinct case in the old geometry — THAT
 * omission is the actual bug, not a specific mask value, so it cannot recur
 * by construction: every corner is one of these three kinds, and only two
 * closed adjacent directions ever produces a bare 90° corner.
 */
export type CornerKind = 'flush' | 'rounded' | 'wedge';

export function cornerKindFor(dirAOpen: boolean, dirBOpen: boolean): CornerKind {
  if (dirAOpen && dirBOpen) return 'flush';
  if (!dirAOpen && !dirBOpen) return 'rounded';
  return 'wedge';
}

export interface SilhouetteCorners {
  NE: CornerKind;
  SE: CornerKind;
  SW: CornerKind;
  NW: CornerKind;
}

/** The 4 corner kinds for a tile's silhouette, derived purely from which of
 * its 4 neighbour directions are "open" (same-kind neighbour present) — see
 * `CornerKind` doc above for why this eliminates the square-protrusion bug
 * by construction rather than special-casing the specific masks that used
 * to produce it. */
export function silhouetteCornersFor(openDirs: readonly Dir[]): SilhouetteCorners {
  const has = (d: Dir) => openDirs.includes(d);
  const n = has('N');
  const e = has('E');
  const s = has('S');
  const w = has('W');
  return {
    NE: cornerKindFor(n, e),
    SE: cornerKindFor(s, e),
    SW: cornerKindFor(s, w),
    NW: cornerKindFor(n, w),
  };
}

// ---- path effective visual width -------------------------------------------

/** Fraction of the tile filled by the path's own "core" (before any bleed
 * into neighbouring grass cells). Raised from the old 0.46 (owner complaint
 * #2: "reads as a thin geometric line") to read as an actual dirt path. */
export const PATH_CORE_FRAC = 0.82;

/** Fraction of the tile the soft dirt fringe bleeds OUTWARD into each
 * neighbouring grass cell along a path-facing edge — the fill "bleeding a
 * few px into neighboring grass cells for visual softness" the task
 * explicitly allows, never crossing into a different logical zone (pond/
 * thicket/plot), only ever drawn onto grass cells. */
export const PATH_FRINGE_FRAC = 0.3;

/** The effective visual width (world px) of a straight path segment: its own
 * core plus fringe bleed on both sides. Kept in the pure/tested module so
 * the 40–48px acceptance range from the task can be asserted at the data
 * level without touching Canvas. */
export function pathEffectiveWidthPx(tile: number): number {
  return tile * PATH_CORE_FRAC + 2 * tile * PATH_FRINGE_FRAC;
}

// ---- contact shadows ---------------------------------------------------

/** Owner complaint #5: "large messy ovals". The old recipe was
 * `height = width*0.3` with NO upper bound — on a 128px-wide building that
 * produced an ~90x27px double-ellipse blob. The corrected recipe is capped:
 * regardless of the object's footprint, the rendered shadow never exceeds
 * these dimensions, and stays proportionally tighter for small objects too
 * (the height fraction itself is lower than the old 0.3). */
export const CONTACT_SHADOW_MAX_WIDTH = 44;
export const CONTACT_SHADOW_MAX_HEIGHT = 12;
export const CONTACT_SHADOW_HEIGHT_FRAC = 0.24;

export interface ContactShadowSize {
  width: number;
  height: number;
}

/** Pure sizing function shared by every contact-shadow call site (buildings/
 * plots/player/Lumi) — `rawWidth` is whatever footprint-derived width the
 * caller previously used unclamped; this always returns a small, compact,
 * capped ellipse size instead. */
export function contactShadowSize(rawWidth: number): ContactShadowSize {
  const width = Math.min(rawWidth, CONTACT_SHADOW_MAX_WIDTH);
  const height = Math.min(width * CONTACT_SHADOW_HEIGHT_FRAC, CONTACT_SHADOW_MAX_HEIGHT);
  return { width, height };
}
