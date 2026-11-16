/**
 * Editing a Layout: pure functions that return a new Layout, or the reason a change isn't allowed.
 * The editor keeps ids on Towers, Rows, Columns and Units (for selection and dragging); the engine model doesn't.
 */
import {
  FLOORS, type Baseplate, type Bottom, type Depth, type DrawerUnit, type Height, type RoofType, type SustainerUnit, type Tower,
  type Unit, type Width,
} from '../engine/model'
import { DEFAULT_EDGE_MARGIN_MM, type Density } from '../engine/plates'
import type { Printed } from '../engine/progress'

export interface EditorDrawer extends DrawerUnit { readonly id: string }
export interface EditorSustainer extends SustainerUnit { readonly id: string }
export type EditorUnit = EditorDrawer | EditorSustainer

/**
 * A Unit as placed: with its own Height (GLOSSARY: Column), and any Empty space left under it while planning.
 * A Tower with Empty space isn't finished, so it never reaches the engine.
 */
export type EditorStackedUnit = EditorUnit & { readonly height: Height; readonly gapBelow?: number }

/** One side of a Row: Units of one Width stacked bottom first. A full-width Row is a single Column. */
export interface EditorColumn {
  readonly id: string
  readonly width: Width
  readonly units: readonly EditorStackedUnit[]
}

/** A Row: one Column of the Tower's Width, or two Columns side by side, left first (GLOSSARY: Row). */
export interface EditorRow {
  readonly id: string
  readonly columns: readonly EditorColumn[]
  /** A narrow Column on its own sits on the left unless this says right. */
  readonly soloSide?: 'right'
}

const unitFloors = (u: EditorStackedUnit) => (u.gapBelow ?? 0) + FLOORS[u.height]
/** How high a Column reaches, in floors, counting Empty space under its Units. */
export const columnFloors = (column: EditorColumn) => column.units.reduce((n, u) => n + unitFloors(u), 0)

/** The floor each Unit of a Column starts on (0 is the bottom of the Row). */
export function unitStarts(units: readonly EditorStackedUnit[]): number[] {
  let floor = 0
  return units.map((u) => { const start = floor + (u.gapBelow ?? 0); floor = start + FLOORS[u.height]; return start })
}

/** Put a Unit into a Column with its bottom on a given floor, pushing Units above up only as far as they must go. */
function placeAtFloor(units: readonly EditorStackedUnit[], unit: EditorStackedUnit, floor: number): EditorStackedUnit[] {
  const starts = unitStarts(units)
  const at = starts.findIndex((s) => s >= floor)
  const order = [...units.map((u, i) => ({ u, start: starts[i] }))]
  order.splice(at < 0 ? order.length : at, 0, { u: unit, start: Math.max(0, floor) })
  let top = 0
  return order.map(({ u, start }) => {
    const from = Math.max(start, top)
    const gap = from - top
    top = from + FLOORS[u.height]
    const { gapBelow: _old, ...rest } = u
    return (gap > 0 ? { ...rest, gapBelow: gap } : rest) as EditorStackedUnit
  })
}

/** Take a Unit out of a Column; the Units above drop by its height (its Empty space stays, under the next one). */
function takeOut(units: readonly EditorStackedUnit[], unitId: string): EditorStackedUnit[] {
  const i = units.findIndex((u) => u.id === unitId)
  if (i < 0) return [...units]
  const gone = units[i].gapBelow ?? 0
  const rest = units.filter((_, j) => j !== i)
  if (gone && rest[i]) rest[i] = { ...rest[i], gapBelow: (rest[i].gapBelow ?? 0) + gone }
  return rest
}

/** A Row's height in floors: its tallest Column (a finished Row's Columns are equal). */
export const rowFloors = (row: EditorRow) => Math.max(0, ...row.columns.map(columnFloors))
/** Every Unit in a Row, Column by Column, bottom first. */
export const rowUnits = (row: EditorRow) => row.columns.flatMap((c) => c.units)
/** How many floors each Column of a Row is short of the tallest one (0 when it reaches it). */
export const columnShortfall = (row: EditorRow) => row.columns.map((c) => rowFloors(row) - columnFloors(c))

