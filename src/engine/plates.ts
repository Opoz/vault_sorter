/**
 * Arranging Parts onto Plates. Each part is laid as the smallest rectangle around its top-down outline,
 * turned 0° or 90° from that rectangle's own axis, with a gap between parts; rectangles are packed with
 * MaxRects. A part that only fits the bed turned diagonally (XL modules on the H2S) gets a plate to itself.
 * Plates hold one Colour role unless colours may mix; TPU parts always get their own plates.
 *
 * Large parts are packed from the back; small ones go just in front of them, clear of the plate edges, and the
 * whole group is then centred. Small parts fail most behind other parts and near the edges, where the first
 * layer is hardest to watch (issue #6).
 */
import type { Catalog, PartMeasure, Point } from './catalog'
import { checkFit, type PrinterBed } from './fit'
import type { ColourRole, PartLine } from './parts'

export type Material = 'PLA' | 'TPU'

export interface PlacedItem {
  readonly path: string
  readonly role: ColourRole
  readonly material: Material
  /** Turn about the vertical axis, applied to the part as stored. */
  readonly angleDeg: number
  /** The point of the part, in its outline's coordinates, that is placed at (x, y). */
  readonly pivot: Point
  /** Where the pivot lands on the plate, in mm from the plate's corner. */
  readonly x: number
  readonly y: number
}

export interface PackedPlate {
  /** 1-based, in printing order. */
  readonly index: number
  readonly role: ColourRole | 'mixed'
  readonly material: Material
  readonly items: readonly PlacedItem[]
  /**
   * The smallest gap between a part and the plate edge. Less than the chosen edge margin only on a plate whose one
   * part can't keep that margin anywhere; the user should be told.
   */
  readonly edgeMm: number
}

export interface PackOptions {
  readonly catalog: Catalog
  readonly printer: PrinterBed
  readonly allowColourMixing: boolean
  readonly spacingMm?: number
  /**
   * Gap kept from the plate's edges; parts only share a plate within it. A part that can't keep it even alone is
   * still printed, on a plate of its own, with the most it can get: the default 1 mm (which Bambu Studio's
   * strict upload check wants), then the tight margin, then an exact fit.
   */
  readonly edgeMarginMm?: number
  /** Smaller gap allowed on a plate whose part can't lie straight otherwise (L parts on 330 mm beds). */
  readonly tightEdgeMarginMm?: number
}

/** How close parts sit on a plate: the gap between parts, in mm, for each choice the user can make. */
export const DENSITY_SPACING_MM = { roomy: 10, normal: 5, tight: 3 } as const
export type Density = keyof typeof DENSITY_SPACING_MM
/** Default gap from the plate edge: Bambu Studio's strict upload check wants about 1 mm. */
export const DEFAULT_EDGE_MARGIN_MM = 1

/** A part counts as small when its footprint's longest side and its height are both at most this. */
export const SMALL_PART_MM = 60
/** Small parts keep at least this far from the plate's edges, when the plate has room. */
export const SMALL_PART_EDGE_MM = 10

/**
 * How far a part printed with supports needs other parts kept away, per mm of its height. Tree supports spread
 * out past the part as they rise: Bambu Studio's strict upload check found the 126 mm Top Handle's supports
 * inside a key 15 mm away, and not 25 mm away (0.2 × 126 = 25.2 mm).
 */
export const SUPPORT_SPREAD = 0.2
const needsSupport = (path: string) => /\(turn on supports\)/i.test(path)

export const materialOf = (path: string): Material => (/\(TPU\)/i.test(path) ? 'TPU' : 'PLA')

