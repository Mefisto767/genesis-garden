// ============================================================================
// Art Vertical Slice A — pure gating logic (see docs/ART_VERTICAL_SLICE_A.md).
// Extracted out of EstateScene.ts (Phaser-coupled) so the one non-trivial
// decision this integration makes — which mature specimens get the static
// Sunflower art instead of the procedural layered render — is unit-testable
// without a Phaser/canvas environment, the same pattern already used for
// movement.ts/lumiBehavior.ts/camera.ts (pure logic, Phaser-free).
// ============================================================================

import type { Genome } from './genetics';
import { PRIMARY_HEX_TO_ID } from './geneticsV2';

/**
 * True only for the exact phenotype the `plant_sunflower_mature` asset
 * depicts: speciesId 1 (Солнечник) with primary_coral (#FF8C77). Every other
 * species or primary color keeps the existing procedural layered render —
 * a single flat PNG cannot honestly stand in for the other 7 primary colors
 * of the same species (docs/ART_VERTICAL_SLICE_A.md).
 */
export function isCoralMatureSunflower(genome: Pick<Genome, 'shape' | 'primary'>): boolean {
  return genome.shape === 1 && PRIMARY_HEX_TO_ID[genome.primary] === 'primary_coral';
}
