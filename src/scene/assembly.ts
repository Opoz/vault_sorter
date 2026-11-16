/**
 * Where every Part of a Tower sits in 3D, assembled, and which way it moves when the view is pulled apart
 * (issue #9). Parts are plain boxes at their measured size for now; real poses for the STLs come later.
 *
 * World axes, in mm: x to the right, y up, z toward the viewer (the Tower's front). The Tower stands centred on
 * x = 0 and z = 0, with the bottom of its lowest Module at y = 0.
 *
 * Every placement here is inferred from the part sizes and the manuals' pictures, not measured on an assembly:
 * see POSE_SOURCE.
 */
import type { Catalog } from '../engine/catalog'
import { MODULE_WIDTH_MM, moduleDepthMm, FLOOR_PITCH_MM, minAreaRect } from '../engine/dimensions'
import type { Depth, Height, Width } from '../engine/model'
import { partsForTower, type ColourRole, type PartLine, type PartsOptions } from '../engine/parts'
import { rowFloors, unitStarts, type EditorStackedUnit, type EditorTower } from '../editor/layoutOps'

export type Vec3 = readonly [x: number, y: number, z: number]

export interface ScenePart {
  /** Stable across renders: the owner, the file and which copy. */
  readonly key: string
  readonly path: string
  readonly role: ColourRole
  /** The Unit this Part belongs to; absent for the Tower's own parts (Roof, Base, Backbone and so on). */
  readonly unitId?: string
  /** Assembled position (the box's centre) and size. */
  readonly center: Vec3
  readonly size: Vec3
  /** How far the Part's whole group (its Unit, or the Roof, Base or back) moves when the Tower is fully pulled apart. */
  readonly groupSpread: Vec3
  /** How far the Part moves out of its group when fully pulled apart, along the way it's fitted. */
  readonly partSpread: Vec3
}

export const POSE_SOURCE = 'Inferred from part sizes and the assembly pictures (Drawer Assembly pp1–8, Instructions Manual pp10–18, Modifications); not yet checked part by part'

/** Parts that are tools rather than pieces of the Tower, so they aren't drawn. */
const TOOLS = [/\/wheels\/jig\.stl$/i]

export interface AssemblyOptions extends PartsOptions {
  readonly catalog: Catalog
}

/** Every Part of a Tower, placed. Unfinished Towers show the Units they have; Empty space stays empty. */
export function assembleTower(tower: EditorTower, depth: Depth, options: AssemblyOptions): ScenePart[] {
  const width = tower.width
  if (!width) return []
  const towerW = MODULE_WIDTH_MM[width]
  const towerD = moduleDepthMm(depth)
  const parts: ScenePart[] = []
  const measure = (path: string) => options.catalog.get(path).size

  // Units, row by row. A Row is as high as its tallest Column.
  let rowBottom = 0
  const rowBottoms: number[] = []
  for (const row of tower.rows) {
    rowBottoms.push(rowBottom)
    const sides = columnSides(width, row.columns.map((c) => c.width), row.soloSide)
    row.columns.forEach((column, ci) => {
      const starts = unitStarts(column.units)
      column.units.forEach((unit, ui) => {
        const frame: Frame = {
          x0: sides[ci], w: MODULE_WIDTH_MM[unit.width], d: towerD,
          y0: rowBottom + starts[ui] * FLOOR_PITCH_MM, h: floorsOf(unit.height) * FLOOR_PITCH_MM,
        }
        // Units spread apart in proportion to how high they sit, and Columns of a split Row apart sideways.
        const sideways = row.columns.length > 1 || MODULE_WIDTH_MM[column.width] < towerW ? (frame.x0 + frame.w / 2 < 0 ? -40 : 40) : 0
        const groupSpread: Vec3 = [sideways, frame.y0 * UNIT_LIFT, 0]
        for (const line of unitLines(tower, unit, depth, options)) {
          placeLine(line, (n) => unitPart(line.path, frame, n, unit, measure), groupSpread, unit.id, parts, unit.id)
        }
      })
    })
    rowBottom += rowFloors(row) * FLOOR_PITCH_MM
  }
  const top = rowBottom
  const towerFrame: Frame = { x0: -towerW / 2, w: towerW, d: towerD, y0: 0, h: top }

  // The Roof, Base and what fixes to the back.
  const lines = towerLines(tower, depth, options)
  const roof = lines.find((l) => /roof/.test(name(l.path)) && !/handle|insert/.test(name(l.path)))
  const roofT = roof ? minAreaRect(options.catalog.get(roof.path).outline)[1] : 0
  for (const line of lines) {
    const group = towerGroup(line.path)
    const groupSpread: Vec3 = group === 'roof' ? [0, top * UNIT_LIFT + 80, 0] : group === 'bottom' ? [0, -80, 0] : [0, 0, -60]
    placeLine(line, (n) => towerPart(line.path, towerFrame, n, line.qty, roofT, measure, options.catalog), groupSpread, 'tower', parts)
  }
  // Backbone and pegboard pieces, Row by Row.
  tower.rows.forEach((row, ri) => {
    let y = rowBottoms[ri]
    for (const line of backLines(tower, rowFloors(row), depth, options)) {
      const size = measure(line.path)
      for (let n = 0; n < line.qty; n++) {
        const pegboard = /pegboard/i.test(line.path)
        const [w, h, t] = size
        const z = -towerD / 2 - (pegboard ? 33 : 0) - t / 2
        parts.push({
          key: `tower:${ri}:${line.path}:${n}`, path: line.path, role: line.role,
          center: [0, y + h / 2, z], size: [w, h, t],
          groupSpread: [0, (y + h / 2) * UNIT_LIFT, -60], partSpread: [0, 0, pegboard ? -120 : -50],
        })
        if (!pegboard) y += h
      }
    }
  })
  return parts
}

