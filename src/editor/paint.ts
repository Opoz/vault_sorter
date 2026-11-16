/**
 * Painting parts (issue #7): a Tower's parts print in their Colour role's colour unless painted. Paint is kept
 * per Tower, for one copy of a part or for every copy of a part file in the Tower; one-copy paint wins.
 */
import type { EditorLayout, EditorTower, OpResult } from './layoutOps'

/**
 * One printed copy of a part: whose it is (a Unit's id, or `tower` for the Tower's own parts, `tower:<row>` for a
 * Row's backbone and pegboard pieces), its file, and which copy of that file the owner has (from 0).
 */
export interface PaintTarget {
  readonly owner: string
  readonly path: string
  readonly copy: number
}

/** Paint one copy, or every copy of the file in the Tower. */
export type PaintScope = 'one' | 'all'

const oneKey = (t: PaintTarget) => `${t.owner}|${t.path}|${t.copy}`
const allKey = (path: string) => `*|${path}`

/** The colour a part is painted, or undefined when it prints in its Colour role's colour. */
export function paintedColour(tower: Pick<EditorTower, 'paint'>, target: PaintTarget): string | undefined {
  const paint = tower.paint
  if (!paint) return undefined
  return paint[oneKey(target)] ?? paint[allKey(target.path)]
}

/** Paint a part, or every copy of its file, with a colour; `null` puts it back in its Colour role's colour. */
export function paintPart(layout: EditorLayout, towerId: string, target: PaintTarget, colour: string | null, scope: PaintScope): OpResult {
  const tower = layout.towers.find((t) => t.id === towerId)
  if (!tower) return { ok: false, reason: 'That tower no longer exists' }
  const paint: Record<string, string> = { ...tower.paint }
  if (scope === 'all') {
    // Every copy alike: any one-off paint on this file goes, so they really are alike.
    for (const key of Object.keys(paint)) if (key.split('|')[1] === target.path) delete paint[key]
    if (colour) paint[allKey(target.path)] = colour
  } else if (colour) {
    paint[oneKey(target)] = colour
  } else {
    delete paint[oneKey(target)]
  }
  const { paint: _old, ...rest } = tower
  const next: EditorTower = Object.keys(paint).length ? { ...rest, paint } : rest
  return { ok: true, layout: { ...layout, towers: layout.towers.map((t) => (t.id === towerId ? next : t)), updatedAt: Date.now() } }
}

/** Each Unit's place in the Tower, as `@<row>.<column>.<unit>`, by its id. */
function places(tower: Pick<EditorTower, 'rows'>): Map<string, string> {
  const map = new Map<string, string>()
  tower.rows.forEach((r, ri) => r.columns.forEach((c, ci) => c.units.forEach((u, ui) => map.set(u.id, `@${ri}.${ci}.${ui}`))))
  return map
}

function rekey(paint: Readonly<Record<string, string>>, owners: Map<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(paint).map(([key, colour]) => {
    const [owner, ...rest] = key.split('|')
    return [[owners.get(owner) ?? owner, ...rest].join('|'), colour]
  }))
}

/** A Tower's paint with Units named by their place, not their id: for share links, which leave ids out. */
export function paintByPlace(tower: EditorTower): Record<string, string> | undefined {
  return tower.paint ? rekey(tower.paint, places(tower)) : undefined
}

/** Paint named by place (from a share link), back on the Tower's Units by their new ids. */
export function paintFromPlace(tower: EditorTower): EditorTower {
  if (!tower.paint) return tower
  const ids = new Map([...places(tower)].map(([id, place]) => [place, id]))
  return { ...tower, paint: rekey(tower.paint, ids) }
}
