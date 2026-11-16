import { describe, expect, it } from 'vitest'
import { withPaint } from './paintLines'
import type { PartLine } from './parts'

const line = (path: string, qty: number, role: PartLine['role'] = 'body'): PartLine => ({ path, qty, role, source: 't', flags: [] })
const colours = { body: '#D3D5D2', accent: '#8A8F93', secondary: '#2F3236' }

describe('withPaint', () => {
  it('splits painted copies off into lines of their own colour, leaving the rest in the role', () => {
    const lines = withPaint([line('A/Facade.stl', 3), line('A/Key.stl', 2, 'secondary')], new Map([['A/Facade.stl', [{ colour: '#c0392b', count: 2 }]]]), colours)
    expect(lines).toEqual([
      line('A/Facade.stl', 1),
      { ...line('A/Facade.stl', 2), colour: '#C0392B' },
      line('A/Key.stl', 2, 'secondary'),
    ])
  })

  it('treats paint in one of the layout colours as that colour role', () => {
    const lines = withPaint([line('A/Facade.stl', 2)], new Map([['A/Facade.stl', [{ colour: '#2f3236', count: 2 }]]]), colours)
    expect(lines).toEqual([line('A/Facade.stl', 2, 'secondary')])
  })

  it('never paints more copies than the line has', () => {
    const lines = withPaint([line('A/Facade.stl', 1)], new Map([['A/Facade.stl', [{ colour: '#ff0000', count: 3 }]]]), colours)
    expect(lines).toEqual([{ ...line('A/Facade.stl', 1), colour: '#FF0000' }])
  })
})
