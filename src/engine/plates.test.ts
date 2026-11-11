import { describe, expect, it } from 'vitest'
import type { Point } from './catalog'
import type { Tower, Unit } from './model'
import { partsForTower } from './parts'
import { footprintOnPlate, packPlates, type PackedPlate } from './plates'
import { realCatalog } from './testing'

const H2S = { name: 'Bambu Lab H2S', bed: { width: 340, depth: 320 }, height: 340 }
const X1C = { name: 'Bambu Lab X1 Carbon', bed: { width: 256, depth: 256 }, height: 250 }
const SPACING = 5

const drawer = (width: Unit['width']): Unit => ({ kind: 'drawer', width, baseplate: 'plain', gearedRails: true, key: 'normal' })
const tower = (t: Partial<Tower>): Tower => ({ width: 'M', depth: 4, roof: 'grid', bottom: 'wheels', backbone: 'matching', rows: [], ...t })
const mTower = tower({
  rows: [
    { height: '2F', units: [drawer('M')] },
    { height: '1F', units: [drawer('M')] },
    { height: '1F', units: [{ kind: 'sustainer', width: 'M', moduleType: 'flat' }] },
  ],
})

const pack = (t: Tower, printer = H2S, allowColourMixing = false) => {
  const lines = partsForTower(t, { catalog: realCatalog, printer })
  return { lines, plates: packPlates(lines, { catalog: realCatalog, printer, allowColourMixing, spacingMm: SPACING }) }
}

const footprints = (plate: PackedPlate) => plate.items.map((item) => footprintOnPlate(item, realCatalog.get(item.path)))