export function packPlates(lines: readonly PartLine[], options: PackOptions): PackedPlate[] {
  const spacing = options.spacingMm ?? DENSITY_SPACING_MM.normal
  const margin = options.edgeMarginMm ?? DEFAULT_EDGE_MARGIN_MM
  const tightMargin = options.tightEdgeMarginMm ?? 0.25
  const { width: W, depth: D } = options.printer.bed
  // Packing happens inside the plate minus the edge margin; positions are shifted back onto the plate.
  const inner = (m: number) => ({ w: W - 2 * m, d: D - 2 * m })
  // Margins to try for a part that can't keep the chosen one, roomiest first.
  const margins = [...new Set([margin, Math.min(margin, DEFAULT_EDGE_MARGIN_MM), Math.min(margin, tightMargin)])]

  // One entry per printed part, grouped by what may share a plate.
  const groups = new Map<string, { role: ColourRole | 'mixed'; material: Material; parts: { line: PartLine; part: PartMeasure }[] }>()
  for (const line of lines) {
    const material = materialOf(line.path)
    const key = material === 'TPU' ? 'tpu' : options.allowColourMixing ? 'pla' : line.role
    const group = groups.get(key) ?? { role: material === 'TPU' || options.allowColourMixing ? 'mixed' : line.role, material, parts: [] }
    if (material === 'TPU') group.role = line.role
    for (let i = 0; i < line.qty; i++) group.parts.push({ line, part: options.catalog.get(line.path) })
    groups.set(key, group)
  }

  const plates: Omit<PackedPlate, 'index' | 'edgeMm'>[] = []
  const order = ['body', 'accent', 'secondary', 'pla', 'tpu']
  for (const key of [...groups.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
    const group = groups.get(key)!
    // `front`: how far forward (packer y, from the back) the large parts placed so far reach, spacing included;
    // `left`/`right`: how far across. Small parts all aim for the middle of that front edge, so they gather
    // side by side in front of the large parts rather than queueing one behind another.
    // A sheet with less than the chosen margin is `solo`: it holds the one part that needed it.
    const sheets: { packer: MaxRects; items: PlacedItem[]; margin: number; solo: boolean; front: number; left: number; right: number }[] = []
    const diagonal: { line: PartLine; part: PartMeasure; rect: { angleDeg: number; w: number; h: number } }[] = []
    const shapes = group.parts
      .map(({ line, part }) => ({ line, part, rect: minAreaRect(part.outline) }))
      .sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)

    for (const { line, part, rect } of shapes) {
      const base = { path: line.path, role: line.role, material: group.material }
      const small = Math.max(rect.w, rect.h, part.size[2]) <= SMALL_PART_MM
      // A part with supports is packed with room for them on every side (on top of the usual spacing between
      // parts), when the plate allows; the part sits in the middle of that room.
      const pad = needsSupport(line.path) ? Math.max(0, SUPPORT_SPREAD * part.size[2] - spacing) : 0
      const fitsBed = (w: number, h: number) => w <= inner(tightMargin).w && h <= inner(tightMargin).d
      const orientations = [
        { angle: rect.angleDeg, w: rect.w, h: rect.h },
        { angle: rect.angleDeg + 90, w: rect.h, h: rect.w },
      ].filter((o) => fitsBed(o.w, o.h))
        .map((o) => (fitsBed(o.w + 2 * pad, o.h + 2 * pad) ? { ...o, w: o.w + 2 * pad, h: o.h + 2 * pad } : o))

      if (orientations.length === 0) {
        // Only fits turned diagonally: laid out separately below, sharing plates where they fit side by side.
        if (!checkFit(part, options.printer).fits) throw new Error(`${line.path} does not fit the ${options.printer.name} at any angle`)
        diagonal.push({ line, part, rect: longSideAlongX(rect) })
        continue
      }

      // Gaps: every rectangle grows by the spacing, and so does the bed, so parts may touch the bed edge.
      let placed: { sheet: (typeof sheets)[number]; at: { x: number; y: number }; o: (typeof orientations)[number] } | undefined
      // Sheets are packed from the back of the plate (packer y runs from back to front), so large parts, placed
      // first by best-short-side-fit, gather at the back. Small parts take the free spot nearest the middle of the
      // front edge of the large parts already placed (or of the plate, before any are), first only where they stay clear of the plate edges, then anywhere.
      // Small parts try, in turn: in front of the large parts and clear of the edges; clear of the edges; anywhere.
      // (A small part beside the tall Top Handle made Bambu Studio report G-code conflicts; in front, it didn't.)
      type Tier = 'front' | 'clear' | 'any'
      const findOn = (sheet: (typeof sheets)[number], tier: Tier) => {
        const { w: sw, d: sd } = inner(sheet.margin)
        const clear = Math.max(0, SMALL_PART_EDGE_MM - sheet.margin)
        let best: { score: number; at: { x: number; y: number }; o: (typeof orientations)[number] } | undefined
        for (const o of orientations) {
          const at = small
            ? sheet.packer.findNear(o.w + spacing, o.h + spacing, { x: (sheet.left < sheet.right ? (sheet.left + sheet.right) / 2 : sw / 2) - o.w / 2, y: sheet.front },
              tier === 'any' ? undefined : { x0: clear, y0: Math.max(clear, tier === 'front' ? sheet.front : 0), x1: sw - clear - o.w, y1: sd - clear - o.h })
            : sheet.packer.find(o.w + spacing, o.h + spacing)
          if (at && (!best || at.score < best.score)) best = { score: at.score, at, o }
        }
        return best
      }
      // A small part looks on every plate for a spot in a better tier before settling for a worse one.
      for (const tier of small ? (['front', 'clear', 'any'] as const) : (['any'] as const)) {
        for (const sheet of sheets) {
          if (sheet.solo) continue
          const best = findOn(sheet, tier)
          if (best) { placed = { sheet, at: best.at, o: best.o }; break }
        }
        if (placed) break
      }
      if (!placed) {
        // A new plate keeps the chosen margin, or the most this part allows (and then it holds only this part).
        const m = margins.find((mm) => orientations.some((o) => o.w <= inner(mm).w && o.h <= inner(mm).d)) ?? tightMargin
        const sheet = { packer: new MaxRects(inner(m).w + spacing, inner(m).d + spacing), items: [] as PlacedItem[], margin: m, solo: m < margin, front: 0, left: Infinity, right: -Infinity }
        // Reserved areas are blocked out, grown so parts keep the spacing from them on every side.
        for (const zone of options.printer.excluded ?? []) {
          const xs = zone.map(([x]) => x)
          const ys = zone.map(([, y]) => y)
          const x0 = Math.min(...xs) - m
          // Packer y runs from the back: flip the zone's y range.
          const y0 = inner(m).d - (Math.max(...ys) - m)
          sheet.packer.place({ x: x0, y: y0, w: Math.max(...xs) - m - x0 + spacing, h: Math.max(...ys) - Math.min(...ys) + spacing })
        }
        sheets.push(sheet)
        const best = findOn(sheet, 'front') ?? findOn(sheet, 'clear') ?? findOn(sheet, 'any')
        if (!best) throw new Error(`${line.path} does not fit an empty ${options.printer.name} plate`)
        placed = { sheet, at: best.at, o: best.o }
      }
      const { sheet, at, o } = placed
      sheet.packer.place({ x: at.x, y: at.y, w: o.w + spacing, h: o.h + spacing })
      if (!small) {
        sheet.front = Math.max(sheet.front, at.y + o.h + spacing)
        sheet.left = Math.min(sheet.left, at.x)
        sheet.right = Math.max(sheet.right, at.x + o.w)
      }
      sheet.items.push({
        ...base,
        angleDeg: normalise(o.angle),
        pivot: boxCentre(part.outline, o.angle),
        x: sheet.margin + at.x + o.w / 2,
        y: sheet.margin + inner(sheet.margin).d - at.y - o.h / 2,
      })
    }
    for (const sheet of sheets) {
      plates.push({ role: group.role, material: group.material, items: centred(sheet.items, options, sheet.margin, spacing) })
    }
    for (const items of diagonalPlates(diagonal, group.material, options, margins, spacing)) {
      plates.push({ role: group.role, material: group.material, items })
    }
  }
  return plates.map((p, i) => ({ ...p, index: i + 1, edgeMm: edgeGap(p.items, options) }))
}

