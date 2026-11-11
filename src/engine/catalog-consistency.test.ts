import { describe, expect, it } from 'vitest'
import { DEPTHS, HEIGHTS, WIDTHS, type Baseplate, type Height, type Tower, type Unit, type Width } from './model'
import { partsForTower, UnavailableError } from './parts'
import { realCatalog } from './testing'

const H2S = { name: 'Bambu Lab H2S', bed: { width: 340, depth: 320 }, height: 340 }
const heightsFor = (w: Width): Height[] => (w === 'XL' ? ['1F'] : [...HEIGHTS])

const drawerOptions = (width: Width): Unit[] =>
  (['none', 'plain', '1 handle', '2 handles'] as Baseplate[]).flatMap((baseplate) =>
    [false, true].flatMap((gearedRails) =>
      (['normal', 'hidden'] as const).map((key) => ({ kind: 'drawer', width, baseplate, gearedRails, key }) as Unit),
    ),
  )
const sustainerOptions = (width: Width): Unit[] =>
  (['flat', 'dividers', 'sealed'] as const).map((moduleType) => ({ kind: 'sustainer', width, moduleType }))

/** Runs the engine; returns 'ok', or 'unavailable' when it cleanly refuses an option the download lacks. */
function attempt(tower: Tower, splitParts: 'whole' | 'split'): 'ok' | 'unavailable' {
  try {
    partsForTower(tower, { catalog: realCatalog, printer: H2S, splitParts })
    return 'ok'
  } catch (e) {
    if (e instanceof UnavailableError) return 'unavailable'
    throw e
  }
}

describe('every rule points at a real Vault file', () => {
  for (const width of WIDTHS) {
    it(`${width}: every unit option at every depth and height`, () => {
      let ok = 0
      for (const depth of DEPTHS) {
        for (const height of heightsFor(width)) {
          for (const unit of [...drawerOptions(width), ...sustainerOptions(width)]) {
            for (const split of ['whole', 'split'] as const) {
              const tower: Tower = {
                width, depth, roof: 'none', bottom: 'none', backbone: 'none', rows: [{ height, units: [unit] }],
              }
              if (attempt(tower, split) === 'ok') ok++
            }
          }
        }
      }
      expect(ok).toBeGreaterThan(0)
    })

    it(`${width}: every roof, bottom and backbone at every depth`, () => {
      const unit: Unit = { kind: 'drawer', width, baseplate: 'none', gearedRails: false, key: 'normal' }
      for (const depth of DEPTHS) {
        for (const roof of ['none', 'grid', 'table', 'heavyweight', 'bowl', 'under table mount'] as const) {
          for (const bottom of ['none', 'feet', 'wheels', 'casters'] as const) {
            for (const backbone of ['none', 'matching', 'universal'] as const) {
              for (const split of ['whole', 'split'] as const) {
                attempt({ width, depth, roof, bottom, backbone, rows: [{ height: '1F', units: [unit] }] }, split)
              }
            }
          }
        }
      }
    })
  }
})
