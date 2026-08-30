import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_MANIFEST_V1, type AssetMetadataV1 } from './assetManifestV1';
import { validateAssetManifestV1, type FileInfoMapV1 } from './assetValidatorV1';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

/** Размер PNG из IHDR-заголовка (байты 16–24, big-endian) — без зависимостей. */
function pngSize(filePath: string): { width: number; height: number } {
  const buf = readFileSync(filePath);
  // PNG signature + IHDR: width/height лежат по смещениям 16 и 20.
  expect(buf.length).toBeGreaterThan(24);
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function realFileInfo(entries: readonly AssetMetadataV1[]): FileInfoMapV1 {
  const info: FileInfoMapV1 = {};
  for (const e of entries) {
    const full = path.join(PUBLIC_DIR, e.file);
    if (!existsSync(full)) {
      info[e.file] = { exists: false };
      continue;
    }
    const { width, height } = pngSize(full);
    info[e.file] = { exists: true, width, height };
  }
  return info;
}

function baseEntry(overrides: Partial<AssetMetadataV1>): AssetMetadataV1 {
  return {
    id: 'test_asset',
    file: 'assets/test.png',
    sourceSize: [32, 32],
    displaySize: [32, 32],
    anchor: [0.5, 1],
    footprint: null,
    interactionPoint: null,
    depthOffset: 0,
    status: 'placeholder',
    required: false,
    ...overrides,
  };
}

describe('ASSET_MANIFEST_V1 — реальный манифест против реальных файлов', () => {
  it('passes full validation, including on-disk PNG canvas checks', () => {
    const errors = validateAssetManifestV1(ASSET_MANIFEST_V1, realFileInfo(ASSET_MANIFEST_V1));
    expect(errors).toEqual([]);
  });

  it('marks every existing image as placeholder — nothing is approved yet', () => {
    // Production-арт не начинался: approved появляется только после
    // прохождения V1 pipeline и приёмки владельцем (контракт §9).
    expect(ASSET_MANIFEST_V1.some((e) => e.status === 'approved')).toBe(false);
    expect(ASSET_MANIFEST_V1.filter((e) => e.status === 'placeholder').length).toBeGreaterThan(0);
  });

  it('keeps every required asset non-missing', () => {
    for (const e of ASSET_MANIFEST_V1.filter((x) => x.required)) {
      expect(e.status, e.id).not.toBe('missing');
    }
  });

  it('declares missing targets honestly (house and lab background do not exist)', () => {
    const missing = ASSET_MANIFEST_V1.filter((e) => e.status === 'missing').map((e) => e.id);
    expect(missing).toContain('building_house_target');
    expect(missing).toContain('lab_bg_level1_target');
    for (const e of ASSET_MANIFEST_V1.filter((x) => x.status === 'missing')) {
      expect(existsSync(path.join(PUBLIC_DIR, e.file)), `${e.file} must not exist`).toBe(false);
    }
  });

  it('groups both tutorial species into complete 3-stage layer sets', () => {
    const sets = new Set(ASSET_MANIFEST_V1.filter((e) => e.plantSet).map((e) => e.plantSet));
    expect(sets.size).toBe(6); // 2 вида × 3 стадии
    for (const set of sets) {
      const layers = ASSET_MANIFEST_V1.filter((e) => e.plantSet === set);
      expect(layers.length, String(set)).toBe(4); // line + 3 маски
    }
  });
});

describe('validateAssetManifestV1 — отдельные правила на синтетических данных', () => {
  it('rejects duplicate ids', () => {
    const errors = validateAssetManifestV1([baseEntry({ id: 'dup' }), baseEntry({ id: 'dup' })]);
    expect(errors.some((e) => e.includes('duplicate asset id: dup'))).toBe(true);
  });

  it('rejects anchors outside [0,1]', () => {
    const errors = validateAssetManifestV1([baseEntry({ anchor: [1.2, -0.1] })]);
    expect(errors.some((e) => e.includes('anchor out of [0,1]'))).toBe(true);
  });

  it('rejects non-positive source and display sizes', () => {
    const errors = validateAssetManifestV1([
      baseEntry({ id: 'a', sourceSize: [0, 32] }),
      baseEntry({ id: 'b', displaySize: [32, -4] }),
    ]);
    expect(errors.some((e) => e.includes('a: non-positive sourceSize'))).toBe(true);
    expect(errors.some((e) => e.includes('b: non-positive displaySize'))).toBe(true);
  });

  it('rejects footprints with non-positive width/height', () => {
    const errors = validateAssetManifestV1([baseEntry({ footprint: [-10, -10, 0, 20] })]);
    expect(errors.some((e) => e.includes('invalid footprint'))).toBe(true);
  });

  it('accepts a valid footprint relative to the anchor', () => {
    const errors = validateAssetManifestV1([baseEntry({ footprint: [-16, -8, 32, 8] })]);
    expect(errors).toEqual([]);
  });

  it('rejects a required asset with status missing', () => {
    const errors = validateAssetManifestV1([baseEntry({ required: true, status: 'missing' })]);
    expect(errors.some((e) => e.includes("required asset must not have status 'missing'"))).toBe(true);
  });

  it('rejects a non-missing entry whose file does not exist', () => {
    const errors = validateAssetManifestV1([baseEntry({})], { 'assets/test.png': { exists: false } });
    expect(errors.some((e) => e.includes('file does not exist'))).toBe(true);
  });

  it('rejects a PNG whose actual canvas differs from the declared sourceSize', () => {
    const errors = validateAssetManifestV1([baseEntry({})], {
      'assets/test.png': { exists: true, width: 64, height: 32 },
    });
    expect(errors.some((e) => e.includes('actual PNG canvas 64x32 != declared sourceSize 32x32'))).toBe(true);
  });

  it('rejects a missing entry whose file actually exists (stale status)', () => {
    const errors = validateAssetManifestV1([baseEntry({ status: 'missing' })], {
      'assets/test.png': { exists: true, width: 32, height: 32 },
    });
    expect(errors.some((e) => e.includes("status 'missing' but the file actually exists"))).toBe(true);
  });

  it('rejects plant layers of one set with different canvas or anchor', () => {
    const errors = validateAssetManifestV1([
      baseEntry({ id: 'p1', plantSet: 'set_a', sourceSize: [512, 512], anchor: [0.5, 0.5] }),
      baseEntry({ id: 'p2', plantSet: 'set_a', sourceSize: [256, 512], anchor: [0.5, 0.5] }),
      baseEntry({ id: 'p3', plantSet: 'set_a', sourceSize: [512, 512], anchor: [0.5, 1] }),
    ]);
    expect(errors.some((e) => e.includes('layer p2 canvas differs'))).toBe(true);
    expect(errors.some((e) => e.includes('layer p3 anchor differs'))).toBe(true);
  });

  it('returns no errors for the same set with identical canvas and anchor', () => {
    const errors = validateAssetManifestV1([
      baseEntry({ id: 'p1', plantSet: 'set_a' }),
      baseEntry({ id: 'p2', plantSet: 'set_a' }),
    ]);
    expect(errors).toEqual([]);
  });
});