/** Smallest distance from any part on a plate to the plate's edge. */
function edgeGap(items: readonly PlacedItem[], options: PackOptions): number {
  const { width: W, depth: D } = options.printer.bed
  let gap = Infinity
  for (const item of items) {
    for (const [x, y] of footprintOnPlate(item, options.catalog.get(item.path))) gap = Math.min(gap, x, y, W - x, D - y)
  }
  return Math.max(0, gap)
}

/**
 * Parts too long to lie straight (L parts on 325 mm beds, XL parts) go across the plate diagonally. Several can
 * share a plate as parallel strips at one angle, stacked side by side and centred; each plate takes as many as
 * fit. A part that fits only by its exact outline (XL modules on the H2S, with a fraction of a mm to spare) gets
 * a plate to itself at the angle checkFit found.
 */
function diagonalPlates(
  parts: { line: PartLine; part: PartMeasure; rect: { angleDeg: number; w: number; h: number } }[],
  material: Material, options: PackOptions, margins: readonly number[], spacing: number,
): PlacedItem[][] {
  const { width: W, depth: D } = options.printer.bed
  const zones = (options.printer.excluded ?? []).map((z) => box(z as Point[]))
  const sorted = [...parts].sort((a, b) => b.rect.w - a.rect.w)
  const plates: PlacedItem[][] = []

  /** The strips laid out at an angle where, stacked, they fit the plate within this margin; undefined if none. */
  const layout = (group: typeof parts, margin: number) => layoutWithin(group, W - 2 * margin, D - 2 * margin)

  const layoutWithin = (group: typeof parts, iw: number, id: number) => {
    const length = Math.max(...group.map((g) => g.rect.w))
    const thickness = group.reduce((t, g) => t + g.rect.h, 0) + spacing * (group.length - 1)
    let best: { phi: number; slack: number } | undefined
    for (let deg = 0; deg < 180; deg += 0.25) {
      const [c, s] = cosSin(deg)
      const w = length * Math.abs(c) + thickness * Math.abs(s)
      const d = length * Math.abs(s) + thickness * Math.abs(c)
      const slack = Math.min(iw - w, id - d)
      if (slack < 0) continue
      const items = place(group, deg, thickness)
      const clear = items.every((item) => {
        const b = box(footprintOnPlate(item, options.catalog.get(item.path)))
        return zones.every((z) => b.x1 + spacing <= z.x0 || b.x0 >= z.x1 + spacing || b.y1 + spacing <= z.y0 || b.y0 >= z.y1 + spacing)
      })
      if (clear && (!best || slack > best.slack)) best = { phi: deg, slack }
    }
    return best && place(group, best.phi, thickness)
  }

  /** Strips side by side across their width, the whole stack centred on the plate, turned by phi. */
  const place = (group: typeof parts, phi: number, thickness: number): PlacedItem[] => {
    const [c, s] = cosSin(phi)
    let v = -thickness / 2
    return group.map(({ line, part, rect }) => {
      const offset = v + rect.h / 2
      v += rect.h + spacing
      return {
        path: line.path, role: line.role, material,
        angleDeg: normalise(rect.angleDeg + phi),
        pivot: boxCentre(part.outline, rect.angleDeg),
        x: W / 2 - offset * s,
        y: D / 2 + offset * c,
      }
    })
  }

  while (sorted.length) {
    const group = [sorted.shift()!]
    let placed = layout(group, margins[0])
    if (!placed) {
      // Can't keep the chosen margin even alone: a plate of its own, with the most margin it can get.
      const alone = margins.slice(1).map((m) => layout(group, m)).find(Boolean)
      if (alone) { plates.push(alone); continue }
      // Fits only by its exact outline: alone, at the angle that leaves the most room.
      const { line, part } = group[0]
      const fit = checkFit(part, options.printer)
      plates.push([{ path: line.path, role: line.role, material, angleDeg: fit.angleDeg, pivot: boxCentre(part.outline, fit.angleDeg), x: W / 2, y: D / 2 }])
      continue
    }
    for (let i = 0; i < sorted.length;) {
      const tried = layout([...group, sorted[i]], margins[0])
      if (tried) { group.push(sorted.splice(i, 1)[0]); placed = tried } else i++
    }
    plates.push(placed)
  }
  return plates
}

