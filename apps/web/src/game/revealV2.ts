// ============================================================================
// Genetics V2 — Slice 12: Reveal view-model + естественное раскрытие.
//
// Реализует ТОЛЬКО docs/GENETICS_TARGET_DELTA.md §12 Slice 12 и
// docs/GENETICS_ONBOARDING_SPEC.md §3.3/§4.2/§11 в объёме этого slice —
// чистые типизированные функции над уже готовым результатом `breedV2`
// (Slice 3-4) и родительскими `GenomeV2` (Slice 1-2). Никакого RNG, никакого
// чтения/записи GameState здесь нет — та же дисциплина, что уже применена в
// hybridCardViewModel.ts/parentageV2.ts. Store (store.ts) вызывает
// `computeNaturalRevealsV2` и атомарно применяет результат к
// `Specimen.revealedLoci`; UI (`RevealPanelV2.tsx`) вызывает
// `buildRevealCardViewModel`/`buildRevealWhyViewModel` для рендера.
//
// Происхождение признака вычисляется СТРУКТУРНО из фактической пары
// `AllelePair` потомка (`a` — всегда от Seed Parent, `b` — всегда от Pollen
// Parent, inheritanceV2.ts) и выраженного значения — не угадывается по
// совпадению фенотипа "постфактум" (задание владельца, дословно).
// ============================================================================

import { GENOME_V2_LOCUS_KEYS, type GenomeV2, type GenomeV2LocusKey } from './geneticsV2';
import { resolvePhenotypeV2 } from './phenotypeV2';
import { notableTraitLociV2, type MutationTierV2 } from './rarityV2';
import { LOCUS_CATEGORY_LABEL_V2, alleleLabelV2, speciesNameV2 } from './hybridCardViewModel';

/** Происхождение выраженного значения одного локуса (delta doc §12 Slice 12,
 * onboarding spec §3.3/§11). `mutation` — только для локуса, реально
 * изменённого mutation event этого скрещивания (Gate 1 — всегда `aura`, если
 * вообще есть мутация, contract §4.7.2), не для любого совпадения значений. */
export type TraitOriginV2 = 'seed' | 'pollen' | 'both' | 'mutation';

export interface RevealTraitRow {
  readonly locus: GenomeV2LocusKey;
  readonly label: string;
  readonly valueLabel: string;
  readonly origin: TraitOriginV2;
}

/**
 * Origin строго по структуре child-пары (`a`=Seed, `b`=Pollen,
 * inheritanceV2.ts `inheritGenomeV2`) — НЕ по сравнению с родительскими
 * геномами (задание: "вычислять из реального результата breedV2 и
 * контрактного значения a/b, не угадывать по фенотипу постфактум"). Локус
 * `aura`, реально изменённый mutation event ЭТОГО скрещивания, всегда
 * `mutation` — приоритет выше обычного a/b-разбора (Gate 1: единственный
 * mutation-pool локус, contract §4.5.6).
 */
export function resolveTraitOriginV2(genomeV2: GenomeV2, mutated: boolean): RevealTraitRow[] {
  const phenotype = resolvePhenotypeV2(genomeV2);
  return GENOME_V2_LOCUS_KEYS.map((locus): RevealTraitRow => {
    const pair = genomeV2[locus] as { a: string; b: string };
    const expressed = phenotype[locus] as string;
    let origin: TraitOriginV2;
    if (mutated && locus === 'aura') {
      origin = 'mutation';
    } else if (pair.a === expressed && pair.b === expressed) {
      origin = 'both';
    } else if (pair.a === expressed) {
      origin = 'seed';
    } else {
      origin = 'pollen';
    }
    return {
      locus,
      label: LOCUS_CATEGORY_LABEL_V2[locus],
      valueLabel: alleleLabelV2(locus, expressed),
      origin,
    };
  });
}

/** Точный текст происхождения (onboarding spec §3.3/§13.1) — зависит от
 * того, одного ли вида родители. Для `origin==='both'` возвращает ОБА текста
 * (не выбирает случайный — задание, дословно). Для `mutation` — фиксированный
 * текст, без миниатюры/стрелки к конкретному родителю. */
export function traitOriginLabelsV2(
  origin: TraitOriginV2,
  seedSpeciesId: number,
  pollenSpeciesId: number
): string[] {
  if (origin === 'mutation') return ['✦ Новый признак'];
  const sameSpecies = seedSpeciesId === pollenSpeciesId;
  const seedLabel = sameSpecies ? 'От первого растения' : `← ${speciesNameV2(seedSpeciesId)}`;
  const pollenLabel = sameSpecies ? 'От второго растения' : `← ${speciesNameV2(pollenSpeciesId)}`;
  if (origin === 'seed') return [seedLabel];
  if (origin === 'pollen') return [pollenLabel];
  return [seedLabel, pollenLabel];
}

/** Один локус, наследуемый скрытым способом (естественное раскрытие) —
 * список пар {parent, locus} затрагиваемых родителей, contract-doc §12
 * Slice 12 "правило естественного раскрытия". */
export interface NaturalRevealResultV2 {
  readonly seedLoci: readonly GenomeV2LocusKey[];
  readonly pollenLoci: readonly GenomeV2LocusKey[];
}

