import type { Catalog } from './catalog'

/**
 * Finds a Vault file from a tidy, predictable name, so the part rules don't have to repeat every quirk
 * of the download's naming: folder number prefixes ("01. "), print notes in names ("(Turn On Supports)"),
 * stray spaces and apostrophes, inconsistent capitals ("4f"), the "Heawyweight" typo and "Roof"/"Roofs"
 * folders.
 *
 * Rules ask for e.g. "drawers/s families/s3/modules/s3 module 4f.stl" and get the real path back.
 */
export interface Resolver {
  /** The real path for a tidy name, or undefined if the download has no such file. */
  find(tidyPath: string): string | undefined
  /** The real path for a tidy name. Throws if the download has no such file. */
  get(tidyPath: string): string
}

export function tidy(path: string): string {
  return path
    .split('/')
    .map((segment) =>
      segment
        .toLowerCase()
        .replace(/^\d+\.\s+/, '')
        .replace(/\(turn on supports\)/g, '')
        .replace(/heawyweight/g, 'heavyweight')
        .replace(/'/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s+\.stl$/, '.stl')
        .trim()
        .replace(/^roofs$/, 'roof'),
    )
    .join('/')
}

export function createResolver(catalog: Catalog): Resolver {
  const byTidy = new Map<string, string>()
  for (const path of catalog.paths()) {
    const key = tidy(path)
    const clash = byTidy.get(key)
    if (clash) throw new Error(`Two Vault files tidy to the same name "${key}": "${clash}" and "${path}"`)
    byTidy.set(key, path)
  }
  const find = (tidyPath: string) => byTidy.get(tidy(tidyPath))
  return {
    find,
    get(tidyPath) {
      const path = find(tidyPath)
      if (!path) throw new Error(`No Vault file matches "${tidyPath}"`)
      return path
    },
  }
}
