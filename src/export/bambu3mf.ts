/**
 * Writing a Bambu project (.3mf) for one Tower: its packed Plates, each part's mesh read from the user's own
 * Vault folder, and Bambu Studio's settings for the printer from a captured template (docs/adr/0003).
 * The file is streamed in pieces, so a project of a gigabyte never sits in memory at once.
 *
 * Layout and structure follow projects saved by Bambu Studio 2.x, and exports are checked by slicing them with
 * its command line: each mesh in its own model file with a unique object id, plates in a grid of
 * ceil(sqrt(n)) columns spaced 1.2 × the bed, per-part filament slot ("extruder") and supports.
 */
import { strToU8, Zip, ZipDeflate } from 'fflate'
import type { PrinterBed } from '../engine/fit'
import type { PackedPlate, PlacedItem } from '../engine/plates'
import type { Mesh } from './stl'

export interface BambuProjectInput {
  readonly plates: readonly PackedPlate[]
  readonly printer: PrinterBed
  /** Bambu Studio's full settings for the printer, with slots PLA (Body), PLA (Accent), TPU. */
  readonly settings: Record<string, unknown>
  readonly colours: { readonly body: string; readonly accent: string }
  readonly tpuColour?: string
  /** Reads a part's mesh from the user's Vault folder. */
  readonly meshFor: (path: string) => Promise<Mesh>
  /** Called after each part is written, for progress. */
  readonly onProgress?: (done: number, total: number) => void
}

/** Receives the zip in pieces; awaited, so a slow disk slows the export instead of filling memory. */
export type Sink = (chunk: Uint8Array) => Promise<void>

const PLATE_STRIDE = 1.2
const NS =
  'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" ' +
  'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"'
const MODEL_REL = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel'