/**
 * Для каждого локуса: если у родителя пара гетерозиготна (есть скрытое
 * состояние) и его СКРЫТЫЙ (не выраженный у него самого) аллель равен
 * фактически выраженному аллелю потомка — этот locus у ЭТОГО родителя
 * считается естественно раскрытым (onboarding spec §6.2/§4.2, delta doc §12
 * Slice 12 "правило естественного раскрытия"). Если оба родителя
 * гетерозиготны по этому локусу и оба несут тот же скрытый аллель — раскрыть
 * у ОБОИХ (contract §4.6.4 — именно так работает второе обучающее
 * скрещивание). Не читает/не пишет `revealedLoci` — идемпотентность и защита
 * от перезаписи microscope-источника реализованы в store.ts на месте
 * применения этого результата.
 */
export function computeNaturalRevealsV2(
  childGenomeV2: GenomeV2,
  seedGenomeV2: GenomeV2,
  pollenGenomeV2: GenomeV2
): NaturalRevealResultV2 {
  const childPhenotype = resolvePhenotypeV2(childGenomeV2);
  const seedPhenotype = resolvePhenotypeV2(seedGenomeV2);
  const pollenPhenotype = resolvePhenotypeV2(pollenGenomeV2);
  const seedLoci: GenomeV2LocusKey[] = [];
  const pollenLoci: GenomeV2LocusKey[] = [];

  for (const locus of GENOME_V2_LOCUS_KEYS) {
    const childValue = childPhenotype[locus] as string;

    const seedPair = seedGenomeV2[locus] as { a: string; b: string };
    if (seedPair.a !== seedPair.b) {
      const seedExpressed = seedPhenotype[locus] as string;
      const seedHidden = seedPair.a === seedExpressed ? seedPair.b : seedPair.a;
      if (seedHidden === childValue) seedLoci.push(locus);
    }

    const pollenPair = pollenGenomeV2[locus] as { a: string; b: string };
    if (pollenPair.a !== pollenPair.b) {
      const pollenExpressed = pollenPhenotype[locus] as string;
      const pollenHidden = pollenPair.a === pollenExpressed ? pollenPair.b : pollenPair.a;
      if (pollenHidden === childValue) pollenLoci.push(locus);
    }
  }

  return { seedLoci, pollenLoci };
}

// ----------------------------------------------------------------------------
// View-models — Reveal card (onboarding spec §3.3) и "Почему получилось так?"
// (§11).
// ----------------------------------------------------------------------------

export interface RevealTraitViewRow {
  readonly locus: GenomeV2LocusKey;
  readonly label: string;
  readonly valueLabel: string;
  readonly originLabels: readonly string[];
}

export interface RevealCardViewModel {
  readonly speciesName: string;
  readonly rarityLabel: string;
  readonly mutationLabel: string | null;
  readonly traits: readonly RevealTraitViewRow[];
}

const MUTATION_TIER_DESCRIPTION_V2: Record<MutationTierV2, string> = {
  Minor: 'небольшое изменение',
  Major: 'заметное изменение',
  Signature: 'редкая именная мутация',
};

export interface RevealWhyViewModel {
  /** Только признаки, ФАКТИЧЕСКИ проявившиеся у потомка (onboarding spec §11
   * — родительские нераскрытые признаки, не проявившиеся у ребёнка, здесь не
   * упоминаются вообще). */
  readonly traits: readonly RevealTraitViewRow[];
  readonly mutated: boolean;
  /** null, если мутации не было — компонент не рендерит строку тира. */
  readonly mutationTierDescription: string | null;
  /** Человеческие названия признаков, повысивших редкость (без чисел). */
  readonly rarityFactors: readonly string[];
  /** Гарантированный текст естественного раскрытия (onboarding spec §4.2) —
   * true, если хотя бы один локус раскрылся естественно у любого родителя
   * этим скрещиванием. */
  readonly hasNaturalReveal: boolean;
}

function buildTraitViewRows(
  genomeV2: GenomeV2,
  mutated: boolean,
  seedSpeciesId: number,
  pollenSpeciesId: number
): RevealTraitViewRow[] {
  return resolveTraitOriginV2(genomeV2, mutated).map((row) => ({
    locus: row.locus,
    label: row.label,
    valueLabel: row.valueLabel,
    originLabels: traitOriginLabelsV2(row.origin, seedSpeciesId, pollenSpeciesId),
  }));
}

export function buildRevealCardViewModel(
  genomeV2: GenomeV2,
  seedSpeciesId: number,
  pollenSpeciesId: number,
  mutated: boolean,
  rarityLabel: string,
  mutationLabel: string | null
): RevealCardViewModel {
  return {
    speciesName: speciesNameV2(genomeV2.speciesId),
    rarityLabel,
    mutationLabel,
    traits: buildTraitViewRows(genomeV2, mutated, seedSpeciesId, pollenSpeciesId),
  };
}

export function buildRevealWhyViewModel(
  genomeV2: GenomeV2,
  seedSpeciesId: number,
  pollenSpeciesId: number,
  mutated: boolean,
  mutationTier: MutationTierV2 | null,
  naturalReveal: NaturalRevealResultV2
): RevealWhyViewModel {
  const notable = notableTraitLociV2(genomeV2);
  const traits = buildTraitViewRows(genomeV2, mutated, seedSpeciesId, pollenSpeciesId);
  return {
    traits,
    mutated,
    mutationTierDescription: mutationTier ? MUTATION_TIER_DESCRIPTION_V2[mutationTier] : null,
    rarityFactors: notable.map((locus) => `${LOCUS_CATEGORY_LABEL_V2[locus]}: ${alleleLabelV2(locus, resolvePhenotypeV2(genomeV2)[locus] as string)}`),
    hasNaturalReveal: naturalReveal.seedLoci.length > 0 || naturalReveal.pollenLoci.length > 0,
  };
}
