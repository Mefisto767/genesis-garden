import { describe, expect, it } from 'vitest';
import { GameStore } from './store';
import type { GameState, Plot, Specimen } from './types';
import { MAX_PLOTS, START_UNLOCKED_PLOTS } from './types';
import type { AllelePair, GenomeV2 } from './geneticsV2';
import { projectGenomeV2ToLegacy } from './legacyProjectionV2';
import { isSupportedParentSpeciesV2 } from './inheritanceV2';
import { mulberry32 } from './rng';
import type { RngFn } from './rng';

// ============================================================================
// Genetics V2 — Slice 11 (contract §4.13.1/§4.13.3, delta doc §0.12 п.3):
// store/UI-level regression — политика доступа legacy species 3-8 не
// изменилась (не удаляются, продолжают отображаться/favorite/переработку),
// только исключаются из списка допустимых родителей V2. Список кандидатов
// лаборатории проверяется через сам predicate (`isSupportedParentSpeciesV2`)
// применённый к массиву specimens, не через рендер `LabPanelV2` — репозиторий
// не имеет React Testing Library (см. hybridCardViewModel.ts/parentageV2.ts).
// ============================================================================

function homo<T extends string>(value: T): AllelePair<T> {
  return { a: value, b: value };
}

function fixtureGenomeV2(speciesId: number, overrides: Partial<GenomeV2> = {}): GenomeV2 {
  return {
    stemForm: homo('stem_standard'),
    leafForm: homo('leaf_standard'),
    flowerForm: homo('flower_standard'),
    primaryColor: homo('primary_honey'),
    secondaryColor: homo('secondary_forest'),
    leafColor: homo('leaf_color_meadow'),
    pattern: homo('pattern_solid'),
    size: homo('size_normal'),
    aura: homo('aura_none'),
    speciesId,
    mutationId: null,
    ...overrides,
  } as GenomeV2;
}

function fixtureSpecimen(id: string, genomeV2: GenomeV2, overrides: Partial<Specimen> = {}): Specimen {
  return {
    id,
    genome: projectGenomeV2ToLegacy(genomeV2),
    genomeV2,
    createdAt: 0,
    ...overrides,
  };
}

function fixturePlots(): Plot[] {
  const plots: Plot[] = [];
  for (let i = 0; i < MAX_PLOTS; i++) {
    plots.push({ id: i, unlocked: i < START_UNLOCKED_PLOTS, seedId: null, plantedAt: null });
  }
  return plots;
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    coins: 100,
    plots: fixturePlots(),
    inventory: {},
    specimens: [],
    geneticDust: 0,
    pityCounter: 0,
    questProgress: {},
    questsClaimed: [],
    entitlements: [],
    pollen: 100,
    labLevel: 3, // Lab L2 уже открыт — изолирует эти тесты от species_locked (Slice 8).
    nurseryTray: [],
    firstBreedFreeClaimed: true,
    firstHybridRewardClaimed: false,
    firstRecycleTopUpClaimed: false,
    ...overrides,
  };
}

function countingRng(value: number): { rng: RngFn; count: () => number } {
  let calls = 0;
  return {
    rng: () => {
      calls += 1;
      return value;
    },
    count: () => calls,
  };
}

function storeWith(state: GameState, rng: RngFn = mulberry32(1)): GameStore {
  return new GameStore({ rng, disablePersistence: true, initialState: state });
}

describe('breedNurseryV2 с species 3-8 — Slice 11 не меняет store-level поведение (regression)', () => {
  for (const legacySpecies of [3, 4, 5, 6, 7, 8]) {
    it(`species1 × species${legacySpecies} — по-прежнему unsupported_species, 0 RNG, полный no-op`, () => {
      const seed = fixtureSpecimen('seed-1', fixtureGenomeV2(1));
      const legacy = fixtureSpecimen('legacy-1', fixtureGenomeV2(legacySpecies));
      const state = baseState({ specimens: [seed, legacy] });
      const { rng, count } = countingRng(0.1);
      const store = storeWith(state, rng);

      const result = store.breedNurseryV2('seed-1', 'legacy-1');

      expect(result).toEqual({ ok: false, reason: 'unsupported_species' });
      expect(count()).toBe(0);
      expect(store.getState()).toEqual(state);
    });
  }
});

