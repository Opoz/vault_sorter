import { describe, expect, it } from 'vitest'
import type { EditorStackedUnit, EditorTower } from '../editor/layoutOps'
import { assembleTower } from '../scene/assembly'
import { catalog } from './data'
import { drawingTargets } from './paintTargets'

const H2S = { name: 'Bambu Lab H2S', bed: { width: 340, depth: 320 }, height: 340 }

describe('drawingTargets (issue #7)', () => {
  // Painting a piece of the 2D drawing must paint the same part copy the 3D view draws there.
  it('points each Box\'s facade, key, label and caps at the 3D parts on that Box\'s floor', () => {
    const unit = { id: 'u', kind: 'drawer', width: 'L', height: '4F', baseplate: 'none', gearedRails: false, key: 'normal', boxes: ['2F', '1F', '1F'] } as EditorStackedUnit
    const tower: EditorTower = {
      id: 't', width: 'L', depth: 4, roof: 'none', bottom: 'none', backbone: 'none',
      rows: [{ id: 'r', columns: [{ id: 'c', width: 'L', units: [unit] }] }],
    }
    const scene = assembleTower(tower, 4, { catalog, printer: H2S })
    const module = scene.find((p) => /module/i.test(p.path))!
    const bottom = module.center[1] - module.size[1] / 2 + 4.5
    const floorOf = (t: { owner: string; path: string; copy: number }) => {
      const part = scene.find((p) => p.owner === t.owner && p.path === t.path && p.copy === t.copy)
      return part ? Math.floor((part.center[1] - bottom) / 48) : undefined
    }
    const targets = drawingTargets(unit, 4)
    expect(targets.boxes).toHaveLength(3)
    const starts = [0, 2, 3]
    targets.boxes.forEach((box, i) => {
      for (const t of [box.facade, box.key, box.label, ...box.caps]) {
        expect(t).toBeDefined()
        const floor = floorOf(t!)
        // A 2F Box's parts sit on its bottom floor, apart from the top-floor caps of its Facade.
        expect([i, floor !== undefined && floor >= starts[i] && floor < starts[i] + (i === 0 ? 2 : 1)]).toEqual([i, true])
      }
    })
    expect(targets.module).toEqual({ owner: module.owner, path: module.path, copy: module.copy })
  })
})
