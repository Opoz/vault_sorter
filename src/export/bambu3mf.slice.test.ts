/**
 * End to end: a real Tower, real Vault meshes, written by writeBambuProject, sliced by Bambu Studio's command
 * line. Needs the Vault download and Bambu Studio installed, so it only runs via `npm run test:slice`.
 *   VAULT_DIR    folder holding "01. DRAWERS" etc. (defaults to the repo's git-ignored download)
 *   BAMBU_STUDIO path to bambu-studio.exe (defaults to the standard Windows install)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import printersJson from '../data/printers.json'
import { filamentEstimate } from '../engine/filament'
import type { PrinterBed } from '../engine/fit'
import type { Tower, Unit } from '../engine/model'
import { partsForTower } from '../engine/parts'
import { withPaint } from '../engine/paintLines'
import { packPlates } from '../engine/plates'
import { realCatalog } from '../engine/testing'
import { primeTowerSpot, writeBambuProject } from './bambu3mf'
import { readStl } from './stl'

const VAULT = process.env.VAULT_DIR ?? join(__dirname, '../../261021_VAULT_USSA_S/261021_VAULT_USSA_S')
const BAMBU = process.env.BAMBU_STUDIO ?? 'C:/Program Files/Bambu Studio/bambu-studio.exe'
const asked = process.env.SLICE_TEST === '1' || process.env.npm_lifecycle_event === 'test:slice'
const enabled = asked && existsSync(VAULT) && existsSync(BAMBU)

const drawer = (width: Unit['width']): Unit => ({ kind: 'drawer', width, baseplate: 'none', gearedRails: false, key: 'normal' })
const tower: Tower = {
  width: 'S', depth: 3, roof: 'grid', bottom: 'wheels', backbone: 'none',
  rows: [{ height: '1F', units: [drawer('S')] }, { height: '1F', units: [{ kind: 'sustainer', width: 'S', moduleType: 'flat' }] }],
}

// L parts are 329.6 mm long: on 330 mm beds (A2L) they lie straight with half a mm to spare; on 325 mm beds
// (H2C) they go diagonally, sharing plates side by side.
const lTower: Tower = {
  width: 'L', depth: 3, roof: 'under table mount', bottom: 'none', backbone: 'none',
  rows: [{ height: '1F', units: [drawer('L')] }],
}
const cases: [string, Tower][] = [['h2s', tower], ['x1-carbon', tower], ['h2d', tower], ['h2c', lTower], ['a2l', lTower]]

describe.skipIf(!enabled)('a Bambu project sliced by Bambu Studio', () => {
  for (const [id, tower] of cases) {
    it(`slices every plate of a ${tower.width} tower for the ${id}, with weights near the estimate`, async () => {
      const printer = printersJson.printers.find((p) => p.id === id)! as unknown as PrinterBed
      const settings = JSON.parse(readFileSync(join(__dirname, `../data/bambu/${id}.json`), 'utf8'))
      const lines = partsForTower(tower, { catalog: realCatalog, printer })
      const plates = packPlates(lines, { catalog: realCatalog, printer, allowColourMixing: false, spacingMm: Number(process.env.SPACING ?? 5) })

      const dir = mkdtempSync(join(tmpdir(), 'vault-slice-'))
      const projectPath = join(dir, 'tower.3mf')
      const chunks: Uint8Array[] = []
      await writeBambuProject(
        {
          plates, printer, settings, colours: { body: '#D3D5D2', accent: '#8A8F93', secondary: '#2F3236' },
          meshFor: async (path) => {
            const b = readFileSync(join(VAULT, path))
            return readStl(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
          },
        },
        async (c) => { chunks.push(c) },
      )
      writeFileSync(projectPath, Buffer.concat(chunks))
      if (process.env.KEEP_SLICE) console.log('PROJECT', id, projectPath, 'plates', plates.length)

      try {
        execFileSync(BAMBU, ['--slice', '0', '--outputdir', dir, projectPath], { timeout: 900_000, stdio: 'ignore' })
      } catch { /* the result file says what happened */ }
      const result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'))

      expect(result.error_string).toBe('Success.')
      expect(result.sliced_plates).toHaveLength(plates.length)
      for (const [i, plate] of plates.entries()) {
        const sliced = result.sliced_plates.find((p: { id: number }) => p.id === i + 1)
        const grams = sliced.filaments.reduce((g: number, f: { total_used_g: number }) => g + f.total_used_g, 0)
        const estimate = filamentEstimate(
          plate.items.map((it) => ({ path: it.path, qty: 1, role: it.role, source: '', flags: [] })), realCatalog,
        ).total
        // Supports, brims and purge come on top of the parts, so the slicer may be somewhat higher.
        expect(grams, `plate ${i + 1}`).toBeGreaterThan(estimate * 0.85)
        expect(grams, `plate ${i + 1}`).toBeLessThan(estimate * 1.6)
      }
    }, 1_200_000)
  }
})

