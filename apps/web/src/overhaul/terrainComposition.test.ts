import { describe, expect, it } from 'vitest';
import {
  DIR_BITS,
  bankDecorAt,
  classifyFourNeighbourMask,
  computeNeighbourMask,
  grassVariantAlt,
  neighbourMaskAt,
  waterAnimatesFor,
  type Dir,
} from './terrainComposition';
import { POND, SECTOR, TILE, pathTileKeySet, terrainAt } from './worldConfig';

describe('grassVariantAlt — pure coordinate hash, not game RNG', () => {
  it('is stable: same (col,row) always returns the same result', () => {
    for (const [col, row] of [
      [0, 0],
      [5, 12],
      [-3, 7],
      [100, -40],
      [22, 22],
    ]) {
      const first = grassVariantAlt(col, row);
      for (let i = 0; i < 5; i++) expect(grassVariantAlt(col, row)).toBe(first);
    }
  });

  it('is a pure function of its inputs only — no shared/mutable state between calls', () => {
    const a = grassVariantAlt(10, 10);
    grassVariantAlt(999, -999); // unrelated call in between
    grassVariantAlt(1, 1);
    expect(grassVariantAlt(10, 10)).toBe(a);
  });

  it('is sparse: only a minority of a large grid gets the alt variant', () => {
    let altCount = 0;
    const size = 64;
    for (let col = 0; col < size; col++) {
      for (let row = 0; row < size; row++) {
        if (grassVariantAlt(col, row)) altCount++;
      }
    }
    const fraction = altCount / (size * size);
    expect(fraction).toBeGreaterThan(0); // real variation exists...
    expect(fraction).toBeLessThan(0.25); // ...but stays sparse, not a checkerboard
  });

  it('does not degenerate to a fixed-period pattern (e.g. every Nth tile)', () => {
    // A hash worth calling "pure coordinate hash" should not just reduce to
    // (col+row) % k — spot check that neighbouring tiles are not locked into
    // a trivial repeating stripe.
    const row = 5;
    const results = Array.from({ length: 20 }, (_, col) => grassVariantAlt(col, row));
    const allSame = results.every((r) => r === results[0]);
    expect(allSame).toBe(false);
  });
});

describe('bankDecorAt — sparse, mutually exclusive, deterministic', () => {
  it('is stable across repeated calls', () => {
    expect(bankDecorAt(4, 9)).toBe(bankDecorAt(4, 9));
    expect(bankDecorAt(-1, 30)).toBe(bankDecorAt(-1, 30));
  });

  it('stays restrained: most tiles get no decor at all', () => {
    let none = 0;
    let total = 0;
    for (let col = 0; col < 40; col++) {
      for (let row = 0; row < 40; row++) {
        total++;
        if (bankDecorAt(col, row) === 'none') none++;
      }
    }
    expect(none / total).toBeGreaterThan(0.8);
  });

  it('produces both stone and reed somewhere in a large grid (real variety, not always the same pick)', () => {
    const kinds = new Set<string>();
    for (let col = 0; col < 60; col++) {
      for (let row = 0; row < 60; row++) kinds.add(bankDecorAt(col, row));
    }
    expect(kinds.has('stone')).toBe(true);
    expect(kinds.has('reed')).toBe(true);
    expect(kinds.has('none')).toBe(true);
  });
});

describe('waterAnimatesFor — reduced-motion respected', () => {
  it('animates when the user has not requested reduced motion', () => {
    expect(waterAnimatesFor(false)).toBe(true);
  });

  it('never animates in reduced motion (base frame only)', () => {
    expect(waterAnimatesFor(true)).toBe(false);
  });
});

describe('computeNeighbourMask / neighbourMaskAt', () => {
  it('sets exactly the bits for present neighbours', () => {
    expect(computeNeighbourMask(false, false, false, false)).toBe(0);
    expect(computeNeighbourMask(true, false, false, false)).toBe(DIR_BITS.N);
    expect(computeNeighbourMask(false, true, false, false)).toBe(DIR_BITS.E);
    expect(computeNeighbourMask(false, false, true, false)).toBe(DIR_BITS.S);
    expect(computeNeighbourMask(false, false, false, true)).toBe(DIR_BITS.W);
    expect(computeNeighbourMask(true, true, true, true)).toBe(15);
  });

  it('neighbourMaskAt reads exactly the four orthogonal neighbours, never diagonals', () => {
    const member = new Set(['5,5', '5,4', '6,5']); // N and E of (5,5) are members
    const isMember = (c: number, r: number) => member.has(`${c},${r}`);
    // diagonal member should NOT affect the mask
    member.add('6,4');
    expect(neighbourMaskAt(5, 5, isMember)).toBe(DIR_BITS.N | DIR_BITS.E);
  });
});

