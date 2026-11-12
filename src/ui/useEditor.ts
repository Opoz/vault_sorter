import { useCallback, useMemo, useState } from 'react'
import { addTower, duplicateUnit as copyUnit, newLayout, type EditorLayout, type OpResult } from '../editor/layoutOps'
import { decodeLayout, encodeLayout } from '../editor/share'
import { createLayoutStore, type KeyValueStorage } from '../editor/storage'
import { DEFAULT_PRINTER_ID, findPrinter, type Printer } from './data'

export type Selection =
  | { readonly type: 'tower'; readonly towerId: string }
  | { readonly type: 'unit'; readonly towerId: string; readonly unitId: string }
  | null

const PRINTER_KEY = 'vault-planner:printer'
const CURRENT_KEY = 'vault-planner:current'

function browserStorage(): KeyValueStorage {
  try {
    return window.localStorage
  } catch {
    // Accessing localStorage itself can throw when site data is blocked; the store copes with a throwing one.
    const fail = () => { throw new Error('Storage unavailable') }
    return { getItem: fail, setItem: fail, removeItem: fail, key: fail, get length(): number { return fail() } }
  }
}

function readPref(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}
function writePref(key: string, value: string) {
  try { window.localStorage.setItem(key, value) } catch { /* a convenience only */ }
}

function starterLayout(): EditorLayout {
  const result = addTower(newLayout('My first layout'))
  return result.ok ? result.layout : newLayout('My first layout')
}

export function useEditor() {
  const store = useMemo(() => createLayoutStore(browserStorage()), [])
  const [layouts, setLayouts] = useState(() => {
    if (store.list().length === 0) store.save(starterLayout())
    return store.list()
  })
  const [currentId, setCurrentId] = useState(() => {
    const remembered = readPref(CURRENT_KEY)
    return remembered && store.load(remembered) ? remembered : store.list()[0].id
  })
  const [printerId, setPrinterIdState] = useState(() => readPref(PRINTER_KEY) ?? DEFAULT_PRINTER_ID)
  const [selection, setSelection] = useState<Selection>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const layout = layouts.find((l) => l.id === currentId) ?? layouts[0]
  const printer: Printer = findPrinter(printerId) ?? findPrinter(DEFAULT_PRINTER_ID)!

  const refresh = useCallback(() => setLayouts(store.list()), [store])

  /** Apply an editing operation: save it, or show why it was refused. */
  const apply = useCallback((result: OpResult) => {
    if (!result.ok) {
      setNotice(result.reason)
      return false
    }
    store.save(result.layout)
    refresh()
    setNotice(null)
    return true
  }, [store, refresh])

  const open = useCallback((id: string) => {
    setCurrentId(id)
    writePref(CURRENT_KEY, id)
    setSelection(null)
  }, [])

  return {
    layout,
    layouts,
    printer,
    selection,
    notice,
    persistent: store.persistent,
    unreadable: store.unreadable,
    setSelection,
    setNotice,
    apply,
    open,
    setPrinterId(id: string) {
      setPrinterIdState(id)
      writePref(PRINTER_KEY, id)
    },
    create() {
      const fresh = starterLayout()
      store.save({ ...fresh, name: `Layout ${store.list().length + 1}` })
      refresh()
      open(fresh.id)
    },
    /** Copy a unit, and say so when it couldn't go beside the original. */
    duplicateUnit(towerId: string, unitId: string) {
      const rowsIn = (l: EditorLayout) => l.towers.find((t) => t.id === towerId)?.rows.length ?? 0
      const result = copyUnit(layout, towerId, unitId)
      if (!apply(result) || !result.ok) return
      if (rowsIn(result.layout) > rowsIn(layout)) setNotice('No room beside it, so the copy went in a new row above.')
    },
    /** A link that opens a copy of the current layout, for anyone. */
    shareLink(): string {
      return `${window.location.origin}${window.location.pathname}#share=${encodeLayout(layout)}`
    },
    /** Open the layout in a share link as a copy of one's own. */
    openShared(code: string) {
      const shared = decodeLayout(code)
      if (!shared) {
        setNotice("That share link couldn't be opened: it may have been cut short when it was copied.")
        return
      }
      const name = `${shared.name} (shared)`
      // Someone opening a link on their first visit shouldn't also be left with the empty starter layout.
      const existing = store.list()
      if (existing.length === 1 && existing[0].towers.every((t) => t.rows.length === 0)) store.remove(existing[0].id)
      store.save({ ...shared, name })
      refresh()
      open(shared.id)
      setNotice(`Opened "${name}" from a share link. It's your own copy: changes won't affect the sender's.`)
    },
    duplicate(id: string) {
      const copy = store.duplicate(id)
      refresh()
      if (copy) open(copy.id)
    },
    remove(id: string) {
      store.remove(id)
      if (store.list().length === 0) store.save(starterLayout())
      refresh()
      if (id === currentId) open(store.list()[0].id)
    },
  }
}

export type Editor = ReturnType<typeof useEditor>