/** Whether a placed part counts as small: its footprint and height are all within SMALL_PART_MM. */
function isSmall(part: PartMeasure, item: PlacedItem): boolean {
  const b = box(footprintOnPlate(item, part))
  return Math.max(b.x1 - b.x0, b.y1 - b.y0, part.size[2]) <= SMALL_PART_MM + 1e-6
}

/**
 * Moves a plate's parts so they sit together in the middle of the plate, as Bambu Studio's own arrange does,
 * unless that would push something off the plate or into a reserved area; then it tries moving along one axis
 * only, and otherwise leaves them where they were packed.
 */
function centred(items: PlacedItem[], options: PackOptions, margin: number, spacing: number): PlacedItem[] {
  const { width: W, depth: D } = options.printer.bed
  const boxes = items.map((item) => box(footprintOnPlate(item, options.catalog.get(item.path))))
  const all = boxes.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))
  const dx = W / 2 - (all.x0 + all.x1) / 2
  const dy = D / 2 - (all.y0 + all.y1) / 2
  const zones = (options.printer.excluded ?? []).map((z) => box(z as Point[]))
  // Small parts keep their extra distance from the edges, if they had it before the move.
  const edgeOf = boxes.map((b, i) => {
    const small = isSmall(options.catalog.get(items[i].path), items[i])
    const had = Math.min(b.x0, b.y0, W - b.x1, D - b.y1)
    return small ? Math.max(margin, Math.min(SMALL_PART_EDGE_MM, had)) : margin
  })
  const fits = (sx: number, sy: number) => boxes.every((b, i) =>
    b.x0 + sx >= edgeOf[i] - 1e-6 && b.y0 + sy >= edgeOf[i] - 1e-6 && b.x1 + sx <= W - edgeOf[i] + 1e-6 && b.y1 + sy <= D - edgeOf[i] + 1e-6 &&
    zones.every((z) => b.x1 + sx + spacing <= z.x0 || b.x0 + sx >= z.x1 + spacing || b.y1 + sy + spacing <= z.y0 || b.y0 + sy >= z.y1 + spacing))
  // As close to the middle as the plate allows: the full move if it fits, otherwise the largest part of it
  // (a reserved strip can block going all the way), on both axes or on one.
  for (let t = 1; t > 0; t -= 0.05) {
    const found = ([[dx * t, dy * t], [dx * t, 0], [0, dy * t]] as const).find(([x, y]) => fits(x, y))
    if (found) return items.map((item) => ({ ...item, x: item.x + found[0], y: item.y + found[1] }))
  }
  return items
}

