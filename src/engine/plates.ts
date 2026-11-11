/**
 * Arranging Parts onto Plates. Each part is laid as the smallest rectangle around its top-down outline,
 * turned 0° or 90° from that rectangle's own axis, with a gap between parts; rectangles are packed with
 * MaxRects. A part that only fits the bed turned diagonally (XL modules on the H2S) gets a plate to itself.
 * Plates hold one Colour role unless colours may mix; TPU parts always get their own plates.
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
}

export interface PackOptions {
  readonly catalog: Catalog
  readonly printer: PrinterBed
  readonly allowColourMixing: boolean
  readonly spacingMm?: number
  /** Gap kept from the plate's edges (Bambu Studio's strict upload check wants about 1 mm). */
  readonly edgeMarginMm?: number
  /** Smaller gap allowed on a plate whose part can't lie straight otherwise (L parts on 330 mm beds). */
  readonly tightEdgeMarginMm?: number
}

export const materialOf = (path: string): Material => (/\(TPU\)/i.test(path) ? 'TPU' : 'PLA')

export function packPlates(lines: readonly PartLine[], options: PackOptions): PackedPlate[] {
  const spacing = options.spacingMm ?? 5
  const margin = options.edgeMarginMm ?? 1
  const tightMargin = options.tightEdgeMarginMm ?? 0.25
  const { width: W, depth: D } = options.printer.bed
  // Packing happens inside the plate minus the edge margin; positions are shifted back onto the plate.
  const inner = (m: number) => ({ w: W - 2 * m, d: D - 2 * m })

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

  const plates: Omit<PackedPlate, 'index'>[] = []
  const order = ['body', 'accent', 'secondary', 'pla', 'tpu']
  for (const key of [...groups.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
    const group = groups.get(key)!
    const sheets: { packer: MaxRects; items: PlacedItem[]; margin: number }[] = []
    const diagonal: { line: PartLine; part: PartMeasure; rect: { angleDeg: number; w: number; h: number } }[] = []
    const shapes = group.parts
      .map(({ line, part }) => ({ line, part, rect: minAreaRect(part.outline) }))
      .sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)

    for (const { line, part, rect } of shapes) {
      const base = { path: line.path, role: line.role, material: group.material }
      const orientations = [
        { angle: rect.angleDeg, w: rect.w, h: rect.h },
        { angle: rect.angleDeg + 90, w: rect.h, h: rect.w },
      ].filter((o) => o.w <= inner(tightMargin).w && o.h <= inner(tightMargin).d)

      if (orientations.length === 0) {
        // Only fits turned diagonally: laid out separately below, sharing plates where they fit side by side.
        if (!checkFit(part, options.printer).fits) throw new Error(`${line.path} does not fit the ${options.printer.name} at any angle`)
        diagonal.push({ line, part, rect: longSideAlongX(rect) })
        continue
      }

      // Gaps: every rectangle grows by the spacing, and so does the bed, so parts may touch the bed edge.
      let placed: { sheet: (typeof sheets)[number]; at: { x: number; y: number }; o: (typeof orientations)[number] } | undefined
      for (const sheet of sheets) {
        let best: { score: number; at: { x: number; y: number }; o: (typeof orientations)[number] } | undefined
        for (const o of orientations) {
          const at = sheet.packer.find(o.w + spacing, o.h + spacing)
          if (at && (!best || at.score < best.score)) best = { score: at.score, at, o }
        }
        if (best) { placed = { sheet, at: best.at, o: best.o }; break }
      }
      if (!placed) {
        // A new plate keeps the normal margin, unless this part only lies straight with the tight one.
        const m = orientations.some((o) => o.w <= inner(margin).w && o.h <= inner(margin).d) ? margin : tightMargin
        const sheet = { packer: new MaxRects(inner(m).w + spacing, inner(m).d + spacing), items: [] as PlacedItem[], margin: m }
        // Reserved areas are blocked out, grown so parts keep the spacing from them on every side.
        for (const zone of options.printer.excluded ?? []) {
          const xs = zone.map(([x]) => x)
          const ys = zone.map(([, y]) => y)
          const x0 = Math.min(...xs) - m, y0 = Math.min(...ys) - m
          sheet.packer.place({ x: x0, y: y0, w: Math.max(...xs) - x0 + spacing, h: Math.max(...ys) - y0 + spacing })
        }
        sheets.push(sheet)
        const o = orientations[0]
        placed = { sheet, at: sheet.packer.find(o.w + spacing, o.h + spacing)!, o }
      }
      const { sheet, at, o } = placed
      sheet.packer.place({ x: at.x, y: at.y, w: o.w + spacing, h: o.h + spacing })
      sheet.items.push({
        ...base,
        angleDeg: normalise(o.angle),
        pivot: boxCentre(part.outline, o.angle),
        x: sheet.margin + at.x + o.w / 2,
        y: sheet.margin + at.y + o.h / 2,
      })
    }
    for (const sheet of sheets) {
      plates.push({ role: group.role, material: group.material, items: centred(sheet.items, options, sheet.margin, spacing) })
    }
    for (const items of diagonalPlates(diagonal, group.material, options, margin, spacing)) {
      plates.push({ role: group.role, material: group.material, items })
    }
  }
  return plates.map((p, i) => ({ ...p, index: i + 1 }))
}

/**
 * Parts too long to lie straight (L parts on 325 mm beds, XL parts) go across the plate diagonally. Several can
 * share a plate as parallel strips at one angle, stacked side by side and centred; each plate takes as many as
 * fit. A part that fits only by its exact outline (XL modules on the H2S, with a fraction of a mm to spare) gets
 * a plate to itself at the angle checkFit found.
 */
function diagonalPlates(
  parts: { line: PartLine; part: PartMeasure; rect: { angleDeg: number; w: number; h: number } }[],
  material: Material, options: PackOptions, margin: number, spacing: number,
): PlacedItem[][] {
  const { width: W, depth: D } = options.printer.bed
  const iw = W - 2 * margin
  const id = D - 2 * margin
  const zones = (options.printer.excluded ?? []).map((z) => box(z as Point[]))
  const sorted = [...parts].sort((a, b) => b.rect.w - a.rect.w)
  const plates: PlacedItem[][] = []

  /** The angle at which strips of these lengths and thicknesses, stacked, fit the plate; undefined if none. */
  const layout = (group: typeof parts) => {
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
    let placed = layout(group)
    if (!placed) {
      // Fits only by its exact outline: alone, at the angle that leaves the most room.
      const { line, part } = group[0]
      const fit = checkFit(part, options.printer)
      plates.push([{ path: line.path, role: line.role, material, angleDeg: fit.angleDeg, pivot: boxCentre(part.outline, fit.angleDeg), x: W / 2, y: D / 2 }])
      continue
    }
    for (let i = 0; i < sorted.length;) {
      const tried = layout([...group, sorted[i]])
      if (tried) { group.push(sorted.splice(i, 1)[0]); placed = tried } else i++
    }
    plates.push(placed)
  }
  return plates
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
  const fits = (sx: number, sy: number) => boxes.every((b) =>
    b.x0 + sx >= margin - 1e-6 && b.y0 + sy >= margin - 1e-6 && b.x1 + sx <= W - margin + 1e-6 && b.y1 + sy <= D - margin + 1e-6 &&
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

/** MaxRects bin packing, best-short-side-fit. */
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
