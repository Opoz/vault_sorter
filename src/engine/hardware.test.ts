import { describe, expect, it } from 'vitest'
import { hardwareForTower, type HardwareLine } from './hardware'
import type { Height, Tower, Unit } from './model'

const drawer = (width: Unit['width']): Unit => ({ kind: 'drawer', width, baseplate: 'none', gearedRails: false, key: 'normal' })
const sustainer = (width: Unit['width']): Unit => ({ kind: 'sustainer', width, moduleType: 'flat' })
const tower = (t: Partial<Tower>): Tower => ({
  width: 'M', depth: 3, roof: 'none', bottom: 'none', backbone: 'none',
  rows: [{ height: '1F', units: [drawer('M')] }], ...t,
})
const rowsOf = (unit: Unit, ...heights: Height[]) => heights.map((height) => ({ height, units: [unit] }))
const qty = (lines: HardwareLine[], item: string) => lines.find((l) => l.item === item)?.qty

describe('hardwareForTower', () => {
  // Instructions Manual p3 ("x4 per floor") and p18 ("x4 for 1F") agree for a 1F drawer.
  it('needs four M4 14 mm bolts for a 1F drawer, with nothing to check', () => {
    const lines = hardwareForTower(tower({}))
    const bolts = lines.find((l) => l.item === 'M4 × 14 mm bolt')

    expect(bolts?.qty).toBe(4)
    expect(bolts?.flags).toEqual([])
  })

  // p18 says x6 for 2F; p3's "x4 per floor" would make it 8. Show it, never pick silently.
  it('flags the manuals disagreeing about bolts for a 2F drawer', () => {
    const bolts = hardwareForTower(tower({ rows: rowsOf(drawer('M'), '2F') })).find((l) => l.item === 'M4 × 14 mm bolt')

    expect(bolts?.qty).toBe(6)
    expect(bolts?.flags).toEqual([expect.objectContaining({ kind: 'conflict', note: expect.stringMatching(/8/) })])
  })

  // p17: "x16 M4 14mm bolts, x8 M4 10mm bolts, x7 M4 20mm bolts - per module".
  it('lists the bolts for a sustainer', () => {
    const lines = hardwareForTower(tower({ rows: rowsOf(sustainer('M'), '1F') }))

    expect(qty(lines, 'M4 × 14 mm bolt')).toBe(16)
    expect(qty(lines, 'M4 × 10 mm bolt')).toBe(8)
    expect(qty(lines, 'M4 × 20 mm bolt')).toBe(7)
  })

  // p3/p18: the top handle on a grid roof takes two M6 50 mm bolts.
  it('adds the top handle bolts for a grid roof', () => {
    expect(qty(hardwareForTower(tower({ roof: 'grid' })), 'M6 × 50 mm bolt')).toBe(2)
  })

  // p3 and Modifications p2: a 414 mm M16 rod for an L base; per wheel 6× M4 25 mm, a 6205ZZ bearing, a stopper;
  // 2× M6 90 mm per foot, and a wheeled base has one foot.
  it('lists everything for a wheeled L base', () => {
    const lines = hardwareForTower(tower({ width: 'L', rows: rowsOf(drawer('L'), '1F'), bottom: 'wheels' }))

    expect(qty(lines, 'M16 threaded rod, 414 mm')).toBe(1)
    expect(qty(lines, 'M4 × 25 mm bolt')).toBe(12)
    expect(qty(lines, '6205ZZ bearing')).toBe(2)
    expect(qty(lines, 'M6 × 90 mm bolt')).toBe(2)
    const stopper = lines.find((l) => l.item.startsWith('SCSAW'))
    expect(stopper?.qty).toBe(2)
    expect(stopper?.flags.some((f) => f.kind === 'conflict')).toBe(true)
  })

  it('names the manual page for every hardware line', () => {
    const lines = hardwareForTower(tower({
      roof: 'grid', bottom: 'wheels', backbone: 'matching',
      rows: [...rowsOf(drawer('M'), '2F'), ...rowsOf(sustainer('M'), '1F')],
    }))
    for (const line of lines) expect(line.source, line.item).toMatch(/\bpp?\d+/)
  })

  it('merges pages from the same manual when a bolt is needed for several reasons', () => {
    const lines = hardwareForTower(tower({ rows: [...rowsOf(drawer('M'), '2F'), ...rowsOf(sustainer('M'), '1F')] }))
    expect(lines.find((l) => l.item === 'M4 × 14 mm bolt')?.source).toBe('Instructions Manual p3, p17 and p18')
  })

  // p3: 4× M4 60–100 mm per backbone board.
  it('adds four long M4 bolts per backbone', () => {
    const lines = hardwareForTower(tower({ backbone: 'matching', rows: rowsOf(drawer('M'), '1F', '2F') }))
    expect(qty(lines, 'M4 × 60–100 mm bolt')).toBe(8)
  })
})
