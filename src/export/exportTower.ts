/**
 * Exporting one Tower from the browser: pack its Parts onto Plates, then stream either a Bambu project (for
 * printers with a captured settings template, docs/adr/0003) or a zip of the STLs grouped by plate.
 */
import { strToU8, Zip, ZipPassThrough } from 'fflate'
import type { Catalog } from '../engine/catalog'
import type { PrinterBed } from '../engine/fit'
import type { Tower } from '../engine/model'
import { partsForTower } from '../engine/parts'
import { packPlates, type PackedPlate } from '../engine/plates'
import templateIndex from '../data/bambu/index.json'
import { primeTowerSpot, writeBambuProject } from './bambu3mf'
import { meshReader, type VaultSource } from './vaultFolder'

const templateLoaders = import.meta.glob<Record<string, unknown>>(['../data/bambu/*.json', '!../data/bambu/index.json'], { import: 'default' })

/** Printers that have a captured Bambu Studio settings template. */
export const hasTemplate = (printerId: string) => printerId in templateIndex

async function loadTemplate(printerId: string): Promise<Record<string, unknown>> {
  const load = templateLoaders[`../data/bambu/${printerId}.json`]
  if (!load) throw new Error(`No Bambu Studio settings for this printer yet`)
  return load()
}

export interface ExportRequest {
  readonly tower: Tower
  readonly towerName: string
  readonly printer: PrinterBed & { readonly id: string }
  readonly catalog: Catalog
  readonly splitParts: 'auto' | 'whole' | 'split'
  readonly allowColourMixing: boolean
  readonly colours: { readonly body: string; readonly accent: string; readonly secondary: string }
}

/** The plates a Tower will be printed on, with the reserved areas of the printer kept clear. */
export function platesFor(req: ExportRequest, primeTowerZone?: [number, number][]): PackedPlate[] {
  const lines = partsForTower(req.tower, { catalog: req.catalog, printer: req.printer, splitParts: req.splitParts })
  const excluded = [...(req.printer.excluded ?? []), ...(primeTowerZone ? [primeTowerZone] : [])]
  return packPlates(lines, { catalog: req.catalog, printer: { ...req.printer, excluded }, allowColourMixing: req.allowColourMixing })
}

/** Rough size of the finished Bambu project: about 9.5 bytes per triangle once compressed (checked against real exports). */
export function estimateProjectBytes(plates: readonly PackedPlate[], catalog: Catalog): number {
  const triangles = plates.reduce((n, p) => n + p.items.reduce((m, i) => m + (catalog.get(i.path).triangles ?? 0), 0), 0)
  return triangles * 9.5 + 100_000
}

type Writable = { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }

/** Chromium can stream to a file the user picks; other browsers build the file in memory and download it. */
export const canStreamToFile = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window

async function chooseFile(suggestedName: string, description: string, extension: string, mime: string): Promise<Writable> {
  if (!canStreamToFile()) return downloadWhenDone(suggestedName, mime)
  const handle = await (window as unknown as {
    showSaveFilePicker(o: object): Promise<{ createWritable(): Promise<Writable> }>
  }).showSaveFilePicker({ suggestedName, types: [{ description, accept: { [mime]: [extension] } }] })
  return handle.createWritable()
}

/** Collects the file in memory and hands it to the browser as a download once complete. */
function downloadWhenDone(name: string, mime: string): Writable {
  let chunks: Uint8Array[] = []
  return {
    async write(data) { chunks.push(data) },
    async close() {
      const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: mime }))
      chunks = []
      const a = Object.assign(document.createElement('a'), { href: url, download: name })
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    },
    async abort() { chunks = [] },
  }
}

const safeName = (s: string) => s.replace(/[<>:"/\\|?*]+/g, '-').trim()

/** Saves a Bambu project for the Tower. Shows the save picker, so call it from a click. */
export async function saveBambuProject(req: ExportRequest, folder: VaultSource, onProgress: (done: number, total: number) => void) {
  const out = await chooseFile(`${safeName(req.towerName)} - ${req.printer.name.replace('Bambu Lab ', '')}.3mf`, 'Bambu Studio project', '.3mf', 'model/3mf')
  try {
    const settings = await loadTemplate(req.printer.id)
    const plates = platesFor(req, req.allowColourMixing ? primeTowerSpot(settings).zone : undefined)
    await writeBambuProject(
      { plates, printer: req.printer, settings, colours: req.colours, meshFor: meshReader(folder), onProgress },
      (chunk) => out.write(chunk),
    )
    await out.close()
  } catch (e) {
    await out.abort().catch(() => {})
    throw e
  }
}

/** Saves the Tower's STLs in a zip, one folder per plate. Shows the save picker, so call it from a click. */
export async function saveStlZip(req: ExportRequest, folder: VaultSource, onProgress: (done: number, total: number) => void) {
  const out = await chooseFile(`${safeName(req.towerName)} - STLs.zip`, 'Zip of STL files', '.zip', 'application/zip')
  try {
    const plates = platesFor(req)
    const total = plates.reduce((n, p) => n + p.items.length, 0)
    let pending = Promise.resolve()
    let failure: unknown
    const zip = new Zip((err, data) => {
      if (err) failure = err
      else pending = pending.then(() => out.write(data))
    })
    let done = 0
    for (const plate of plates) {
      const kind = plate.material === 'TPU' ? 'TPU' : plate.role === 'mixed' ? 'mixed colours' : `${plate.role} colour`
      const dir = `Plate ${String(plate.index).padStart(2, '0')} - ${kind}`
      const used = new Map<string, number>()
      for (const item of plate.items) {
        const name = item.path.split('/').pop()!
        const n = (used.get(name) ?? 0) + 1
        used.set(name, n)
        const entry = new ZipPassThrough(`${dir}/${n > 1 ? name.replace(/\.stl$/i, ` (${n}).stl`) : name}`)
        zip.add(entry)
        entry.push(new Uint8Array(await (await folder.readFile(item.path)).arrayBuffer()), true)
        await pending
        if (failure) throw failure
        onProgress(++done, total)
      }
    }
    const readme = new ZipPassThrough('READ ME.txt')
    zip.add(readme)
    readme.push(strToU8(
      `${req.towerName} for the ${req.printer.name}: ${plates.length} plates.\n` +
      'Each folder is one plate. Parts marked "(Turn On Supports)" need supports; TPU parts print in TPU.\n' +
      'Made with Vault Planner, an unofficial planner for USSA\'s Vault.\n',
    ), true)
    zip.end()
    await pending
    if (failure) throw failure
    await out.close()
  } catch (e) {
    await out.abort().catch(() => {})
    throw e
  }
}
