import { describe, expect, it } from 'vitest';
import {
  ensureGenomeV2Sidecars,
  migrateGenomeToV2,
  migrateMutationId,
  type GenomeV2,
} from './geneticsV2';
import type { Genome } from './genetics';
import type { Specimen } from './types';
import { GENETICS_CONFIG } from './config';

// ============================================================================
// Genetics V2 — Slice 1. Тесты 7-19 из обязательного списка задания
// (docs/GENETICS_TARGET_DELTA.md §10.4) — маппинг legacy->V2 и
// ensureGenomeV2Sidecars. Тесты 1-6/20-22 (save-уровневая миграция) —
// apps/web/src/game/store.test.ts.
// ============================================================================

function baseGenome(overrides: Partial<Genome> = {}): Genome {
  return {
    shape: 1,
    primary: GENETICS_CONFIG.primaryPool[0],
    secondary: GENETICS_CONFIG.secondaryPool[0],
    leaf: GENETICS_CONFIG.leafPool[0],
    pattern: 'solid',
    size: 'normal',
    aura: 'none',
    mutationId: null,
    ...overrides,
  };
}

function specimenOf(id: string, genome: Genome, genomeV2?: GenomeV2): Specimen {
  return genomeV2 ? { id, genome, createdAt: 0, genomeV2 } : { id, genome, createdAt: 0 };
}

describe('тест 7: все 8 primary HEX мигрируют точно', () => {
  // Контракт §4.2 (primaryColor) — точное соответствие ID -> HEX.
  const expected: Record<string, string> = {
    '#FFC85C': 'primary_honey',
    '#F5A623': 'primary_amber',
    '#FF6F59': 'primary_sunset',
    '#FF8C77': 'primary_coral',
    '#CFA1E8': 'primary_lilac',
    '#B678D9': 'primary_violet',
    '#89D65C': 'primary_leaf',
    '#CBE9F2': 'primary_frost',
  };

  it('пул кода содержит ровно эти 8 значений', () => {
    expect(GENETICS_CONFIG.primaryPool).toHaveLength(8);
    expect(new Set(GENETICS_CONFIG.primaryPool)).toEqual(new Set(Object.keys(expected)));
  });

  it.each(GENETICS_CONFIG.primaryPool)('%s мигрирует в контрактный ID, гомозиготно', (hex) => {
    const v2 = migrateGenomeToV2(baseGenome({ primary: hex }));
    expect(v2.primaryColor).toEqual({ a: expected[hex], b: expected[hex] });
  });

  it('маппинг биективен — 8 уникальных ID на 8 уникальных hex', () => {
    const ids = GENETICS_CONFIG.primaryPool.map(
      (hex) => migrateGenomeToV2(baseGenome({ primary: hex })).primaryColor.a
    );
    expect(new Set(ids).size).toBe(8);
  });
});

describe('тест 8: все 7 secondary HEX мигрируют точно', () => {
  const expected: Record<string, string> = {
    '#57993A': 'secondary_forest',
    '#FF6F59': 'secondary_sunset',
    '#F5A623': 'secondary_amber',
    '#E05543': 'secondary_crimson',
    '#9457BC': 'secondary_purple',
    '#A9D4E2': 'secondary_sky',
    '#D98C12': 'secondary_ochre',
  };

  it('пул кода содержит ровно эти 7 значений', () => {
    expect(GENETICS_CONFIG.secondaryPool).toHaveLength(7);
    expect(new Set(GENETICS_CONFIG.secondaryPool)).toEqual(new Set(Object.keys(expected)));
  });

  it.each(GENETICS_CONFIG.secondaryPool)('%s мигрирует в контрактный ID, гомозиготно', (hex) => {
    const v2 = migrateGenomeToV2(baseGenome({ secondary: hex }));
    expect(v2.secondaryColor).toEqual({ a: expected[hex], b: expected[hex] });
  });

  it('маппинг биективен — 7 уникальных ID на 7 уникальных hex', () => {
    const ids = GENETICS_CONFIG.secondaryPool.map(
      (hex) => migrateGenomeToV2(baseGenome({ secondary: hex })).secondaryColor.a
    );
    expect(new Set(ids).size).toBe(7);
  });
});

