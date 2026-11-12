/**
 * Real outside sizes, in mm, measured from the Vault STLs (scripts/measure). Used to draw Towers to scale.
 * Stacked height assumes modules overlap by their 9.01 mm lip: 48 mm per floor (inferred, see GLOSSARY Height).
 */
import type { Height, RoofType, Width } from '../engine/model'

export const WIDTH_MM: Record<Width, number> = { S: 164.8, M: 254.0, L: 329.6, XL: 418.8 }
export const FLOORS: Record<Height, number> = { '1F': 1, '2F': 2, '4F': 4 }
export const FLOOR_PITCH_MM = 48
export const LIP_MM = 9.01
export const depthMm = (depth: number) => 20.1 + 42 * depth

/** Roof thickness by type and base thickness, measured from the STLs. Wheels and feet are approximate. */
export const ROOF_MM: Record<RoofType, number> = {
  none: 0, grid: 14.8, table: 14.8, bowl: 21.8, 'under table mount': 21.3, heavyweight: 88.3,
}
export const BASE_MM = 52.2
export const WHEEL_MM = 160
/** Width of the TPU tyre, measured. */
export const TYRE_WIDTH_MM = 40.6
/** Each Feet bar is 60 mm narrower than its tower (S 104.8, M 194, L 269.6, XL 358.8; measured). */
export const FEET_INSET_MM = 60
/** Casters are bought, so sizes vary; drawn small and dark as in the Modifications manual (Casters Mode). */
export const CASTER = { height: 48, plate: 34, fork: 22, wheel: 36 }

/** How far below the base its feet, wheels or casters reach, so the tower can stand on the floor line. */
export const belowBaseMm = (bottom: 'none' | 'feet' | 'wheels' | 'casters') =>
  bottom === 'casters' ? CASTER.height : bottom === 'none' ? 0 : FOOT_MM
/**
 * Top Handle as seen from the front: measured 126 mm long and 51 mm tall. The loop's thickness and corner are
 * drawn from USSA's renders, not measured.
 */
/** Heavyweight Roof Handle, measured: a bar 156.5 mm long and 29.5 mm thick. */
export const HEAVYWEIGHT_HANDLE_MM = { length: 156.5, thickness: 29.5 }
export const HANDLE_MM = { length: 126, height: 51, top: 13, side: 22, bottom: 17, corner: 16 }
export const FOOT_MM = 60.5

export const rowHeightMm = (h: Height) => FLOORS[h] * FLOOR_PITCH_MM

export function towerHeightMm(rows: readonly { height: Height }[], roof: RoofType, hasBase: boolean): number {
  if (rows.length === 0) return 0
  const modules = rows.reduce((sum, r) => sum + rowHeightMm(r.height), 0) + LIP_MM
  return modules + ROOF_MM[roof] + (hasBase ? BASE_MM : 0)
}
