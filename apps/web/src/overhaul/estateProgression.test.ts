import { describe, expect, it } from 'vitest';
import { ESTATE_EXPANSION_STAGES, capacityAfterSectors } from './estateProgression';

describe('Crossroads estate progression contract', () => {
  it('starts with exactly six outdoor plots', () => {
    expect(capacityAfterSectors([])).toEqual({ outdoorPlots: 6, greenhouseSlots: 0, aquaticHabitats: 0 });
  });

  it('makes north the first expansion and reaches 12+4 growing places', () => {
    expect(ESTATE_EXPANSION_STAGES.find((stage) => stage.id === 'north')?.order).toBe(1);
    expect(capacityAfterSectors(['north'])).toEqual({ outdoorPlots: 12, greenhouseSlots: 4, aquaticHabitats: 0 });
  });

  it('adds three aquatic habitats in the east without inventing ordinary plots', () => {
    expect(capacityAfterSectors(['north', 'east'])).toEqual({
      outdoorPlots: 12,
      greenhouseSlots: 4,
      aquaticHabitats: 3,
    });
  });

  it('gives every planned sector one stable physical passage', () => {
    const transitions = ESTATE_EXPANSION_STAGES.filter((stage) => stage.id !== 'center').map(
      (stage) => stage.transitionId
    );
    expect(transitions).toEqual(['transition_north', 'transition_east', 'transition_west', 'transition_south']);
    expect(new Set(transitions).size).toBe(4);
  });
});
