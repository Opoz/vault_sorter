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
import type { Catalog, Point } from '../engine/catalog'
import { MODULE_WIDTH_MM, moduleDepthMm, FLOOR_PITCH_MM, minAreaRect } from '../engine/dimensions'
import { FLOORS, type Depth, type Height, type Width } from '../engine/model'
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
  /**
   * How the file is turned from the way it's stored (its print orientation) to how it sits: world x (right),
   * y (up) and z (front) are the file's axes axes[0], axes[1] and axes[2], e.g. '-y' for up means the file's −y
   * side faces up.
   */
  readonly axes: Axes
  /** Where the turn and place were checked against the manual (with the user); absent while they're inferred. */
  readonly checked?: string
  /** Which loose piece of the file this is, for files holding several (a pair of springs); absent for the whole file. */
  readonly piece?: number
  /**
   * For a file stored turned on the bed (most roofs, the L and XL modules): degrees about the file's z that square
   * it up, applied before `axes`. Absent for files stored square.
   */
  readonly planDeg?: number
}

/** A file axis and its direction. */
export type Axis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z'
/** The file axis for world right, up and front. */
export type Axes = readonly [Axis, Axis, Axis]
const AXIS: readonly Axis[] = ['+x', '+y', '+z']
const STORED: Axes = ['+x', '+y', '+z']
/** Swaps of the stored axes (directions not yet known), by file axis number. */
const along = (a: number, b: number, c: number): Axes => [AXIS[a], AXIS[b], AXIS[c]]
/** The same file axis, the other way. */
const neg = (a: Axis): Axis => ((a[0] === '+' ? '-' : '+') + a[1]) as Axis
/** The file's axes from longest to shortest. */
const rankAxes = (s: Vec3): Axes => {
  const [a, b, c] = [0, 1, 2].sort((i, j) => s[j] - s[i])
  return along(a, b, c)
}

/**
 * The turn for `axes` as a 3×3 matrix, row by row (world from file). An assignment that would mirror the part
 * (a printed part can only be turned) has its last row flipped to keep it a true turn.
 */
