import { checkFit, type Fit } from './fit'
import { DEPTHS, type Depth, type Tower } from './model'
import { partsForTower, UnavailableError, type PartsOptions } from './parts'

export interface PartFit {
  readonly path: string
  readonly fit: Fit
}

export interface DepthOption {
  readonly depth: Depth
  /** Every Part fits the printer and the Vault files have everything the Tower asks for. */
  readonly fits: boolean
  /** Parts that don't fit the printer. */
  readonly blockers: readonly PartFit[]
  /** Parts that fit with less than 2 mm to spare. */
  readonly tight: readonly PartFit[]
  /** Set when the Vault files lack something this Tower asks for at this depth. */
  readonly unavailable?: string
}

export interface DepthChoice {
  readonly options: readonly DepthOption[]
  /** The largest depth that fits, if any does. */
  readonly suggested?: Depth
}

/** How a Tower would come out at each Depth, for choosing one after the Units are placed. */
export function depthOptions(tower: Omit<Tower, 'depth'>, options: PartsOptions): DepthChoice {
  const results = DEPTHS.map((depth): DepthOption => {
    let lines
    try {
      lines = partsForTower({ ...tower, depth }, options)
    } catch (e) {
      if (!(e instanceof UnavailableError)) throw e
      return { depth, fits: false, blockers: [], tight: [], unavailable: e.message }
    }
    const fits = lines.map((l) => ({ path: l.path, fit: checkFit(options.catalog.get(l.path), options.printer) }))
    const blockers = fits.filter((f) => !f.fit.fits)
    return { depth, fits: blockers.length === 0, blockers, tight: fits.filter((f) => f.fit.tight) }
  })
  const suggested = [...results].reverse().find((o) => o.fits)?.depth
  return { options: results, suggested }
}
