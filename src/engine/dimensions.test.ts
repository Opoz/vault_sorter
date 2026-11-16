import { describe, expect, it } from 'vitest'
import { towerDimensions } from './dimensions'
import type { Height, Tower, Unit } from './model'
import { realCatalog } from './testing'

const H2S = { name: 'Bambu Lab H2S', bed: { width: 340, depth: 320 }, height: 340 }
const opts = { catalog: realCatalog, printer: H2S }
const drawer = (width: Unit['width']): Unit => ({ kind: 'drawer', width, baseplate: 'none', gearedRails: false, key: 'normal' })
const tower = (t: Partial<Tower>): Tower => ({
  width: 'S', depth: 3, roof: 'none', bottom: 'none', backbone: 'none',
  rows: [{ height: '1F', units: [drawer('S')] }], ...t,
})
const rows = (w: Unit['width'], ...heights: Height[]) => heights.map((height) => ({ height, units: [drawer(w)] }))

describe('towerDimensions', () => {
  // Measured: S3 Module 1F is 164.8 wide, 57.01 tall and 146.1 deep.
  it('matches the measured module for a single 1F drawer', () => {
    const d = towerDimensions(tower({}), opts)

    expect(d.widthMm).toBeCloseTo(164.8, 1)
    expect(d.depthMm).toBeCloseTo(146.1, 1)
    expect(d.heightMm).toBeCloseTo(57.01, 1)
    expect(d.flags).toEqual([])
  })

  // Stacked modules overlap at the lip; that overlap is inferred, not measured.
  it('marks the height of a stack as inferred, and keeps it between the overlapped and loose totals', () => {
    const d = towerDimensions(tower({ width: 'M', depth: 5, rows: rows('M', '1F', '2F') }), opts)
    const loose = 57.01 + 105.01

    expect(d.heightMm).toBeLessThan(loose)
    expect(d.heightMm).toBeGreaterThan(loose - 2 * 9.01)
    expect(d.flags.some((f) => f.kind === 'inferred')).toBe(true)
  })

  // Measured roof thickness: grid 14.8 mm; L heavyweight 88.3 mm. Measured base: 52.2 mm.
  it('adds the measured thickness of the roof and the base', () => {
    const bare = towerDimensions(tower({ width: 'L', rows: rows('L', '1F') }), opts).heightMm

    expect(towerDimensions(tower({ width: 'L', rows: rows('L', '1F'), roof: 'grid' }), opts).heightMm - bare).toBeCloseTo(14.8, 0)
    expect(towerDimensions(tower({ width: 'L', rows: rows('L', '1F'), roof: 'heavyweight' }), opts).heightMm - bare).toBeCloseTo(88.3, 0)
    expect(towerDimensions(tower({ width: 'L', rows: rows('L', '1F'), bottom: 'casters' }), opts).heightMm - bare).toBeCloseTo(52.2, 0)
  })

  it('counts a split row by the height its columns reach', () => {
    const unit = (height: '1F' | '2F' | '4F') => ({ ...drawer('S'), height })
    const split = tower({
      width: 'L',
      rows: [{ columns: [{ width: 'S', units: [unit('4F'), unit('1F')] }, { width: 'S', units: [unit('2F'), unit('1F'), unit('2F')] }] }],
    })
    const stacked = tower({ width: 'L', rows: rows('L', '4F', '1F') })

    expect(towerDimensions(split, opts).heightMm).toBeCloseTo(towerDimensions(stacked, opts).heightMm, 6)
  })

  // Issue #17: a Sustainer stacks at its own height, a 1F one 12.7 mm taller than a 1F drawer (60.7 against 48).
  const sustainer = (width: Unit['width']): Unit => ({ kind: 'sustainer', width, moduleType: 'flat' })
  it('counts a 1F sustainer 12.7 mm taller than a 1F drawer', () => {
    const drawers = towerDimensions(tower({ rows: rows('S', '1F', '1F') }), opts).heightMm
    const withSustainer = towerDimensions(tower({ rows: [...rows('S', '1F'), { height: '1F', units: [sustainer('S')] }] }), opts).heightMm
    expect(withSustainer - drawers).toBeCloseTo(12.7, 1)
  })

  it('warns when the columns of a split row end at different heights', () => {
    const split = (units: Unit[][]) => towerDimensions(tower({
      width: 'L', rows: [{ columns: units.map((u) => ({ width: 'S' as const, units: u.map((x) => ({ ...x, height: '1F' as const })) })) }],
    }), opts).flags.filter((f) => f.kind === 'warning')
    expect(split([[drawer('S')], [drawer('S')]])).toEqual([])
    expect(split([[drawer('S')], [sustainer('S')]])).toEqual([expect.objectContaining({ note: expect.stringMatching(/12\.7 mm apart/) })])
  })
})