function box(points: readonly Point[]) {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

/** A placed part's outline, in plate coordinates. */
export function footprintOnPlate(item: PlacedItem, part: PartMeasure): Point[] {
  const [c, s] = cosSin(item.angleDeg)
  const [px, py] = item.pivot
  return part.outline.map(([x, y]) => {
    const dx = x - px
    const dy = y - py
    return [item.x + dx * c - dy * s, item.y + dx * s + dy * c] as const
  })
}

const normalise = (deg: number) => ((deg % 360) + 360) % 360
const cosSin = (deg: number): [number, number] => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]

/** Centre of the outline's bounding box once turned by `deg`, expressed in the outline's own coordinates. */
function boxCentre(outline: readonly Point[], deg: number): Point {
  const [c, s] = cosSin(deg)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of outline) {
    const rx = x * c - y * s
    const ry = x * s + y * c
    minX = Math.min(minX, rx); maxX = Math.max(maxX, rx); minY = Math.min(minY, ry); maxY = Math.max(maxY, ry)
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return [cx * c + cy * s, -cx * s + cy * c]
}

/** Smallest rectangle around a convex outline, and the turn that lines one of its sides up with the X axis. */
function minAreaRect(outline: readonly Point[]): { angleDeg: number; w: number; h: number } {
  let best = { angleDeg: 0, w: Infinity, h: Infinity }
  for (let i = 0; i < outline.length; i++) {
    const [ax, ay] = outline[i]
    const [bx, by] = outline[(i + 1) % outline.length]
    if (ax === bx && ay === by) continue
    const angleDeg = (-Math.atan2(by - ay, bx - ax) * 180) / Math.PI
    const [c, s] = cosSin(angleDeg)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const [x, y] of outline) {
      const rx = x * c - y * s
      const ry = x * s + y * c
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx); minY = Math.min(minY, ry); maxY = Math.max(maxY, ry)
    }
    const w = maxX - minX
    const h = maxY - minY
    if (w * h < best.w * best.h) best = { angleDeg, w, h }
  }
  return best
}

