import type { Height, Unit, Width } from '../engine/model'
import type { UnitSpec } from '../editor/layoutOps'

/** How a Unit is named in labels and buttons, e.g. "S 2F drawer". */
export const describe = (kind: Unit['kind'], width: Width, height: Height) =>
  `${width} ${height} ${kind === 'drawer' ? 'drawer' : 'sustainer'}`

/** A stable key for a palette entry. */
export const specKey = (s: UnitSpec) => `${s.kind}:${s.width}:${s.height}`
