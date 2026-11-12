/**
 * Print progress: how many of each part have been printed. Counted per part file rather than per plate, because
 * plates change with the printer and plate settings while the parts list doesn't.
 */
import type { PartLine } from './parts'
import type { PackedPlate } from './plates'

/** Printed count per part path. */
export type Printed = Readonly<Record<string, number>>

export interface PartProgress {
  readonly done: number
  readonly total: number
  /** Printed count per path, capped at what the parts list asks for. */
  readonly byPath: ReadonlyMap<string, number>
}

export function partProgress(lines: readonly PartLine[], printed: Printed): PartProgress {
  const byPath = new Map<string, number>()
  let done = 0
  let total = 0
  for (const line of lines) {
    const n = Math.min(line.qty, Math.max(0, printed[line.path] ?? 0))
    byPath.set(line.path, n)
    done += n
    total += line.qty
  }
  return { done, total, byPath }
}

/**
 * Which plates count as printed: the printed parts are handed out to plates in printing order, and a plate is
 * printed when every part on it got one.
 */
export function platesDone(plates: readonly PackedPlate[], printed: Printed): boolean[] {
  const left = new Map(Object.entries(printed))
  return plates.map((plate) => {
    const need = new Map<string, number>()
    for (const item of plate.items) need.set(item.path, (need.get(item.path) ?? 0) + 1)
    const covered = [...need].every(([path, n]) => (left.get(path) ?? 0) >= n)
    if (covered) for (const [path, n] of need) left.set(path, (left.get(path) ?? 0) - n)
    return covered
  })
}
