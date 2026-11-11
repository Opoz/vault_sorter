import { describe, expect, it } from 'vitest'
import { newLayout } from './layoutOps'
import { createLayoutStore, type KeyValueStorage } from './storage'

function memoryStorage(seed: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...seed }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v },
    removeItem: (k) => { delete data[k] },
    key: (i) => Object.keys(data)[i] ?? null,
    get length() { return Object.keys(data).length },
  }
}

const brokenStorage: KeyValueStorage = {
  getItem: () => { throw new Error('SecurityError') },
  setItem: () => { throw new Error('SecurityError') },
  removeItem: () => { throw new Error('SecurityError') },
  key: () => { throw new Error('SecurityError') },
  get length(): number { throw new Error('SecurityError') },
}

describe('layout storage', () => {
  it('keeps a saved layout across a reload', () => {
    const storage = memoryStorage()
    const layout = { ...newLayout('Garage wall'), allowColourMixing: true }
    createLayoutStore(storage).save(layout)

    const reloaded = createLayoutStore(storage)

    expect(reloaded.load(layout.id)).toEqual(layout)
    expect(reloaded.list().map((l) => l.name)).toEqual(['Garage wall'])
  })

  it('lists the most recently changed layout first', () => {
    const store = createLayoutStore(memoryStorage())
    store.save({ ...newLayout('Old'), updatedAt: 1 })
    store.save({ ...newLayout('New'), updatedAt: 2 })

    expect(store.list().map((l) => l.name)).toEqual(['New', 'Old'])
  })

  it('duplicates a layout under a new id and name', () => {
    const store = createLayoutStore(memoryStorage())
    const original = newLayout('Desk')
    store.save(original)

    const copy = store.duplicate(original.id)!

    expect(copy.id).not.toBe(original.id)
    expect(copy.name).toBe('Desk (copy)')
    expect(store.list()).toHaveLength(2)
  })

  it('deletes a layout', () => {
    const store = createLayoutStore(memoryStorage())
    const layout = newLayout('Gone')
    store.save(layout)

    store.remove(layout.id)

    expect(store.load(layout.id)).toBeUndefined()
    expect(store.list()).toEqual([])
  })

  it('skips saved data it cannot read instead of crashing, and reports it', () => {
    const good = newLayout('Fine')
    const storage = memoryStorage({ 'vault-planner:layout:bad': '{not json', 'unrelated-key': 'x' })
    createLayoutStore(storage).save(good)

    const store = createLayoutStore(storage)

    expect(store.list().map((l) => l.name)).toEqual(['Fine'])
    expect(store.unreadable).toEqual(['vault-planner:layout:bad'])
  })

  it('reads a layout saved by an older version of the app', () => {
    const v0 = { id: 'old', name: 'From before colours', towers: [], splitParts: 'auto', updatedAt: 5 }
    const storage = memoryStorage({ 'vault-planner:layout:old': JSON.stringify(v0) })

    const loaded = createLayoutStore(storage).load('old')!

    expect(loaded.name).toBe('From before colours')
    expect(loaded.colours).toBeDefined()
    expect(loaded.allowColourMixing).toBe(false)
  })

  it('keeps working in memory when the browser refuses storage, and says so', () => {
    const store = createLayoutStore(brokenStorage)
    const layout = newLayout('Private window')

    store.save(layout)

    expect(store.persistent).toBe(false)
    expect(store.load(layout.id)?.name).toBe('Private window')
  })
})
