import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createCatalog, type PartMeasure } from '../engine/catalog'
import type { PartLine } from '../engine/parts'
import { packPlates } from '../engine/plates'
import { writeBambuProject } from './bambu3mf'
import type { Mesh } from './stl'

// Box-shaped stand-in parts, so every position can be checked exactly.
const BOXES: Record<string, [number, number, number]> = {
  'A/Module.stl': [200, 150, 60],
  'A/Box.stl': [180, 140, 40],
  'A/Key (Turn On Supports).stl': [30, 20, 15],
  'A/Facade.stl': [160, 50, 8],
  'A/Tyre (TPU).stl': [160, 160, 40],
}
const part = (path: string): PartMeasure => {
  const [x, y, z] = BOXES[path]
  return { path, size: [x, y, z], volume: x * y * z, area: 2 * (x * y + y * z + x * z), outline: [[0, 0], [x, 0], [x, y], [0, y]] }
}
const catalog = createCatalog({ source: 'test', parts: Object.keys(BOXES).map(part) })
const box = (path: string, at: [number, number, number] = [5, -3, 100]): Mesh => {
  const [sx, sy, sz] = BOXES[path]
  const [ox, oy, oz] = at
  const p = [0, 1].flatMap((k) => [0, 1].flatMap((j) => [0, 1].map((i) => [ox + i * sx, oy + j * sy, oz + k * sz])))
  const f = [[0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4], [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5]]
  return {
    vertices: Float32Array.from(p.flat()),
    triangles: Uint32Array.from(f.flat()),
    min: Float32Array.from(at),
    max: Float32Array.from([ox + sx, oy + sy, oz + sz]),
  }
}

const H2S = { name: 'Bambu Lab H2S', bed: { width: 340, depth: 320 }, height: 340 }
const settings = { printer_settings_id: 'Bambu Lab H2S 0.4 nozzle', filament_colour: ['#000', '#000', '#000'], filament_multi_colour: ['#000', '#000', '#000'] }
const lines: PartLine[] = [
  { path: 'A/Module.stl', qty: 2, role: 'body', source: 't', flags: [] },
  { path: 'A/Box.stl', qty: 2, role: 'body', source: 't', flags: [] },
  { path: 'A/Key (Turn On Supports).stl', qty: 3, role: 'accent', source: 't', flags: [] },
  { path: 'A/Facade.stl', qty: 2, role: 'body', source: 't', flags: [] },
  { path: 'A/Tyre (TPU).stl', qty: 2, role: 'body', source: 't', flags: [] },
]

async function exportProject() {
  const plates = packPlates(lines, { catalog, printer: H2S, allowColourMixing: false })
  const chunks: Uint8Array[] = []
  await writeBambuProject(
    { plates, printer: H2S, settings, colours: { body: '#D3D5D2', accent: '#2F3236' }, meshFor: async (path) => box(path) },
    async (chunk) => { chunks.push(chunk) },
  )
  const zip = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) { zip.set(c, at); at += c.length }
  const files = unzipSync(zip)
  const text = (name: string) => strFromU8(files[name])
  return { plates, files, text }
}

