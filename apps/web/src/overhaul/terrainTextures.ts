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
  boundaryFoliageVariant,
  classifyFourNeighbourMask,
  grassVariantAlt,
  neighbourMaskAt,
  waterAnimatesFor,
  type AdjacencyShape,
  type BankDecor,
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
  boundaryFoliage: 'boundary_hedge_v1',
} as const;

function sourceImage(scene: Phaser.Scene, key: string): CanvasImageSource {
  return scene.textures.get(key).getSourceImage() as CanvasImageSource;
}

/** Rounded-rect subpath, manually via arcTo (not relying on the newer
 * ctx.roundRect, which not every target needs to support). Callers add this
 * as one subpath of a larger path before clip()/fill() — combined with
 * ctx.rect() calls for the connectivity "arms" under the nonzero fill rule,
 * consistent winding gives a clean union silhouette. */
function roundRectSubpath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Organic "compact core + arms toward each open direction" silhouette —
 * used for both the earth path fill and the water fill. `corridor` is the
 * width of the core/arms (fraction of tile), `armReach` how far an arm
 * reaches past the core toward the tile edge (usually all the way, 1). */
function traceOrganicSilhouette(
  ctx: CanvasRenderingContext2D,
  openDirs: readonly Dir[],
  tile: number,
  corridorFrac: number
) {
  const corridor = tile * corridorFrac;
  const inset = (tile - corridor) / 2;
  const radius = corridor * 0.34;
  ctx.beginPath();
  roundRectSubpath(ctx, inset, inset, corridor, corridor, radius);
  for (const dir of openDirs) {
    switch (dir) {
      case 'N':
        ctx.rect(inset, 0, corridor, inset + radius);
        break;
      case 'S':
        ctx.rect(inset, tile - inset - radius, corridor, inset + radius);
        break;
      case 'E':
        ctx.rect(tile - inset - radius, inset, inset + radius, corridor);
        break;
      case 'W':
        ctx.rect(0, inset, inset + radius, corridor);
        break;
    }
  }
}

function ensureCanvasTexture(scene: Phaser.Scene, key: string, size: number): Phaser.Textures.CanvasTexture | null {
  if (scene.textures.exists(key)) return null; // already built — idempotent, same convention as proceduralAssets.ts
  return scene.textures.createCanvas(key, size, size);
}

// ---- boundary foliage ------------------------------------------------------

/** Turns the accepted 64×64 bush cutout into eight dense 32×32 boundary
 * material variants. Each variant uses a different deterministic crop,
 * quarter-turn and flip, so the perimeter reads as overlapping foliage
 * instead of a repeated wallpaper tile. The underlying thicket occupancy
 * and collision remain entirely in worldConfig. */
function buildThicketTexture(scene: Phaser.Scene, col: number, row: number): string {
  const variant = boundaryFoliageVariant(col, row);
  const key = `terrain_thicket_v1_${variant}`;
  const tex = ensureCanvasTexture(scene, key, TILE);
  if (!tex) return key;

  const ctx = tex.getContext();
  ctx.clearRect(0, 0, TILE, TILE);
  ctx.fillStyle = '#173b22';
  ctx.fillRect(0, 0, TILE, TILE);
  const size = TILE * (1.32 + (variant % 3) * 0.09);
  const dx = ((variant * 7) % 9) - 4;
  const dy = ((variant * 5) % 7) - 3;
  ctx.save();
  ctx.translate(TILE / 2 + dx, TILE / 2 + dy);
  ctx.rotate((variant % 4) * (Math.PI / 2));
  ctx.scale(variant & 4 ? -1 : 1, 1);
  ctx.drawImage(sourceImage(scene, TERRAIN_KEYS.boundaryFoliage), -size / 2, -size / 2, size, size);
  ctx.restore();
  tex.refresh();
  return key;
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

function buildPathTexture(scene: Phaser.Scene, mask: number): string {
  const key = `terrain_path_v1_${mask}`;
  const tex = ensureCanvasTexture(scene, key, TILE);
  if (!tex) return key;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, TILE, TILE);
  ctx.drawImage(sourceImage(scene, TERRAIN_KEYS.grass), 0, 0, TILE, TILE);
  const { openDirs } = classifyFourNeighbourMask(mask);
  ctx.save();
  traceOrganicSilhouette(ctx, openDirs, TILE, 0.46);
  ctx.clip();
  ctx.drawImage(sourceImage(scene, TERRAIN_KEYS.pathEarth), 0, 0, TILE, TILE);
  ctx.restore();
  tex.refresh();
  return key;
}

