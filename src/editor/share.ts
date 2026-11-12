/**
 * Share links: a whole Layout packed into the link itself (compressed JSON, base64url), so nothing is stored on a
 * server. Opening a link gives the receiver a copy under a new id; the printer isn't included, as each person
 * picks their own.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import { HEIGHTS, WIDTHS } from '../engine/model'
import type { EditorLayout } from './layoutOps'
import { upgradeLayout } from './storage'

const VERSION = '1'

export function encodeLayout(layout: EditorLayout): string {
  const { id: _id, updatedAt: _updatedAt, ...shared } = layout
  return `${VERSION}.${toBase64Url(deflateSync(strToU8(JSON.stringify(shared)), { level: 9 }))}`
}

/** The Layout in a share link, as a fresh copy; undefined when the link is damaged or not one of ours. */
export function decodeLayout(text: string): EditorLayout | undefined {
  const [version, body] = text.split('.', 2)
  if (version !== VERSION || !body) return undefined
  try {
    const data = JSON.parse(strFromU8(inflateSync(fromBase64Url(body))))
    if (!isLayoutShape(data)) return undefined
    return upgradeLayout({ ...data, id: crypto.randomUUID(), updatedAt: Date.now() })
  } catch {
    return undefined
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
    return t.rows.every((r: unknown) => {
      const row = r as { id?: unknown; height?: unknown; units?: unknown }
      return typeof row?.id === 'string' && HEIGHTS.includes(row.height as never) && Array.isArray(row.units) &&
        row.units.every((u: { id?: unknown; kind?: unknown; width?: unknown }) =>
          typeof u?.id === 'string' && (u.kind === 'drawer' || u.kind === 'sustainer') && WIDTHS.includes(u.width as never))
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