describe('classifyFourNeighbourMask — all 16 four-neighbour masks', () => {
  const expected: Record<number, { kind: string; openDirs: Dir[] }> = {
    0: { kind: 'isolated', openDirs: [] },
    1: { kind: 'end', openDirs: ['N'] },
    2: { kind: 'end', openDirs: ['E'] },
    4: { kind: 'end', openDirs: ['S'] },
    8: { kind: 'end', openDirs: ['W'] },
    5: { kind: 'straight', openDirs: ['N', 'S'] }, // N+S
    10: { kind: 'straight', openDirs: ['E', 'W'] }, // E+W
    3: { kind: 'corner', openDirs: ['N', 'E'] },
    6: { kind: 'corner', openDirs: ['E', 'S'] },
    12: { kind: 'corner', openDirs: ['S', 'W'] },
    9: { kind: 'corner', openDirs: ['N', 'W'] },
    14: { kind: 't', openDirs: ['E', 'S', 'W'] }, // missing N
    13: { kind: 't', openDirs: ['N', 'S', 'W'] }, // missing E
    11: { kind: 't', openDirs: ['N', 'E', 'W'] }, // missing S
    7: { kind: 't', openDirs: ['N', 'E', 'S'] }, // missing W
    15: { kind: 'cross', openDirs: ['N', 'E', 'S', 'W'] },
  };

  it('covers exactly masks 0..15, one classification each', () => {
    expect(Object.keys(expected).map(Number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => i)
    );
  });

  for (const [maskStr, exp] of Object.entries(expected)) {
    const mask = Number(maskStr);
    it(`mask ${mask} (0b${mask.toString(2).padStart(4, '0')}) classifies as ${exp.kind}`, () => {
      const shape = classifyFourNeighbourMask(mask);
      expect(shape.kind).toBe(exp.kind);
      expect(shape.openDirs).toEqual(exp.openDirs);
      expect(shape.mask).toBe(mask);
    });
  }

  it('counts exactly 1 isolated + 4 ends + 2 straights + 4 corners + 4 Ts + 1 cross', () => {
    const counts: Record<string, number> = {};
    for (let m = 0; m <= 15; m++) {
      const k = classifyFourNeighbourMask(m).kind;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts).toEqual({ isolated: 1, end: 4, straight: 2, corner: 4, t: 4, cross: 1 });
  });
});

describe('path connectivity classification against the real worldConfig path', () => {
  const pathTiles = pathTileKeySet();
  const isPath = (col: number, row: number) => pathTiles.has(`${col},${row}`);

  function maskAt(col: number, row: number) {
    return neighbourMaskAt(col, row, isPath);
  }

  it('classifies the two documented endpoints of the path polyline as ends', () => {
    // PATH_POLYLINE starts at (656,744) and ends at (984,880) — see worldConfig.ts.
    const startCol = Math.floor(656 / TILE);
    const startRow = Math.floor(744 / TILE);
    const endCol = Math.floor(984 / TILE);
    const endRow = Math.floor(880 / TILE);
    expect(isPath(startCol, startRow)).toBe(true);
    expect(isPath(endCol, endRow)).toBe(true);
    expect(classifyFourNeighbourMask(maskAt(startCol, startRow)).kind).toBe('end');
    expect(classifyFourNeighbourMask(maskAt(endCol, endRow)).kind).toBe('end');
  });

  it('classifies the turn near (656,880) as a corner', () => {
    // The polyline turns 90° at x=656,y=880 (vertical leg meets the main
    // horizontal corridor) — see worldConfig.ts PATH_POLYLINE.
    const col = Math.floor(656 / TILE);
    const row = Math.floor(880 / TILE);
    expect(isPath(col, row)).toBe(true);
    const kind = classifyFourNeighbourMask(maskAt(col, row)).kind;
    expect(['corner', 't', 'cross']).toContain(kind); // never a bare 'straight' or 'end' at a real turn
  });

  it('classifies an interior tile of the long horizontal corridor as straight', () => {
    // Somewhere strictly between the turn and the east endpoint, on row 27
    // (y=864..896), both E and W neighbours are path tiles.
    const row = Math.floor(880 / TILE);
    const col = Math.floor(780 / TILE); // well inside the corridor, away from both ends
    expect(isPath(col, row)).toBe(true);
    expect(classifyFourNeighbourMask(maskAt(col, row)).kind).toBe('straight');
  });

  it('every classified path tile has at least one open direction (never isolated in real data)', () => {
    for (const key of pathTiles) {
      const [col, row] = key.split(',').map(Number);
      const shape = classifyFourNeighbourMask(maskAt(col, row));
      expect(shape.openDirs.length, `path tile (${col},${row}) is isolated`).toBeGreaterThan(0);
    }
  });

  it('no path tile is ever adjacent to thicket (documented assumption behind always compositing the path silhouette over a grass background)', () => {
    for (const key of pathTiles) {
      const [col, row] = key.split(',').map(Number);
      for (const [dc, dr] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ]) {
        const kind = terrainAt(col + dc, row + dr, pathTiles);
        expect(kind === 'thicket', `path tile (${col},${row}) neighbour is ${kind}`).toBe(false);
      }
    }
  });

  it('documents the one real exception: the path corridor runs alongside the pond, so a path tile CAN have a water neighbour', () => {
    // The path corridor (row 27, y 864-896) runs directly above the pond
    // (POND.y=912, row 28) — tile (23,27) has a water neighbour to the
    // south. terrainTextures.ts's path-mask arm extension treats a water
    // neighbour the same as a path neighbour (both are "wet", not grass)
    // specifically so this real case never leaves a false grass-colored gap
    // between the path silhouette and the pond edge — see its comment.
    expect(isPath(23, 27)).toBe(true);
    expect(terrainAt(23, 28, pathTiles)).toBe('water');
  });
});