const attrs = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}\\b([^>]*)/?>`, 'g'))].map((m) => Object.fromEntries([...m[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])))

describe('writeBambuProject', () => {
  it('writes the files Bambu Studio expects, one mesh file per placed part', async () => {
    const { plates, files } = await exportProject()
    const placed = plates.reduce((n, p) => n + p.items.length, 0)

    for (const name of ['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model', '3D/_rels/3dmodel.model.rels', 'Metadata/model_settings.config', 'Metadata/project_settings.config']) {
      expect(files[name], name).toBeDefined()
    }
    expect(Object.keys(files).filter((n) => n.startsWith('3D/Objects/'))).toHaveLength(placed)
  })

  it('lists each plate with exactly its parts, on the right filament slot, with supports only where the files ask', async () => {
    const { plates, text } = await exportProject()
    const config = text('Metadata/model_settings.config')
    const objects = [...config.matchAll(/<object id="(\d+)">([\s\S]*?)<\/object>/g)].map((m) => ({
      id: m[1],
      name: m[2].match(/key="name" value="([^"]*)"/)![1],
      slot: m[2].match(/key="extruder" value="(\d)"/)![1],
      support: /key="enable_support" value="1"/.test(m[2]),
    }))
    const plateBlocks = [...config.matchAll(/<plate>([\s\S]*?)<\/plate>/g)].map((m) => [...m[1].matchAll(/key="object_id" value="(\d+)"/g)].map((x) => x[1]))

    expect(plateBlocks).toHaveLength(plates.length)
    plates.forEach((plate, i) => {
      const names = plateBlocks[i].map((id) => objects.find((o) => o.id === id)!.name).sort()
      expect(names).toEqual(plate.items.map((it) => it.path.split('/').pop()).sort())
    })
    for (const o of objects) {
      expect(o.slot, o.name).toBe(o.name.includes('(TPU)') ? '3' : o.name.startsWith('Key') ? '2' : '1')
      expect(o.support, o.name).toBe(o.name.includes('(Turn On Supports)'))
    }
  })

  it('fills in the layout colours for the body and accent slots', async () => {
    const { text } = await exportProject()
    const s = JSON.parse(text('Metadata/project_settings.config'))

    expect(s.filament_colour.slice(0, 2)).toEqual(['#D3D5D2', '#2F3236'])
    expect(s.filament_multi_colour.slice(0, 2)).toEqual(['#D3D5D2', '#2F3236'])
  })

  // Bambu Studio refuses names containing <>:/\|?*" with an error pop-up per name.
  it('names plates and parts without characters Bambu Studio refuses', async () => {
    const { text } = await exportProject()
    const names = [...text('Metadata/model_settings.config').matchAll(/key="(?:plater_name|name)" value="([^"]*)"/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) expect(name, name).not.toMatch(/[<>:/\\|?*"]|&quot;/)
  })

  // Bambu Studio only reads plates and settings from a file that says Bambu Studio wrote it.
  it('identifies the file as a Bambu Studio project', async () => {
    const { text } = await exportProject()
    expect(text('3D/3dmodel.model')).toMatch(/<metadata name="Application">BambuStudio-/)
  })

  // A wipe tower is only needed when a plate changes filament; left on, it collides with parts.
  it('turns the wipe tower off when every plate prints in one filament', async () => {
    const { text } = await exportProject()
    expect(JSON.parse(text('Metadata/project_settings.config')).enable_prime_tower).toBe('0')
  })

  // Bambu Studio lays plates out in a grid, columns = ceil(sqrt(plates)), 1.2 × the bed apart; plate 2 of a
  // two-plate project sits 408 mm right of plate 1 on the H2S (seen in a project Bambu Studio saved).
  it('puts every part inside its own plate on the bed, sitting on the plate', async () => {
    const { plates, text } = await exportProject()
    const model = text('3D/3dmodel.model')
    const config = text('Metadata/model_settings.config')
    const items = attrs(model, 'item')
    const components = attrs(model, 'component')
    const cols = Math.ceil(Math.sqrt(plates.length))
    const plateOf = new Map<string, number>()
    ;[...config.matchAll(/<plate>([\s\S]*?)<\/plate>/g)].forEach((m, i) => {
      for (const x of m[1].matchAll(/key="object_id" value="(\d+)"/g)) plateOf.set(x[1], i)
    })

    for (const item of items) {
      const [, , , , , , , , , tx, ty, tz] = item.transform.split(' ').map(Number)
      const comp = components.find((c) => c['objectid'] === String(Number(item.objectid) - 1))!
      const mesh = text(comp['p:path'].slice(1))
      const verts = [...mesh.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map((v) => [+v[1] + tx, +v[2] + ty, +v[3] + tz])
      const i = plateOf.get(item.objectid)!
      const ox = (i % cols) * H2S.bed.width * 1.2
      const oy = -Math.floor(i / cols) * H2S.bed.depth * 1.2

      expect(Math.min(...verts.map((v) => v[2]))).toBeCloseTo(0, 3)
      for (const [x, y] of verts) {
        expect(x).toBeGreaterThanOrEqual(ox - 0.01)
        expect(x).toBeLessThanOrEqual(ox + H2S.bed.width + 0.01)
        expect(y).toBeGreaterThanOrEqual(oy - 0.01)
        expect(y).toBeLessThanOrEqual(oy + H2S.bed.depth + 0.01)
      }
    }
  })
})
