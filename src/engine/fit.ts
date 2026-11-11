import type { PartMeasure, Point } from './catalog'

export interface PrinterBed {
  readonly name: string
  /** Printable area of the plate in mm. */
  readonly bed: { readonly width: number; readonly depth: number }
  /** Printable height in mm. */
  readonly height: number
  /** Areas of the plate the printer reserves (e.g. a corner or a strip at the back), as outlines in mm. */
  readonly excluded?: readonly (readonly Point[])[]
}

export interface Fit {
  readonly fits: boolean
  /** Less than TIGHT_FIT_MM to spare. */
  readonly tight: boolean
  /** Smallest gap to the edge of the printable volume at the best rotation; negative = overhang. */
  readonly spareMm: number
  /** Rotation on the plate, in degrees, that gives the most room. */
  readonly angleDeg: number
  /** What stops it fitting, or what is tightest when it does. */
  readonly limitedBy: 'footprint' | 'height'
}

export const TIGHT_FIT_MM = 2

/**
 * Whether a part fits a printer, in the orientation its file is stored in, turned to any angle on the
 * plate. Never tips the part onto another side, and applies no hidden margin (see docs/adr/0002).
 */
export function checkFit(part: PartMeasure, printer: PrinterBed): Fit {
  const { width, depth } = printer.bed
  const roomAt = (deg: number) => {
    const [w, d] = rotatedSize(part.outline, deg)
    return Math.min(width - w, depth - d)
  }

  // Coarse sweep over half a turn (a rectangle bed repeats after 180°), then refine around the best.
  let bestDeg = 0
  let best = -Infinity
  for (let deg = 0; deg < 180; deg += 0.5) {
    const room = roomAt(deg)
    if (room > best) [best, bestDeg] = [room, deg]
  }
  for (let step = 0.25; step > 1e-4; step /= 2) {
    for (const deg of [bestDeg - step, bestDeg + step]) {
      const room = roomAt(deg)
      if (room > best) [best, bestDeg] = [room, deg]
    }
  }

  const heightRoom = printer.height - part.size[2]
  const limitedBy = heightRoom < best ? 'height' : 'footprint'
  const spareMm = Math.min(best, heightRoom)
  return {
    fits: spareMm >= 0,
    tight: spareMm >= 0 && spareMm < TIGHT_FIT_MM,
    spareMm,
    angleDeg: ((bestDeg % 180) + 180) % 180,
    limitedBy,
  }
}

function rotatedSize(outline: readonly Point[], deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of outline) {
    const rx = x * c - y * s
    const ry = x * s + y * c
    if (rx < minX) minX = rx
    if (rx > maxX) maxX = rx
    if (ry < minY) minY = ry
    if (ry > maxY) maxY = ry
  }
  return [maxX - minX, maxY - minY]
}
