// ============================================================================
// Genetics V2 — Slice 10: минимальное отображение прямых родителей.
//
// Реализует ТОЛЬКО docs/GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md §4.13.2
// (delta doc §0.12 п.1-2) в объёме Slice 10 из delta doc §12: чистая typed
// view-model над уже существующим `Specimen.parentIds`/`HybridSeedV2.parentIds`
// (Slice 1/5, `store.ts` `breedNurseryV2`/`harvestHybridV2`) — только ОДНО
// поколение прямых родителей, БЕЗ отдельного экрана родословной/дерева/графа
// (сознательно вне рамок этого slice). НИКАКОГО изменения `parentIds`/store/
// save-схемы здесь нет — `SAVE_VERSION` остаётся 4.
//
// Тот же принцип, что уже применён в `hybridCardViewModel.ts` (Slice 5
// fix-pass): чистая функция, не React, не читает `GameState` целиком —
// только `parentIds` конкретного specimen и полный список `specimens` (для
// поиска родителей по id), оба по значению. Никакого RNG, ничего не пишет.
// ============================================================================

import type { Genome } from './genetics';
import type { Specimen } from './types';
import { speciesNameV2 } from './hybridCardViewModel';

/** Одна строка блока «Родители» — либо найденный родитель (русское имя вида
 * + legacy-геном для `SpecimenThumbnail`), либо `available: false` без
 * дальнейших полей (та же дисциплина типов, что `MicroscopeCardUnresearchedRow`,
 * hybridCardViewModel.ts — скрытые/недоступные данные не могут утечь через
 * поле, которого физически нет в объекте). Raw `parentId`/`specimen.id`
 * никогда не попадает в этот тип ни в каком виде. */
export interface ParentageRow {
  readonly roleLabel: 'Первый родитель' | 'Второй родитель';
  readonly available: boolean;
  /** Присутствует только когда `available === true`. */
  readonly speciesName?: string;
  /** Legacy `genome` найденного родителя — только для передачи в уже
   * существующий `SpecimenThumbnail`. Никогда не `genomeV2`/`AllelePair`/
   * скрытые аллели/`revealedLoci`/mutation history. */
  readonly genome?: Genome;
}

export interface ParentageViewModel {
  /** `false`, если у specimen нет `parentIds` (`undefined`/`null`) —
   * родительский блок в UI не рендерится вообще. */
  readonly visible: boolean;
  /** Ровно 2 строки, когда `visible === true`: [Первый родитель, Второй родитель]. */
  readonly rows: readonly ParentageRow[];
}

function buildParentageRow(
  roleLabel: ParentageRow['roleLabel'],
  parentId: string,
  allSpecimens: readonly Specimen[]
): ParentageRow {
  const parent = allSpecimens.find((s) => s.id === parentId);
  if (!parent || !parent.genomeV2) {
    // Родитель переработан/удалён (не найден), либо найден, но повреждён/
    // домиграционный (нет genomeV2, defensive — на практике оба текущих
    // родителя V2-скрещивания всегда имеют genomeV2 на момент breedNurseryV2,
    // но save мог быть отредактирован вручную/повреждён между сессиями).
    return { roleLabel, available: false };
  }
  return {
    roleLabel,
    available: true,
    speciesName: speciesNameV2(parent.genomeV2.speciesId),
    genome: parent.genome,
  };
}

/**
 * Строит блок «Родители» простой карточки (contract §4.13.2). `parentIds`
 * отсутствует (`undefined`/`null`, включая specimens, созданных до Slice 5,
 * у которых этого поля никогда не было) → `{ visible: false, rows: [] }` —
 * функция не реконструирует родословную задним числом. Порядок строк
 * фиксирован: первый элемент `parentIds` — «Первый родитель» (Seed Parent),
 * второй — «Второй родитель» (Pollen Parent) — не зависит от текущего
 * состояния/сортировки `allSpecimens`.
 */
export function buildParentageViewModel(
  parentIds: readonly [string, string] | null | undefined,
  allSpecimens: readonly Specimen[]
): ParentageViewModel {
  if (!parentIds) {
    return { visible: false, rows: [] };
  }
  const [seedParentId, pollenParentId] = parentIds;
  return {
    visible: true,
    rows: [
      buildParentageRow('Первый родитель', seedParentId, allSpecimens),
      buildParentageRow('Второй родитель', pollenParentId, allSpecimens),
    ],
  };
}
