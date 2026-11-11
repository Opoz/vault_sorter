import { describe, expect, it } from 'vitest'
import { depthOptions } from './depth'
import type { Tower, Unit } from './model'
import { realCatalog } from './testing'

const H2S = { name: 'Bambu Lab H2S', bed: { width: 340, depth: 320 }, height: 340 }
const X1C = { name: 'Bambu Lab X1 Carbon', bed: { width: 256, depth: 256 }, height: 250 }

const drawer = (width: Unit['width']): Unit =>
  ({ kind: 'drawer', width, baseplate: 'none', gearedRails: false, key: 'normal' })
const towerOf = (width: Unit['width'], roof: Tower['roof'] = 'none'): Omit<Tower, 'depth'> =>
  ({ width, roof, bottom: 'none', backbone: 'none', rows: [{ height: '1F', units: [drawer(width)] }] })

describe('depthOptions', () => {
  it('lists every depth, and picks the largest one that fits by default', () => {
    const result = depthOptions(towerOf('S'), { catalog: realCatalog, printer: X1C })

    expect(result.options.map((o) => [o.depth, o.fits])).toEqual([[3, true], [4, true], [5, true], [6, false], [7, false]])
    expect(result.suggested).toBe(5)
  })

  // The confusion reported in the existing planner: it said "nothing fits" without saying why.
  it('names the part and the numbers that rule a depth out', () => {
    const six = depthOptions(towerOf('S'), { catalog: realCatalog, printer: X1C }).options.find((o) => o.depth === 6)!
    const module = six.blockers.find((b) => b.path.endsWith('S6 Module 1F.stl'))

    expect(module?.fit.limitedBy).toBe('height')
    expect(module?.fit.spareMm).toBeCloseTo(250 - 272.1, 0)
  })

  it('accepts every depth for an XL tower on the H2S, warning about tight fits', () => {
    const result = depthOptions(towerOf('XL', 'heavyweight'), { catalog: realCatalog, printer: H2S })

    expect(result.options.every((o) => o.fits)).toBe(true)
    expect(result.suggested).toBe(7)
    expect(result.options.find((o) => o.depth === 7)!.tight.length).toBeGreaterThan(0)
  })

  it('suggests nothing when no depth fits, but still explains each one', () => {
    const result = depthOptions(towerOf('XL'), { catalog: realCatalog, printer: X1C })

    expect(result.suggested).toBeUndefined()
    expect(result.options.every((o) => o.blockers.length > 0)).toBe(true)
  })
})
