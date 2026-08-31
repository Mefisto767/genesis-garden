// ============================================================================
// Environment Art Slice B — thin Phaser-side consumer of terrainComposition.ts
// (docs/ENVIRONMENT_ART_SLICE_B.md). Composites the six approved 32×32
// material textures (game-ready/*.png -> assets/terrain/*.png) into the
// actual masked shapes the terrain grid needs, deterministically, at scene
// preload/create time — cached by Phaser texture key (keyed by the 4-bit
// adjacency mask, and by decor variant for bank tiles), never regenerated on
// every render.
//
// Why Canvas 2D compositing instead of Phaser Graphics/RenderTexture masks:
// the six textures are flat *materials*, not pre-cut shapes — there is no
// pond-bank-shaped or path-fringe-shaped source asset to draw. Building the
// masked shape has to happen at runtime from the adjacency data. A plain
// <canvas> 2D context with clip() is the simplest reliable way to composite
// "material B, only inside this organic silhouette, over material A" without
// fighting Phaser's WebGL-vs-Canvas renderer differences — CanvasTexture
// (scene.textures.createCanvas) uploads the result as a normal texture
// either way. This file is intentionally NOT unit-tested the same way
// terrainComposition.ts is (no different than EstateScene's own draw calls
// being untested by Vitest) — only the mask/shape/hash DECISIONS it consumes
// are pure and tested.
// ============================================================================

import Phaser from 'phaser';
import {
  bankDecorAt,
  classifyFourNeighbourMask,
  grassNoiseSeed,
  grassToneVariant,
  grassVariantAlt,
  neighbourMaskAt,
  PATH_CORE_FRAC,
  PATH_FRINGE_FRAC,
  silhouetteCornersFor,
  thicketVariantIndex,
  waterAnimatesFor,
  type AdjacencyShape,
  type BankDecor,
  type CornerKind,
  type Dir,
} from './terrainComposition';
import { TILE, terrainAt } from './worldConfig';

const TERRAIN_KEYS = {
  grass: 'tile_grass_v1',
  grassAlt: 'tile_grass_v1_alt',
  pathEarth: 'tile_path_earth_v1',
  water: 'tile_water_v1',
  waterAlt: 'tile_water_v1_alt',
  thicket: 'tile_thicket_v1',
} as const;

function sourceImage(scene: Phaser.Scene, key: string): CanvasImageSource {
  return scene.textures.get(key).getSourceImage() as CanvasImageSource;
}

/**
 * Organic tile silhouette (Visual Correction — replaces the old "rounded
 * core + sharp rectangular arms" compositor, see terrainComposition.ts
 * `CornerKind` doc for exactly why that produced square shore protrusions).
 *
 * Builds ONE closed path for the tile: each edge sits either flush with the
 * tile boundary (that direction is open — a same-kind neighbour continues
 * the shape there) or inset (that direction is closed — this is a real
 * silhouette edge). The 4 corners between those edges are NOT a fixed
 * radius — each is classified by `silhouetteCornersFor` into 'flush' (both
 * adjacent edges open — sharp is fine, it's interior, never seen against a
 * background), 'rounded' (both closed — a normal small rounded outer
 * corner), or 'wedge' (exactly one open — a wide, smooth diagonal blend,
 * the actual shoreline/path-edge transition). This is what makes every
 * corner either fully sharp-but-hidden or visibly smooth, never a
 * stray square notch.
 */