export async function writeBambuProject(input: BambuProjectInput, sink: Sink): Promise<void> {
  let pending = Promise.resolve()
  let failure: unknown
  const zip = new Zip((err, data) => {
    if (err) failure = err
    else pending = pending.then(() => sink(data))
  })
  const file = (name: string, content: string) => {
    const entry = new ZipDeflate(name, { level: 6 })
    zip.add(entry)
    entry.push(strToU8(content), true)
  }

  // Plates are spaced by the whole plate (from the settings), which can be wider than the area parts are
  // packed into: on dual-nozzle printers each nozzle reaches only part of the plate.
  const { width: W, depth: D } = plateSize(input.settings) ?? input.printer.bed
  const cols = Math.ceil(Math.sqrt(Math.max(1, input.plates.length)))
  const placed = input.plates.flatMap((plate, p) => plate.items.map((item) => ({ plate, p, item })))
  const objects: { id: number; meshId: number; file: string; item: PlacedItem; plate: number; tx: number; ty: number }[] = []

  for (const [n, { p, item }] of placed.entries()) {
    const meshId = 2 * n + 1
    const id = meshId + 1
    const fileName = `3D/Objects/object_${n + 1}.model`
    const tx = (p % cols) * W * PLATE_STRIDE + item.x
    const ty = -Math.floor(p / cols) * D * PLATE_STRIDE + item.y
    objects.push({ id, meshId, file: fileName, item, plate: p, tx, ty })

    const mesh = await input.meshFor(item.path)
    const entry = new ZipDeflate(fileName, { level: 6 })
    zip.add(entry)
    for (const piece of meshXml(mesh, item, meshId)) entry.push(strToU8(piece), false)
    entry.push(new Uint8Array(0), true)
    await pending // let the disk catch up before reading the next mesh
    if (failure) throw failure
    input.onProgress?.(n + 1, placed.length)
  }

  file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>`)
  file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="${MODEL_REL}"/>
</Relationships>`)
  file('3D/_rels/3dmodel.model.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${objects.map((o, i) => ` <Relationship Target="/${o.file}" Id="rel-${i + 1}" Type="${MODEL_REL}"/>`).join('\n')}
</Relationships>`)
  file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS}>
 <metadata name="Application">BambuStudio-${bambuVersion(input.settings)}</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
${objects.map((o) => `  <object id="${o.id}" type="model">
   <components>
    <component p:path="/${o.file}" objectid="${o.meshId}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>`).join('\n')}
 </resources>
 <build>
${objects.map((o) => `  <item objectid="${o.id}" transform="1 0 0 0 1 0 0 0 1 ${num(o.tx)} ${num(o.ty)} 0" printable="1"/>`).join('\n')}
 </build>
</model>`)
  file('Metadata/model_settings.config', modelSettings(input.plates, objects))
  file('Metadata/project_settings.config', JSON.stringify(projectSettings(input), null, 4))
  zip.end()
  await pending
  if (failure) throw failure
}

/**
 * Bambu Studio only reads a project's plates and settings when the file says it was written by Bambu Studio,
 * so the project names the Bambu Studio version its settings were captured from.
 */
function bambuVersion(settings: Record<string, unknown>): string {
  return typeof settings.version === 'string' && settings.version ? settings.version : '02.00.00.00'
}

function plateSize(settings: Record<string, unknown>): { width: number; depth: number } | undefined {
  const area = settings.printable_area
  if (!Array.isArray(area) || area.length < 3) return undefined
  const pts = area.map((p) => String(p).split('x').map(Number))
  const xs = pts.map(([x]) => x)
  const ys = pts.map(([, y]) => y)
  return { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys) }
}

/** Body parts print from slot 1, Accent from slot 2, TPU from slot 3. */
const slotOf = (item: PlacedItem) => (item.material === 'TPU' ? 3 : item.role === 'accent' ? 2 : 1)
const needsSupport = (path: string) => /\(turn on supports\)/i.test(path)
const fileName = (path: string) => path.split('/').pop()!

function modelSettings(plates: readonly PackedPlate[], objects: { id: number; meshId: number; item: PlacedItem; plate: number }[]): string {
  const objectXml = objects.map((o) => {
    const name = xml(safeName(fileName(o.item.path)))
    return `  <object id="${o.id}">
    <metadata key="name" value="${name}"/>
    <metadata key="extruder" value="${slotOf(o.item)}"/>${needsSupport(o.item.path) ? '\n    <metadata key="enable_support" value="1"/>' : ''}
    <part id="${o.meshId}" subtype="normal_part">
      <metadata key="name" value="${name}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
    </part>
  </object>`
  })
  const plateXml = plates.map((plate, p) => `  <plate>
    <metadata key="plater_id" value="${p + 1}"/>
    <metadata key="plater_name" value="${xml(safeName(plateName(plate)))}"/>
    <metadata key="locked" value="false"/>
${objects.filter((o) => o.plate === p).map((o) => `    <model_instance>
      <metadata key="object_id" value="${o.id}"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>`).join('\n')}
  </plate>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${[...objectXml, ...plateXml].join('\n')}\n</config>`
}

function plateName(plate: PackedPlate): string {
  if (plate.material === 'TPU') return `Plate ${plate.index} - TPU`
  return `Plate ${plate.index} - ${plate.role === 'mixed' ? 'mixed colours' : plate.role === 'body' ? 'body colour' : 'accent colour'}`
}

/** Bambu Studio refuses any name containing these characters, with an error pop-up per name. */
const safeName = (s: string) => s.replace(/[<>:/\\|?*"]+/g, '-')

function projectSettings(input: BambuProjectInput): Record<string, unknown> {
  const colours = [input.colours.body, input.colours.accent, input.tpuColour ?? '#1A1A1A']
  const settings: Record<string, unknown> = { ...input.settings, filament_colour: colours, filament_multi_colour: colours }
  // A wipe tower is only built where a plate changes filament. When none does, switch it off: left on, it
  // can collide with parts. When colours mix, every plate keeps it at the spot the packer kept free for it.
  const mixes = input.plates.some((plate) => new Set(plate.items.map(slotOf)).size > 1)
  if (!mixes) {
    settings.enable_prime_tower = '0'
  } else {
    const { x, y } = primeTowerSpot(input.settings)
    settings.wipe_tower_x = input.plates.map(() => String(x))
    settings.wipe_tower_y = input.plates.map(() => String(y))
  }
  return settings
}

/** Where the template puts the wipe tower, and a generous square around it to keep free when colours mix. */
export function primeTowerSpot(settings: Record<string, unknown>): { x: number; y: number; zone: [number, number][] } {
  const first = (key: string, fallback: number) => {
    const v = settings[key]
    const n = Number(Array.isArray(v) ? v[0] : v)
    return Number.isFinite(n) ? n : fallback
  }
  const x = first('wipe_tower_x', 15)
  const y = first('wipe_tower_y', 220)
  const SIZE = 70 // the tower's footprint grows with purge volume; keep plenty of room
  return { x, y, zone: [[x, y], [x + SIZE, y], [x + SIZE, y + SIZE], [x, y + SIZE]] }
}

/**
 * The mesh, moved so its turning point sits at the origin and its bottom on z = 0, then turned. The build item
 * only translates it to its spot on its plate.
 */
function* meshXml(mesh: Mesh, item: PlacedItem, id: number): Generator<string> {
  const rad = (item.angleDeg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const px = mesh.min[0] + item.pivot[0]
  const py = mesh.min[1] + item.pivot[1]
  const pz = mesh.min[2]
  const v = mesh.vertices
  yield `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS}>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
  <object id="${id}" type="model">
   <mesh>
    <vertices>\n`
  const BATCH = 20000
  for (let start = 0; start < v.length / 3; start += BATCH) {
    let out = ''
    for (let i = start; i < Math.min(start + BATCH, v.length / 3); i++) {
      const dx = v[i * 3] - px
      const dy = v[i * 3 + 1] - py
      out += `     <vertex x="${num(dx * c - dy * s)}" y="${num(dx * s + dy * c)}" z="${num(v[i * 3 + 2] - pz)}"/>\n`
    }
    yield out
  }
  yield '    </vertices>\n    <triangles>\n'
  const t = mesh.triangles
  for (let start = 0; start < t.length / 3; start += BATCH) {
    let out = ''
    for (let i = start; i < Math.min(start + BATCH, t.length / 3); i++) {
      out += `     <triangle v1="${t[i * 3]}" v2="${t[i * 3 + 1]}" v3="${t[i * 3 + 2]}"/>\n`
    }
    yield out
  }
  yield '    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build/>\n</model>\n'
}

const num = (n: number) => String(Math.round(n * 1e5) / 1e5)
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
