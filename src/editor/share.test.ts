import { deflateSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { addTower, newLayout, placeUnit, updateLayout, type EditorLayout, type OpResult, type UnitSpec } from './layoutOps'
import { decodeLayout, encodeLayout } from './share'

const ok = (r: OpResult): EditorLayout => {
  if (!r.ok) throw new Error(r.reason)
  return r.layout
}
const drawer = (width: UnitSpec['width'], height: UnitSpec['height'] = '1F'): UnitSpec => ({ kind: 'drawer', width, height })

/** A link holding exactly this data, as an older or damaged link might. */
const rawLink = (data: unknown) => {
  let binary = ''
  for (const b of deflateSync(strToU8(JSON.stringify(data)))) binary += String.fromCharCode(b)
  return `1.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

/** Links leave ids out (they're random); compare everything else. */
const withoutIds = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(withoutIds)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'id').map(([k, v]) => [k, withoutIds(v)]))
      : value

/** A layout of several towers, each a few rows high: about as big as a shared layout gets in practice. */
function bigLayout(): EditorLayout {
  let layout = ok(updateLayout(newLayout('Workshop wall'), { plateEdgeMm: 4, plateDensity: 'roomy' }))
  for (let t = 0; t < 4; t++) {
    layout = ok(addTower(layout))
    const towerId = layout.towers[t].id
    for (const spec of [drawer('M', '2F'), drawer('M'), drawer('M'), { kind: 'sustainer', width: 'M', height: '2F' } as UnitSpec]) {
      layout = ok(placeUnit(layout, towerId, { kind: 'newRow', index: layout.towers[t].rows.length }, spec))
    }
  }
  return layout
}

describe('share links', () => {
  it('opens a shared layout as a copy with everything the sender set', () => {
    const sent = bigLayout()

    const received = decodeLayout(encodeLayout(sent))!

    expect(received.id).not.toBe(sent.id)
    expect(received.name).toBe(sent.name)
    expect(withoutIds(received.towers)).toEqual(withoutIds(sent.towers))
    expect(received.colours).toEqual(sent.colours)
    expect([received.plateEdgeMm, received.plateDensity, received.splitParts]).toEqual([4, 'roomy', sent.splitParts])
  })

  // Links get pasted into chats and browsers; keep them well under the lengths those handle.
  it('keeps the link short', () => {
    expect(encodeLayout(bigLayout()).length).toBeLessThan(2000)
  })

  it('uses only characters that are safe in a link', () => {
    expect(encodeLayout(bigLayout())).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('refuses a damaged or unknown link instead of opening something broken', () => {
    const good = encodeLayout(bigLayout())
    for (const bad of ['', 'nonsense', '9.' + good.slice(2), good.slice(0, good.length / 2), '1.AAAA']) {
      expect(decodeLayout(bad), bad.slice(0, 20)).toBeUndefined()
    }
  })

  it('refuses a link whose layout has a tower in an impossible shape', () => {
    const broken = { ...bigLayout(), towers: [{ width: 'Q', depth: null, rows: 'oops' }] }
    expect(decodeLayout(rawLink(broken))).toBeUndefined()
  })

  // Links made before Columns, and with ids, still open.
  it('opens a link made before columns', () => {
    const unit = { id: 'u', kind: 'drawer', width: 'S', baseplate: 'none', gearedRails: false, key: 'normal' }
    const old = { ...bigLayout(), towers: [{ id: 't', width: 'L', depth: null, roof: 'grid', bottom: 'none', backbone: 'none',
      rows: [{ id: 'r', height: '1F', units: [unit, { ...unit, id: 'v' }] }] }] }

    const received = decodeLayout(rawLink(old))!

    expect(received.towers[0].rows[0].columns.map((c) => c.units[0].height)).toEqual(['1F', '1F'])
  })

  // Progress is the sender's own; whoever opens the link starts fresh.
  it('leaves print progress out of the link', () => {
    const sent = bigLayout()
    const withProgress = { ...sent, towers: sent.towers.map((t) => ({ ...t, printed: { 'A/Key.stl': 3 } })) }

    const received = decodeLayout(encodeLayout(withProgress))!

    for (const tower of received.towers) expect(tower.printed).toBeUndefined()
  })
})
