/**
 * The user's own Vault download, read in the browser (Chromium's folder picker). The chosen folder is
 * remembered between visits, so later exports don't ask again; nothing is ever uploaded (docs/adr/0001).
 */
import { readStl, type Mesh } from './stl'

const DB = 'vault-planner'
const STORE = 'handles'
const KEY = 'vault-folder'
/** A folder that directly contains this is the Vault download. */
const MARKER = '01. DRAWERS'

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission(o: { mode: 'read' }): Promise<PermissionState>
  requestPermission(o: { mode: 'read' }): Promise<PermissionState>
  values(): AsyncIterable<FileSystemHandle>
}

/** Chromium can remember a chosen folder between visits; other browsers use a folder input each visit. */
export const canRememberFolders = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function stored(): Promise<DirHandle | undefined> {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result as DirHandle | undefined)
      req.onerror = () => resolve(undefined)
    })
  } catch {
    return undefined
  }
}

async function remember(handle: DirHandle) {
  try {
    const db = await openDb()
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(handle, KEY)
  } catch {
    /* remembering is a convenience; the export still works this time */
  }
}

export type VaultFolder = DirHandle

/** The folder chosen on an earlier visit, and whether the browser still lets us read it without asking. */
export async function rememberedFolder(): Promise<{ folder: VaultFolder; granted: boolean } | undefined> {
  const folder = await stored()
  if (!folder) return undefined
  try {
    return { folder, granted: (await folder.queryPermission({ mode: 'read' })) === 'granted' }
  } catch {
    return undefined
  }
}

/** Asks again for permission to read a remembered folder. Call from a click. */
export async function allowFolder(folder: VaultFolder): Promise<boolean> {
  return (await folder.requestPermission({ mode: 'read' })) === 'granted'
}

/** Lets the user choose their Vault folder, and remembers it. Call from a click. */
export async function chooseFolder(): Promise<VaultFolder> {
  const picked = await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> })
    .showDirectoryPicker({ id: 'vault', mode: 'read' })
  const root = await findVaultRoot(picked)
  if (!root) throw new Error(`That folder isn't the Vault download: it has no "${MARKER}" folder inside.`)
  await remember(root)
  return root
}

/** Finds the Vault download inside what the user picked: the folder itself, or one level down. */
async function findVaultRoot(dir: DirHandle): Promise<DirHandle | undefined> {
  const hasMarker = async (d: DirHandle) => {
    try { await d.getDirectoryHandle(MARKER); return true } catch { return false }
  }
  if (await hasMarker(dir)) return dir
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory' && entry.name !== '__MACOSX' && (await hasMarker(entry as DirHandle))) return entry as DirHandle
  }
  return undefined
}

/**
 * Where part files are read from: either a remembered folder (Chromium) or the files from a folder input
 * (Firefox and others, chosen again each visit). Both read a part by its path inside the Vault download.
 */
export interface VaultSource {
  readonly name: string
  readFile(path: string): Promise<File>
}

const missing = (path: string) =>
  new Error(`Your Vault folder has no file "${path}". It may be a different version of the download.`)

/** A folder chosen with the folder picker (Chromium). */
export function folderSource(root: VaultFolder): VaultSource {
  return {
    name: root.name,
    async readFile(path) {
      const parts = path.split('/')
      let dir: FileSystemDirectoryHandle = root
      try {
        for (const name of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(name)
        return await (await dir.getFileHandle(parts[parts.length - 1])).getFile()
      } catch {
        throw missing(path)
      }
    },
  }
}

/**
 * The files from a folder input (`<input type="file" webkitdirectory>`), which every major browser supports.
 * Paths arrive relative to the chosen folder; whatever sits above the Vault download's own top level is dropped.
 */
export function filesSource(files: FileList | readonly File[]): VaultSource {
  const list = [...files] as (File & { webkitRelativePath: string })[]
  const marker = list.map((f) => f.webkitRelativePath.split('/')).find((parts) => parts.includes(MARKER))
  if (!marker) throw new Error(`That folder isn't the Vault download: it has no "${MARKER}" folder inside.`)
  const depth = marker.indexOf(MARKER)
  const byPath = new Map<string, File>()
  for (const f of list) {
    const parts = f.webkitRelativePath.split('/')
    if (parts.includes('__MACOSX')) continue
    byPath.set(parts.slice(depth).join('/'), f)
  }
  return {
    name: marker[depth - 1] ?? marker[0],
    async readFile(path) {
      const file = byPath.get(path)
      if (!file) throw missing(path)
      return file
    },
  }
}

/** Reads one part's STL, by its path inside the Vault download. */
export function meshReader(source: VaultSource): (path: string) => Promise<Mesh> {
  return async (path) => readStl(await (await source.readFile(path)).arrayBuffer())
}
