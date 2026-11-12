import { describe, expect, it } from 'vitest'
import type { PartLine } from '../engine/parts'
import { onlyPart } from './exportTower'

const line = (path: string, qty: number): PartLine => ({ path, qty, role: 'body', source: 'test', flags: [] })

describe('onlyPart', () => {
  // "Print just this part", for a reprint when one fails or breaks: one copy of that part and nothing else.
  it('keeps one copy of the chosen part', () => {
    const lines = [line('a/Handle.stl', 2), line('a/Key.stl', 4)]
    expect(onlyPart(lines, 'a/Key.stl')).toEqual([{ ...lines[1], qty: 1 }])
  })

  it('refuses a part the tower no longer has', () => {
    expect(() => onlyPart([line('a/Handle.stl', 2)], 'a/Gone.stl')).toThrow(/no longer in this tower/)
  })
})