/** How far apart Units spread, per mm of height below them. */
const UNIT_LIFT = 0.35

interface Frame {
  /** Left edge, bottom, width, height, depth. The front is at z = d / 2. */
  readonly x0: number; readonly y0: number; readonly w: number; readonly h: number; readonly d: number
}

const floorsOf = (h: Height) => ({ '1F': 1, '2F': 2, '4F': 4 })[h]

/** Left edges of a Row's Columns: a lone Column sits on its side, leaving the gap for the missing one. */
function columnSides(towerWidth: Width, widths: readonly Width[], soloSide?: 'right'): number[] {
  const left = -MODULE_WIDTH_MM[towerWidth] / 2
  if (widths.length === 1 && soloSide === 'right') return [-left - MODULE_WIDTH_MM[widths[0]]]
  return widths.map((_, i) => left + widths.slice(0, i).reduce((s, w) => s + MODULE_WIDTH_MM[w], 0))
}

function placeLine(line: PartLine, place: (n: number) => Placement, groupSpread: Vec3, owner: string, out: ScenePart[], unitId?: string) {
  for (let n = 0; n < line.qty; n++) {
    const p = place(n)
    out.push({
      key: `${owner}:${line.path}:${n}`, path: line.path, role: line.role, unitId,
      center: p.center, size: p.size, groupSpread, partSpread: p.spread,
    })
  }
}

interface Placement { readonly center: Vec3; readonly size: Vec3; readonly spread: Vec3 }

const name = (path: string) => path.split('/').pop()!.toLowerCase().replace(/\.stl$/, '')
/** Sizes sorted largest first. */
const ranked = (s: Vec3) => [...s].sort((a, b) => b - a) as unknown as Vec3
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
/** Copy n of 2 goes on the left (−1), the other on the right (+1). */
const sideOf = (n: number) => (n % 2 === 0 ? -1 : 1)
/** Which half of a split part this is: Part 1 at the front, Part 2 behind; 0 when it's whole. */
const half = (file: string) => (/part 1\b/.test(file) ? 1 : /part 2\b/.test(file) ? -1 : 0)

/** A box with its bottom at y0, centred on cx and cz. */
const sitting = (cx: number, y0: number, cz: number, size: Vec3): Vec3 => [cx, y0 + size[1] / 2, cz]