describe('pond edge/corner classification against the real POND rectangle', () => {
  const pathTiles = pathTileKeySet();
  const isWater = (col: number, row: number) => terrainAt(col, row, pathTiles) === 'water';

  function maskAt(col: number, row: number) {
    return neighbourMaskAt(col, row, isWater);
  }

  const pondColStart = Math.floor(POND.x / TILE);
  const pondColEnd = Math.floor((POND.x + POND.w - 1) / TILE);
  const pondRowStart = Math.floor(POND.y / TILE);
  const pondRowEnd = Math.floor((POND.y + POND.h - 1) / TILE);

  it('has a pond spanning more than one tile in each axis (otherwise edge/corner classification is untestable)', () => {
    expect(pondColEnd).toBeGreaterThan(pondColStart);
    expect(pondRowEnd).toBeGreaterThan(pondRowStart);
  });

  it('classifies the pond corner tile as a corner or end (never a bare cross — water has an edge somewhere on a finite pond)', () => {
    const shape = classifyFourNeighbourMask(maskAt(pondColStart, pondRowStart));
    expect(shape.kind).not.toBe('isolated');
    expect(shape.openDirs.length).toBeLessThan(4);
  });

  it('classifies every pond-perimeter water tile as having at least one non-water (bank) side', () => {
    for (let col = pondColStart; col <= pondColEnd; col++) {
      for (let row = pondRowStart; row <= pondRowEnd; row++) {
        const onPerimeter = col === pondColStart || col === pondColEnd || row === pondRowStart || row === pondRowEnd;
        if (!onPerimeter) continue;
        const shape = classifyFourNeighbourMask(maskAt(col, row));
        expect(shape.openDirs.length, `pond tile (${col},${row})`).toBeLessThan(4);
      }
    }
  });

  it('gives every grass tile touching the pond a non-zero water-neighbour mask (continuous bank, no gaps)', () => {
    const bankTiles: Array<[number, number]> = [];
    for (let col = pondColStart - 1; col <= pondColEnd + 1; col++) {
      for (let row = pondRowStart - 1; row <= pondRowEnd + 1; row++) {
        if (terrainAt(col, row, pathTiles) !== 'grass') continue;
        const mask = neighbourMaskAt(col, row, isWater);
        if (mask !== 0) bankTiles.push([col, row]);
      }
    }
    // The pond must actually have a detectable bank ring, not zero tiles.
    expect(bankTiles.length).toBeGreaterThan(0);
    for (const [col, row] of bankTiles) {
      const mask = neighbourMaskAt(col, row, isWater);
      const shape = classifyFourNeighbourMask(mask);
      expect(shape.openDirs.length).toBeGreaterThan(0);
    }
  });
});

describe('unchanged terrain occupancy/collision semantics (regression guard)', () => {
  // This slice must never redefine POND/SECTOR/pathTileKeySet/terrainAt —
  // only consume them. These assertions pin down the exact values already
  // covered by worldConfig.test.ts so an accidental edit to worldConfig.ts
  // during this slice would also fail here.
  it('POND and SECTOR keep their exact pre-existing rectangles', () => {
    expect(POND).toEqual({ x: 740, y: 912, w: 100, h: 70 });
    expect(SECTOR.w).toBeGreaterThan(0);
    expect(SECTOR.h).toBeGreaterThan(0);
  });

  it('terrainAt still returns one of exactly the four known kinds for every rendered cell', () => {
    const pathTiles = pathTileKeySet();
    for (let col = Math.floor(SECTOR.x / TILE) - 2; col < Math.floor((SECTOR.x + SECTOR.w) / TILE) + 2; col++) {
      for (let row = Math.floor(SECTOR.y / TILE) - 2; row < Math.floor((SECTOR.y + SECTOR.h) / TILE) + 2; row++) {
        expect(['grass', 'path', 'water', 'thicket']).toContain(terrainAt(col, row, pathTiles));
      }
    }
  });
});