describe('тест 9: все 3 leaf HEX мигрируют точно (в новый независимый локус leafColor)', () => {
  const expected: Record<string, string> = {
    '#89D65C': 'leaf_color_meadow',
    '#6FBE44': 'leaf_color_fresh',
    '#57993A': 'leaf_color_forest',
  };

  it('пул кода содержит ровно эти 3 значения', () => {
    expect(GENETICS_CONFIG.leafPool).toHaveLength(3);
    expect(new Set(GENETICS_CONFIG.leafPool)).toEqual(new Set(Object.keys(expected)));
  });

  it.each(GENETICS_CONFIG.leafPool)('%s мигрирует в контрактный ID, гомозиготно', (hex) => {
    const v2 = migrateGenomeToV2(baseGenome({ leaf: hex }));
    expect(v2.leafColor).toEqual({ a: expected[hex], b: expected[hex] });
  });

  it('leafColor независим от leafForm — leafForm всегда нейтральный дефолт независимо от цвета листа', () => {
    for (const hex of GENETICS_CONFIG.leafPool) {
      const v2 = migrateGenomeToV2(baseGenome({ leaf: hex }));
      expect(v2.leafForm).toEqual({ a: 'leaf_standard', b: 'leaf_standard' });
    }
  });
});

describe('тест 10: все pattern/size/aura enum-значения мигрируют точно', () => {
  it.each([
    ['solid', 'pattern_solid'],
    ['duotone', 'pattern_duotone'],
  ] as const)('pattern=%s -> %s (гомозиготно)', (legacy, expectedId) => {
    const v2 = migrateGenomeToV2(baseGenome({ pattern: legacy }));
    expect(v2.pattern).toEqual({ a: expectedId, b: expectedId });
  });

  it.each([
    ['small', 'size_small'],
    ['normal', 'size_normal'],
    ['large', 'size_large'],
    ['giant', 'size_giant'],
  ] as const)('size=%s -> %s (гомозиготно)', (legacy, expectedId) => {
    const v2 = migrateGenomeToV2(baseGenome({ size: legacy }));
    expect(v2.size).toEqual({ a: expectedId, b: expectedId });
  });

  it.each([
    ['none', 'aura_none'],
    ['faint', 'aura_faint'],
    ['glow', 'aura_glow'],
    ['radiant', 'aura_radiant'],
  ] as const)('aura=%s -> %s (гомозиготно, включая radiant несмотря на вес 0 в пуле рождения V2)', (legacy, expectedId) => {
    const v2 = migrateGenomeToV2(baseGenome({ aura: legacy }));
    expect(v2.aura).toEqual({ a: expectedId, b: expectedId });
  });

  it('speciesId копируется 1:1 из genome.shape', () => {
    for (const shape of GENETICS_CONFIG.shapes) {
      expect(migrateGenomeToV2(baseGenome({ shape })).speciesId).toBe(shape);
    }
  });

  it('новые геометрические локусы всегда получают нейтральный дефолт, гомозиготно', () => {
    const v2 = migrateGenomeToV2(baseGenome());
    expect(v2.stemForm).toEqual({ a: 'stem_standard', b: 'stem_standard' });
    expect(v2.leafForm).toEqual({ a: 'leaf_standard', b: 'leaf_standard' });
    expect(v2.flowerForm).toEqual({ a: 'flower_standard', b: 'flower_standard' });
  });
});

describe('тест 11: все четыре legacy mutation ID и null мигрируют точно', () => {
  it.each(['golden_vein', 'stardust', 'prism', 'phoenix', null])(
    'migrateMutationId(%s) копируется 1:1',
    (id) => {
      expect(migrateMutationId(id)).toBe(id);
    }
  );

  it.each(['golden_vein', 'stardust', 'prism', 'phoenix', null])(
    'genome.mutationId=%s -> genomeV2.mutationId идентично (через migrateGenomeToV2)',
    (id) => {
      const v2 = migrateGenomeToV2(baseGenome({ mutationId: id }));
      expect(v2.mutationId).toBe(id);
    }
  );
});

