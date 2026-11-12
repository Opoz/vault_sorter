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

/** A Unit as placed: with its own Height (GLOSSARY: Column). */
export type EditorStackedUnit = EditorUnit & { readonly height: Height }

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
}

export const columnFloors = (column: EditorColumn) => column.units.reduce((n, u) => n + FLOORS[u.height], 0)
/** A Row's height in floors: its tallest Column (a finished Row's Columns are equal). */
export const rowFloors = (row: EditorRow) => Math.max(0, ...row.columns.map(columnFloors))
/** Every Unit in a Row, Column by Column, bottom first. */
export const rowUnits = (row: EditorRow) => row.columns.flatMap((c) => c.units)

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
  /** Start the second Column of a Row. */
  | { readonly kind: 'beside'; readonly rowId: string }
  /** On top of a Column's stack. */
  | { readonly kind: 'onColumn'; readonly rowId: string; readonly columnId: string }

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
      if (isFull(width, widths)) return 'That row is already full'
      if (!canStart(width, [...widths, unit.width])) return `There's no room for an ${unit.width} unit in that row`
      const column: EditorColumn = { id: newId(), width: unit.width, units: [placed] }
      return { ...tower, rows: tower.rows.map((r) => (r.id === row.id ? { ...r, columns: [...r.columns, column] } : r)) }
    }
    const column = row.columns.find((c) => c.id === target.columnId)
    if (!column) return 'That column no longer exists'
    if (column.width !== unit.width) return `Only ${column.width} units stack in that column`
    return {
      ...tower,
      rows: tower.rows.map((r) => (r.id !== row.id ? r : {
        ...r, columns: r.columns.map((c) => (c.id === column.id ? { ...c, units: [...c.units, placed] } : c)),
      })),
    }
  })
}

/** Take a Unit out. Its Column and Row go when they empty; an emptied Tower forgets its Width. */
export function removeUnit(layout: EditorLayout, towerId: string, unitId: string): OpResult {
  return withTower(layout, towerId, (tower) => {
    const rows = tower.rows
      .map((r) => ({
        ...r,
        columns: r.columns.map((c) => ({ ...c, units: c.units.filter((u) => u.id !== unitId) })).filter((c) => c.units.length > 0),
      }))
      .filter((r) => r.columns.length > 0)
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
  if (row.columns.length > 1 && columnFloors(column) < rowFloors(row)) {
    return placeExisting(layout, towerId, { kind: 'onColumn', rowId: row.id, columnId: column.id }, copy, height)
  }
  return placeExisting(layout, towerId, { kind: 'newRow', index: rowIndex + 1 }, copy, height)
}

/** Move a placed Unit, within its Tower or into another one. */
export function moveUnit(
  layout: EditorLayout, fromTowerId: string, unitId: string, toTowerId: string, target: DropTarget,
): OpResult {
  const from = layout.towers.find((t) => t.id === fromTowerId)
  const found = from && findUnit(from, unitId)
  if (!from || !found) return refuse('That unit no longer exists')
  const { row, rowIndex, column, unit } = found
  if (target.kind === 'beside' && target.rowId === row.id && row.columns.length === 1) return done(layout)
  if (target.kind === 'onColumn' && target.columnId === column.id && column.units.at(-1)?.id === unitId) return done(layout)
  const removed = removeUnit(layout, fromTowerId, unitId)
  if (!removed.ok) return removed
  // If the unit was alone in its row, that row is gone: keep the drop position stable.
  let adjusted = target
  if (target.kind === 'newRow' && fromTowerId === toTowerId && rowUnits(row).length === 1 && rowIndex < target.index) {
    adjusted = { kind: 'newRow', index: target.index - 1 }
  }
  const { id, height, ...settings } = unit
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
  'depth' | 'roof' | 'bottom' | 'backbone' | 'stationaryHandle' | 'pullOutHandle' | 'pegboard' | 'wallMount'>>

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

/** How many floors each Column of a Row is short of the tallest one (0 when it reaches it). */
export const columnShortfall = (row: EditorRow) => row.columns.map((c) => rowFloors(row) - columnFloors(c))

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
      const missing = ROW_FILLS[width].find((f) => f.length > widths.length && startsWith(f, widths))
      const next = missing?.[widths.length]
      return [{ rowIndex, problem: next ? `Needs another ${next} unit to fill the ${width} width` : 'Does not fit this tower' }]
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
    rows: tower.rows.map((r) => ({ columns: r.columns.map((c) => ({ width: c.width, units: c.units })) })),
    roof: tower.roof,
    bottom: tower.bottom,
    backbone: tower.backbone,
    stationaryHandle: tower.stationaryHandle ?? false,
    pullOutHandle: tower.pullOutHandle ?? false,
    pegboard: tower.pegboard,
    wallMount: tower.wallMount ?? false,
  }
}