function traceOrganicSilhouette(
  ctx: CanvasRenderingContext2D,
  openDirs: readonly Dir[],
  tile: number,
  coreFrac: number,
  cornerRadii: { rounded: number; wedge: number }
) {
  const inset = (tile - tile * coreFrac) / 2;
  const has = (d: Dir) => openDirs.includes(d);
  const top = has('N') ? 0 : inset;
  const right = has('E') ? tile : tile - inset;
  const bottom = has('S') ? tile : tile - inset;
  const left = has('W') ? 0 : inset;

  const corners = silhouetteCornersFor(openDirs);
  const radiusFor = (kind: CornerKind) => (kind === 'flush' ? 0 : kind === 'rounded' ? cornerRadii.rounded : cornerRadii.wedge);
  // Never let a corner radius eat past the midpoint of the shape's own
  // (smaller) axis, or two opposite arcs would overlap and self-intersect.
  const cap = Math.min(tile, right - left, bottom - top) / 2;
  const rNE = Math.min(radiusFor(corners.NE), cap);
  const rSE = Math.min(radiusFor(corners.SE), cap);
  const rSW = Math.min(radiusFor(corners.SW), cap);
  const rNW = Math.min(radiusFor(corners.NW), cap);

  ctx.beginPath();
  ctx.moveTo(left + rNW, top);
  ctx.lineTo(right - rNE, top);
  ctx.arcTo(right, top, right, top + rNE, rNE);
  ctx.lineTo(right, bottom - rSE);
  ctx.arcTo(right, bottom, right - rSE, bottom, rSE);
  ctx.lineTo(left + rSW, bottom);
  ctx.arcTo(left, bottom, left, bottom - rSW, rSW);
  ctx.lineTo(left, top + rNW);
  ctx.arcTo(left, top, left + rNW, top, rNW);
  ctx.closePath();
}

// ---- enhanced grass base (owner complaint #1: "too yellow, flat, no
// texture") ------------------------------------------------------------------

/** Tiny deterministic PRNG (mulberry32) seeded from `grassNoiseSeed` — used
 * ONLY to place fleck-noise pixels inside one tile's Canvas draw, never for
 * anything gameplay-affecting. Not the game RNG, not Math.random: same seed
 * always produces the same fleck layout, so the same tile always renders
 * identically across reloads. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-tone-variant darker, calmer, less-yellow tint applied over the source
 * material (owner complaint #1) — multiply-style overlay, subtle (low
 * alpha) so the source texture's own shape/shading still shows through. */
const GRASS_TONE_OVERLAYS: readonly string[] = [
  'rgba(38, 58, 30, 0.22)', // deepen toward a calmer, cooler green
  'rgba(46, 64, 34, 0.14)', // lighter deepen, slight variety
  'rgba(30, 50, 28, 0.28)', // deepest — breaks up any two-tone banding
];

/**
 * Draws the grass background for one tile at `size` (display px), but
 * internally composites at `GRASS_SRC_SCALE`x that size first — generating
 * fleck/noise detail directly at the resolution it will actually be shown
 * at (never downsampled FROM a higher-detail hand-painted source, which is
 * the lossy step `docs/ENVIRONMENT_ART_SLICE_B_VISUAL_CORRECTION.md`
 * identifies as a root cause) — then scales that supersampled result down
 * onto the destination with Canvas 2D's own image smoothing. This keeps the
 * final displayed texture native-resolution (32×32 world px, same crisp
 * scale as every other sprite in this `pixelArt: true` game) while the
 * fleck detail generated at 2x survives the scale-down instead of being
 * flattened to a single flat block of color.
 */
const GRASS_SRC_SCALE = 2;

function drawEnhancedGrassBase(
  ctx: CanvasRenderingContext2D,
  scene: Phaser.Scene,
  sourceKey: string,
  size: number,
  toneVariant: number,
  noiseSeed: number
) {
  const srcSize = size * GRASS_SRC_SCALE;
  const work = document.createElement('canvas');
  work.width = srcSize;
  work.height = srcSize;
  const wctx = work.getContext('2d');
  if (!wctx) {
    // Extremely defensive fallback (no 2D context available) — draw flat,
    // same as the pre-correction behaviour, rather than throwing.
    ctx.drawImage(sourceImage(scene, sourceKey), 0, 0, size, size);
    return;
  }
  wctx.drawImage(sourceImage(scene, sourceKey), 0, 0, srcSize, srcSize);
  wctx.fillStyle = GRASS_TONE_OVERLAYS[toneVariant % GRASS_TONE_OVERLAYS.length];
  wctx.fillRect(0, 0, srcSize, srcSize);

  // Fleck noise: small, sparse, deterministic dashes of slightly darker/
  // lighter green — breaks up the flat/uniform read (complaint #1) without
  // introducing anything resembling a repeating grid (each tile's flecks
  // come from its own coordinate-derived seed).
  const rng = mulberry32(noiseSeed);
  const fleckCount = 10 + Math.floor(rng() * 6);
  for (let i = 0; i < fleckCount; i++) {
    const fx = rng() * srcSize;
    const fy = rng() * srcSize;
    const flen = srcSize * (0.05 + rng() * 0.06);
    const dark = rng() > 0.5;
    wctx.strokeStyle = dark ? 'rgba(20, 36, 18, 0.35)' : 'rgba(120, 138, 70, 0.22)';
    wctx.lineWidth = Math.max(1, srcSize * 0.012);
    wctx.beginPath();
    wctx.moveTo(fx, fy);
    wctx.lineTo(fx + flen * (rng() - 0.5), fy + flen);
    wctx.stroke();
  }

  ctx.drawImage(work, 0, 0, srcSize, srcSize, 0, 0, size, size);
}