/** Where a Unit sits in a Tower. */
export function findUnit(tower: EditorTower, unitId: string) {
  for (const [rowIndex, row] of tower.rows.entries()) {
    for (const column of row.columns) {
      const unit = column.units.find((u) => u.id === unitId)
      if (unit) return { row, rowIndex, column, unit }
    }
  }
  return undefined
}

export interface EditorTower {
  readonly id: string
  /** Null until the first Unit is placed. */
  readonly width: Width | null
  /** Null means "use the largest depth that fits the printer". */
  readonly depth: Depth | null
  readonly rows: readonly EditorRow[]
  readonly roof: RoofType
  readonly bottom: Bottom
  readonly backbone: Tower['backbone']
  readonly stationaryHandle?: boolean
  readonly pullOutHandle?: boolean
  readonly pegboard?: 'skadis' | 'ussa'
  readonly wallMount?: boolean
  /** Top Handles on a grid roof; absent means 1. */
  readonly topHandles?: number
  /** How many of each part file have been printed so far (print progress); absent until something is. */
  readonly printed?: Printed
}

/** One colour per Colour role. */
export interface Colours {
  readonly body: string
  readonly accent: string
  readonly secondary: string
}

export interface EditorLayout {
  readonly id: string
  readonly name: string
  readonly towers: readonly EditorTower[]
  readonly splitParts: 'auto' | 'whole' | 'split'
  readonly allowColourMixing: boolean
  /** Gap kept between parts and the plate edge, in mm. */
  readonly plateEdgeMm: number
  /** How close parts sit to each other on a plate. */
  readonly plateDensity: Density
  readonly colours: Colours
  readonly updatedAt: number
}

/** What gets dragged from the palette: a Unit's kind, Width and Height. */
export interface UnitSpec {
  readonly kind: Unit['kind']
  readonly width: Width
  readonly height: Height
}

export type DropTarget =
  | { readonly kind: 'newRow'; readonly index: number }
  /**
   * Start the other Column of a Row: on `side` (by default, wherever the Row's lone Column isn't), with its bottom
   * on `floor` (default 0), leaving Empty space under it.
   */
  | { readonly kind: 'beside'; readonly rowId: string; readonly side?: 'left' | 'right'; readonly floor?: number }
  /**
   * Into a Column's stack: just under the Unit at `index` (0 is the bottom), or with its bottom on `floor` (Empty
   * space under it if that's above the stack), or on top when both are left out.
   */
  | { readonly kind: 'onColumn'; readonly rowId: string; readonly columnId: string; readonly index?: number; readonly floor?: number }

export type OpResult = { readonly ok: true; readonly layout: EditorLayout } | { readonly ok: false; readonly reason: string }

const newId = () => crypto.randomUUID()
const done = (layout: EditorLayout): OpResult => ({ ok: true, layout: { ...layout, updatedAt: Date.now() } })
const refuse = (reason: string): OpResult => ({ ok: false, reason })

// Matches USSA's renders: light grey modules and facades, dark locks, latches and handles. Runners are hidden
// inside, so their default only needs to tell them apart.
export const DEFAULT_COLOURS: Colours = { body: '#D3D5D2', accent: '#8A8F93', secondary: '#2F3236' }

export function newLayout(name: string): EditorLayout {
  return {
    id: newId(), name, towers: [], splitParts: 'auto', allowColourMixing: false,
    plateEdgeMm: DEFAULT_EDGE_MARGIN_MM, plateDensity: 'normal',
    colours: DEFAULT_COLOURS, updatedAt: Date.now(),
  }
}

export function addTower(layout: EditorLayout): OpResult {
  const tower: EditorTower = {
    id: newId(), width: null, depth: null, rows: [], roof: 'grid', bottom: 'none', backbone: 'none',
  }
  return done({ ...layout, towers: [...layout.towers, tower] })
}

export function removeTower(layout: EditorLayout, towerId: string): OpResult {
  return done({ ...layout, towers: layout.towers.filter((t) => t.id !== towerId) })
}

/** Widths that can share a Row, in order, for each Tower Width (Instructions Manual p8). */
const ROW_FILLS: Record<Width, readonly (readonly Width[])[]> = {
  S: [['S']],
  M: [['M']],
  L: [['L'], ['S', 'S']],
  XL: [['XL'], ['S', 'M'], ['M', 'S']],
}

