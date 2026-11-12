import { describe, expect, it } from 'vitest'
import type { PartLine } from './parts'
import type { PackedPlate } from './plates'
import { partProgress, platesDone } from './progress'

const line = (path: string, qty: number): PartLine => ({ path, qty, role: 'body', source: 't', flags: [] })
const plate = (index: number, ...paths: string[]): PackedPlate => ({
  index, role: 'body', material: 'PLA', edgeMm: 5,
  items: paths.map((path) => ({ path, role: 'body', material: 'PLA', angleDeg: 0, pivot: [0, 0], x: 0, y: 0 })),
})

describe('print progress', () => {
  it('counts printed parts against the parts list, never more than it asks for', () => {
    const lines = [line('A/Module.stl', 2), line('A/Key.stl', 3)]

    const progress = partProgress(lines, { 'A/Module.stl': 1, 'A/Key.stl': 5, 'A/Gone.stl': 4 })

    expect(progress.done).toBe(1 + 3)
    expect(progress.total).toBe(5)
    expect(progress.byPath.get('A/Key.stl')).toBe(3)
  })

  // Plates aren't stored: they change with the printer and settings. A plate counts as printed when the printed
  // parts cover it, handing them out to plates in printing order.
  it('marks plates printed in order as the printed parts cover them', () => {
    const plates = [plate(1, 'A/Module.stl', 'A/Key.stl'), plate(2, 'A/Module.stl', 'A/Key.stl'), plate(3, 'A/Key.stl')]

    expect(platesDone(plates, {})).toEqual([false, false, false])
    expect(platesDone(plates, { 'A/Module.stl': 1, 'A/Key.stl': 1 })).toEqual([true, false, false])
    expect(platesDone(plates, { 'A/Module.stl': 1, 'A/Key.stl': 3 })).toEqual([true, false, true])
    expect(platesDone(plates, { 'A/Module.stl': 2, 'A/Key.stl': 3 })).toEqual([true, true, true])
  })
})