// ---- water (organic pond fill, 2 shimmer frames) ---------------------------

function buildWaterTexture(scene: Phaser.Scene, mask: number, alt: boolean): string {
  const key = `terrain_water_v1_${mask}_${alt ? 'alt' : 'base'}`;
  const tex = ensureCanvasTexture(scene, key, TILE);
  if (!tex) return key;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, TILE, TILE);
  ctx.drawImage(sourceImage(scene, TERRAIN_KEYS.grass), 0, 0, TILE, TILE);
  const { openDirs } = classifyFourNeighbourMask(mask);
  ctx.save();
  traceOrganicSilhouette(ctx, openDirs, TILE, 0.86);
  ctx.clip();
  ctx.drawImage(sourceImage(scene, alt ? TERRAIN_KEYS.waterAlt : TERRAIN_KEYS.water), 0, 0, TILE, TILE);
  ctx.restore();
  tex.refresh();
  return key;
}

// ---- bank (grass adjacent to water: restrained fringe + rare stone/reed) ---

function drawBankFringe(ctx: CanvasRenderingContext2D, openDirs: readonly Dir[], tile: number) {
  // A thin, low-alpha wet-earth tint along each water-facing edge — reads as
  // "damp bank", not a hard line. Restrained: short reach into the tile,
  // low opacity, no stones/reeds here (those are drawn separately, sparse).
  const depth = tile * 0.22;
  ctx.save();
  ctx.fillStyle = 'rgba(90, 74, 42, 0.28)';
  for (const dir of openDirs) {
    ctx.beginPath();
    switch (dir) {
      case 'N':
        ctx.rect(0, 0, tile, depth);
        break;
      case 'S':
        ctx.rect(0, tile - depth, tile, depth);
        break;
      case 'E':
        ctx.rect(tile - depth, 0, depth, tile);
        break;
      case 'W':
        ctx.rect(0, 0, depth, tile);
        break;
    }
    ctx.fill();
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

function buildBankTexture(scene: Phaser.Scene, mask: number, decor: BankDecor): string {
  const key = `terrain_bank_v1_${mask}_${decor}`;
  const tex = ensureCanvasTexture(scene, key, TILE);
  if (!tex) return key;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, TILE, TILE);
  ctx.drawImage(sourceImage(scene, TERRAIN_KEYS.grass), 0, 0, TILE, TILE);
  const { openDirs } = classifyFourNeighbourMask(mask);
  drawBankFringe(ctx, openDirs, TILE);
  drawBankDecor(ctx, decor, openDirs, TILE);
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
    return { key: buildThicketTexture(scene, col, row), shimmerAltKey: null };
  }

  if (kind === 'path') {
    const mask = pathTextureMask(col, row, pathTiles);
    return { key: buildPathTexture(scene, mask), shimmerAltKey: null };
  }

  if (kind === 'water') {
    const isWater = (c: number, r: number) => terrainAt(c, r, pathTiles) === 'water';
    const mask = neighbourMaskAt(col, row, isWater);
    const baseKey = buildWaterTexture(scene, mask, false);
    const altKey = animateWater ? buildWaterTexture(scene, mask, true) : null;
    return { key: baseKey, shimmerAltKey: altKey };
  }

  // grass — either plain, or a bank fringe if adjacent to water.
  const isWater = (c: number, r: number) => terrainAt(c, r, pathTiles) === 'water';
  const waterMask = neighbourMaskAt(col, row, isWater);
  if (waterMask !== 0) {
    const decor = bankDecorAt(col, row);
    return { key: buildBankTexture(scene, waterMask, decor), shimmerAltKey: null };
  }
  const key = grassVariantAlt(col, row) ? TERRAIN_KEYS.grassAlt : TERRAIN_KEYS.grass;
  return { key, shimmerAltKey: null };
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
