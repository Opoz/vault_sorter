import type { Catalog } from './catalog'
import type { ColourRole, PartLine } from './parts'

/**
 * Estimated grams of filament, from each part's surface area and volume.
 *
 * A print is a shell of walls following the surface, with sparse infill inside. So:
 *   grams = density × (wall volume + infill share of what's left)
 * where wall volume ≈ surface area × SHELL_MM, capped at the part's own volume for thin parts.
 * SHELL_MM is close to Bambu Studio's default two 0.42 mm walls and was checked against parts the user
 * sliced (within ±10%). Excludes supports and purge; Bambu Studio's own slicing is the final number.
 */
export const PLA_DENSITY_G_PER_MM3 = 1.26 / 1000 // Bambu PLA Basic, 1.26 g/cm³
export const SHELL_MM = 0.8
export const INFILL = 0.15 // Bambu Studio default sparse infill

export type FilamentEstimate = Record<ColourRole | 'total', number>

export function gramsForPart(volume: number, area: number): number {
  const walls = Math.min(volume, area * SHELL_MM)
  return PLA_DENSITY_G_PER_MM3 * (walls + INFILL * (volume - walls))
}

export function filamentEstimate(lines: readonly PartLine[], catalog: Catalog): FilamentEstimate {
  const grams: FilamentEstimate = { body: 0, accent: 0, secondary: 0, total: 0 }
  for (const line of lines) {
    const part = catalog.get(line.path)
    const g = gramsForPart(part.volume, part.area) * line.qty
    grams[line.role] += g
    grams.total += g
  }
  return grams
}
