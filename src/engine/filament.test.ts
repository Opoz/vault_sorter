import { describe, expect, it } from 'vitest'
import { filamentEstimate } from './filament'
import type { PartLine } from './parts'
import { realCatalog } from './testing'

const DRAWERS = '01. DRAWERS'
const line = (path: string, qty = 1, role: PartLine['role'] = 'body'): PartLine => ({ path, qty, role, source: 'test', flags: [] })

// Grams from Bambu Studio, default settings (0.20 mm Standard, Bambu PLA Basic), sliced by the user.
const SLICED: [string, number][] = [
  [`${DRAWERS}/01. S Families/S3/Boxes/S3 Box 1F.stl`, 92.21],
  [`${DRAWERS}/03. L Families/L3/Modules/L3 Module 2F.stl`, 443.17],
  [`${DRAWERS}/07. Universal/Latch.stl`, 7.74],
  [`${DRAWERS}/07. Universal/Key (Turn On Supports).stl`, 9.34],
]

describe('filamentEstimate', () => {
  for (const [path, grams] of SLICED) {
    it(`comes within 12% of Bambu Studio for ${path.split('/').pop()}`, () => {
      const estimate = filamentEstimate([line(path)], realCatalog)
      expect(estimate.body).toBeGreaterThan(grams * 0.88)
      expect(estimate.body).toBeLessThan(grams * 1.12)
    })
  }

  it('multiplies by quantity and splits grams by colour role', () => {
    const latch = `${DRAWERS}/07. Universal/Latch.stl`
    const key = `${DRAWERS}/07. Universal/Key (Turn On Supports).stl`
    const one = filamentEstimate([line(latch)], realCatalog).body
    const keyOnly = filamentEstimate([line(key)], realCatalog).body

    const both = filamentEstimate([line(latch, 3, 'body'), line(key, 2, 'accent')], realCatalog)

    expect(both.body).toBeCloseTo(3 * one, 1)
    expect(both.accent).toBeCloseTo(2 * keyOnly, 1)
    expect(both.total).toBeCloseTo(both.body + both.accent, 6)
  })
})
