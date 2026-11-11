/** Measurements of every Vault part file, as shipped in src/data/parts.json (see docs/adr/0001). */

export type Point = readonly [x: number, y: number]

export interface PartMeasure {
  /** Path inside the Vault download, e.g. "01. DRAWERS/05. XL Families/XL3/Modules/XL3 Module 1F.stl". */
  readonly path: string
  /** Bounding size [x, y, z] in mm, in the orientation the file is stored in (its print orientation). */
  readonly size: readonly [number, number, number]
  /** Volume in mm³. */
  readonly volume: number
  /** Surface area in mm². */
  readonly area: number
  /** Top-down convex outline in mm, drawn slightly outside the part. */
  readonly outline: readonly Point[]
}

export interface Catalog {
  /** Vault release the measurements came from, e.g. "261021_VAULT_USSA_S". */
  readonly source: string
  has(path: string): boolean
  /** The part at this path. Throws if the Vault download has no such file. */
  get(path: string): PartMeasure
  paths(): string[]
}

interface CatalogJson {
  source: string
  parts: PartMeasure[]
}

export function createCatalog(json: CatalogJson): Catalog {
  const byPath = new Map(json.parts.map((p) => [p.path, p]))
  return {
    source: json.source,
    has: (path) => byPath.has(path),
    get(path) {
      const part = byPath.get(path)
      if (!part) throw new Error(`No Vault part file at "${path}"`)
      return part
    },
    paths: () => [...byPath.keys()],
  }
}