// Painted parts (issue #7) add filament slots past the template's four; Bambu Studio must take the grown settings
// on one-nozzle and two-nozzle printers alike. Painted plates print in one colour each, unless colours may mix,
// which is sliced on the H2D, the one printer where mixed plates slice without the wipe tower meeting parts.
describe.skipIf(!enabled)('a Bambu project with painted parts, sliced by Bambu Studio', () => {
  const runs: [string, boolean][] = [['h2s', false], ['h2d', false], ['x1-carbon', false], ['a2l', false], ['h2d', true]]
  for (const [id, mixing] of runs) {
    it(`slices a tower with two painted colours for the ${id}${mixing ? ', colours mixing' : ''}`, async () => {
      const printer = printersJson.printers.find((p) => p.id === id)! as unknown as PrinterBed
      const settings = JSON.parse(readFileSync(join(__dirname, `../data/bambu/${id}.json`), 'utf8'))
      const colours = { body: '#D3D5D2', accent: '#8A8F93', secondary: '#2F3236' }
      const all = partsForTower(tower, { catalog: realCatalog, printer })
      const facade = all.find((l) => /Facade/.test(l.path))!
      const key = all.find((l) => /Key/.test(l.path))!
      const lines = withPaint(all, new Map([[facade.path, [{ colour: '#C0392B', count: 1 }]], [key.path, [{ colour: '#2E86DE', count: key.qty }]]]), colours)
      const excluded = [...(printer.excluded ?? []), ...(mixing ? [primeTowerSpot(settings).zone] : [])]
      const plates = packPlates(lines, { catalog: realCatalog, printer: { ...printer, excluded }, allowColourMixing: mixing })

      const dir = mkdtempSync(join(tmpdir(), 'vault-slice-'))
      const projectPath = join(dir, 'painted.3mf')
      const chunks: Uint8Array[] = []
      await writeBambuProject(
        {
          plates, printer, settings, colours,
          meshFor: async (path) => {
            const b = readFileSync(join(VAULT, path))
            return readStl(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
          },
        },
        async (c) => { chunks.push(c) },
      )
      writeFileSync(projectPath, Buffer.concat(chunks))
      if (process.env.KEEP_SLICE) console.log('PROJECT', id, projectPath, 'plates', plates.length)
      try {
        execFileSync(BAMBU, ['--slice', '0', '--outputdir', dir, projectPath], { timeout: 900_000, stdio: 'ignore' })
      } catch { /* the result file says what happened */ }
      const result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'))

      expect(result.error_string).toBe('Success.')
      expect(result.sliced_plates).toHaveLength(plates.length)
      const used = new Set(result.sliced_plates.flatMap((p: { filaments: { id: number }[] }) => p.filaments.map((f) => f.id)))
      expect([...used].some((f) => Number(f) >= 4), `filaments used: ${[...used]}`).toBe(true)
    }, 1_200_000)
  }
})
