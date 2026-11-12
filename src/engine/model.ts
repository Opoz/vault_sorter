/** The planner's domain model. Terms follow GLOSSARY.md. */

export type Width = 'S' | 'M' | 'L' | 'XL'
export type Depth = 3 | 4 | 5 | 6 | 7
export type Height = '1F' | '2F' | '4F'

export const WIDTHS: readonly Width[] = ['S', 'M', 'L', 'XL']
export const DEPTHS: readonly Depth[] = [3, 4, 5, 6, 7]
export const HEIGHTS: readonly Height[] = ['1F', '2F', '4F']

export type Baseplate = 'none' | 'plain' | '1 handle' | '2 handles'

export interface DrawerUnit {
  readonly kind: 'drawer'
  readonly width: Width
  readonly baseplate: Baseplate
  readonly gearedRails: boolean
  readonly key: 'normal' | 'hidden'
}

export interface SustainerUnit {
  readonly kind: 'sustainer'
  readonly width: Width
  /** Only L and XL Sustainers come in more than one Module type. */
  readonly moduleType: 'flat' | 'dividers' | 'sealed'
}

export type Unit = DrawerUnit | SustainerUnit

/** Floors in each Height. */
export const FLOORS: Record<Height, number> = { '1F': 1, '2F': 2, '4F': 4 }

/** A Unit with its own Height, as stacked in a Column. */
export type StackedUnit = Unit & { readonly height: Height }

/** One side of a split Row: Units of one Width stacked bottom first, any mix of Heights (GLOSSARY: Column). */
export interface Column {
  readonly width: Width
  readonly units: readonly StackedUnit[]
}

/** A Row whose Units sit side by side, all one Height. */
export interface UniformRow {
  readonly height: Height
  readonly units: readonly Unit[]
}

/** A Row of two Columns that need only reach the same height. */
export interface SplitRow {
  readonly columns: readonly Column[]
}

/** One horizontal layer of a Tower (GLOSSARY: Row). */
export type Row = UniformRow | SplitRow

/** A Row as Columns: a uniform Row is one Column per Unit, each a single Unit. */
export function columnsOf(row: Row): Column[] {
  return 'columns' in row ? [...row.columns] : row.units.map((u) => ({ width: u.width, units: [{ ...u, height: row.height }] }))
}

export const columnFloors = (column: Column) => column.units.reduce((n, u) => n + FLOORS[u.height], 0)

/** How many floors high a Row is: as high as its tallest Column (a finished Row's Columns are all equal). */
export const rowFloors = (row: Row) => Math.max(0, ...columnsOf(row).map(columnFloors))

/** Every Unit of a Row with its Height, Column by Column, bottom first. */
export const unitsOf = (row: Row): StackedUnit[] => columnsOf(row).flatMap((c) => c.units)

export type RoofType = 'none' | 'grid' | 'table' | 'heavyweight' | 'bowl' | 'under table mount'
export type Bottom = 'none' | 'feet' | 'wheels' | 'casters'

export interface Tower {
  readonly width: Width
  readonly depth: Depth
  /** Bottom Row first. */
  readonly rows: readonly Row[]
  readonly roof: RoofType
  readonly bottom: Bottom
  readonly backbone: 'none' | 'matching' | 'universal'
  /** A fixed handle on the backbone (Modifications p12). */
  readonly stationaryHandle?: boolean
  /** A telescoping handle on two rods, locked to the backbone (Modifications pp13–14). */
  readonly pullOutHandle?: boolean
  /** Pegboard boards on the backbone, for IKEA Skadis or USSA pegboard accessories (Modifications p15). */
  readonly pegboard?: 'skadis' | 'ussa'
  /** Hung on a wall by mounts on the back of each module (Mounting Instructions pp1–9). */
  readonly wallMount?: boolean
}

export interface Layout {
  readonly name: string
  readonly towers: readonly Tower[]
  /** Use Whole parts when they fit the printer ('auto'), or force one version. */
  readonly splitParts: 'auto' | 'whole' | 'split'
  readonly allowColourMixing: boolean
}