function ensureCanvasTexture(scene: Phaser.Scene, key: string, size: number): Phaser.Textures.CanvasTexture | null {
  if (scene.textures.exists(key)) return null; // already built — idempotent, same convention as proceduralAssets.ts
  return scene.textures.createCanvas(key, size, size);
}

// ---- path (earth fill + organic grass fringe) ------------------------------

/** Path connectivity mask for TEXTURE purposes treats a water neighbour the
 * same as a path neighbour (both "wet", never grass) — see
 * terrainComposition.test.ts "documents the one real exception" for why:
 * the path corridor runs directly alongside the pond for one tile, and
 * without this the fringe would show a false strip of grass between the
 * path silhouette and the pond edge. Purely a rendering nuance — the actual
 * LOGICAL path-connectivity classification (tested) never treats water as
 * part of the path. */
function pathTextureMask(col: number, row: number, pathTiles: Set<string>): number {
  const isWetForFringe = (c: number, r: number) => {
    if (pathTiles.has(`${c},${r}`)) return true;
    return terrainAt(c, r, pathTiles) === 'water';
  };
  return neighbourMaskAt(col, row, isWetForFringe);
}

/** Rounded/wedge corner radii tuned for the path — subtler than the pond's
 * (a dirt path shouldn't curve as dramatically as a shoreline), but the
 * wedge radius is still generous enough to fully remove the old hard 90°
 * corner/end-cap look (owner complaint #2). */
const PATH_CORNER_RADII = { rounded: TILE * 0.3, wedge: TILE * 0.42 };

function grassSourceKeyFor(col: number, row: number): string {
  return grassVariantAlt(col, row) ? TERRAIN_KEYS.grassAlt : TERRAIN_KEYS.grass;
}

function buildPathTexture(scene: Phaser.Scene, col: number, row: number, mask: number): string {
  const key = `terrain_path_v1_${mask}_${col}_${row}`;
  const tex = ensureCanvasTexture(scene, key, TILE);
  if (!tex) return key;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, TILE, TILE);
  drawEnhancedGrassBase(ctx, scene, grassSourceKeyFor(col, row), TILE, grassToneVariant(col, row), grassNoiseSeed(col, row));
  const { openDirs } = classifyFourNeighbourMask(mask);
  ctx.save();
  traceOrganicSilhouette(ctx, openDirs, TILE, PATH_CORE_FRAC, PATH_CORNER_RADII);
  ctx.clip();
  ctx.drawImage(sourceImage(scene, TERRAIN_KEYS.pathEarth), 0, 0, TILE, TILE);
  ctx.restore();
  tex.refresh();
  return key;
}

/**
 * Owner complaint #2 ("reads as a thin geometric line"): the path's own
 * 32px tile alone cannot reach the 40-48 world-px effective width the task
 * requires (see `terrainComposition.pathEffectiveWidthPx`). This draws the
 * remaining width as a soft dirt fringe bleeding OUTWARD from a path-facing
 * edge into an adjacent GRASS cell — explicitly allowed by the task ("the
 * path FILL can bleed a few px into neighboring grass cells... as long as
 * it never overlaps a different logical zone") — never drawn onto
 * path/water/thicket/plot cells, only onto grass. Feathered via gradient
 * (not a flat rect) so the transition itself reads as soft, not a second
 * hard edge.
 */