describe('список кандидатов лаборатории V2 — Slice 11 (contract §4.13.3): только species 1/2', () => {
  it('смешанный массив specimens (1, 2, 3, 5, 7) — после фильтра остаются только species 1 и 2', () => {
    const specimens = [
      fixtureSpecimen('s1', fixtureGenomeV2(1)),
      fixtureSpecimen('s2', fixtureGenomeV2(2)),
      fixtureSpecimen('s3', fixtureGenomeV2(3)),
      fixtureSpecimen('s5', fixtureGenomeV2(5)),
      fixtureSpecimen('s7', fixtureGenomeV2(7)),
    ];
    // Тот же фильтр, что и LabPanelV2.tsx: !!s.genomeV2 && isSupportedParentSpeciesV2(...).
    const candidates = specimens.filter((s) => !!s.genomeV2 && isSupportedParentSpeciesV2(s.genomeV2.speciesId));
    expect(candidates.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('species 2 остаётся кандидатом даже при labLevel < 2 — Lab-гейт (Slice 8) отдельная проверка, не эта', () => {
    const specimens = [fixtureSpecimen('s1', fixtureGenomeV2(1)), fixtureSpecimen('s2', fixtureGenomeV2(2))];
    const candidates = specimens.filter((s) => !!s.genomeV2 && isSupportedParentSpeciesV2(s.genomeV2.speciesId));
    // Оба остаются кандидатами независимо от labLevel — isSupportedParentSpeciesV2
    // не читает labLevel вообще, блокировка species 2 до L2 — отдельный слой
    // (isSpeciesUnlockedV2/isCandidateLocked в самом LabPanelV2, не тестируется здесь).
    expect(candidates).toHaveLength(2);
  });

  it('species 3-8 отсутствуют среди кандидатов при любом labLevel', () => {
    const specimens = [3, 4, 5, 6, 7, 8].map((id) => fixtureSpecimen(`legacy-${id}`, fixtureGenomeV2(id)));
    const candidates = specimens.filter((s) => !!s.genomeV2 && isSupportedParentSpeciesV2(s.genomeV2.speciesId));
    expect(candidates).toEqual([]);
  });
});

describe('species 3-8 в коллекции — Slice 11 не трогает favorite/переработку (regression)', () => {
  it('toggleFavorite продолжает работать для species 5', () => {
    const legacy = fixtureSpecimen('legacy-5', fixtureGenomeV2(5));
    const store = storeWith(baseState({ specimens: [legacy] }));

    const ok = store.toggleFavorite('legacy-5');

    expect(ok).toBe(true);
    expect(store.getState().specimens[0].favorite).toBe(true);
  });

  it('recycleSpecimenV2 продолжает работать для species 7 (не favorite)', () => {
    const legacy = fixtureSpecimen('legacy-7', fixtureGenomeV2(7));
    const store = storeWith(baseState({ specimens: [legacy], geneticDust: 0 }));

    const result = store.recycleSpecimenV2('legacy-7');

    expect(result.ok).toBe(true);
    expect(store.getState().specimens).toEqual([]);
  });

  it('recycleSpecimenV2 для species 3, отмеченного избранным, по-прежнему отклоняется reason=favorite (regression)', () => {
    const legacy = fixtureSpecimen('legacy-3', fixtureGenomeV2(3), { favorite: true });
    const store = storeWith(baseState({ specimens: [legacy] }));

    const result = store.recycleSpecimenV2('legacy-3');

    expect(result).toEqual({ ok: false, reason: 'favorite' });
    expect(store.getState().specimens).toHaveLength(1);
  });

  it('species 3-8 остаются в state.specimens (не удаляются политикой доступа Slice 11 сами по себе)', () => {
    const specimens = [3, 4, 5, 6, 7, 8].map((id) => fixtureSpecimen(`legacy-${id}`, fixtureGenomeV2(id)));
    const store = storeWith(baseState({ specimens }));
    expect(store.getState().specimens).toHaveLength(6);
  });
});
