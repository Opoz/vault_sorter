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

/** One horizontal layer of a Tower. Every Unit in it shares the Row's Height. */
export interface Row {
  readonly height: Height
  readonly units: readonly Unit[]
}

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
}

export interface Layout {
  readonly name: string
  readonly towers: readonly Tower[]
  /** Use Whole parts when they fit the printer ('auto'), or force one version. */
  readonly splitParts: 'auto' | 'whole' | 'split'
  readonly allowColourMixing: boolean
}