const startsWith = (fill: readonly Width[], prefix: readonly Width[]) => prefix.every((w, i) => fill[i] === w)
const canStart = (towerWidth: Width, widths: readonly Width[]) =>
  ROW_FILLS[towerWidth].some((fill) => fill.length >= widths.length && startsWith(fill, widths))
const isFull = (towerWidth: Width, widths: readonly Width[]) =>
  ROW_FILLS[towerWidth].some((fill) => fill.length === widths.length && startsWith(fill, widths))

function makeUnit(spec: UnitSpec): EditorUnit {
  return spec.kind === 'drawer'
    ? { id: newId(), kind: 'drawer', width: spec.width, baseplate: 'none' as Baseplate, gearedRails: false, key: 'normal' }
    : { id: newId(), kind: 'sustainer', width: spec.width, moduleType: 'flat' }
}

function withTower(layout: EditorLayout, towerId: string, change: (t: EditorTower) => EditorTower | string): OpResult {
  const tower = layout.towers.find((t) => t.id === towerId)
  if (!tower) return refuse('That tower no longer exists')
  const next = change(tower)
  if (typeof next === 'string') return refuse(next)
  return done({ ...layout, towers: layout.towers.map((t) => (t.id === towerId ? next : t)) })
}

/** Drop a new Unit (from the palette) into a Tower. */
export function placeUnit(layout: EditorLayout, towerId: string, target: DropTarget, spec: UnitSpec): OpResult {
  return placeExisting(layout, towerId, target, makeUnit(spec), spec.height)
}

function placeExisting(
  layout: EditorLayout, towerId: string, target: DropTarget, unit: EditorUnit, height: Height,
): OpResult {
  if (unit.width === 'XL' && height !== '1F') return refuse('XL only comes in 1F')
  const placed: EditorStackedUnit = { ...unit, height }
  return withTower(layout, towerId, (tower) => {
    const width = tower.width ?? unit.width
    if (target.kind === 'newRow') {
      if (!canStart(width, [unit.width])) return `An ${unit.width} unit doesn't fit a ${width} tower`
      const row: EditorRow = { id: newId(), columns: [{ id: newId(), width: unit.width, units: [placed] }] }
      const rows = [...tower.rows]
      rows.splice(Math.max(0, Math.min(target.index, rows.length)), 0, row)
      return { ...tower, width, rows }
    }
    const row = tower.rows.find((r) => r.id === target.rowId)
    if (!row) return 'That row no longer exists'
    const widths = row.columns.map((c) => c.width)
    if (target.kind === 'beside') {
      if (row.columns.length !== 1 || isFull(width, widths)) return 'That row is already full'
      const side = target.side ?? (row.soloSide === 'right' ? 'left' : 'right')
      const order = side === 'left' ? [unit.width, widths[0]] : [widths[0], unit.width]
      if (!isFull(width, order)) return `There's no room for an ${unit.width} unit in that row`
      const column: EditorColumn = { id: newId(), width: unit.width, units: placeAtFloor([], placed, target.floor ?? 0) }
      const columns = side === 'left' ? [column, row.columns[0]] : [row.columns[0], column]
      return { ...tower, rows: tower.rows.map((r) => (r.id === row.id ? { id: r.id, columns } : r)) }
    }
    const column = row.columns.find((c) => c.id === target.columnId)
    if (!column) return 'That column no longer exists'
    if (column.width !== unit.width) return `Only ${column.width} units stack in that column`
    return {
      ...tower,
      rows: tower.rows.map((r) => (r.id !== row.id ? r : {
        ...r, columns: r.columns.map((c) => (c.id === column.id ? { ...c, units: intoColumn(c.units, placed, target) } : c)),
      })),
    }
  })
}

/** Where an onColumn drop puts a Unit: under the Unit at `index`, on `floor`, or on top. */
function intoColumn(units: readonly EditorStackedUnit[], unit: EditorStackedUnit, target: { index?: number; floor?: number }) {
  if (target.floor !== undefined) return placeAtFloor(units, unit, target.floor)
  if (target.index !== undefined && target.index < units.length) return placeAtFloor(units, unit, unitStarts(units)[Math.max(0, target.index)])
  return [...units, unit]
}

