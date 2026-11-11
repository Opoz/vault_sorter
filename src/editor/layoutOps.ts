/**
 * Editing a Layout: pure functions that return a new Layout, or the reason a change isn't allowed.
 * The editor keeps ids on Towers, Rows and Units (for selection and dragging); the engine model doesn't.
 */
import type {
  Baseplate, Bottom, Depth, DrawerUnit, Height, RoofType, SustainerUnit, Tower, Unit, Width,
} from '../engine/model'
import { DEFAULT_EDGE_MARGIN_MM, type Density } from '../engine/plates'

export interface EditorDrawer extends DrawerUnit { readonly id: string }
export interface EditorSustainer extends SustainerUnit { readonly id: string }
export type EditorUnit = EditorDrawer | EditorSustainer

export interface EditorRow {
  readonly id: string
  readonly height: Height
  readonly units: readonly EditorUnit[]
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
  | { readonly kind: 'beside'; readonly rowId: string }

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
  return withTower(layout, towerId, (tower) => {
    const width = tower.width ?? unit.width
    if (target.kind === 'newRow') {
      if (!canStart(width, [unit.width])) return `An ${unit.width} unit doesn't fit a ${width} tower`
      const row: EditorRow = { id: newId(), height, units: [unit] }
      const rows = [...tower.rows]
      rows.splice(Math.max(0, Math.min(target.index, rows.length)), 0, row)
      return { ...tower, width, rows }
    }
    const row = tower.rows.find((r) => r.id === target.rowId)
    if (!row) return 'That row no longer exists'
    const widths = [...row.units.map((u) => u.width), unit.width]
    if (isFull(width, row.units.map((u) => u.width))) return 'That row is already full'
    if (!canStart(width, widths)) return `There's no room for an ${unit.width} unit in that row`
    if (row.height !== height) return `Everything in a row shares one height; this row is ${row.height}`
    return { ...tower, rows: tower.rows.map((r) => (r.id === row.id ? { ...r, units: [...r.units, unit] } : r)) }
  })
}

/** Take a Unit out. Its Row goes when it empties; an emptied Tower forgets its Width. */
export function removeUnit(layout: EditorLayout, towerId: string, unitId: string): OpResult {
  return withTower(layout, towerId, (tower) => {
    const rows = tower.rows
      .map((r) => ({ ...r, units: r.units.filter((u) => u.id !== unitId) }))
      .filter((r) => r.units.length > 0)
    return { ...tower, rows, width: rows.length ? tower.width : null, depth: rows.length ? tower.depth : null }
  })
}

/**
 * Copy a placed Unit, with its settings: beside it when its Row has room, otherwise in a new Row directly above.
 */
export function duplicateUnit(layout: EditorLayout, towerId: string, unitId: string): OpResult {
  const tower = layout.towers.find((t) => t.id === towerId)
  const index = tower?.rows.findIndex((r) => r.units.some((u) => u.id === unitId)) ?? -1
  if (!tower || index < 0) return refuse('That unit no longer exists')
  const row = tower.rows[index]
  const unit = row.units.find((u) => u.id === unitId)!
  const copy = { ...unit, id: newId() }
  const beside = placeExisting(layout, towerId, { kind: 'beside', rowId: row.id }, copy, row.height)
  return beside.ok ? beside : placeExisting(layout, towerId, { kind: 'newRow', index: index + 1 }, copy, row.height)
}

/** Move a placed Unit, within its Tower or into another one. */
export function moveUnit(
  layout: EditorLayout, fromTowerId: string, unitId: string, toTowerId: string, target: DropTarget,
): OpResult {
  const from = layout.towers.find((t) => t.id === fromTowerId)
  const row = from?.rows.find((r) => r.units.some((u) => u.id === unitId))
  const unit = row?.units.find((u) => u.id === unitId)
  if (!from || !row || !unit) return refuse('That unit no longer exists')
  if (target.kind === 'beside' && target.rowId === row.id) return done(layout)
  const removed = removeUnit(layout, fromTowerId, unitId)
  if (!removed.ok) return removed
  // If the unit was alone in its row, that row is gone: keep the drop position stable.
  let adjusted = target
  if (target.kind === 'newRow' && fromTowerId === toTowerId && row.units.length === 1) {
    const oldIndex = from.rows.indexOf(row)
    if (oldIndex < target.index) adjusted = { kind: 'newRow', index: target.index - 1 }
  }
  return placeExisting(removed.layout, toTowerId, adjusted, unit, row.height)
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
    const blocked = tower.rows.findIndex((r) => !canStart(width, r.units.map((u) => u.width)))
    if (blocked >= 0) return `Row ${blocked + 1} is too wide for an ${width} tower`
    if (width === 'XL' && tower.rows.some((r) => r.height !== '1F')) return 'XL towers only take 1F rows'
    return { ...tower, width }
  })
}

export type TowerPatch = Partial<Pick<EditorTower, 'depth' | 'roof' | 'bottom' | 'backbone'>>

export function updateTower(layout: EditorLayout, towerId: string, patch: TowerPatch): OpResult {
  return withTower(layout, towerId, (tower) => {
    const next = { ...tower, ...patch }
    // An under-table tower hangs from its roof, so it can't stand on wheels, feet or casters.
    if (next.roof === 'under table mount') return { ...next, bottom: 'none' }
    return next
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
      units: r.units.map((u) => (u.id === unitId ? ({ ...u, ...patch } as EditorUnit) : u)),
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
  const widths = row.units.map((u) => u.width)
  if (isFull(towerWidth, widths)) return null
  return ROW_FILLS[towerWidth].find((f) => f.length > widths.length && startsWith(f, widths))?.[widths.length] ?? null
}

/** Rows that aren't complete yet, e.g. a single S in an L tower. Not errors: the tower is still being built. */
export function rowProblems(tower: EditorTower): { rowIndex: number; problem: string }[] {
  if (!tower.width) return []
  const width = tower.width
  return tower.rows.flatMap((row, rowIndex) => {
    const widths = row.units.map((u) => u.width)
    if (isFull(width, widths)) return []
    const missing = ROW_FILLS[width].find((f) => f.length > widths.length && startsWith(f, widths))
    const next = missing?.[widths.length]
    return [{ rowIndex, problem: next ? `Needs another ${next} unit to fill the ${width} width` : 'Does not fit this tower' }]
  })
}

/** The engine's view of a Tower, or null while it is still incomplete. */
export function toEngineTower(tower: EditorTower, depth: Depth): Tower | null {
  if (!tower.width || tower.rows.length === 0 || rowProblems(tower).length > 0) return null
  return {
    width: tower.width,
    depth,
    rows: tower.rows.map((r) => ({ height: r.height, units: r.units })),
    roof: tower.roof,
    bottom: tower.bottom,
    backbone: tower.backbone,
  }
}
