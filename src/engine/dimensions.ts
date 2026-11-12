/**
 * Outside size of a built Tower, from the measured parts. Modules are measured exactly; how stacked parts
 * overlap is not visible in the files, so anything that depends on it is flagged as inferred.
 */
import type { PartMeasure, Point } from './catalog'
import { rowFloors, unitsOf, type Tower, type Width } from './model'
import { partsForTower, type Flag, type PartsOptions } from './parts'

// Measured from the Module files (scripts/measure): every module of a width is the same width, every module
// of a depth the same depth, and module height is 48 mm per floor plus a 9.01 mm lip at every width and depth.
export const MODULE_WIDTH_MM: Record<Width, number> = { S: 164.8, M: 254.0, L: 329.6, XL: 418.8 }
export const moduleDepthMm = (depth: number) => 20.1 + 42 * depth
export const FLOOR_PITCH_MM = 48
export const LIP_MM = 9.01

export interface TowerDimensions {
  readonly widthMm: number
  readonly depthMm: number
  readonly heightMm: number
  /** Where the height comes from, bottom up. */
  readonly breakdown: readonly { label: string; mm: number }[]
  readonly flags: readonly Flag[]
}

export function towerDimensions(tower: Tower, options: PartsOptions): TowerDimensions {
  const flags: Flag[] = []
  const breakdown: { label: string; mm: number }[] = []
  const lines = partsForTower(tower, options)

  const base = lines.find((l) => /\/Base\/[^/]+\/[^/]*Base( Whole| Part 1)?\.stl$/i.test(l.path))
  if (base) breakdown.push({ label: 'Base', mm: thickness(options.catalog.get(base.path)) })

  const floors = tower.rows.reduce((n, r) => n + rowFloors(r), 0)
  if (floors > 0) breakdown.push({ label: 'Modules', mm: floors * FLOOR_PITCH_MM + LIP_MM })
  if (tower.rows.length > 1 || tower.rows.some((r) => unitsOf(r).length > 2)) {
    flags.push({
      kind: 'inferred',
      note: 'Stacked modules are assumed to overlap by their 9.01 mm lip (48 mm per floor); not yet checked on a real stack.',
      source: 'Module measurements',
    })
  }
  if (tower.rows.some((r) => unitsOf(r).some((u) => u.kind === 'sustainer'))) {
    flags.push({
      kind: 'inferred',
      note: "Sustainers are assumed to stack to the same height per floor as drawers; their module and lid don't add up to it directly.",
      source: 'Module and lid measurements; Instructions Manual p8 (sustainers and drawers stack)',
    })
  }

  const roof = lines.find((l) => /^01\. DRAWERS\/.*\/Roofs?\/[^/]+$/i.test(l.path))
  if (roof) {
    breakdown.push({ label: 'Roof', mm: thickness(options.catalog.get(roof.path)) })
    if (floors > 0) {
      flags.push({ kind: 'inferred', note: 'The roof is assumed to sit on top of the last lip, adding its full thickness.', source: 'Roof measurements' })
    }
  }

  return {
    widthMm: MODULE_WIDTH_MM[tower.width],
    depthMm: moduleDepthMm(tower.depth),
    heightMm: breakdown.reduce((sum, b) => sum + b.mm, 0),
    breakdown,
    flags,
  }
}

/**
 * Roofs and bases are stored standing on an edge, often turned on the plate, so their thickness is the short
 * side of the smallest rectangle around their top-down outline.
 */
function thickness(part: PartMeasure): number {
  return minAreaRect(part.outline)[1]
}

function minAreaRect(outline: readonly Point[]): [long: number, short: number] {
  let best: [number, number] = [Infinity, Infinity]
  for (let i = 0; i < outline.length; i++) {
    // The smallest rectangle around a convex outline has a side along one of its edges.
    const [ax, ay] = outline[i]
    const [bx, by] = outline[(i + 1) % outline.length]
    const angle = Math.atan2(by - ay, bx - ax)
    const c = Math.cos(-angle)
    const s = Math.sin(-angle)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const [x, y] of outline) {
      const rx = x * c - y * s
      const ry = x * s + y * c
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx); minY = Math.min(minY, ry); maxY = Math.max(maxY, ry)
    }
    const w = maxX - minX
    const h = maxY - minY
    if (w * h < best[0] * best[1]) best = [Math.max(w, h), Math.min(w, h)]
  }
  return best
}
