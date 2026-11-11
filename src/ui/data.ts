import partsJson from '../data/parts.json'
import printersJson from '../data/printers.json'
import { createCatalog } from '../engine/catalog'
import type { PrinterBed } from '../engine/fit'

export const catalog = createCatalog(partsJson as unknown as Parameters<typeof createCatalog>[0])

export interface Printer extends PrinterBed {
  readonly id: string
  /** Shown instead of the name when one entry covers several printers, e.g. "X1 Carbon / X1". */
  readonly label?: string
}

/** How a printer is named in the interface. */
export const printerLabel = (p: Printer) => p.label ?? p.name.replace(/^Bambu Lab /, '')

/** Printers merged into another entry; a saved choice of one opens the other. */
const MERGED: Record<string, string> = { x1: 'x1-carbon' }
export const findPrinter = (id: string) => printers.find((p) => p.id === (MERGED[id] ?? id))

export const printers: readonly Printer[] = printersJson.printers as unknown as Printer[]
export const printerSource = printersJson.source
export const DEFAULT_PRINTER_ID = 'h2s'
