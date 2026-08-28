// ============================================================================
// Genetics V2 — Slice 5: legacy-совместимая проекция `genomeV2` -> `genome`.
//
// Реализует ТОЛЬКО docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.8.6, в
// объёме Slice 5 из docs/GENETICS_TARGET_DELTA.md §0.7 п.6: `Specimen.genome`
// (legacy, обязательное поле типа с Этапа 2) должен существовать у КАЖДОГО
// specimen, включая тех, что рождены целиком через Genetics V2 (Nursery Tray,
// этот slice). Эта функция — единственный источник такого legacy `genome`
// для V2-рождённых specimen; она работает НАД уже выраженным фенотипом
// (`resolvePhenotypeV2`, Slice 2), не над сырыми парами аллелей — скрытые
// (невыраженные) аллели эта функция не читает вообще и никак не уничтожает,
// они остаются как есть в `Specimen.genomeV2`.
//
// Чистая функция: без RNG, без побочных эффектов, никогда не вызывается
// повторно для уже существующего specimen и никогда не используется для
// обратного пересчёта `genomeV2` — переключение
// `VITE_DIPLOID_GENETICS_ENABLED` false->true->false не меняет `genomeV2` ни
// на бит, legacy-режим только ЧИТАЕТ `genome`.
// ============================================================================

import type { Genome, AuraTier, Pattern, SizeTier } from './genetics';
import type { AuraAllele, GenomeV2, PatternAllele, SizeAllele } from './geneticsV2';
import { resolvePhenotypeV2 } from './phenotypeV2';

/**
 * Обратная (id -> hex) версия `PRIMARY_HEX_TO_ID`/`SECONDARY_HEX_TO_ID`/
 * `LEAF_COLOR_HEX_TO_ID` (`geneticsV2.ts`) — та же самая таблица, записанная
 * в обратную сторону явными литералами (не вычисляется рантаймом через
 * `Object.entries().reduce()`), чтобы `Record<Allele, string>` заставил
 * TypeScript отказаться компилировать объект при пропущенном аллеле — тот же
 * принцип полноты, что уже применён в `phenotypeV2.ts` DOMINANCE_TABLE и
 * `rarityV2.ts` *_POINTS. Round-trip-согласованность с прямыми таблицами
 * `geneticsV2.ts` проверяется отдельным тестом (`legacyProjectionV2.test.ts`),
 * а не структурным переиспользованием — так дрейф между ними виден как
 * упавший тест, а не как молчаливое расхождение внутри одного вычисления.
 */
const PRIMARY_COLOR_TO_HEX: Record<
  'primary_honey' | 'primary_amber' | 'primary_sunset' | 'primary_coral' | 'primary_lilac' | 'primary_violet' | 'primary_leaf' | 'primary_frost',
  string
> = {
  primary_honey: '#FFC85C',
  primary_amber: '#F5A623',
  primary_sunset: '#FF6F59',
  primary_coral: '#FF8C77',
  primary_lilac: '#CFA1E8',
  primary_violet: '#B678D9',
  primary_leaf: '#89D65C',
  primary_frost: '#CBE9F2',
};

const SECONDARY_COLOR_TO_HEX: Record<
  | 'secondary_forest'
  | 'secondary_sunset'
  | 'secondary_amber'
  | 'secondary_crimson'
  | 'secondary_purple'
  | 'secondary_sky'
  | 'secondary_ochre',
  string
> = {
  secondary_forest: '#57993A',
  secondary_sunset: '#FF6F59',
  secondary_amber: '#F5A623',
  secondary_crimson: '#E05543',
  secondary_purple: '#9457BC',
  secondary_sky: '#A9D4E2',
  secondary_ochre: '#D98C12',
};

const LEAF_COLOR_TO_HEX: Record<'leaf_color_meadow' | 'leaf_color_fresh' | 'leaf_color_forest', string> = {
  leaf_color_meadow: '#89D65C',
  leaf_color_fresh: '#6FBE44',
  leaf_color_forest: '#57993A',
};

const SIZE_TO_LEGACY: Record<SizeAllele, SizeTier> = {
  size_small: 'small',
  size_normal: 'normal',
  size_large: 'large',
  size_giant: 'giant',
};

const AURA_TO_LEGACY: Record<AuraAllele, AuraTier> = {
  aura_none: 'none',
  aura_faint: 'faint',
  aura_glow: 'glow',
  aura_radiant: 'radiant',
};

/**
 * `pattern_solid` -> legacy `'solid'`; остальные четыре V2-only паттерна
 * (`pattern_duotone`/`pattern_spots`/`pattern_stripes`/`pattern_veins`) ->
 * legacy `'duotone'` — legacy знает только два значения, три geometric-
 * паттерна Gate 1 (spots/stripes/veins) не имеют legacy-эквивалента вовсе
 * (contract §4.8.6).
 */
function patternToLegacy(pattern: PatternAllele): Pattern {
  return pattern === 'pattern_solid' ? 'solid' : 'duotone';
}

/**
 * Обратные round-trip-таблицы выше экспортированы только для теста
 * (`legacyProjectionV2.test.ts` сверяет их с прямыми `*_HEX_TO_ID` из
 * `geneticsV2.ts`) — не предназначены для использования где-либо ещё.
 */
export const __TEST_ONLY__ = {
  PRIMARY_COLOR_TO_HEX,
  SECONDARY_COLOR_TO_HEX,
  LEAF_COLOR_TO_HEX,
};

/**
 * Legacy-совместимая проекция уже выраженного `GenomeV2` (contract §4.8.6).
 * Не мутирует и не читает ничего, кроме `genomeV2`, переданного по значению —
 * не оставляет ссылок на него внутри результата (результат — независимый
 * плоский объект нового типа `Genome`).
 */
export function projectGenomeV2ToLegacy(genomeV2: GenomeV2): Genome {
  const phenotype = resolvePhenotypeV2(genomeV2);
  const pattern = patternToLegacy(phenotype.pattern);
  const primary = PRIMARY_COLOR_TO_HEX[phenotype.primaryColor];
  // Legacy-инвариант (genetics.ts randomGenome()/breed(): `if (pattern ===
  // 'solid') secondary = primary;`) — перенесён 1:1, не изобретён заново.
  const secondary = pattern === 'solid' ? primary : SECONDARY_COLOR_TO_HEX[phenotype.secondaryColor];
  return {
    shape: phenotype.speciesId,
    primary,
    secondary,
    leaf: LEAF_COLOR_TO_HEX[phenotype.leafColor],
    pattern,
    size: SIZE_TO_LEGACY[phenotype.size],
    aura: AURA_TO_LEGACY[phenotype.aura],
    mutationId: phenotype.mutationId,
  };
}