/** Where one copy of a Unit's part goes, in the Unit's frame. */
function unitPart(path: string, f: Frame, n: number, unit: EditorStackedUnit, measure: (p: string) => Vec3): Placement {
  const file = name(path)
  const [sx, sy, sz] = measure(path)
  const cx = f.x0 + f.w / 2
  const front = f.d / 2
  const out = f.d * 0.75 // how far a Box pulls out

  if (unit.kind === 'drawer') {
    // Box sizes are stored upright: [width, depth, height]. Facades lie on their back: [width, height, thickness].
    const boxW = f.w - 30.6
    const boxH = f.h - 10.5
    const boxBottom = f.y0 + (f.h - boxH) / 2
    const boxSpread: Vec3 = [0, 0, out]
    if (/\bmodule\b/.test(file)) return { center: sitting(cx, f.y0, 0, [f.w, f.h, f.d]), size: [f.w, f.h, f.d], spread: [0, 0, 0] }
    if (/\bbox\b/.test(file)) {
      const h = half(file)
      const d = h === 0 ? f.d - 2.3 : (f.d - 2.3) / 2
      const z = front - (h === -1 ? (f.d - 2.3) * 0.75 : h === 1 ? d / 2 : d / 2)
      return { center: sitting(cx, boxBottom, z, [boxW, boxH, d]), size: [boxW, boxH, d], spread: add(boxSpread, [0, 0, h * 15]) }
    }
    if (/back panel/.test(file)) {
      return { center: sitting(cx, boxBottom, front - f.d + 4, [boxW, boxH, 3]), size: [boxW, boxH, 3], spread: add(boxSpread, [0, 0, -30]) }
    }
    if (/baseplate/.test(file)) {
      const h = half(file)
      const size: Vec3 = [sx, Math.min(sz, 4), h === 0 ? sy : sy]
      const z = h === 0 ? front - f.d / 2 : front - f.d / 2 + h * (sy / 2)
      return { center: sitting(cx, boxBottom + 2, z, size), size, spread: add(boxSpread, [0, boxH + 25, 0]) }
    }
    if (/facade cap/.test(file)) return small(path, [cx + f.w / 2 - 15, f.y0 + f.h / 2, front + 12], add(boxSpread, [0, 0, 80]), measure)
    if (/\/facades\/|xl facade/i.test(path)) {
      return { center: [cx, f.y0 + f.h / 2, front + sz / 2], size: [sx, sy, sz], spread: add(boxSpread, [0, 0, 40]) }
    }
    if (/^label$/.test(file)) return flat(path, [cx, f.y0 + f.h - 18, front + 11], add(boxSpread, [0, 0, 70]), measure)
    // The key turns in the Facade and sits mostly behind it: only its cap shows.
    if (/^key cap/.test(file)) return small(path, [cx, f.y0 + f.h / 2, front + 16], add(boxSpread, [0, 0, 110]), measure)
    if (/key/.test(file)) {
      const k = small(path, [0, 0, 0], [0, 0, 0], measure)
      const z = front - k.size[2] / 2 + (/part 2/.test(file) ? 14 : 8)
      return { center: [cx, f.y0 + f.h / 2, z], size: k.size, spread: add(boxSpread, [0, 0, /part 2/.test(file) ? 110 : 90]) }
    }
    if (/latch/.test(file)) {
      const size: Vec3 = [sx, sz, sy]
      return { center: sitting(cx, f.y0 + 1, front - sy / 2 - 4, size), size, spread: [0, -35, f.d * 0.25] }
    }
    if (/springs/.test(file)) {
      const size: Vec3 = [sx, sz, sy]
      return { center: sitting(cx, f.y0 + 1, front - sy - 50, size), size, spread: [0, -55, f.d * 0.1] }
    }
    if (/runner guide/.test(file)) {
      // Guides line the Module's sides: length along the depth, width up the side, thickness across.
      const size: Vec3 = [sz, sx, sy]
      const x = cx + sideOf(n) * (f.w / 2 - 2 - sz / 2)
      return { center: sitting(x, boxBottom, front - sy / 2 - 1, size), size, spread: [sideOf(n) * 45, 0, 0] }
    }
    if (/runner slide/.test(file)) {
      const size: Vec3 = [sz, sx, sy]
      const x = cx + sideOf(n) * (boxW / 2 + sz / 2)
      return { center: sitting(x, boxBottom + 2, front - sy / 2 - 6, size), size, spread: add(boxSpread, [sideOf(n) * 25, 0, 0]) }
    }
    if (/runner stopper/.test(file)) {
      return small(path, [cx + sideOf(n) * (f.w / 2 - 8), boxBottom + 10, front - f.d + 12], [sideOf(n) * 45, 0, -30], measure)
    }
    if (/rails/.test(file)) {
      // Geared rails: one under the Box and one over it, front to back.
      const size: Vec3 = [sz, sy, sx]
      const y = n % 2 === 0 ? boxBottom - sy : boxBottom + boxH
      return { center: sitting(cx, y, front - sx / 2 - 10, size), size, spread: add(boxSpread, [0, n % 2 === 0 ? -20 : 20, 0]) }
    }
  } else {
    // Sustainers: a Module open at the top, a lid (the Roof file) over it, a Facade on the front, hinges at the
    // back and locks at the front.
    const lidT = 6
    const modH = f.h - lidT
    const lidSpread: Vec3 = [0, 70, 0]
    if (/\bmodule\b/.test(file)) return { center: sitting(cx, f.y0, 0, [f.w, modH, f.d]), size: [f.w, modH, f.d], spread: [0, 0, 0] }
    if (/\broof\b/.test(file)) {
      const h = half(file)
      const d = h === 0 ? f.d - 4 : (f.d - 4) / 2
      const z = h * d / 2
      return { center: sitting(cx, f.y0 + modH, z, [f.w - 4, lidT, d]), size: [f.w - 4, lidT, d], spread: add(lidSpread, [0, 0, h * 15]) }
    }
    if (/connector/.test(file)) return small(path, [cx, f.y0 + modH + lidT, 0], add(lidSpread, [0, 25, 0]), measure)
    if (/facade/.test(file)) {
      return { center: [cx, f.y0 + modH / 2, front + sz / 2], size: [sx, sy, sz], spread: [0, 0, 45] }
    }
    if (/label/.test(file)) return flat(path, [cx, f.y0 + modH / 2, front + sz + 11], [0, 0, 80], measure)
    if (/hinge top/.test(file)) return small(path, [cx + sideOf(n) * f.w / 4, f.y0 + f.h + 6, -front + 10], add(lidSpread, [0, 30, -40]), measure)
    if (/hinge/.test(file)) return small(path, [cx + sideOf(n) * f.w / 4, f.y0 + modH - 10, -front - 10], [0, 20, -45], measure)
    if (/rods/.test(file)) return small(path, [cx, f.y0 + modH - 10, -front - 18], [0, 40, -70], measure)
    const lockX = cx + sideOf(n) * (f.w / 2 - 28)
    const lockY = f.y0 + modH - 20
    if (/lock holder/.test(file)) return small(path, [lockX, lockY, front + 4], [0, 0, 30], measure)
    if (/lock inner/.test(file)) return small(path, [lockX, lockY, front + 12], [0, 0, 55], measure)
    if (/lock outer/.test(file)) return small(path, [lockX, lockY, front + 20], [0, 0, 80], measure)
    if (/pins/.test(file)) return small(path, [lockX, lockY + 15, front + 8], [0, 15, 100], measure)
  }
  if (/wall mount second/.test(file)) return small(path, [cx, f.y0 + f.h / 2, -f.d / 2 - 30], [0, 0, -110], measure)
  if (/wall mount/.test(file)) {
    const size: Vec3 = ranked([sx, sy, sz])
    return { center: [cx, f.y0 + f.h / 2, -f.d / 2 - size[2] / 2], size: [size[0], size[1], size[2]], spread: [0, 0, -60] }
  }
  return loose(path, [cx, f.y0 + f.h, 0], measure)
}

