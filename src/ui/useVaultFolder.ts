/**
 * The user's Vault folder, shared by everything that reads part files (print files, the 3D view): chosen once
 * per visit, or remembered between visits where the browser allows it. Nothing is ever uploaded.
 */
import { useEffect, useSyncExternalStore } from 'react'
import {
  allowFolder, canRememberFolders, chooseFolder, filesSource, folderSource, rememberedFolder, type VaultFolder, type VaultSource,
} from '../export/vaultFolder'

export type FolderState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'none' }
  | { readonly kind: 'needs-permission'; readonly folder: VaultFolder }
  | { readonly kind: 'ready'; readonly source: VaultSource }

const remembers = canRememberFolders()
let state: FolderState = remembers ? { kind: 'checking' } : { kind: 'none' }
let checked = false
const listeners = new Set<() => void>()
const set = (next: FolderState) => { state = next; listeners.forEach((l) => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** Asks the user for the folder: the picker where the browser can remember it, a folder input elsewhere. Call from a click. */
async function pick(): Promise<void> {
  if (remembers) {
    set({ kind: 'ready', source: folderSource(await chooseFolder()) })
    return
  }
  const files = await new Promise<FileList | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
    input.onchange = () => resolve(input.files)
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
  if (files?.length) set({ kind: 'ready', source: filesSource(files) })
}

/** Asks again for permission to read the remembered folder. Call from a click. */
async function allow(folder: VaultFolder): Promise<void> {
  set((await allowFolder(folder)) ? { kind: 'ready', source: folderSource(folder) } : { kind: 'needs-permission', folder })
}

export function useVaultFolder() {
  const folder = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    if (checked || !remembers) return
    checked = true
    rememberedFolder().then((r) => {
      set(!r ? { kind: 'none' } : r.granted ? { kind: 'ready', source: folderSource(r.folder) } : { kind: 'needs-permission', folder: r.folder })
    })
  }, [])
  return { folder, remembers, pick, allow }
}