export function turnMatrix(axes: Axes): number[] {
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  axes.forEach((a, row) => { m[row * 3 + 'xyz'.indexOf(a[1])] = a[0] === '-' ? -1 : 1 })
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  if (det < 0) for (let k = 6; k < 9; k++) m[k] = -m[k]
  return m
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
          placeLine(line, (n) => unitPart(line.path, frame, n, unit, measure), groupSpread, unit.id, parts, options.catalog.get(line.path).outline, unit.id)
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
    placeLine(line, (n) => towerPart(line.path, towerFrame, n, line.qty, roofT, measure, options.catalog), groupSpread, 'tower', parts, options.catalog.get(line.path).outline)
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
          groupSpread: [0, (y + h / 2) * UNIT_LIFT, -60], partSpread: [0, 0, pegboard ? -120 : -50], axes: STORED,
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

function placeLine(
  line: PartLine, place: (n: number) => Placement | Placement[], groupSpread: Vec3, owner: string, out: ScenePart[], outline: readonly Point[], unitId?: string,
) {
  for (let n = 0; n < line.qty; n++) {
    const placed = place(n)
    // A file holding several loose pieces is placed piece by piece.
    const pieces = Array.isArray(placed) ? placed : [placed]
    pieces.forEach((p, i) => out.push({
      key: `${owner}:${line.path}:${n}${Array.isArray(placed) ? `:${i}` : ''}`, path: line.path, role: line.role, unitId,
      center: p.center, size: p.size, groupSpread, partSpread: p.spread, axes: p.axes ?? STORED,
      ...(p.checked ? { checked: p.checked } : {}),
      ...(Array.isArray(placed) ? { piece: i } : {}),
      ...(() => {
        const deg = planTurn(outline, storedFootprint(p.size, p.axes ?? STORED))
        return deg ? { planDeg: deg } : {}
      })(),
    }))
  }
}

interface Placement { readonly center: Vec3; readonly size: Vec3; readonly spread: Vec3; readonly axes?: Axes; readonly checked?: string }

const name = (path: string) => path.split('/').pop()!.toLowerCase().replace(/\.stl$/, '')
/** Sizes sorted largest first. */
const ranked = (s: Vec3) => [...s].sort((a, b) => b - a) as unknown as Vec3
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
/** How far right of a Facade's middle its outer capped bolt hole is, for widths with four bolts (measured). */
const OUTER_BOLT: Partial<Record<Width, number>> = { M: 92, L: 130, XL: 170 }
/** Sustainer poses read from the files, matched to the pictures and confirmed by the user (no assembly manual). */
const SUSTAINER_CHECK = 'Instructions Manual pp12 and 17, with the user'
/** Widths whose Modules hold two latches. */
const TWO_LATCHES: ReadonlySet<Width> = new Set(['L', 'XL'])

/** Copy n of 2 goes on the left (−1), the other on the right (+1). */
const sideOf = (n: number) => (n % 2 === 0 ? -1 : 1)
/** Which half of a split part this is: Part 1 at the front, Part 2 behind; 0 when it's whole. */
const half = (file: string) => (/part 1\b/.test(file) ? 1 : /part 2\b/.test(file) ? -1 : 0)

/** A box with its bottom at y0, centred on cx and cz. */
const sitting = (cx: number, y0: number, cz: number, size: Vec3): Vec3 => [cx, y0 + size[1] / 2, cz]

/** Where one copy of a Unit's part goes, in the Unit's frame. */
function unitPart(path: string, f: Frame, n: number, unit: EditorStackedUnit, measure: (p: string) => Vec3): Placement | Placement[] {
  const file = name(path)
  const [sx, sy, sz] = measure(path)
  const cx = f.x0 + f.w / 2
  const front = f.d / 2
  const out = f.d * 0.75 // how far a Box pulls out

  if (unit.kind === 'drawer') {
    // Box sizes are stored upright: [width, depth, height]. Facades lie on their back: [width, height, thickness].
    // XL Boxes are narrower for their thicker runners (377.7 mm in an XL Module, measured).
    const boxW = f.w - (unit.width === 'XL' ? 41.1 : 30.6)
    const boxH = f.h - 10.5
    const boxBottom = f.y0 + (f.h - boxH) / 2
    const boxSpread: Vec3 = [0, 0, out]
    // Stored upside down, front facing +z: the "S3" mark and "align to connect" are on the file's −y side, which
    // is the top (Drawer Assembly pp7–8), and the +z end is open.
    if (/\bmodule\b/.test(file)) return { center: sitting(cx, f.y0, 0, [f.w, f.h, f.d]), size: [f.w, f.h, f.d], spread: [0, 0, 0], axes: ['-x', '-y', '+z'], checked: 'Drawer Assembly p8, step 11' }
    if (/\bbox\b/.test(file)) {
      const h = half(file)
      const d = h === 0 ? f.d - 2.3 : (f.d - 2.3) / 2
      const z = front - (h === -1 ? (f.d - 2.3) * 0.75 : h === 1 ? d / 2 : d / 2)
      if (unit.width === 'XL') {
        // XL Boxes are open at the back (a Back Panel closes them) and print standing on end, turned on the bed:
        // the front wall with the key notch down (the file's −z) and the floor on the file's +x once squared up.
        // A split XL7 Box's Part 2 stands on its closed back wall instead, floor on −x (measured; inferred turn).
        const axes: Axes = h === -1 ? ['-y', '+x', '+z'] : ['-y', '-x', '-z']
        return { center: sitting(cx, boxBottom, z, [boxW, boxH, d]), size: [boxW, boxH, d], spread: add(boxSpread, [0, 0, h * 15]), axes }
      }
      // Printed open side up; the end with the facade's two bolt holes and the lock notch is the file's +y.
      return { center: sitting(cx, boxBottom, z, [boxW, boxH, d]), size: [boxW, boxH, d], spread: add(boxSpread, [0, 0, h * 15]), axes: ['-x', '+z', '+y'], checked: 'Drawer Assembly p6, step 8' }
    }
    if (/back panel/.test(file)) {
      return { center: sitting(cx, boxBottom, front - f.d + 4, [boxW, boxH, 3]), size: [boxW, boxH, 3], spread: add(boxSpread, [0, 0, -30]), axes: rankAxes([sx, sy, sz]) }
    }
    if (/baseplate/.test(file) && unit.width === 'XL') {
      // XL baseplates print standing on edge, turned on the bed, like the XL Boxes: flat underside on the file's −x
      // once squared up, the Gridfinity pockets toward +x; taken to have the front end down (−z). A split XL7's
      // Part 2 lies the other way up, flipped end for end like its Box (measured; inferred turn).
      const h = half(file)
      const size: Vec3 = [boxW - 9.3, 26.2, sz]
      const z = h === -1 ? front - f.d + 2 + sz / 2 : h === 1 ? front - 2 - sz / 2 : front - 2 - sz / 2
      const axes: Axes = h === -1 ? ['+y', '-x', '+z'] : ['+y', '+x', '-z']
      return { center: sitting(cx, boxBottom + 2, z, size), size, spread: add(boxSpread, [0, boxH + 25, 0]), axes }
    }
    if (/baseplate/.test(file)) {
      const h = half(file)
      const size: Vec3 = [sx, Math.min(sz, 4), h === 0 ? sy : sy]
      const z = h === 0 ? front - f.d / 2 : front - f.d / 2 + h * (sy / 2)
      return { center: sitting(cx, boxBottom + 2, z, size), size, spread: add(boxSpread, [0, boxH + 25, 0]), axes: along(0, 2, 1) }
    }
    // Facades lie face up (+z), upside down: seen from the front, the label recess is on the left and the cap's
    // hole on the right (Drawer Assembly p6, step 8). The key, label and caps are on the bottom floor whatever the
    // height, 23.5 mm up from the Facade's bottom (measured on S1F, S2F and S4F; the user).
    const facadeT = 10
    const lowY = f.y0 + f.h / FLOORS[unit.height] / 2
    if (/facade cap/.test(file)) {
      // Caps fill the bolt holes the label doesn't cover: on an S the one right of the key; wider Facades have
      // four bolts, so one left of the key and two right of it, the outer one this far from the middle (measured
      // on the M1F, L1F and XL facades; three caps as on Instructions Manual p18's M drawer). A 2F or 4F Facade
      // has two more holes on its top floor, each capped (the user): the inner pair on an S, the outer pair on
      // the wider ones (measured on S2F, M2F, L2F and L4F).
      const outer = OUTER_BOLT[unit.width]
      const bottom = outer === undefined ? [51] : [51, -51, outer]
      const topY = f.y0 + f.h - f.h / FLOORS[unit.height] / 2
      const at: [number, number] = n < bottom.length ? [bottom[n], lowY] : [sideOf(n - bottom.length) * (outer ?? 51), topY]
      return { ...small(path, [cx + at[0], at[1], front + facadeT], add(boxSpread, [0, 0, 80]), measure), checked: 'Drawer Assembly p6, step 8; Instructions Manual p18; the user' }
    }
    if (/\/facades\/|xl facade/i.test(path)) {
      return { center: [cx, f.y0 + f.h / 2, front + sz / 2], size: [sx, sy, sz], spread: add(boxSpread, [0, 0, 40]), axes: ['-x', '-y', '+z'], checked: 'Drawer Assembly p6, step 8' }
    }
    // The label slides into the recess on the left, its printed face (the file's +z) out (Drawer Assembly p5–6),
    // half-turned so its rounded end faces the key (the user).
    if (/^label$/.test(file)) {
      // The recess is 2 mm deep, as thick as the label, so it sits flush with the face, its middle 25.9 mm in from
      // the Facade's left end on every width (measured on the S1F, M1F, L1F and XL facades).
      return { ...flat(path, [cx - (f.w / 2 - 25.9), lowY, front + facadeT - 1], add(boxSpread, [0, 0, 70]), measure), axes: ['-x', '-y', '+z'], checked: 'Drawer Assembly pp5–6' }
    }
    // The key goes in from the back of the Facade, its knob (the file's +z) through to the front and its gear
    // behind; the cap presses onto the knob, open side (its +z) inward (Drawer Assembly p1). Both are half-turned
    // so the pin holes are on the right (the user, against p1 and p6). The knob stands about 15 mm proud.
    const faceZ = front + facadeT
    const midY = lowY
    if (/^key cap/.test(file)) {
      return { center: [cx, midY, faceZ + 15 - sz / 2 + 2], size: [sx, sy, sz], spread: add(boxSpread, [0, 0, 110]), axes: ['-x', '+y', '-z'], checked: 'Drawer Assembly p1, step 2' }
    }
    if (/^key/.test(file)) {
      return { center: [cx, midY, faceZ + 15 - sz / 2], size: [sx, sy, sz], spread: add(boxSpread, [0, 0, 85]), axes: ['-x', '-y', '+z'], checked: 'Drawer Assembly p1, step 1' }
    }
    if (/hidden key/.test(file)) {
      // Not shown in the manual's pictures: taken to sit like the normal key (inferred).
      const part2 = /part 2/.test(file)
      return { center: [cx, midY, faceZ + (part2 ? 4 : 10) - sz / 2], size: [sx, sy, sz], spread: add(boxSpread, [0, 0, part2 ? 110 : 85]), axes: STORED }
    }
    // The latch clips into the pocket under the Module, 10–66 mm from its back whatever the depth: arms across,
    // stem front to back with its ring at the back (Drawer Assembly p8, step 12). S and M Modules have one pocket in
    // the middle; L and XL have two, a quarter of the width either side of it (measured on L4, L4² and XL4).
    if (/latch/.test(file)) {
      const size: Vec3 = [sx, sz, sy]
      const x = TWO_LATCHES.has(unit.width) ? cx + sideOf(n) * (f.w / 4) : cx
      return { center: [x, f.y0 + 1, -f.d / 2 + 38], size, spread: [0, -40, 0], axes: ['+x', '-z', '+y'], checked: 'Drawer Assembly p8, step 12' }
    }
    // The springs lie flat on the back of the Facade, one each side of the key's gear (Drawer Assembly p2). The
    // file holds both, one above the other, so each is placed as its own piece: flat side (the file's −z, printed
    // on the bed) away from the Facade ("flat side up"), and the end with the file's +x outward, toward the
    // Facade's bolt posts (the user).
    if (/springs/.test(file)) {
      const size: Vec3 = [sx, sy / 2, sz]
      const spring = (side: 1 | -1): Placement => ({
        center: [cx + side * 38, midY, front - sz / 2], size, spread: add(boxSpread, [side * 15, 0, 20]),
        axes: side > 0 ? ['+x', '+y', '+z'] : ['-x', '-y', '+z'], checked: 'Drawer Assembly p2, step 3',
      })
      return [spring(1), spring(-1)]
    }
    // Runners ride in the channel low on each side of the Box, centred on its first floor: the slide in the Box's
    // channel, the guide over it (Drawer Assembly pp4 and 7). Box, slides and guides go into the Module together,
    // so they come apart together.
    const runnerY = boxBottom + 37.5 / 2
    if (/runner guide/.test(file)) {
      // The guide's plain, slotted side faces out; its channel opens toward the front (the file's +y), where the
      // slide comes out. The right one is the left one turned over.
      const size: Vec3 = [sz, sx, sy]
      const x = cx + sideOf(n) * (f.w / 2 - 2 - sz / 2)
      return {
        center: [x, runnerY, front - sy / 2 - 1], size, spread: add(boxSpread, [sideOf(n) * 45, 0, 0]),
        axes: sideOf(n) < 0 ? ['+z', '+x', '+y'] : ['-z', '-x', '+y'], checked: 'Drawer Assembly p7, step 9',
      }
    }
    if (/runner slide/.test(file)) {
      // The slide's notched end (the file's −y end) is at the back (the user, against Drawer Assembly p4).
      const size: Vec3 = [sz, sx, sy]
      // XL slides are wedges, thickening toward the back by about 2° (12.5 mm at the front, up to 22.8 mm at the
      // back on x7; measured), so their flat outer face is set by the thin front end, not the full thickness
      // (inferred).
      const thick = unit.width === 'XL' ? 12.5 : sz
      const x = cx + sideOf(n) * (boxW / 2 + thick - sz / 2)
      return {
        center: [x, runnerY, front - sy / 2 - 6], size, spread: add(boxSpread, [sideOf(n) * 22, 0, 0]),
        axes: sideOf(n) < 0 ? ['+z', '+x', '+y'] : ['-z', '-x', '+y'], checked: 'Drawer Assembly p4, step 6',
      }
    }
    if (/runner stopper/.test(file)) {
      // Pushed into the slot in each side of the Module once the Box is in (Drawer Assembly p8). The slot's centre
      // is 28.5 mm in front of the Module's middle at every depth and width (measured on S3–S7, M5 and L4).
      // Taller Modules have a slot per floor; a single Box's stoppers are taken to use the lowest, level with its
      // runners (inferred).
      // Its length (17.9 mm) runs front to back along the slot, with the file's middle-length side facing into
      // the Module (the user, against Drawer Assembly p8). The right one is the left one turned round.
      const st = measure(path)
      const [a, b, c] = ranked(st)
      const r = rankAxes(st)
      return {
        center: [cx + sideOf(n) * (f.w / 2 + 1), runnerY, 28.5], size: [b, c, a], spread: [sideOf(n) * 45, 0, 0],
        axes: sideOf(n) < 0 ? [r[1], neg(r[2]), r[0]] : [neg(r[1]), neg(r[2]), neg(r[0])], checked: 'Drawer Assembly p8, step 11',
      }
    }
    if (/rails/.test(file)) {
      // Geared rails run side to side in the Box's front notch, behind the Facade, one under and one over the key's
      // gear: teeth toward the gear (Drawer Assembly p4, step 5). Each goes in from a side, plain end first, so the
      // plain ends sit inside the Box pointing opposite ways and nothing sticks out past its sides (the user). The
      // file holds the pair; they differ only in their end detail, so they're spaced by the 4.8 mm bar.
      const gearR = 16
      const bar = 4.8
      const rail = (piece: 0 | 1): Placement => {
        const under = piece === 0
        return {
          center: [cx + (under ? -5 : 5), midY + (under ? -1 : 1) * (gearR + bar / 2), front - sz / 2], size: [sx, sy / 2, sz],
          spread: add(boxSpread, [0, under ? -15 : 15, 0]),
          axes: under ? ['+x', '+y', '+z'] : ['-x', '-y', '+z'], checked: 'Drawer Assembly p4, step 5',
        }
      }
      return [rail(0), rail(1)]
    }
  } else {
    // Sustainers: a Module open at the top, a lid (the Roof file) hinged at its back, a Facade on the front, hinges
    // at the back and locks at the front (Instructions Manual pp12 and 17; there's no assembly manual for them, so
    // the turns below are read from the files and those two pictures, inferred).
    // The Module is stored like a drawer's: upside down, its closed back wall on the file's −z, open front on +z.
    // Module heights are the same at every width and depth (measured on S3, M5 and L4).
    const moduleH = { '1F': 50.8, '2F': 84.8, '4F': 180.8 }[unit.height]
    const top = f.y0 + moduleH
    const lidSpread: Vec3 = [0, 70, 0]
    const facadeT = 10
    if (/\bmodule\b/.test(file)) return { center: sitting(cx, f.y0, 0, [f.w, sy, f.d]), size: [f.w, sy, f.d], spread: [0, 0, 0], axes: ['-x', '-y', '+z'], checked: SUSTAINER_CHECK }
    if (/\broof\b/.test(file)) {
      // The lid stands on end on the bed, turned: its top on the file's +x once squared up, its hollow underside
      // on −x, the corner bosses for the hinges at the back (−z) and the tab the lock catches at the front (+z).
      // It reaches over the Facade (198.1 = 188.1 + 10 on S4), its rim on the Module's top edge with the bosses
      // 8 mm lower. Split lids: Part 1 at the front, Part 2 behind, taken to be stored the same way.
      const h = half(file)
      const lidT = 27.9
      const z = h === -1 ? -f.d / 2 + sz / 2 : front + facadeT - sz / 2
      return { center: [cx, top + lidT / 2 - 8, z], size: [f.w, lidT, sz], spread: add(lidSpread, [0, 0, h * 15]), axes: ['-y', '+x', '+z'], ...(h === 0 ? { checked: SUSTAINER_CHECK } : {}) }
    }
    if (/connector/.test(file)) return small(path, [cx, top + 20, 0], add(lidSpread, [0, 25, 0]), measure)
    // The Facade is stored face up (+z) and upside down, like a drawer's: its lock recess and the notch for the
    // lock's hook are at the file's −y end, which is the top. It's set flush with the Module's top.
    const facadeTop = top
    if (/facade/.test(file)) {
      return { center: [cx, facadeTop - sy / 2, front + sz / 2], size: [sx, sy, sz], spread: [0, 0, 45], axes: ['-x', '-y', '+z'], checked: SUSTAINER_CHECK }
    }
    if (/label/.test(file)) {
      // In the Facade's 2 mm recess, 24.9 mm in from its left end: at the top of a 1F Facade, below the lock on
      // taller ones (measured on S1F, S2F and S4F).
      const down = { '1F': 10, '2F': 44, '4F': 48 }[unit.height]
      return { ...flat(path, [cx - (f.w / 2 - 24.9), facadeTop - down, front + facadeT - 1], [0, 0, 80], measure), axes: ['-x', '-y', '+z'], checked: SUSTAINER_CHECK }
    }
    if (/hinge top/.test(file)) return small(path, [cx + sideOf(n) * f.w / 4, f.y0 + f.h + 6, -front + 10], add(lidSpread, [0, 30, -40]), measure)
    if (/hinge/.test(file)) return small(path, [cx + sideOf(n) * f.w / 4, f.y0 + moduleH - 10, -front - 10], [0, 20, -45], measure)
    if (/rods/.test(file)) return small(path, [cx, f.y0 + moduleH - 10, -front - 18], [0, 40, -70], measure)
    const lockX = cx + sideOf(n) * (f.w / 2 - 28)
    const lockY = f.y0 + moduleH - 20
    if (/lock holder/.test(file)) return small(path, [lockX, lockY, front + 4], [0, 0, 30], measure)
    if (/lock inner/.test(file)) return small(path, [lockX, lockY, front + 12], [0, 0, 55], measure)
    if (/lock outer/.test(file)) return small(path, [lockX, lockY, front + 20], [0, 0, 80], measure)
    if (/pins/.test(file)) return small(path, [lockX, lockY + 15, front + 8], [0, 15, 100], measure)
  }
  if (/wall mount second/.test(file)) return small(path, [cx, f.y0 + f.h / 2, -f.d / 2 - 30], [0, 0, -110], measure)
  if (/wall mount/.test(file)) {
    const size: Vec3 = ranked([sx, sy, sz])
    return { center: [cx, f.y0 + f.h / 2, -f.d / 2 - size[2] / 2], size: [size[0], size[1], size[2]], spread: [0, 0, -60], axes: rankAxes([sx, sy, sz]) }
  }
  return loose(path, [cx, f.y0 + f.h, 0], measure)
}

/** A small part: its longest side across, the next up, the shortest front to back. */
function small(path: string, center: Vec3, spread: Vec3, measure: (p: string) => Vec3): Placement {
  const s = measure(path)
  const [a, b, c] = ranked(s)
  return { center, size: [a, b, c], spread, axes: rankAxes(s) }
}

/** A flat part facing forward, like a label: stored lying down as [width, height, thickness]. */
function flat(path: string, center: Vec3, spread: Vec3, measure: (p: string) => Vec3): Placement {
  const [x, y, z] = measure(path)
  return { center, size: [x, y, z], spread }
}

/** A part with no known place: drawn just above where it belongs, so it's still counted and visible. */
function loose(path: string, at: Vec3, measure: (p: string) => Vec3): Placement {
  const s = measure(path)
  const size = ranked(s)
  return { center: [at[0], at[1] + size[1] / 2 + 20, at[2]], size, spread: [0, 60, 0], axes: rankAxes(s) }
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
    const s = measure(path)
    const [a, b, c] = ranked(s)
    const r = rankAxes(s)
    return { center: [cx, top + 40, 0], size: [a, c, b], spread: [0, 120, 0], axes: [r[0], r[2], r[1]] }
  }
  if (/top handle/.test(file)) {
    const s = measure(path)
    const [a, b, c] = ranked(s)
    const x = f.x0 + ((n + 0.5) / qty) * f.w
    return { center: [x, top + roofT + b / 2, 0], size: [a, b, c], spread: [0, 100, 0], axes: rankAxes(s) }
  }
  if (/roof/.test(file)) {
    const t = thick(path)
    return { center: sitting(cx, top, 0, [f.w, t, f.d]), size: [f.w, t, f.d], spread: [0, 0, 0], axes: along(0, 2, 1) }
  }
  if (/\bbase\b/.test(file)) {
    const t = thick(path)
    const h = half(file)
    const d = h === 0 ? f.d : f.d / 2
    return { center: sitting(cx, -t, h * d / 2, [f.w, t, d]), size: [f.w, t, d], spread: [0, 0, h * 20] }
  }
  if (/connector/.test(file)) return small(path, [cx, -10, 0], [0, -40, 0], measure)
  if (/feet/.test(file)) {
    const s = measure(path)
    const [a, b, c] = ranked(s)
    const r = rankAxes(s)
    const z = qty === 1 ? f.d / 2 - c / 2 : (n === 0 ? 1 : -1) * (f.d / 2 - c / 2)
    return { center: [cx, -25 - c / 2, z], size: [a, c, b], spread: [0, -60, 0], axes: [r[0], r[2], r[1]] }
  }
  if (/disk|bushing|tyre|cover/.test(file)) {
    // Two wheels at the back corners, axle across.
    const s = measure(path)
    const [a, , c] = ranked(s)
    const r = rankAxes(s)
    const order = ['tyre', 'disk', 'bushing', 'cover'].findIndex((k) => file.includes(k))
    const x = cx + sideOf(n) * (f.w / 2 + 6 + order * 6)
    return { center: [x, -a / 2 - 10, -f.d / 2 + a / 2], size: [c, a, a], spread: [sideOf(n) * (30 + order * 25), -60, 0], axes: [r[2], r[0], r[1]] }
  }
  if (/stationary handle|pull-out handle\b|pull-out handle$/.test(file)) {
    const s = measure(path)
    const [a, b, c] = ranked(s)
    return { center: [cx, top - b / 2, -f.d / 2 - 33 - c / 2], size: [a, b, c], spread: [0, 40, -80], axes: rankAxes(s) }
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

/** The x and y extents a part's file should have once squared up, from its assembled size and turn. */
function storedFootprint(size: Vec3, axes: Axes): [number, number] {
  const stored = [0, 0, 0]
  axes.forEach((a, world) => { stored['xyz'.indexOf(a[1])] = size[world] })
  return [stored[0], stored[1]]
}

/**
 * The turn (degrees about the file's z) that squares up a file stored at an angle on the bed: the quarter-turn
 * of its outline's tightest rectangle whose footprint best matches `want`, the smaller turn on a tie. 0 for a
 * file stored square. Which way round a symmetric footprint goes (a half-turn) isn't known from the outline.
 */
export function planTurn(outline: readonly Point[], want: readonly [number, number]): number {
  const extents = (deg: number) => {
    const r = (deg * Math.PI) / 180
    const [c, s] = [Math.cos(r), Math.sin(r)]
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity]
    for (const [x, y] of outline) {
      const [rx, ry] = [x * c - y * s, x * s + y * c]
      x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); y0 = Math.min(y0, ry); y1 = Math.max(y1, ry)
    }
    return [x1 - x0, y1 - y0] as const
  }
  // The tightest rectangle has a side along one of the outline's edges.
  let best = { area: Infinity, deg: 0 }
  outline.forEach(([ax, ay], i) => {
    const [bx, by] = outline[(i + 1) % outline.length]
    const deg = (-Math.atan2(by - ay, bx - ax) * 180) / Math.PI
    const [w, h] = extents(deg)
    if (w * h < best.area - 1e-6) best = { area: w * h, deg }
  })
  const [w0, h0] = extents(0)
  // Stored square (or round): leave it.
  if (w0 * h0 <= best.area * 1.03) return 0
  const norm = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
  const options = [0, 90, 180, 270].map((k) => norm(best.deg + k))
  const score = (deg: number) => { const [w, h] = extents(deg); return Math.abs(w - want[0]) + Math.abs(h - want[1]) }
  return options.reduce((a, b) => (score(b) < score(a) - 0.5 || (Math.abs(score(b) - score(a)) <= 0.5 && Math.abs(b) < Math.abs(a)) ? b : a))
}