describe('packPlates', () => {
  it('places every part exactly as many times as the parts list asks', () => {
    const { lines, plates } = pack(mTower)
    const placed = new Map<string, number>()
    for (const plate of plates) for (const item of plate.items) placed.set(item.path, (placed.get(item.path) ?? 0) + 1)

    for (const line of lines) expect(placed.get(line.path), line.path).toBe(line.qty)
  })

  it('keeps every part fully on the plate', () => {
    for (const plate of pack(mTower).plates) {
      for (const outline of footprints(plate)) {
        for (const [x, y] of outline) {
          expect(x).toBeGreaterThanOrEqual(-0.01)
          expect(y).toBeGreaterThanOrEqual(-0.01)
          expect(x).toBeLessThanOrEqual(H2S.bed.width + 0.01)
          expect(y).toBeLessThanOrEqual(H2S.bed.depth + 0.01)
        }
      }
    }
  })

  it('leaves at least the spacing between any two parts on a plate', () => {
    for (const plate of pack(mTower).plates) {
      const outlines = footprints(plate)
      for (let i = 0; i < outlines.length; i++) {
        for (let j = i + 1; j < outlines.length; j++) {
          expect(distance(outlines[i], outlines[j]), `${plate.items[i].path} vs ${plate.items[j].path}`).toBeGreaterThanOrEqual(SPACING - 0.01)
        }
      }
    }
  })

  it('keeps one colour per plate, and the TPU tyres on their own plates', () => {
    const { lines, plates } = pack(mTower)
    const roleOf = new Map(lines.map((l) => [l.path, l.role]))
    for (const plate of plates) {
      const kinds = new Set(plate.items.map((i) => (i.path.includes('(TPU)') ? 'tpu' : roleOf.get(i.path))))
      expect(kinds.size, `plate ${plate.index}`).toBe(1)
    }
    expect(plates.some((p) => p.material === 'TPU')).toBe(true)
  })

  it('needs no more plates when colours may mix', () => {
    expect(pack(mTower, H2S, true).plates.length).toBeLessThanOrEqual(pack(mTower, H2S, false).plates.length)
  })

  // XL modules fit the H2S only turned diagonally (docs/adr/0002), so each gets a plate to itself.
  it('gives a part that only fits diagonally a plate of its own, turned to fit', () => {
    const xl = tower({ width: 'XL', depth: 3, roof: 'none', bottom: 'none', backbone: 'none', rows: [{ height: '1F', units: [drawer('XL')] }] })
    const { plates } = pack(xl)
    const modulePlate = plates.find((p) => p.items.some((i) => i.path.endsWith('XL3 Module 1F.stl')))!

    expect(modulePlate.items).toHaveLength(1)
    expect(modulePlate.items[0].angleDeg % 90).not.toBeCloseTo(0, 0)
  })

  // Like Bambu Studio's own arrange: a plate's parts sit together in the middle, not in a corner.
  it('centres the parts on each plate', () => {
    for (const plate of pack(mTower).plates) {
      const pts = footprints(plate).flat()
      const cx = (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2
      const cy = (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2
      expect(cx, `plate ${plate.index}`).toBeCloseTo(H2S.bed.width / 2, 0)
      expect(cy, `plate ${plate.index}`).toBeCloseTo(H2S.bed.depth / 2, 0)
    }
  })

  // H2C: a reserved strip at the back (145–251 × 310–326 mm). It can stop parts moving all the way back, but they
  // should still get as close to the middle as it allows: centred left to right, and no further forward than needed.
  it('centres parts as far as a reserved area allows', () => {
    const strip: Point[] = [[145, 310], [251, 310], [251, 326], [145, 326]]
    const H2C = { name: 'Bambu Lab H2C', bed: { width: 325, depth: 320 }, height: 320, excluded: [strip] }
    for (const plate of pack(mTower, H2C).plates) {
      const pts = footprints(plate).flat()
      const cx = (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2
      expect(cx, `plate ${plate.index}`).toBeCloseTo(H2C.bed.width / 2, -1)
    }
  })

  // H2S profile: a strip at the back of the plate is reserved ("wrapping_exclude_area").
  it('keeps parts clear of areas the printer reserves on the plate', () => {
    const strip: Point[] = [[172.3, 302], [232.5, 302], [232.5, 322], [172.3, 322]]
    const printer = { ...H2S, excluded: [strip] }
    const lines = partsForTower(mTower, { catalog: realCatalog, printer })
    for (const plate of packPlates(lines, { catalog: realCatalog, printer, allowColourMixing: false, spacingMm: SPACING })) {
      for (const outline of footprints(plate)) expect(distance(outline, strip)).toBeGreaterThan(0)
    }
  })

  // H2C/H2D: a 325 × 320 mm single-nozzle bed. L parts (329.6 mm long) fit only diagonally, but the plate's
  // diagonal is 456 mm, so several thin L parts fit side by side at the same angle.
  it('lets parts that only fit diagonally share a plate when they fit side by side', () => {
    const H2C = { name: 'Bambu Lab H2C', bed: { width: 325, depth: 320 }, height: 320 }
    const l = tower({ width: 'L', depth: 3, roof: 'under table mount', bottom: 'none', backbone: 'none', rows: [{ height: '1F', units: [drawer('L')] }] })
    const { plates } = pack(l, H2C)
    // The three parts too long to lie straight: module (57 mm wide), facade (47) and roof (21). All three
    // side by side would be 135 mm thick, too much at any angle, but two of them fit together.
    const long = ['L3 Module 1F', 'L1F (Turn On Supports)', 'L3 Under Table Mount Roof']
    const platesWithLong = new Set(plates.filter((p) => p.items.some((i) => long.some((n) => i.path.includes(n)))))

    expect(platesWithLong.size).toBe(2)
    for (const plate of plates) {
      const outlines = footprints(plate)
      for (const outline of outlines) for (const [x, y] of outline) {
        expect(x).toBeGreaterThanOrEqual(-0.01); expect(x).toBeLessThanOrEqual(325.01)
        expect(y).toBeGreaterThanOrEqual(-0.01); expect(y).toBeLessThanOrEqual(320.01)
      }
      for (let i = 0; i < outlines.length; i++) for (let j = i + 1; j < outlines.length; j++) {
        expect(distance(outlines[i], outlines[j])).toBeGreaterThanOrEqual(SPACING - 0.01)
      }
    }
  })

  // Bambu Studio's strict upload check wants parts about 1 mm from the edge. On a 330 mm bed (A2L, H3C) a
  // 329.6 mm L part has only 0.4 mm to spare, so it goes diagonally instead, and the margin holds everywhere.
  it('keeps 1 mm from the plate edges, sending L parts diagonally on a 330 mm bed', () => {
    const A2L = { name: 'Bambu Lab A2L', bed: { width: 330, depth: 320 }, height: 325 }
    const l = tower({ width: 'L', depth: 3, roof: 'none', bottom: 'none', backbone: 'none', rows: [{ height: '1F', units: [drawer('L')] }] })
    for (const plate of pack(l, A2L).plates) {
      const pts = footprints(plate).flat()
      const edge = Math.min(...pts.map(([x, y]) => Math.min(x, y, A2L.bed.width - x, A2L.bed.depth - y)))
      expect(edge, `plate ${plate.index}`).toBeGreaterThanOrEqual(0.99)
      for (const item of plate.items) if (item.path.includes('L1F')) expect(item.angleDeg % 90).not.toBeCloseTo(0, 0)
    }
  })

  it('packs a smaller bed too, still keeping everything on it', () => {
    const small = tower({ width: 'S', depth: 3, rows: [{ height: '1F', units: [drawer('S')] }, { height: '2F', units: [drawer('S')] }] })
    for (const plate of pack(small, X1C).plates) {
      for (const outline of footprints(plate)) {
        for (const [x, y] of outline) {
          expect(x).toBeLessThanOrEqual(X1C.bed.width + 0.01)
          expect(y).toBeLessThanOrEqual(X1C.bed.depth + 0.01)
        }
      }
    }
  })
})

/** Smallest distance between two convex outlines (0 if they touch or overlap). */
function distance(a: readonly Point[], b: readonly Point[]): number {
  if (overlaps(a, b)) return 0
  let best = Infinity
  for (const [p, poly] of [[a, b], [b, a]] as const) {
    for (const pt of p) {
      for (let i = 0; i < poly.length; i++) best = Math.min(best, segmentDistance(pt, poly[i], poly[(i + 1) % poly.length]))
    }
  }
  return best
}
function overlaps(a: readonly Point[], b: readonly Point[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i]
      const [x2, y2] = poly[(i + 1) % poly.length]
      const nx = y2 - y1, ny = x1 - x2
      const proj = (p: readonly Point[]) => p.map(([x, y]) => x * nx + y * ny)
      const pa = proj(a), pb = proj(b)
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false
    }
  }
  return true
}
function segmentDistance([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
