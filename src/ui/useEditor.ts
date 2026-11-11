import { useCallback, useMemo, useState } from 'react'
import { addTower, newLayout, type EditorLayout, type OpResult } from '../editor/layoutOps'
import { createLayoutStore, type KeyValueStorage } from '../editor/storage'
import { DEFAULT_PRINTER_ID, printers, type Printer } from './data'

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
  const printer: Printer = printers.find((p) => p.id === printerId) ?? printers.find((p) => p.id === DEFAULT_PRINTER_ID)!

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