/** A Row without a Unit. An emptied Column goes; if that was the left one, the other stays on the right. */
const withoutUnit = (unitId: string) => (row: EditorRow): EditorRow => {
  const columns = row.columns.map((c) => ({ ...c, units: takeOut(c.units, unitId) }))
  const kept = columns.filter((c) => c.units.length > 0)
  if (kept.length === columns.length) return { ...row, columns }
  const soloSide = row.columns.length === 2 ? (columns[0].units.length === 0 ? 'right' : undefined) : row.soloSide
  return soloSide ? { id: row.id, columns: kept, soloSide } : { id: row.id, columns: kept }
}

/** Take a Unit out. Its Column and Row go when they empty; an emptied Tower forgets its Width. */
export function removeUnit(layout: EditorLayout, towerId: string, unitId: string): OpResult {
  return withTower(layout, towerId, (tower) => {
    const rows = tower.rows.map(withoutUnit(unitId)).filter((r) => r.columns.length > 0)
    return { ...tower, rows, width: rows.length ? tower.width : null, depth: rows.length ? tower.depth : null }
  })
}

/**
 * Copy a placed Unit, with its settings: beside it when its Row has room, on top of it when its Column is the
 * shorter one, otherwise in a new Row directly above.
 */
export function duplicateUnit(layout: EditorLayout, towerId: string, unitId: string): OpResult {
  const tower = layout.towers.find((t) => t.id === towerId)
  const found = tower && findUnit(tower, unitId)
  if (!tower || !found) return refuse('That unit no longer exists')
  const { row, rowIndex, column, unit } = found
  const { id: _id, height, ...settings } = unit
  const copy = { ...settings, id: newId() } as EditorUnit
  const beside = placeExisting(layout, towerId, { kind: 'beside', rowId: row.id }, copy, height)
  if (beside.ok) return beside
  // A column of the same width that's short by at least the copy's height: its own first, then the other.
  const short = columnShortfall(row)
  const target = [column, ...row.columns.filter((c) => c.id !== column.id)]
    .find((c) => c.width === unit.width && short[row.columns.indexOf(c)] >= FLOORS[height])
  if (target) return placeExisting(layout, towerId, { kind: 'onColumn', rowId: row.id, columnId: target.id }, copy, height)
  return placeExisting(layout, towerId, { kind: 'newRow', index: rowIndex + 1 }, copy, height)
}

/** A copy of a Unit, with its settings, on top of a chosen Column. */
export function copyUnitOnto(layout: EditorLayout, towerId: string, unitId: string, rowId: string, columnId: string): OpResult {
  const tower = layout.towers.find((t) => t.id === towerId)
  const found = tower && findUnit(tower, unitId)
  if (!found) return refuse('That unit no longer exists')
  const { id: _id, height, ...settings } = found.unit
  return placeExisting(layout, towerId, { kind: 'onColumn', rowId, columnId }, { ...settings, id: newId() } as EditorUnit, height)
}

/** A copy of a whole Column, every Unit with its settings, as the other Column of its Row. */
export function duplicateColumn(layout: EditorLayout, towerId: string, rowId: string, columnId: string): OpResult {
  return withTower(layout, towerId, (tower) => {
    const row = tower.rows.find((r) => r.id === rowId)
    const column = row?.columns.find((c) => c.id === columnId)
    if (!row || !column) return 'That column no longer exists'
    const width = tower.width ?? column.width
    const widths = row.columns.map((c) => c.width)
    if (row.columns.length !== 1 || !isFull(width, [...widths, column.width])) return `There's no room for another ${column.width} column in that row`
    const copy: EditorColumn = { id: newId(), width: column.width, units: column.units.map((u) => ({ ...u, id: newId() })) }
    const columns = row.soloSide === 'right' ? [copy, column] : [column, copy]
    return { ...tower, rows: tower.rows.map((r) => (r.id === row.id ? { id: r.id, columns } : r)) }
  })
}

