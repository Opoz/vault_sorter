import { describe, expect, it } from 'vitest'
import type { Point } from './catalog'
import type { Tower, Unit } from './model'
import { partsForTower } from './parts'
import { footprintOnPlate, packPlates, SMALL_PART_EDGE_MM, SMALL_PART_MM, SUPPORT_SPREAD, type PackedPlate } from './plates'
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

/** Centre of the box around all of a plate's parts. */
function centreOf(plate: PackedPlate) {
  const pts = footprints(plate).flat()
  return {
    cx: (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2,
    cy: (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2,
  }
}

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

  // Like Bambu Studio's own arrange: a plate's parts sit together in the middle, not in a corner. On a full plate
  // the last few mm can be given up to keep small parts clear of the edges (issue #6).
  it('centres the parts on each plate', () => {
    for (const plate of pack(mTower).plates) {
      const { cx, cy } = centreOf(plate)
      expect(Math.abs(cx - H2S.bed.width / 2), `plate ${plate.index}`).toBeLessThan(5)
      expect(Math.abs(cy - H2S.bed.depth / 2), `plate ${plate.index}`).toBeLessThan(5)
    }
  })

  // H2C: a reserved strip at the back (145–251 × 310–326 mm). It can stop parts moving all the way back, but they
  // should still get as close to the middle as it allows: centred left to right.
  it('centres parts as far as a reserved area allows', () => {
    const strip: Point[] = [[145, 310], [251, 310], [251, 326], [145, 326]]
    const H2C = { name: 'Bambu Lab H2C', bed: { width: 325, depth: 320 }, height: 320, excluded: [strip] }
    for (const plate of pack(mTower, H2C).plates) {
      expect(Math.abs(centreOf(plate).cx - H2C.bed.width / 2), `plate ${plate.index}`).toBeLessThan(5)
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

  // Issue #5: the margin from the plate edge and the gap between parts are the user's choice.
  it('keeps the edge margin and the spacing it is given', () => {
    const lines = partsForTower(mTower, { catalog: realCatalog, printer: H2S })
    const plates = packPlates(lines, { catalog: realCatalog, printer: H2S, allowColourMixing: false, spacingMm: 12, edgeMarginMm: 8 })
    for (const plate of plates) {
      const outlines = footprints(plate)
      const edge = Math.min(...outlines.flat().map(([x, y]) => Math.min(x, y, H2S.bed.width - x, H2S.bed.depth - y)))
      expect(edge, `plate ${plate.index}`).toBeGreaterThanOrEqual(8 - 0.01)
      for (let i = 0; i < outlines.length; i++) for (let j = i + 1; j < outlines.length; j++) {
        expect(distance(outlines[i], outlines[j])).toBeGreaterThanOrEqual(12 - 0.01)
      }
    }
  })

  // The edge margin decides which parts may share a plate. A part that can't keep it even on a plate of its own
  // (L parts lying diagonally on a 325 mm bed, with 20 mm asked for) is still printed, alone, with as much margin
  // as it can get; the plate reports the margin it actually has, so the user can be told.
  it('shares plates only within the chosen edge margin, giving a part that cannot keep it a plate of its own', () => {
    const H2C = { name: 'Bambu Lab H2C', bed: { width: 325, depth: 320 }, height: 320 }
    const l = tower({ width: 'L', depth: 3, roof: 'under table mount', bottom: 'none', backbone: 'none', rows: [{ height: '1F', units: [drawer('L')] }] })
    const lines = partsForTower(l, { catalog: realCatalog, printer: H2C })
    const plates = packPlates(lines, { catalog: realCatalog, printer: H2C, allowColourMixing: false, edgeMarginMm: 20 })

    for (const plate of plates) {
      const pts = footprints(plate).flat()
      const edge = Math.min(...pts.map(([x, y]) => Math.min(x, y, H2C.bed.width - x, H2C.bed.depth - y)))
      expect(plate.edgeMm, `plate ${plate.index}`).toBeCloseTo(edge, 1)
      if (edge < 20 - 0.01) {
        expect(plate.items, `plate ${plate.index} has less than 20 mm, so nothing shares it`).toHaveLength(1)
        expect(edge, `plate ${plate.index}`).toBeGreaterThanOrEqual(0.99)
      }
    }
    expect(plates.some((p) => p.edgeMm < 20)).toBe(true)
  })

  // Issue #6: small parts (keys, caps, springs, stoppers) fail most behind other parts and near the edges, where
  // the first layer is hardest to watch and adhesion is weakest. They go in front of the other parts (not at the
  // front edge of the plate: the group is still centred), clear of the edges.
  // Tall parts with a small footprint (the 126 mm Top Handle) count as large: placed among small parts, it made
  // Bambu Studio's upload check report G-code conflicts.
  describe('small parts', () => {
    const isSmall = (plate: PackedPlate, i: number) => {
      const pts = footprints(plate)[i]
      const w = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]))
      const d = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]))
      return Math.max(w, d, realCatalog.get(plate.items[i].path).size[2]) <= SMALL_PART_MM
    }

    it('go in front of the larger parts on their plate', () => {
      let compared = 0
      for (const plate of pack(mTower).plates) {
        const small = plate.items.filter((_, i) => isSmall(plate, i)).map((it) => it.y)
        const large = plate.items.filter((_, i) => !isSmall(plate, i)).map((it) => it.y)
        if (!small.length || !large.length) continue
        compared++
        const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
        expect(mean(small), `plate ${plate.index}`).toBeLessThan(mean(large))
      }
      expect(compared).toBeGreaterThan(0)
    })

    it('keep clear of the plate edges', () => {
      for (const plate of pack(mTower).plates) {
        footprints(plate).forEach((outline, i) => {
          if (!isSmall(plate, i)) return
          const edge = Math.min(...outline.map(([x, y]) => Math.min(x, y, H2S.bed.width - x, H2S.bed.depth - y)))
          expect(edge, plate.items[i].path).toBeGreaterThanOrEqual(SMALL_PART_EDGE_MM - 0.01)
        })
      }
    })
  })

  // Tree supports spread out past a tall part. Bambu Studio's strict upload check found the Top Handle's (126 mm)
  // supports inside a key 15 mm away, but not 25 mm away; so supported parts keep a gap that grows with height.
  it('keeps other parts clear of the supports spreading out from a tall part', () => {
    for (const plate of pack(mTower).plates) {
      const outlines = footprints(plate)
      plate.items.forEach((item, i) => {
        if (!/turn on supports/i.test(item.path)) return
        const needed = SUPPORT_SPREAD * realCatalog.get(item.path).size[2]
        outlines.forEach((other, j) => {
          if (j !== i) expect(distance(outlines[i], other), `${item.path} vs ${plate.items[j].path}`).toBeGreaterThanOrEqual(Math.max(needed, SPACING) - 0.01)
        })
      })
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
