import { describe, expect, it } from 'vitest'
import { boxArrangements, boxesFill } from './model'

describe('boxArrangements', () => {
  // Issue #16: a Module holds Boxes adding up to its Height, in any order; one full-height Box is the default.
  it('lists every way to fill a Module with Boxes, the single Box first', () => {
    expect(boxArrangements('1F')).toEqual([['1F']])
    expect(boxArrangements('2F')).toEqual([['2F'], ['1F', '1F']])
    expect(boxArrangements('4F')).toEqual([
      ['4F'], ['2F', '2F'], ['2F', '1F', '1F'], ['1F', '2F', '1F'], ['1F', '1F', '2F'], ['1F', '1F', '1F', '1F'],
    ])
  })

  it('only lists arrangements that fill the Module', () => {
    for (const h of ['1F', '2F', '4F'] as const) for (const a of boxArrangements(h)) expect(boxesFill(a, h)).toBe(true)
  })
})