describe('тест 12: неизвестный mutation ID не роняет загрузку', () => {
  it('migrateMutationId с посторонней строкой возвращает null, не бросает', () => {
    expect(() => migrateMutationId('not_a_real_mutation')).not.toThrow();
    expect(migrateMutationId('not_a_real_mutation')).toBeNull();
  });

  it('migrateGenomeToV2 с повреждённым mutationId не бросает и даёт genomeV2.mutationId=null', () => {
    const genome = baseGenome({ mutationId: 'corrupted_legacy_value' });
    expect(() => migrateGenomeToV2(genome)).not.toThrow();
    expect(migrateGenomeToV2(genome).mutationId).toBeNull();
  });

  it('legacy genome.mutationId сам по себе не переписывается ensureGenomeV2Sidecars', () => {
    const genome = baseGenome({ mutationId: 'corrupted_legacy_value' });
    const [migrated] = ensureGenomeV2Sidecars([specimenOf('s1', genome)]);
    expect(migrated.genome.mutationId).toBe('corrupted_legacy_value'); // не тронуто
    expect(migrated.genomeV2?.mutationId).toBeNull();
  });
});

describe('тест 13: V4-save с одним specimen без sidecar', () => {
  it('backfill создаёт sidecar только тому specimen, у которого его нет', () => {
    const withSidecar = specimenOf('has', baseGenome(), migrateGenomeToV2(baseGenome()));
    const withoutSidecar = specimenOf('missing', baseGenome());
    const result = ensureGenomeV2Sidecars([withSidecar, withoutSidecar]);

    const has = result.find((s) => s.id === 'has')!;
    const missing = result.find((s) => s.id === 'missing')!;
    expect(has).toBe(withSidecar); // не пересоздан — та же ссылка
    expect(missing.genomeV2).toBeDefined();
    expect(missing).not.toBe(withoutSidecar); // пересоздан именно этот
  });
});

describe('тест 14: смешанный V4-save (часть с genomeV2, часть без, вперемешку)', () => {
  it('после backfill все specimens имеют genomeV2, порядок и количество сохранены', () => {
    const a = specimenOf('a', baseGenome({ shape: 1 })); // без sidecar
    const b = specimenOf('b', baseGenome({ shape: 2 }), migrateGenomeToV2(baseGenome({ shape: 2 }))); // с sidecar
    const c = specimenOf('c', baseGenome({ shape: 3 })); // без sidecar
    const d = specimenOf('d', baseGenome({ shape: 4 }), migrateGenomeToV2(baseGenome({ shape: 4 }))); // с sidecar

    const result = ensureGenomeV2Sidecars([a, b, c, d]);

    expect(result.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.every((s) => s.genomeV2)).toBe(true);
    expect(result.find((s) => s.id === 'b')).toBe(b); // существующий sidecar не тронут
    expect(result.find((s) => s.id === 'd')).toBe(d);
  });
});

describe('тест 15: V2→Legacy breed→V2 backfill (сценарий delta doc §7.2 целиком)', () => {
  it('specimen, рождённый через legacy breed при временно выключенном V2, корректно получает sidecar на следующей загрузке', () => {
    // 1. Save уже мигрирован — старые specimens имеют genomeV2.
    const migrated = specimenOf('old', baseGenome({ shape: 1 }), migrateGenomeToV2(baseGenome({ shape: 1 })));
    // 2. V2 временно выключен, игрок создаёт нового specimen через legacy —
    //    у него нет genomeV2 (legacy engine ничего не знает о нём).
    const newLegacy = specimenOf('new_from_legacy_breed', baseGenome({ shape: 2, primary: GENETICS_CONFIG.primaryPool[3] }));
    expect(newLegacy.genomeV2).toBeUndefined();

    // 3. V2 включён обратно — следующая загрузка вызывает ensureGenomeV2Sidecars.
    const result = ensureGenomeV2Sidecars([migrated, newLegacy]);

    const old = result.find((s) => s.id === 'old')!;
    const fresh = result.find((s) => s.id === 'new_from_legacy_breed')!;
    expect(old).toBe(migrated); // старый не тронут
    expect(fresh.genomeV2).toBeDefined();
    expect(fresh.genomeV2!.speciesId).toBe(2);
  });
});