/** Move a placed Unit, within its Tower or into another one. */
export function moveUnit(
  layout: EditorLayout, fromTowerId: string, unitId: string, toTowerId: string, target: DropTarget,
): OpResult {
  const from = layout.towers.find((t) => t.id === fromTowerId)
  const found = from && findUnit(from, unitId)
  if (!from || !found) return refuse('That unit no longer exists')
  const { row, rowIndex, column, unit } = found
  // Within its own Column: rearrange the Column in place (it mustn't vanish when this was its only Unit).
  if (fromTowerId === toTowerId && target.kind === 'onColumn' && target.columnId === column.id) {
    const from = column.units.findIndex((u) => u.id === unitId)
    const to = target.index ?? column.units.length
    // Dropped on a join just above or below itself: nothing moves.
    if (target.floor === undefined && (to === from || to === from + 1)) return done(layout)
    const rest = takeOut(column.units, unitId)
    // Joins were counted before the move: those above it shift down one.
    const index = target.index !== undefined && target.index > from ? target.index - 1 : target.index
    const units = intoColumn(rest, unit, { index, floor: target.floor })
    return withTower(layout, toTowerId, (tower) => ({
      ...tower,
      rows: tower.rows.map((r) => (r.id !== row.id ? r : { ...r, columns: r.columns.map((c) => (c.id === column.id ? { ...c, units } : c)) })),
    }))
  }
  // A lone Unit in a lone Column dropped on the Row's other side: the Column moves across.
  if (fromTowerId === toTowerId && target.kind === 'beside' && target.rowId === row.id && row.columns.length === 1 && column.units.length === 1) {
    const side = target.side ?? (row.soloSide === 'right' ? 'left' : 'right')
    const units = placeAtFloor([], unit, target.floor ?? 0)
    return withTower(layout, toTowerId, (tower) => ({
      ...tower,
      rows: tower.rows.map((r) => (r.id !== row.id ? r : side === 'right'
        ? { id: r.id, columns: [{ ...column, units }], soloSide: 'right' as const }
        : { id: r.id, columns: [{ ...column, units }] })),
    }))
  }
  const removed = removeUnit(layout, fromTowerId, unitId)
  if (!removed.ok) return removed
  // If the unit was alone in its row, that row is gone: keep the drop position stable.
  let adjusted = target
  if (target.kind === 'newRow' && fromTowerId === toTowerId && rowUnits(row).length === 1 && rowIndex < target.index) {
    adjusted = { kind: 'newRow', index: target.index - 1 }
  }
  const { id, height, gapBelow: _gap, ...settings } = unit
  return placeExisting(removed.layout, toTowerId, adjusted, { ...settings, id } as EditorUnit, height)
}

export function moveRow(layout: EditorLayout, towerId: string, from: number, to: number): OpResult {
  return withTower(layout, towerId, (tower) => {
    if (from < 0 || from >= tower.rows.length) return 'That row no longer exists'
    const rows = [...tower.rows]
    const [row] = rows.splice(from, 1)
    rows.splice(Math.max(0, Math.min(to, rows.length)), 0, row)
    return { ...tower, rows }
  })
}

export function setTowerWidth(layout: EditorLayout, towerId: string, width: Width): OpResult {
  return withTower(layout, towerId, (tower) => {
    const blocked = tower.rows.findIndex((r) => !canStart(width, r.columns.map((c) => c.width)))
    if (blocked >= 0) return `Row ${blocked + 1} is too wide for an ${width} tower`
    if (width === 'XL' && tower.rows.some((r) => r.columns.length === 1 && rowFloors(r) !== 1)) return 'XL towers only take 1F rows'
    return { ...tower, width }
  })
}

export type TowerPatch = Partial<Pick<EditorTower,
  'depth' | 'roof' | 'bottom' | 'backbone' | 'stationaryHandle' | 'pullOutHandle' | 'pegboard' | 'wallMount' | 'topHandles'>>

/**
 * Change a Tower's settings. Settings the change rules out are cleared rather than refused, so picking an option
 * always works: an under-table tower loses its base, a wall-mounted one its backbone and base, and handles and
 * pegboard go with the backbone they fix to.
 */
export function updateTower(layout: EditorLayout, towerId: string, patch: TowerPatch): OpResult {
  return withTower(layout, towerId, (tower) => {
    let next: EditorTower = { ...tower, ...patch }
    // Whichever way of hanging the tower was just chosen wins.
    if (patch.wallMount && next.roof === 'under table mount') next = { ...next, roof: 'grid' }
    if (patch.roof === 'under table mount') next = { ...next, wallMount: false }
    if (next.roof === 'under table mount' || next.wallMount) next = { ...next, bottom: 'none' }
    if (next.wallMount) next = { ...next, backbone: 'none' }
    if (next.backbone === 'none') next = { ...next, stationaryHandle: false, pullOutHandle: false, pegboard: undefined }
    return next
  })
}