/** A small part: its longest side across, the next up, the shortest front to back. */
function small(path: string, center: Vec3, spread: Vec3, measure: (p: string) => Vec3): Placement {
  const [a, b, c] = ranked(measure(path))
  return { center, size: [a, b, c], spread }
}

/** A flat part facing forward, like a label: stored lying down as [width, height, thickness]. */
function flat(path: string, center: Vec3, spread: Vec3, measure: (p: string) => Vec3): Placement {
  const [x, y, z] = measure(path)
  return { center, size: [x, y, z], spread }
}

/** A part with no known place: drawn just above where it belongs, so it's still counted and visible. */
function loose(path: string, at: Vec3, measure: (p: string) => Vec3): Placement {
  const size = ranked(measure(path))
  return { center: [at[0], at[1] + size[1] / 2 + 20, at[2]], size, spread: [0, 60, 0] }
}

type TowerGroup = 'roof' | 'bottom' | 'back'
function towerGroup(path: string): TowerGroup {
  const file = name(path)
  if (/roof|top handle/.test(file)) return 'roof'
  if (/\bbase\b|connector|feet|disk|bushing|tyre|cover/.test(file)) return 'bottom'
  return 'back'
}

/** Where one copy of a Tower part goes. */
function towerPart(path: string, f: Frame, n: number, qty: number, roofT: number, measure: (p: string) => Vec3, catalog: Catalog): Placement {
  const file = name(path)
  const top = f.y0 + f.h
  const cx = f.x0 + f.w / 2
  const thick = (p: string) => minAreaRect(catalog.get(p).outline)[1]
  if (/roof insert/.test(file)) return small(path, [cx, top + 30, 0], [0, 140, 0], measure)
  if (/roof handle/.test(file)) {
    const [a, b, c] = ranked(measure(path))
    return { center: [cx, top + 40, 0], size: [a, c, b], spread: [0, 120, 0] }
  }
  if (/top handle/.test(file)) {
    const [a, b, c] = ranked(measure(path))
    const x = f.x0 + ((n + 0.5) / qty) * f.w
    return { center: [x, top + roofT + b / 2, 0], size: [a, b, c], spread: [0, 100, 0] }
  }
  if (/roof/.test(file)) {
    const t = thick(path)
    return { center: sitting(cx, top, 0, [f.w, t, f.d]), size: [f.w, t, f.d], spread: [0, 0, 0] }
  }
  if (/\bbase\b/.test(file)) {
    const t = thick(path)
    const h = half(file)
    const d = h === 0 ? f.d : f.d / 2
    return { center: sitting(cx, -t, h * d / 2, [f.w, t, d]), size: [f.w, t, d], spread: [0, 0, h * 20] }
  }
  if (/connector/.test(file)) return small(path, [cx, -10, 0], [0, -40, 0], measure)
  if (/feet/.test(file)) {
    const [a, b, c] = ranked(measure(path))
    const z = qty === 1 ? f.d / 2 - c / 2 : (n === 0 ? 1 : -1) * (f.d / 2 - c / 2)
    return { center: [cx, -25 - c / 2, z], size: [a, c, b], spread: [0, -60, 0] }
  }
  if (/disk|bushing|tyre|cover/.test(file)) {
    // Two wheels at the back corners, axle across.
    const [a, , c] = ranked(measure(path))
    const order = ['tyre', 'disk', 'bushing', 'cover'].findIndex((k) => file.includes(k))
    const x = cx + sideOf(n) * (f.w / 2 + 6 + order * 6)
    return { center: [x, -a / 2 - 10, -f.d / 2 + a / 2], size: [c, a, a], spread: [sideOf(n) * (30 + order * 25), -60, 0] }
  }
  if (/stationary handle|pull-out handle\b|pull-out handle$/.test(file)) {
    const [a, b, c] = ranked(measure(path))
    return { center: [cx, top - b / 2, -f.d / 2 - 33 - c / 2], size: [a, b, c], spread: [0, 40, -80] }
  }
  if (/handle lock knob/.test(file)) return small(path, [cx + sideOf(n) * 40, top - 60, -f.d / 2 - 40], [sideOf(n) * 20, 0, -110], measure)
  if (/handle lock/.test(file)) return small(path, [cx + (qty > 1 ? sideOf(n) * 40 : 0), top - 60, -f.d / 2 - 36], [0, 0, -95], measure)
  return loose(path, [cx, top, 0], measure)
}