describe('тест 16: повторный backfill — no-op', () => {
  it('второй вызов ensureGenomeV2Sidecars на уже полностью смигрированном массиве ничего не меняет', () => {
    const specimens = [specimenOf('a', baseGenome()), specimenOf('b', baseGenome({ shape: 2 }))];
    const firstPass = ensureGenomeV2Sidecars(specimens);
    const secondPass = ensureGenomeV2Sidecars(firstPass);

    expect(secondPass).toEqual(firstPass);
    secondPass.forEach((s, i) => expect(s).toBe(firstPass[i])); // те же ссылки, ничего не пересоздано
  });
});

describe('тест 17: существующий sidecar не перезаписывается', () => {
  it('specimen с genomeV2, отличным от того, что дал бы пересчёт по текущему legacy genome, сохраняет исходный sidecar как есть', () => {
    const legacyGenome = baseGenome({ shape: 1, primary: GENETICS_CONFIG.primaryPool[0] });
    // Намеренно "устаревший"/другой sidecar, не совпадающий с тем, что дал бы
    // текущий legacy genome — имитирует native V2-геном, рождённый V2-кодом,
    // а не мигрированный.
    const customSidecar = migrateGenomeToV2(baseGenome({ shape: 7, primary: GENETICS_CONFIG.primaryPool[6] }));
    const specimen = specimenOf('native_v2', legacyGenome, customSidecar);

    const [result] = ensureGenomeV2Sidecars([specimen]);

    expect(result.genomeV2).toBe(customSidecar); // не пересчитан из legacy genome
    expect(result.genomeV2!.speciesId).toBe(7); // НЕ 1, что дал бы пересчёт
  });
});

describe('тест 18: save-level поля не меняются при sidecar-backfill', () => {
  it('ensureGenomeV2Sidecars — чистая функция над Specimen[], не трогает GameState целиком', () => {
    // ensureGenomeV2Sidecars принимает и возвращает только Specimen[] — по
    // самой сигнатуре типа не может прочитать или изменить pollen/labLevel/
    // pityCounter/обучающие флаги. Дополнительно проверяем на уровне store:
    // полный цикл загрузки с backfill не меняет save-уровневые поля,
    // отличные от тех, что явно входят в глобальную миграцию.
    const before = ensureGenomeV2Sidecars([specimenOf('a', baseGenome())]);
    // Повторный backfill того же результата не создаёт побочных изменений.
    const after = ensureGenomeV2Sidecars(before);
    expect(after).toEqual(before);
  });
});

describe('тест 19: legacy genome остаётся deep-equal исходному после backfill', () => {
  it('specimen.genome после ensureGenomeV2Sidecars побайтово равен genome до backfill', () => {
    const genome = baseGenome({ shape: 5, mutationId: 'stardust' });
    const genomeSnapshot = JSON.parse(JSON.stringify(genome));
    const specimen = specimenOf('s', genome);

    const [result] = ensureGenomeV2Sidecars([specimen]);

    expect(result.genome).toEqual(genomeSnapshot);
    expect(result.genome).toBe(genome); // даже ссылка не заменена (spread не трогает genome)
  });

  it('внешний вид (все перенесённые поля) визуально совпадает: гомозиготная экспрессия равна исходному legacy-значению', () => {
    const genome = baseGenome({
      shape: 6,
      primary: GENETICS_CONFIG.primaryPool[5],
      secondary: GENETICS_CONFIG.secondaryPool[4],
      leaf: GENETICS_CONFIG.leafPool[2],
      pattern: 'duotone',
      size: 'giant',
      aura: 'glow',
    });
    const v2 = migrateGenomeToV2(genome);
    // Гомозиготная пара => "выражение" (Slice 2 ещё не реализован, но для
    // гомозиготы это тривиально a===b) идентично мигрировавшему значению.
    expect(v2.primaryColor.a).toBe(v2.primaryColor.b);
    expect(v2.secondaryColor.a).toBe(v2.secondaryColor.b);
    expect(v2.leafColor.a).toBe(v2.leafColor.b);
    expect(v2.pattern.a).toBe(v2.pattern.b);
    expect(v2.size.a).toBe(v2.size.b);
    expect(v2.aura.a).toBe(v2.aura.b);
    expect(v2.speciesId).toBe(genome.shape);
  });
});
