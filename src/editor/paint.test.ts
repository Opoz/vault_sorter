import { describe, expect, it } from 'vitest'
import { newLayout, type EditorLayout, type EditorTower } from './layoutOps'
import { paintedColour, paintPart, type PaintTarget } from './paint'

const layoutWith = (tower: Partial<EditorTower> = {}): EditorLayout => {
  const base = newLayout('Test')
  return { ...base, towers: [{ ...base.towers[0], id: 't', ...tower }] }
}
const towerOf = (layout: EditorLayout) => layout.towers[0]
const facade = (owner: string, copy = 0): PaintTarget => ({ owner, path: 'drawers/S1F.stl', copy })

describe('painting parts (issue #7)', () => {
  it('leaves a part in its colour role until it is painted', () => {
    expect(paintedColour(towerOf(layoutWith()), facade('u1'))).toBeUndefined()
  })

  it('paints just the one part', () => {
    const result = paintPart(layoutWith(), 't', facade('u1'), '#c0392b', 'one')
    if (!result.ok) throw new Error(result.reason)
    const tower = towerOf(result.layout)
    expect(paintedColour(tower, facade('u1'))).toBe('#c0392b')
    expect(paintedColour(tower, facade('u2'))).toBeUndefined()
    expect(paintedColour(tower, facade('u1', 1))).toBeUndefined()
  })

  it('paints every copy of the file in the tower, replacing one-off paint on it', () => {
    const one = paintPart(layoutWith(), 't', facade('u1'), '#c0392b', 'one')
    if (!one.ok) throw new Error(one.reason)
    const all = paintPart(one.layout, 't', facade('u2'), '#2e86de', 'all')
    if (!all.ok) throw new Error(all.reason)
    const tower = towerOf(all.layout)
    expect([paintedColour(tower, facade('u1')), paintedColour(tower, facade('u2')), paintedColour(tower, facade('u3', 2))])
      .toEqual(['#2e86de', '#2e86de', '#2e86de'])
  })

  it('lets one part differ from an all-copies colour', () => {
    const all = paintPart(layoutWith(), 't', facade('u1'), '#2e86de', 'all')
    if (!all.ok) throw new Error(all.reason)
    const one = paintPart(all.layout, 't', facade('u2'), '#f1c40f', 'one')
    if (!one.ok) throw new Error(one.reason)
    const tower = towerOf(one.layout)
    expect([paintedColour(tower, facade('u1')), paintedColour(tower, facade('u2'))]).toEqual(['#2e86de', '#f1c40f'])
  })

  it('puts parts back in their colour role when painted with none', () => {
    const all = paintPart(layoutWith(), 't', facade('u1'), '#2e86de', 'all')
    if (!all.ok) throw new Error(all.reason)
    const cleared = paintPart(all.layout, 't', facade('u1'), null, 'all')
    if (!cleared.ok) throw new Error(cleared.reason)
    expect(paintedColour(towerOf(cleared.layout), facade('u2'))).toBeUndefined()
    expect(towerOf(cleared.layout).paint).toBeUndefined()
  })
})
