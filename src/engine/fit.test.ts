import { describe, expect, it } from 'vitest'
import { checkFit } from './fit'
import { realCatalog } from './testing'

// Bed sizes from Bambu Studio's printer profiles.
const H2S = { name: 'Bambu Lab H2S', bed: { width: 340, depth: 320 }, height: 340 }
const X1C = { name: 'Bambu Lab X1 Carbon', bed: { width: 256, depth: 256 }, height: 250 }

const part = (path: string) => realCatalog.get(path)

describe('checkFit', () => {
  // The bug reported against the existing planner: XL modules shown as not fitting the H2S.
  // Independent check: XL7 Module 1F is stored diagonally in a 339.8 × 319.9 mm box, so at least
  // 0.1 mm spare, and it is 418.8 mm long, so it can only fit turned well away from square.
  it('fits an XL module on the H2S only diagonally, as a tight fit', () => {
    const fit = checkFit(part('01. DRAWERS/05. XL Families/XL7/Modules/XL7 Module 1F.stl'), H2S)

    expect(fit.fits).toBe(true)
    expect(fit.tight).toBe(true)
    expect(fit.spareMm).toBeGreaterThanOrEqual(0.09)
    expect(fit.spareMm).toBeLessThan(0.5)
    expect(fit.angleDeg % 90).not.toBeCloseTo(0, 0)
  })

  it('rejects the same XL module on an X1C because of its footprint, with the overhang', () => {
    const fit = checkFit(part('01. DRAWERS/05. XL Families/XL7/Modules/XL7 Module 1F.stl'), X1C)

    expect(fit.fits).toBe(false)
    expect(fit.limitedBy).toBe('footprint')
    expect(fit.spareMm).toBeLessThan(0)
  })

  // S6 Module 1F: a 164.8 × 57 mm footprint, but stored 272.1 mm tall (modules print standing on their back).
  it('rejects a part that is too tall, even though its footprint fits easily', () => {
    const fit = checkFit(part('01. DRAWERS/01. S Families/S6/Modules/S6 Module 1F.stl'), X1C)

    expect(fit.fits).toBe(false)
    expect(fit.limitedBy).toBe('height')
    expect(fit.spareMm).toBeCloseTo(250 - 272.1, 0)
  })

  // XL Facade 1F is 418.8 mm long: longer than either side of the H2S plate, shorter than its diagonal.
  it('fits a part that is longer than the plate by turning it', () => {
    const fit = checkFit(part('01. DRAWERS/05. XL Families/XL Facade 1F.stl'), H2S)

    expect(fit.fits).toBe(true)
    expect(fit.angleDeg % 90).not.toBeCloseTo(0, 0)
  })

  it('gives a roomy part plenty of spare and no tight-fit warning', () => {
    const fit = checkFit(part('01. DRAWERS/01. S Families/S3/Boxes/S3 Box 1F.stl'), H2S)

    expect(fit.fits).toBe(true)
    expect(fit.tight).toBe(false)
    expect(fit.spareMm).toBeGreaterThan(100)
  })
})