/** Add (or, with negative numbers, take away) printed parts for a Tower. Counts never go below zero. */
export function changePrinted(layout: EditorLayout, towerId: string, delta: Readonly<Record<string, number>>): OpResult {
  return withTower(layout, towerId, (tower) => {
    const printed: Record<string, number> = { ...tower.printed }
    for (const [path, d] of Object.entries(delta)) {
      const n = Math.max(0, (printed[path] ?? 0) + d)
      if (n > 0) printed[path] = n
      else delete printed[path]
    }
    return { ...tower, printed }
  })
}

export type UnitPatch =
  | Partial<Pick<EditorDrawer, 'baseplate' | 'gearedRails' | 'key'>>
  | Partial<Pick<EditorSustainer, 'moduleType'>>

export function updateUnit(layout: EditorLayout, towerId: string, unitId: string, patch: UnitPatch): OpResult {
  return withTower(layout, towerId, (tower) => ({
    ...tower,
    rows: tower.rows.map((r) => ({
      ...r,
      columns: r.columns.map((c) => ({
        ...c,
        units: c.units.map((u) => (u.id === unitId ? ({ ...u, ...patch } as EditorStackedUnit) : u)),
      })),
    })),
  }))
}

export function updateLayout(
  layout: EditorLayout,
  patch: Partial<Pick<EditorLayout, 'name' | 'splitParts' | 'allowColourMixing' | 'colours' | 'plateEdgeMm' | 'plateDensity'>>,
): OpResult {
  return done({ ...layout, ...patch })
}

/** The Width a Row still needs to fill its Tower, or null when it is full or can't be filled. */
export function missingWidth(towerWidth: Width, row: EditorRow): Width | null {
  const widths = row.columns.map((c) => c.width)
  if (isFull(towerWidth, widths)) return null
  return ROW_FILLS[towerWidth].find((f) => f.length > widths.length && startsWith(f, widths))?.[widths.length] ?? null
}

/**
 * Rows that aren't complete yet: a single S in an L tower, or Columns that don't reach the same height yet. Not
 * errors: the tower is still being built.
 */
export function rowProblems(tower: EditorTower): { rowIndex: number; problem: string }[] {
  if (!tower.width) return []
  const width = tower.width
  return tower.rows.flatMap((row, rowIndex) => {
    const widths = row.columns.map((c) => c.width)
    if (!isFull(width, widths)) {
      const right = row.soloSide === 'right'
      const fill = ROW_FILLS[width].find((f) => f.length === 2 && f[right ? 1 : 0] === widths[0])
      const next = fill && widths.length === 1 ? fill[right ? 0 : 1] : undefined
      return [{ rowIndex, problem: next ? `Needs another ${next} unit to fill the ${width} width` : 'Does not fit this tower' }]
    }
    const sideOf = (ci: number) => (row.columns.length === 2 ? (ci === 0 ? 'left' : 'right') : 'a')
    for (const [ci, column] of row.columns.entries()) {
      const floating = column.units.find((u) => (u.gapBelow ?? 0) > 0)
      if (floating) {
        return [{ rowIndex, problem: `The ${sideOf(ci)} column has ${floating.gapBelow}F of empty space under its ${floating.width} ${floating.kind}` }]
      }
    }
    const short = columnShortfall(row)
    const i = short.findIndex((n) => n > 0)
    if (i < 0) return []
    const side = row.columns.length === 2 ? (i === 0 ? 'left' : 'right') : 'a'
    return [{ rowIndex, problem: `The ${side} column needs ${short[i]}F more to reach ${rowFloors(row)}F` }]
  })
}

/** The engine's view of a Tower, or null while it is still incomplete. */
export function toEngineTower(tower: EditorTower, depth: Depth): Tower | null {
  if (!tower.width || tower.rows.length === 0 || rowProblems(tower).length > 0) return null
  return {
    width: tower.width,
    depth,
    rows: tower.rows.map((r) => ({ columns: r.columns.map((c) => ({ width: c.width, units: c.units.map(({ gapBelow: _gap, ...u }) => u) })) })),
    roof: tower.roof,
    bottom: tower.bottom,
    backbone: tower.backbone,
    stationaryHandle: tower.stationaryHandle ?? false,
    pullOutHandle: tower.pullOutHandle ?? false,
    pegboard: tower.pegboard,
    wallMount: tower.wallMount ?? false,
    topHandles: tower.topHandles,
  }
}
