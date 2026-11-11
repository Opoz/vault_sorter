/**
 * Saved Layouts in the browser. Each Layout is one key, so one bad entry never takes the others down.
 * If the browser refuses storage (private windows, blocked site data), layouts live in memory for the
 * session and `persistent` says so, so the page can tell the person.
 */
import { DEFAULT_COLOURS, type Colours, type EditorLayout } from './layoutOps'

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

export interface LayoutStore {
  /** False when the browser refused storage and layouts only last until the tab closes. */
  readonly persistent: boolean
  /** Keys of saved entries that couldn't be read. */
  readonly unreadable: readonly string[]
  list(): EditorLayout[]
  load(id: string): EditorLayout | undefined
  save(layout: EditorLayout): void
  remove(id: string): void
  duplicate(id: string): EditorLayout | undefined
}

const PREFIX = 'vault-planner:layout:'
const SCHEMA = 1

/** Bring a layout saved by any earlier version up to the current shape. */
function upgrade(raw: unknown): EditorLayout | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const data = raw as Record<string, unknown>
  if (typeof data.id !== 'string' || typeof data.name !== 'string' || !Array.isArray(data.towers)) return undefined
  // Before the secondary colour existed, "accent" was the colour of keys, locks and handles: that is now secondary.
  const colours = data.colours as Partial<Colours> | undefined
  const upgradedColours = colours && !colours.secondary
    ? { ...DEFAULT_COLOURS, body: colours.body ?? DEFAULT_COLOURS.body, secondary: colours.accent ?? DEFAULT_COLOURS.secondary }
    : colours ?? DEFAULT_COLOURS
  return {
    splitParts: 'auto',
    allowColourMixing: false,
    updatedAt: 0,
    ...(data as object),
    colours: upgradedColours,
  } as EditorLayout
}

export function createLayoutStore(storage: KeyValueStorage): LayoutStore {
  const memory = new Map<string, EditorLayout>()
  const unreadable: string[] = []
  let persistent = true

  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (!key?.startsWith(PREFIX)) continue
      try {
        const parsed = JSON.parse(storage.getItem(key) ?? '')
        const layout = upgrade(parsed?.schema === SCHEMA ? parsed.layout : parsed)
        if (layout) memory.set(layout.id, layout)
        else unreadable.push(key)
      } catch {
        unreadable.push(key)
      }
    }
  } catch {
    persistent = false
  }

  const write = (layout: EditorLayout) => {
    if (!persistent) return
    try {
      storage.setItem(PREFIX + layout.id, JSON.stringify({ schema: SCHEMA, layout }))
    } catch {
      persistent = false
    }
  }

  const store: LayoutStore = {
    get persistent() { return persistent },
    unreadable,
    list: () => [...memory.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    load: (id) => memory.get(id),
    save(layout) {
      memory.set(layout.id, layout)
      write(layout)
    },
    remove(id) {
      memory.delete(id)
      if (!persistent) return
      try {
        storage.removeItem(PREFIX + id)
      } catch {
        persistent = false
      }
    },
    duplicate(id) {
      const original = memory.get(id)
      if (!original) return undefined
      const copy = { ...original, id: crypto.randomUUID(), name: `${original.name} (copy)`, updatedAt: Date.now() }
      store.save(copy)
      return copy
    },
  }
  return store
}
