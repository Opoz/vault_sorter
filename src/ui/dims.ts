/**
 * Real outside sizes, in mm, measured from the Vault STLs (scripts/measure). Used to draw Towers to scale.
 * Stacked height assumes modules overlap by their 9.01 mm lip: 48 mm per floor (inferred, see GLOSSARY Height).
 */
import type { Height, Width } from '../engine/model'

export const WIDTH_MM: Record<Width, number> = { S: 164.8, M: 254.0, L: 329.6, XL: 418.8 }
export const FLOORS: Record<Height, number> = { '1F': 1, '2F': 2, '4F': 4 }
export const FLOOR_PITCH_MM = 48
export const LIP_MM = 9.01
export const depthMm = (depth: number) => 20.1 + 42 * depth

/** Approximate heights of the parts drawn above and below the modules. */
export const ROOF_MM = 14
export const BASE_MM = 52.2
export const WHEEL_MM = 160
export const FOOT_MM = 60.5

export const rowHeightMm = (h: Height) => FLOORS[h] * FLOOR_PITCH_MM

export function towerHeightMm(rows: readonly { height: Height }[], hasRoof: boolean, hasBase: boolean): number {
  if (rows.length === 0) return 0
  const modules = rows.reduce((sum, r) => sum + rowHeightMm(r.height), 0) + LIP_MM
  return modules + (hasRoof ? ROOF_MM : 0) + (hasBase ? BASE_MM : 0)
}
