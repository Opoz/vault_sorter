import { describe, expect, it } from 'vitest'
import { pickInScene, withoutPart } from './useEditor'

describe('pickInScene', () => {
  const box = 'drawers/S3 Box 1F.stl'
  it("selects a part's unit first", () => {
    expect(pickInScene(null, 't', 'u1', box)).toEqual({ type: 'unit', towerId: 't', unitId: 'u1' })
    expect(pickInScene({ type: 'unit', towerId: 't', unitId: 'u2' }, 't', 'u1', box)).toEqual({ type: 'unit', towerId: 't', unitId: 'u1' })
  })
  it('picks the part out once its unit is selected', () => {
    expect(pickInScene({ type: 'unit', towerId: 't', unitId: 'u1' }, 't', 'u1', box)).toEqual({ type: 'unit', towerId: 't', unitId: 'u1', part: box })
  })
  it("treats the tower's own parts the same way, through the tower", () => {
    const roof = 'drawers/S3 Grid Roof.stl'
    expect(pickInScene({ type: 'unit', towerId: 't', unitId: 'u1' }, 't', undefined, roof)).toEqual({ type: 'tower', towerId: 't' })
    expect(pickInScene({ type: 'tower', towerId: 't' }, 't', undefined, roof)).toEqual({ type: 'tower', towerId: 't', part: roof })
  })
})

describe('withoutPart', () => {
  it('drops the picked part but keeps its owner selected', () => {
    expect(withoutPart({ type: 'unit', towerId: 't', unitId: 'u', part: 'a.stl' })).toEqual({ type: 'unit', towerId: 't', unitId: 'u' })
    expect(withoutPart({ type: 'tower', towerId: 't' })).toEqual({ type: 'tower', towerId: 't' })
    expect(withoutPart(null)).toBeNull()
  })
})
