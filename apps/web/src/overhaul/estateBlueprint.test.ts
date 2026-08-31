import { describe, expect, it } from 'vitest';
import {
  BUILDING_SLOTS,
  ESTATE_ZONES,
  FULL_WORLD_COLS,
  FULL_WORLD_ROWS,
  LANDMARK_SLOTS,
  REQUIRED_BUILDING_IDS,
  REQUIRED_LANDMARK_IDS,
  ZONE_STARTING_GARDEN,
  buildingSlotById,
  buildingSlotsForZone,
  zoneById,
  type TileRect,
} from './estateBlueprint';

function tileRectsOverlap(a: TileRect, b: TileRect): boolean {
  return (
    a.col < b.col + b.cols && a.col + a.cols > b.col && a.row < b.row + b.rows && a.row + a.rows > b.row
  );
}

describe('estate blueprint — full-world zones', () => {
  it('logically spans approximately 48x48 tiles', () => {
    expect(FULL_WORLD_COLS).toBe(48);
    expect(FULL_WORLD_ROWS).toBe(48);
  });

  it('defines exactly one open zone — the starting garden', () => {
    const open = ESTATE_ZONES.filter((z) => z.status === 'open');
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe('zone_starting_garden');
  });

  it('locks the five-zone Crossroads topology around the starting garden', () => {
    expect(ESTATE_ZONES).toHaveLength(5);
    expect(zoneById('zone_working_farm')?.tileRect).toEqual({ col: 15, row: 0, cols: 18, rows: 16 });
    expect(zoneById('zone_botanical_estate')?.tileRect).toEqual({ col: 33, row: 16, cols: 15, rows: 16 });
    expect(zoneById('zone_exhibition_courtyard')?.tileRect).toEqual({ col: 0, row: 16, cols: 15, rows: 16 });
    expect(zoneById('zone_late_territory')?.tileRect).toEqual({ col: 15, row: 32, cols: 18, rows: 16 });
  });

  it('keeps the starting garden at roughly 16x16 tiles', () => {
    expect(ZONE_STARTING_GARDEN.tileRect.cols).toBeGreaterThanOrEqual(14);
    expect(ZONE_STARTING_GARDEN.tileRect.cols).toBeLessThanOrEqual(20);
    expect(ZONE_STARTING_GARDEN.tileRect.rows).toBeGreaterThanOrEqual(14);
    expect(ZONE_STARTING_GARDEN.tileRect.rows).toBeLessThanOrEqual(20);
  });

  it('keeps every zone rect inside the full 48x48 world', () => {
    for (const z of ESTATE_ZONES) {
      expect(z.tileRect.col).toBeGreaterThanOrEqual(0);
      expect(z.tileRect.row).toBeGreaterThanOrEqual(0);
      expect(z.tileRect.col + z.tileRect.cols).toBeLessThanOrEqual(FULL_WORLD_COLS);
      expect(z.tileRect.row + z.tileRect.rows).toBeLessThanOrEqual(FULL_WORLD_ROWS);
    }
  });

  it('does not let any two zones overlap', () => {
    for (let i = 0; i < ESTATE_ZONES.length; i++) {
      for (let j = i + 1; j < ESTATE_ZONES.length; j++) {
        expect(tileRectsOverlap(ESTATE_ZONES[i].tileRect, ESTATE_ZONES[j].tileRect)).toBe(false);
      }
    }
  });

  it('looks zones up by id', () => {
    expect(zoneById('zone_starting_garden')).toBe(ZONE_STARTING_GARDEN);
    expect(zoneById('nope')).toBeUndefined();
  });
});

describe('estate blueprint — building & landmark slots', () => {
  it('includes every required stable building ID', () => {
    for (const id of REQUIRED_BUILDING_IDS) {
      expect(buildingSlotById(id), `missing building slot ${id}`).toBeDefined();
    }
  });

  it('includes every required stable landmark ID', () => {
    const ids = LANDMARK_SLOTS.map((l) => l.id);
    for (const id of REQUIRED_LANDMARK_IDS) {
      expect(ids, `missing landmark slot ${id}`).toContain(id);
    }
  });

  it('has at least 3 landmark slots reserved for future monuments', () => {
    expect(LANDMARK_SLOTS.length).toBeGreaterThanOrEqual(3);
    expect(LANDMARK_SLOTS.every((l) => l.status === 'reserved')).toBe(true);
  });

  it('marks every slot outside the starting garden as reserved, never active', () => {
    for (const b of BUILDING_SLOTS) {
      if (b.zoneId !== 'zone_starting_garden') {
        expect(b.status, `${b.id} is outside the open zone but not reserved`).toBe('reserved');
      }
    }
  });

  it('only activates the starting-garden buildings the Stage-1 slice actually needs', () => {
    const active = BUILDING_SLOTS.filter((b) => b.status === 'active').map((b) => b.id).sort();
    expect(active).toEqual(
      ['building_house', 'building_laboratory', 'building_lumi_station', 'building_storage'].sort()
    );
  });

  it('places every building slot inside its own zone rect', () => {
    for (const b of BUILDING_SLOTS) {
      const zone = zoneById(b.zoneId);
      expect(zone, `${b.id} references unknown zone ${b.zoneId}`).toBeDefined();
      if (!zone) continue;
      const { col, row, cols, rows } = zone.tileRect;
      expect(b.tile.col).toBeGreaterThanOrEqual(col);
      expect(b.tile.col).toBeLessThanOrEqual(col + cols);
      expect(b.tile.row).toBeGreaterThanOrEqual(row);
      expect(b.tile.row).toBeLessThanOrEqual(row + rows);
    }
  });

  it('places every landmark slot inside its own zone rect', () => {
    for (const l of LANDMARK_SLOTS) {
      const zone = zoneById(l.zoneId);
      expect(zone).toBeDefined();
      if (!zone) continue;
      const { col, row, cols, rows } = zone.tileRect;
      expect(l.tile.col).toBeGreaterThanOrEqual(col);
      expect(l.tile.col).toBeLessThanOrEqual(col + cols);
      expect(l.tile.row).toBeGreaterThanOrEqual(row);
      expect(l.tile.row).toBeLessThanOrEqual(row + rows);
    }
  });

  it('returns all building slots for a given zone', () => {
    const starting = buildingSlotsForZone('zone_starting_garden');
    expect(starting.length).toBeGreaterThanOrEqual(4);
    expect(starting.every((b) => b.zoneId === 'zone_starting_garden')).toBe(true);
  });

  it('has no duplicate building or landmark IDs', () => {
    const buildingIds = BUILDING_SLOTS.map((b) => b.id);
    expect(new Set(buildingIds).size).toBe(buildingIds.length);
    const landmarkIds = LANDMARK_SLOTS.map((l) => l.id);
    expect(new Set(landmarkIds).size).toBe(landmarkIds.length);
  });
});