/** A Unit's own parts, from a Tower holding just it. Wall mounts come per Unit, so they're included. */
function unitLines(tower: EditorTower, unit: EditorStackedUnit, depth: Depth, options: PartsOptions): PartLine[] {
  const { gapBelow: _gap, ...plain } = unit
  const alone = {
    width: unit.width, depth, roof: 'none' as const, bottom: 'none' as const, backbone: 'none' as const,
    wallMount: tower.wallMount ?? false, rows: [{ columns: [{ width: unit.width, units: [plain] }] }],
  }
  try {
    return partsForTower(alone, options)
  } catch {
    return []
  }
}

/** The Tower's own parts: Roof, Base, handles. Backbones and pegboards come Row by Row (backLines). */
function towerLines(tower: EditorTower, depth: Depth, options: PartsOptions): PartLine[] {
  if (!tower.width) return []
  const bare = {
    width: tower.width, depth, rows: [], roof: tower.roof, bottom: tower.bottom, backbone: tower.backbone,
    stationaryHandle: tower.stationaryHandle ?? false, pullOutHandle: tower.pullOutHandle ?? false,
    topHandles: tower.topHandles, wallMount: tower.wallMount ?? false,
  }
  try {
    return partsForTower(bare, options).filter((l) => !TOOLS.some((t) => t.test(l.path)))
  } catch {
    return []
  }
}