function drawPathFringe(ctx: CanvasRenderingContext2D, openDirs: readonly Dir[], tile: number) {
  const depth = tile * PATH_FRINGE_FRAC;
  ctx.save();
  for (const dir of openDirs) {
    let grad: CanvasGradient;
    let x = 0;
    let y = 0;
    let w = tile;
    let h = tile;
    switch (dir) {
      case 'N':
        grad = ctx.createLinearGradient(0, 0, 0, depth);
        h = depth;
        break;
      case 'S':
        grad = ctx.createLinearGradient(0, tile, 0, tile - depth);
        y = tile - depth;
        h = depth;
        break;
      case 'E':
        grad = ctx.createLinearGradient(tile, 0, tile - depth, 0);
        x = tile - depth;
        w = depth;
        break;
      case 'W':
      default:
        grad = ctx.createLinearGradient(0, 0, depth, 0);
        w = depth;
        break;
    }
    grad.addColorStop(0, 'rgba(107, 84, 48, 0.34)');
    grad.addColorStop(1, 'rgba(107, 84, 48, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

function buildPathFringeTexture(scene: Phaser.Scene, col: number, row: number, mask: number): string {
  const key = `terrain_pathfringe_v1_${mask}_${col}_${row}`;
  const tex = ensureCanvasTexture(scene, key, TILE);
  if (!tex) return key;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, TILE, TILE);
  drawEnhancedGrassBase(ctx, scene, grassSourceKeyFor(col, row), TILE, grassToneVariant(col, row), grassNoiseSeed(col, row));
  const { openDirs } = classifyFourNeighbourMask(mask);
  drawPathFringe(ctx, openDirs, TILE);
  tex.refresh();
  return key;
}

// ---- water (organic pond fill, 2 shimmer frames) ---------------------------

/** Wider corner radii than the path — a pond's shoreline should read as a
 * clearly organic curve, not a subtle taper. This is the direct fix for
 * owner complaint #3/#4 (pond reads as a rectangle / square shore
 * protrusions): every corner adjacent to exactly one open direction — i.e.
 * every real shoreline corner on a rectangular pond — now gets this wide
 * smooth blend instead of ever being flush/square. */
const WATER_CORNER_RADII = { rounded: TILE * 0.38, wedge: TILE * 0.6 };

function buildWaterTexture(scene: Phaser.Scene, col: number, row: number, mask: number, alt: boolean): string {
  const key = `terrain_water_v1_${mask}_${alt ? 'alt' : 'base'}_${col}_${row}`;
  const tex = ensureCanvasTexture(scene, key, TILE);
  if (!tex) return key;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, TILE, TILE);
  drawEnhancedGrassBase(ctx, scene, grassSourceKeyFor(col, row), TILE, grassToneVariant(col, row), grassNoiseSeed(col, row));
  const { openDirs } = classifyFourNeighbourMask(mask);
  ctx.save();
  traceOrganicSilhouette(ctx, openDirs, TILE, 0.9, WATER_CORNER_RADII);
  ctx.clip();
  ctx.drawImage(sourceImage(scene, alt ? TERRAIN_KEYS.waterAlt : TERRAIN_KEYS.water), 0, 0, TILE, TILE);
  ctx.restore();
  tex.refresh();
  return key;
}

// ---- bank (grass adjacent to water: restrained fringe + rare stone/reed) ---

function drawBankFringe(ctx: CanvasRenderingContext2D, openDirs: readonly Dir[], tile: number) {
  // A soft, low-alpha wet-earth GRADIENT (not a flat rect) along each
  // water-facing edge — reads as "damp bank" fading into dry grass, not a
  // hard line. Combined with the wide shoreline corner radii above (§3 of
  // the visual-correction doc: "the same new per-corner geometry... plus
  // this softened fringe together read as one continuous shoreline band,
  // not a blocky per-tile edge").
  const depth = tile * 0.3;
  ctx.save();
  for (const dir of openDirs) {
    let grad: CanvasGradient;
    let x = 0;
    let y = 0;
    let w = tile;
    let h = tile;
    switch (dir) {
      case 'N':
        grad = ctx.createLinearGradient(0, 0, 0, depth);
        h = depth;
        break;
      case 'S':
        grad = ctx.createLinearGradient(0, tile, 0, tile - depth);
        y = tile - depth;
        h = depth;
        break;
      case 'E':
        grad = ctx.createLinearGradient(tile, 0, tile - depth, 0);
        x = tile - depth;
        w = depth;
        break;
      case 'W':
      default:
        grad = ctx.createLinearGradient(0, 0, depth, 0);
        w = depth;
        break;
    }
    grad.addColorStop(0, 'rgba(90, 74, 42, 0.32)');
    grad.addColorStop(1, 'rgba(90, 74, 42, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

function drawBankDecor(ctx: CanvasRenderingContext2D, decor: BankDecor, openDirs: readonly Dir[], tile: number) {
  if (decor === 'none' || openDirs.length === 0) return;
  // Bias placement toward the water-facing side — average the open
  // directions into an offset from tile center, deterministic (no per-frame
  // randomness), always the same position for the same tile.
  let ox = 0;
  let oy = 0;
  for (const dir of openDirs) {
    if (dir === 'N') oy -= 1;
    if (dir === 'S') oy += 1;
    if (dir === 'E') ox += 1;
    if (dir === 'W') ox -= 1;
  }
  const len = Math.hypot(ox, oy) || 1;
  const cx = tile / 2 + (ox / len) * tile * 0.28;
  const cy = tile / 2 + (oy / len) * tile * 0.28;
  ctx.save();
  if (decor === 'stone') {
    ctx.fillStyle = 'rgba(150, 145, 130, 0.9)';
    ctx.strokeStyle = 'rgba(70, 62, 48, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, tile * 0.09, tile * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    // reed: 2 short curved dark-green strokes
    ctx.strokeStyle = 'rgba(46, 74, 40, 0.75)';
    ctx.lineWidth = tile * 0.03;
    ctx.lineCap = 'round';
    for (const dx of [-tile * 0.04, tile * 0.05]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx, cy + tile * 0.1);
      ctx.quadraticCurveTo(cx + dx * 1.4, cy - tile * 0.05, cx + dx * 0.6, cy - tile * 0.16);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function buildBankTexture(scene: Phaser.Scene, col: number, row: number, mask: number, decor: BankDecor): string {
  const key = `terrain_bank_v1_${mask}_${decor}_${col}_${row}`;
  const tex = ensureCanvasTexture(scene, key, TILE);
  if (!tex) return key;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, TILE, TILE);
  drawEnhancedGrassBase(ctx, scene, grassSourceKeyFor(col, row), TILE, grassToneVariant(col, row), grassNoiseSeed(col, row));
  const { openDirs } = classifyFourNeighbourMask(mask);
  drawBankFringe(ctx, openDirs, TILE);
  drawBankDecor(ctx, decor, openDirs, TILE);
  tex.refresh();
  return key;
}

// ---- plain grass (owner complaint #1) ---------------------------------------

function buildGrassTexture(scene: Phaser.Scene, col: number, row: number): string {
  const key = `terrain_grass_v1_${col}_${row}`;
  const tex = ensureCanvasTexture(scene, key, TILE);
  if (!tex) return key;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, TILE, TILE);
  drawEnhancedGrassBase(ctx, scene, grassSourceKeyFor(col, row), TILE, grassToneVariant(col, row), grassNoiseSeed(col, row));
  tex.refresh();
  return key;
}

// ---- boundary hedge (thicket): 3 deterministic variants ---------------------

/** Owner complaint #6: the single `tile_thicket_v1` source drawn identically
 * everywhere visibly repeats along the boundary ring. With no new source art
 * available, 3 variants are produced purely by transform (flip / 180°
 * rotate — both preserve the square tile's bounding box, so occupancy/
 * collision geometry, which never reads this texture, is entirely
 * unaffected) plus a slight per-variant tint, hash-selected per tile via
 * `thicketVariantIndex` — same pattern as grass's tone variant. */
function buildThicketTexture(scene: Phaser.Scene, variant: number): string {
  const key = `terrain_thicket_v1_${variant}`;
  const tex = ensureCanvasTexture(scene, key, TILE);
  if (!tex) return key;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, TILE, TILE);
  ctx.save();
  if (variant === 1) {
    // horizontal flip
    ctx.translate(TILE, 0);
    ctx.scale(-1, 1);
  } else if (variant === 2) {
    // 180° rotate
    ctx.translate(TILE, TILE);
    ctx.rotate(Math.PI);
  }
  ctx.drawImage(sourceImage(scene, TERRAIN_KEYS.thicket), 0, 0, TILE, TILE);
  ctx.restore();
  if (variant !== 0) {
    ctx.save();
    ctx.fillStyle = variant === 1 ? 'rgba(20, 34, 16, 0.1)' : 'rgba(60, 78, 40, 0.08)';
    ctx.fillRect(0, 0, TILE, TILE);
    ctx.restore();
  }
  tex.refresh();
  return key;
}

// ---- public entry points ----------------------------------------------------

export interface TerrainCellTextures {
  /** Base texture key to draw at this cell. */
  key: string;
  /** For water cells only: the shimmer alt-frame key (or null if this cell
   * has no shimmer, e.g. reduced motion / non-water). */
  shimmerAltKey: string | null;
}

/**
 * Resolves + lazily builds (idempotent, cached by Phaser texture key) the
 * exact texture(s) one rendered grid cell needs, from the same terrain data
 * EstateScene already reads (terrainAt/pathTileKeySet — never redefines it).
 */
export function terrainCellTextures(
  scene: Phaser.Scene,
  col: number,
  row: number,
  pathTiles: Set<string>,
  animateWater: boolean
): TerrainCellTextures {
  const kind = terrainAt(col, row, pathTiles);

  if (kind === 'thicket') {
    const variant = thicketVariantIndex(col, row);
    return { key: buildThicketTexture(scene, variant), shimmerAltKey: null };
  }

  if (kind === 'path') {
    const mask = pathTextureMask(col, row, pathTiles);
    return { key: buildPathTexture(scene, col, row, mask), shimmerAltKey: null };
  }

  if (kind === 'water') {
    const isWater = (c: number, r: number) => terrainAt(c, r, pathTiles) === 'water';
    const mask = neighbourMaskAt(col, row, isWater);
    const baseKey = buildWaterTexture(scene, col, row, mask, false);
    const altKey = animateWater ? buildWaterTexture(scene, col, row, mask, true) : null;
    return { key: baseKey, shimmerAltKey: altKey };
  }

  // grass — bank fringe if adjacent to water, path fringe if adjacent to the
  // path (and not water — water bank takes priority at the one documented
  // path/water-adjacent junction, see pathTextureMask's doc comment), else
  // plain (but no longer flat: drawEnhancedGrassBase in all three cases).
  const isWater = (c: number, r: number) => terrainAt(c, r, pathTiles) === 'water';
  const waterMask = neighbourMaskAt(col, row, isWater);
  if (waterMask !== 0) {
    const decor = bankDecorAt(col, row);
    return { key: buildBankTexture(scene, col, row, waterMask, decor), shimmerAltKey: null };
  }
  const isPath = (c: number, r: number) => terrainAt(c, r, pathTiles) === 'path';
  const pathMask = neighbourMaskAt(col, row, isPath);
  if (pathMask !== 0) {
    return { key: buildPathFringeTexture(scene, col, row, pathMask), shimmerAltKey: null };
  }
  return { key: buildGrassTexture(scene, col, row), shimmerAltKey: null };
}

/** Whether the current viewer prefers reduced motion — read once per scene
 * create, not per-frame (matches EstateScene.enterLaboratory's existing
 * pattern for the same media query). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function shouldAnimateWater(): boolean {
  return waterAnimatesFor(prefersReducedMotion());
}

// Re-exported for callers that need the raw shape classification (kept out
// of EstateScene's own imports where not needed) without reaching past this
// module into terrainComposition.ts directly.
export type { AdjacencyShape };
