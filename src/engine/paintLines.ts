/**
 * Painted parts in the print (issue #7): a parts-list line split by colour, so plates, filament slots and grams
 * follow the paint. The parts list itself stays one line per file.
 */
import type { ColourRole, PartLine } from './parts'

/** Copies of each part file painted each colour, by file path. */
export type PaintedCounts = ReadonlyMap<string, readonly { readonly colour: string; readonly count: number }[]>

/**
 * The lines with painted copies split off into lines carrying their colour (as upper-case hex). Paint in one of
 * the layout's colours moves the copies to that Colour role instead, so they print with it.
 */
export function withPaint(lines: readonly PartLine[], painted: PaintedCounts, colours: Readonly<Record<ColourRole, string>>): PartLine[] {
  const roleOf = new Map(Object.entries(colours).map(([role, hex]) => [hex.toUpperCase(), role as ColourRole]))
  return lines.flatMap((line) => {
    let left = line.qty
    const split = new Map<string, PartLine>()
    for (const { colour, count } of painted.get(line.path) ?? []) {
      const n = Math.min(count, left)
      if (n <= 0) continue
      left -= n
      const hex = colour.toUpperCase()
      const role = roleOf.get(hex)
      if (role === line.role) { left += n; continue }
      const key = role ?? hex
      const prev = split.get(key)
      split.set(key, prev ? { ...prev, qty: prev.qty + n } : role ? { ...line, qty: n, role } : { ...line, qty: n, colour: hex })
    }
    return [...(left > 0 ? [{ ...line, qty: left }] : []), ...split.values()]
  })
}