/** Backbone and pegboard pieces covering one Row of this many floors. */
function backLines(tower: EditorTower, floors: number, depth: Depth, options: PartsOptions): PartLine[] {
  if (!tower.width || tower.backbone === 'none' || floors === 0) return []
  // A stand-in Row of the same height, one Unit wide, just to ask which pieces cover it.
  const heights: Height[] = tower.width === 'XL' ? Array(floors).fill('1F') : [...Array(Math.floor(floors / 2)).fill('2F'), ...(floors % 2 ? ['1F' as const] : [])]
  const units = heights.map((height) => ({ kind: 'drawer' as const, width: tower.width!, baseplate: 'none' as const, gearedRails: false, key: 'normal' as const, height }))
  const stand = {
    width: tower.width, depth, rows: [{ columns: [{ width: tower.width, units }] }], roof: 'none' as const, bottom: 'none' as const,
    backbone: tower.backbone, pegboard: tower.pegboard,
  }
  try {
    return partsForTower(stand, options).filter((l) => /\/(backbone|pegboard attachment)\//i.test(l.path) && !/lock|knob/i.test(l.path))
  } catch {
    return []
  }
}

/** Where a Part is drawn when the view is pulled apart by `t` (0 assembled, 1 fully apart). */
export function explodedCenter(part: ScenePart, t: number, focusUnitId?: string): Vec3 {
  if (focusUnitId) {
    // Only the chosen Unit comes apart; everything else stays put.
    return part.unitId === focusUnitId ? add(part.center, scale(part.partSpread, t)) : part.center
  }
  return add(part.center, scale(add(part.groupSpread, part.partSpread), t))
}

const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k]

/**
 * Open spaces in an unfinished Tower, drawn as faint outlines: Empty space under a Unit, the space above a
 * Column shorter than its Row, and the side of a Row still waiting for its other Column.
 */
export function emptySpaces(tower: EditorTower, depth: Depth): { readonly center: Vec3; readonly size: Vec3 }[] {
  const width = tower.width
  if (!width) return []
  const d = moduleDepthMm(depth)
  const out: { center: Vec3; size: Vec3 }[] = []
  const space = (x0: number, w: number, y0: number, floors: number) => {
    if (floors > 0) out.push({ center: [x0 + w / 2, y0 + (floors * FLOOR_PITCH_MM) / 2, 0], size: [w, floors * FLOOR_PITCH_MM, d] })
  }
  let rowBottom = 0
  for (const row of tower.rows) {
    const floors = rowFloors(row)
    const widths = row.columns.map((c) => c.width)
    const sides = columnSides(width, widths, row.soloSide)
    row.columns.forEach((column, ci) => {
      const w = MODULE_WIDTH_MM[column.width]
      const starts = unitStarts(column.units)
      column.units.forEach((u, ui) => space(sides[ci], w, rowBottom + (starts[ui] - (u.gapBelow ?? 0)) * FLOOR_PITCH_MM, u.gapBelow ?? 0))
      const used = column.units.length ? starts.at(-1)! + floorsOf(column.units.at(-1)!.height) : 0
      space(sides[ci], w, rowBottom + used * FLOOR_PITCH_MM, floors - used)
    })
    const usedW = widths.reduce((s, w) => s + MODULE_WIDTH_MM[w], 0)
    const missing = MODULE_WIDTH_MM[width] - usedW
    if (missing > 1) space(row.soloSide === 'right' ? -MODULE_WIDTH_MM[width] / 2 : MODULE_WIDTH_MM[width] / 2 - missing, missing, rowBottom, floors)
    rowBottom += floors * FLOOR_PITCH_MM
  }
  return out
}