/** The same rectangle, turned if needed so its long side runs along X (for laying parts out as strips). */
function longSideAlongX(r: { angleDeg: number; w: number; h: number }) {
  return r.w >= r.h ? r : { angleDeg: r.angleDeg + 90, w: r.h, h: r.w }
}

interface Rect { x: number; y: number; w: number; h: number }

/** MaxRects bin packing: free space kept as maximal rectangles. */
class MaxRects {
  private free: Rect[]
  constructor(width: number, height: number) {
    this.free = [{ x: 0, y: 0, w: width, h: height }]
  }

  find(w: number, h: number): { x: number; y: number; score: number } | undefined {
    let best: { x: number; y: number; score: number } | undefined
    for (const f of this.free) {
      if (w <= f.w + 1e-9 && h <= f.h + 1e-9) {
        const score = Math.min(f.w - w, f.h - h)
        if (!best || score < best.score) best = { x: f.x, y: f.y, score }
      }
    }
    return best
  }

  /**
   * The free spot for a w × h rectangle whose corner is nearest `want`, optionally only where the corner stays
   * within `bounds`. Within each free rectangle the corner is pulled as close to `want` as it can go.
   */
  findNear(
    w: number, h: number, want: { x: number; y: number }, bounds?: { x0: number; y0: number; x1: number; y1: number },
  ): { x: number; y: number; score: number } | undefined {
    let best: { x: number; y: number; score: number } | undefined
    for (const f of this.free) {
      let x0 = f.x, x1 = f.x + f.w - w, y0 = f.y, y1 = f.y + f.h - h
      if (bounds) { x0 = Math.max(x0, bounds.x0); x1 = Math.min(x1, bounds.x1); y0 = Math.max(y0, bounds.y0); y1 = Math.min(y1, bounds.y1) }
      if (x1 < x0 - 1e-9 || y1 < y0 - 1e-9) continue
      const x = Math.min(Math.max(want.x, x0), Math.max(x0, x1))
      const y = Math.min(Math.max(want.y, y0), Math.max(y0, y1))
      const score = Math.hypot(x - want.x, y - want.y)
      if (!best || score < best.score) best = { x, y, score }
    }
    return best
  }

  place(r: Rect) {
    const next: Rect[] = []
    for (const f of this.free) {
      if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) {
        next.push(f)
        continue
      }
      if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h })
      if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - (r.x + r.w), h: f.h })
      if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y })
      if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - (r.y + r.h) })
    }
    // Drop free rectangles contained in another.
    this.free = next.filter((a, i) => !next.some((b, j) => i !== j &&
      a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h &&
      (j < i || a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h)))
  }
}
