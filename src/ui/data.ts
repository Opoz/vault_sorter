import partsJson from '../data/parts.json'
import printersJson from '../data/printers.json'
import { createCatalog } from '../engine/catalog'
import type { PrinterBed } from '../engine/fit'

export const catalog = createCatalog(partsJson as unknown as Parameters<typeof createCatalog>[0])

export interface Printer extends PrinterBed {
  readonly id: string
}

export const printers: readonly Printer[] = printersJson.printers
export const printerSource = printersJson.source
export const DEFAULT_PRINTER_ID = 'h2s'
