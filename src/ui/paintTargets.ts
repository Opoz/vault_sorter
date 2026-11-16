/**
 * Which part copy each piece of the 2D drawing stands for, so painting there matches the 3D view (issue #7). Copies
 * are counted per Unit and file, Box by Box for a Module holding several, as the 3D view hands them out.
 */
import type { Depth } from '../engine/model'
import { partsForTower, type PartLine } from '../engine/parts'
import type { EditorStackedUnit, EditorTower } from '../editor/layoutOps'
import { paintedColour, type PaintTarget } from '../editor/paint'
import { assembleTower } from '../scene/assembly'
import { catalog, type Printer } from './data'

export interface BoxTargets {
  readonly facade?: PaintTarget
  readonly key?: PaintTarget
  /** The key's cap (the lever drawn on the lock); absent for a hidden key. */
  readonly keyCap?: PaintTarget
  readonly label?: PaintTarget
  /** The facade caps the drawing shows, left to right. */
  readonly caps: readonly PaintTarget[]
}

export interface DrawingTargets {
  readonly module?: PaintTarget
  /** A drawer's Boxes, bottom first. */
  readonly boxes: readonly BoxTargets[]
  /** A Sustainer's Facade, label and locks (left to right). */
  readonly facade?: PaintTarget
  readonly label?: PaintTarget
  readonly locks: readonly PaintTarget[]
}

// Any printer big enough: the drawn pieces never come split.
const BIG = { name: 'any', bed: { width: 400, depth: 400 }, height: 400 }

/** A Unit's parts, as a Tower holding just it (as the 3D view counts them). */
function linesOf(unit: EditorStackedUnit, depth: Depth): PartLine[] {
  const { gapBelow: _gap, id: _id, ...plain } = unit
  try {
    return partsForTower({
      width: unit.width, depth, roof: 'none', bottom: 'none', backbone: 'none', wallMount: false,
      rows: [{ columns: [{ width: unit.width, units: [plain] }] }],
    }, { catalog, printer: BIG })
  } catch {
    return []
  }
}

const file = (path: string) => path.split('/').pop()!.toLowerCase()
const find = (lines: readonly PartLine[], test: RegExp) => lines.find((l) => test.test(file(l.path)) || test.test(l.path.toLowerCase()))

const cache = new Map<string, DrawingTargets>()

export function drawingTargets(unit: EditorStackedUnit, depth: Depth): DrawingTargets {
  const cacheKey = `${depth}\n${JSON.stringify(unit)}`
  const known = cache.get(cacheKey)
  if (known) return known
  const owner = unit.id
  const lines = linesOf(unit, depth)
  const target = (line: PartLine | undefined, copy = 0): PaintTarget | undefined => (line ? { owner, path: line.path, copy } : undefined)
  const module = target(find(lines, /\bmodule\b/))
  let made: DrawingTargets
  if (unit.kind === 'sustainer') {
    const locks = find(lines, /lock outer part/)
    made = {
      module, boxes: [],
      facade: target(find(lines, /facade\.stl$/)),
      label: target(find(lines, /label for sustainers/)),
      locks: locks ? Array.from({ length: locks.qty }, (_, i) => ({ owner, path: locks.path, copy: i })) : [],
    }
  } else {
    // Each Box's own files, then copies numbered in Box order per file.
    const heights = unit.boxes && unit.boxes.length > 1 ? unit.boxes : [unit.height]
    const used = new Map<string, number>()
    const next = (line: PartLine | undefined) => {
      if (!line) return undefined
      const copy = used.get(line.path) ?? 0
      used.set(line.path, copy + 1)
      return { owner, path: line.path, copy }
    }
    const boxes = heights.map((height): BoxTargets => {
      const own = heights.length > 1 ? linesOf({ ...unit, height, boxes: undefined }, depth) : lines
      const caps = find(own, /facade cap/)
      return {
        facade: next(find(own, /\/facades\/|xl facade/)),
        key: next(find(own, unit.key === 'hidden' ? /hidden key part 2/ : /^key \(/)),
        keyCap: unit.key === 'hidden' ? undefined : next(find(own, /^key cap/)),
        label: next(find(own, /^label\.stl$/)),
        caps: caps ? Array.from({ length: caps.qty }, () => next(caps)!) : [],
      }
    })
    made = { module, boxes, locks: [] }
  }
  cache.set(cacheKey, made)
  return made
}

/**
 * How many copies of each part file are painted which colour, for the parts list: from the 3D layout, which names
 * every copy and its owner. Empty when nothing in the Tower is painted.
 */
export function paintedCounts(tower: EditorTower, depth: Depth, printer: Printer, splitParts: 'auto' | 'whole' | 'split'): Map<string, { colour: string; count: number }[]> {
  const counts = new Map<string, Map<string, number>>()
  if (!tower.paint) return new Map()
  for (const part of assembleTower(tower, depth, { catalog, printer, splitParts })) {
    if (part.piece) continue // a file drawn as several pieces counts once per copy
    const colour = paintedColour(tower, part)
    if (!colour) continue
    const byColour = counts.get(part.path) ?? new Map<string, number>()
    byColour.set(colour, (byColour.get(colour) ?? 0) + 1)
    counts.set(part.path, byColour)
  }
  return new Map([...counts].map(([path, m]) => [path, [...m].map(([colour, count]) => ({ colour, count }))]))
}
