// ============================================================================
// Чистый валидатор typed V1 asset manifest (docs/VISUAL_ASSET_CONTRACT.md §9).
// Без файловой системы и без Phaser: информация о реальных файлах передаётся
// снаружи (FileInfoV1) — тест собирает её из настоящих PNG на диске, а сам
// валидатор остаётся детерминированной функцией данные→ошибки.
// ============================================================================

import type { AssetMetadataV1 } from './assetManifestV1';

/** Фактическое состояние файла на диске: существует ли и какой у PNG canvas. */
export interface FileInfoV1 {
  exists: boolean;
  width?: number;
  height?: number;
}

/** Карта file-путь → информация о файле. Записи со status 'missing' не
 * требуют присутствия в карте (их файлов и не должно быть). */
export type FileInfoMapV1 = Record<string, FileInfoV1>;

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Валидация манифеста. Возвращает список человекочитаемых ошибок (пустой —
 * манифест валиден). fileInfo опционален: без него проверяются только
 * структурные правила (ID/anchor/размеры/footprint/required-vs-missing/
 * plant sets), с ним — дополнительно существование файлов и совпадение
 * фактического PNG canvas с заявленным sourceSize.
 */
export function validateAssetManifestV1(
  entries: readonly AssetMetadataV1[],
  fileInfo?: FileInfoMapV1
): string[] {
  const errors: string[] = [];

  // 1. Уникальные ID.
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) errors.push(`duplicate asset id: ${e.id}`);
    seen.add(e.id);
  }

  for (const e of entries) {
    // 2. Корректные anchors: оба в [0, 1].
    const [ax, ay] = e.anchor;
    if (!isFiniteNumber(ax) || !isFiniteNumber(ay) || ax < 0 || ax > 1 || ay < 0 || ay > 1) {
      errors.push(`${e.id}: anchor out of [0,1]: [${ax}, ${ay}]`);
    }

    // 3. Положительные размеры.
    const [sw, sh] = e.sourceSize;
    const [dw, dh] = e.displaySize;
    if (!isFiniteNumber(sw) || !isFiniteNumber(sh) || sw <= 0 || sh <= 0) {
      errors.push(`${e.id}: non-positive sourceSize: [${sw}, ${sh}]`);
    }
    if (!isFiniteNumber(dw) || !isFiniteNumber(dh) || dw <= 0 || dh <= 0) {
      errors.push(`${e.id}: non-positive displaySize: [${dw}, ${dh}]`);
    }

    // 4. Валидный footprint: ширина/высота строго положительны.
    if (e.footprint !== null) {
      const [fx, fy, fw, fh] = e.footprint;
      if (!isFiniteNumber(fx) || !isFiniteNumber(fy) || !isFiniteNumber(fw) || !isFiniteNumber(fh) || fw <= 0 || fh <= 0) {
        errors.push(`${e.id}: invalid footprint: [${e.footprint.join(', ')}]`);
      }
    }

    // 5. required-ассет не может быть missing.
    if (e.required && e.status === 'missing') {
      errors.push(`${e.id}: required asset must not have status 'missing'`);
    }

    // 6/7. Существование файла и совпадение фактического PNG canvas.
    if (fileInfo && e.status !== 'missing') {
      const info = fileInfo[e.file];
      if (!info || !info.exists) {
        errors.push(`${e.id}: file does not exist: ${e.file}`);
      } else if (
        info.width !== undefined &&
        info.height !== undefined &&
        (info.width !== e.sourceSize[0] || info.height !== e.sourceSize[1])
      ) {
        errors.push(
          `${e.id}: actual PNG canvas ${info.width}x${info.height} != declared sourceSize ${e.sourceSize[0]}x${e.sourceSize[1]} (${e.file})`
        );
      }
    }
    if (fileInfo && e.status === 'missing') {
      const info = fileInfo[e.file];
      if (info?.exists) {
        errors.push(`${e.id}: status 'missing' but the file actually exists: ${e.file}`);
      }
    }
  }

  // 8. Слои одного plant-набора: одинаковый canvas и anchor.
  const sets = new Map<string, AssetMetadataV1[]>();
  for (const e of entries) {
    if (!e.plantSet) continue;
    const list = sets.get(e.plantSet) ?? [];
    list.push(e);
    sets.set(e.plantSet, list);
  }
  for (const [setId, layers] of sets) {
    const [first, ...rest] = layers;
    for (const layer of rest) {
      if (layer.sourceSize[0] !== first.sourceSize[0] || layer.sourceSize[1] !== first.sourceSize[1]) {
        errors.push(`plant set ${setId}: layer ${layer.id} canvas differs from ${first.id}`);
      }
      if (layer.anchor[0] !== first.anchor[0] || layer.anchor[1] !== first.anchor[1]) {
        errors.push(`plant set ${setId}: layer ${layer.id} anchor differs from ${first.id}`);
      }
    }
  }

  return errors;
}
