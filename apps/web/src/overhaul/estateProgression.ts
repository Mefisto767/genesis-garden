export type EstateSectorId = 'center' | 'north' | 'east' | 'west' | 'south';

export interface GrowingCapacity {
  outdoorPlots: number;
  greenhouseSlots: number;
  aquaticHabitats: number;
}

export interface EstateExpansionStage {
  id: EstateSectorId;
  order: number;
  zoneId: string;
  transitionId: string | null;
  nameRu: string;
  unlockState: 'open' | 'planned';
  capacityDelta: GrowingCapacity;
}

export const ESTATE_EXPANSION_STAGES: readonly EstateExpansionStage[] = [
  {
    id: 'center',
    order: 0,
    zoneId: 'zone_starting_garden',
    transitionId: null,
    nameRu: 'Центральный сад',
    unlockState: 'open',
    capacityDelta: { outdoorPlots: 6, greenhouseSlots: 0, aquaticHabitats: 0 },
  },
  {
    id: 'north',
    order: 1,
    zoneId: 'zone_working_farm',
    transitionId: 'transition_north',
    nameRu: 'Рабочая ферма',
    unlockState: 'planned',
    capacityDelta: { outdoorPlots: 6, greenhouseSlots: 4, aquaticHabitats: 0 },
  },
  {
    id: 'east',
    order: 2,
    zoneId: 'zone_botanical_estate',
    transitionId: 'transition_east',
    nameRu: 'Пруд и сад опылителей',
    unlockState: 'planned',
    capacityDelta: { outdoorPlots: 0, greenhouseSlots: 0, aquaticHabitats: 3 },
  },
  {
    id: 'west',
    order: 3,
    zoneId: 'zone_exhibition_courtyard',
    transitionId: 'transition_west',
    nameRu: 'Выставочный и социальный двор',
    unlockState: 'planned',
    capacityDelta: { outdoorPlots: 0, greenhouseSlots: 0, aquaticHabitats: 0 },
  },
  {
    id: 'south',
    order: 4,
    zoneId: 'zone_late_territory',
    transitionId: 'transition_south',
    nameRu: 'Поздняя ботаническая территория',
    unlockState: 'planned',
    capacityDelta: { outdoorPlots: 0, greenhouseSlots: 0, aquaticHabitats: 0 },
  },
] as const;

export function capacityAfterSectors(unlocked: readonly EstateSectorId[]): GrowingCapacity {
  const allowed = new Set(unlocked);
  allowed.add('center');
  return ESTATE_EXPANSION_STAGES.filter((stage) => allowed.has(stage.id)).reduce<GrowingCapacity>(
    (total, stage) => ({
      outdoorPlots: total.outdoorPlots + stage.capacityDelta.outdoorPlots,
      greenhouseSlots: total.greenhouseSlots + stage.capacityDelta.greenhouseSlots,
      aquaticHabitats: total.aquaticHabitats + stage.capacityDelta.aquaticHabitats,
    }),
    { outdoorPlots: 0, greenhouseSlots: 0, aquaticHabitats: 0 }
  );
}
