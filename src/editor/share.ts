/**
 * Share links: a whole Layout packed into the link itself (compressed JSON, base64url), so nothing is stored on a
 * server. Opening a link gives the receiver a copy under new ids (ids are random, so they'd only make the link
 * longer); the printer and print progress aren't included, as they're each person's own.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import { HEIGHTS, WIDTHS } from '../engine/model'
import type { EditorLayout } from './layoutOps'
import { upgradeLayout } from './storage'

const VERSION = '1'

export function encodeLayout(layout: EditorLayout): string {
  const { id: _id, updatedAt: _updatedAt, ...rest } = layout
  // Print progress is the sender's own: whoever opens the link starts fresh.
  const shared = {
    ...rest,
    towers: rest.towers.map(({ id: _t, printed: _printed, ...tower }) => ({
      ...tower,
      rows: tower.rows.map(({ id: _r, ...row }) => ({
        ...row,
        columns: row.columns.map(({ id: _c, ...column }) => ({ ...column, units: column.units.map(({ id: _u, ...unit }) => unit) })),
      })),
    })),
  }
  return `${VERSION}.${toBase64Url(deflateSync(strToU8(JSON.stringify(shared)), { level: 9 }))}`
}

/** The Layout in a share link, as a fresh copy; undefined when the link is damaged or not one of ours. */
export function decodeLayout(text: string): EditorLayout | undefined {
  const [version, body] = text.split('.', 2)
  if (version !== VERSION || !body) return undefined
  try {
    const data = withIds(JSON.parse(strFromU8(inflateSync(fromBase64Url(body)))))
    if (!isLayoutShape(data)) return undefined
    return upgradeLayout({ ...(data as object), id: crypto.randomUUID(), updatedAt: Date.now() })
  } catch {
    return undefined
  }
}

/** Give every Tower, Row, Column and Unit an id (links leave them out; older links have them already). */
function withIds(data: unknown): unknown {
  const id = (o: Record<string, unknown>) => ({ ...o, id: typeof o.id === 'string' ? o.id : crypto.randomUUID() })
  const each = (list: unknown, f: (o: Record<string, unknown>) => unknown) =>
    Array.isArray(list) ? list.map((o) => (o && typeof o === 'object' ? f(o as Record<string, unknown>) : o)) : list
  if (!data || typeof data !== 'object') return data
  const d = data as Record<string, unknown>
  return {
    ...d,
    towers: each(d.towers, (t) => id({
      ...t,
      rows: each(t.rows, (r) => id({
        ...r,
        units: each(r.units, id),
        columns: r.columns === undefined ? undefined : each(r.columns, (c) => id({ ...c, units: each(c.units, id) })),
      })),
    })),
  }
}

/** Enough checking that a hand-edited or damaged link can't open as a layout the editor would trip over. */
function isLayoutShape(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const d = data as { name?: unknown; towers?: unknown }
  if (typeof d.name !== 'string' || !Array.isArray(d.towers)) return false
  return d.towers.every((t) => {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !Array.isArray(t.rows)) return false
    if (t.width !== null && !WIDTHS.includes(t.width)) return false
    const isUnit = (u: { id?: unknown; kind?: unknown; width?: unknown }) =>
      typeof u?.id === 'string' && (u.kind === 'drawer' || u.kind === 'sustainer') && WIDTHS.includes(u.width as never)
    return t.rows.every((r: unknown) => {
      const row = r as { id?: unknown; height?: unknown; units?: unknown; columns?: unknown }
      if (typeof row?.id !== 'string') return false
      // Links made before Columns: Units side by side sharing one Height.
      if (!row.columns) return HEIGHTS.includes(row.height as never) && Array.isArray(row.units) && row.units.every(isUnit)
      return Array.isArray(row.columns) && row.columns.every((c: { id?: unknown; width?: unknown; units?: unknown }) =>
        typeof c?.id === 'string' && WIDTHS.includes(c.width as never) && Array.isArray(c.units) &&
        c.units.every((u: { height?: unknown }) => isUnit(u as never) && HEIGHTS.includes(u.height as never)))
    })
  })
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}
