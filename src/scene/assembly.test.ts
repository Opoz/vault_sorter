import { describe, expect, it } from 'vitest'
import type { EditorStackedUnit, EditorTower } from '../editor/layoutOps'
import type { Depth, Height, Width } from '../engine/model'
import { partsForTower } from '../engine/parts'
import { realCatalog } from '../engine/testing'
import { assembleTower, emptySpaces, explodedCenter, planTurn, type ScenePart } from './assembly'
import { toEngineTower } from '../editor/layoutOps'

const H2S = { name: 'Bambu Lab H2S', bed: { width: 340, depth: 320 }, height: 340 }
const opts = { catalog: realCatalog, printer: H2S }

let next = 0
const drawer = (width: Width, height: Height, extra: Partial<EditorStackedUnit> = {}): EditorStackedUnit =>
  ({ id: `u${next++}`, kind: 'drawer', width, height, baseplate: 'plain', gearedRails: true, key: 'normal', ...extra }) as EditorStackedUnit
const sustainer = (width: Width, height: Height): EditorStackedUnit =>
  ({ id: `u${next++}`, kind: 'sustainer', width, height, moduleType: 'flat' })

function tower(width: Width, rows: EditorStackedUnit[][][], extra: Partial<EditorTower> = {}): EditorTower {
  return {
    id: 't', width, depth: 4, roof: 'grid', bottom: 'wheels', backbone: 'matching', stationaryHandle: true,
    rows: rows.map((columns, r) => ({ id: `r${r}`, columns: columns.map((units, c) => ({ id: `c${r}${c}`, width: units[0].width, units })) })),
    ...extra,
  }
}

const boxTop = (p: ScenePart) => p.center[1] + p.size[1] / 2
const boxBottom = (p: ScenePart) => p.center[1] - p.size[1] / 2
const file = (p: ScenePart) => p.path.split('/').pop()!

describe('assembleTower', () => {
  const full = tower('L', [
    [[drawer('L', '1F')]],
    [[drawer('S', '2F'), drawer('S', '1F')], [sustainer('S', '1F'), drawer('S', '2F')]],
    [[sustainer('L', '2F')]],
  ], { pegboard: 'skadis', pullOutHandle: true })

  it('draws every printed part of a finished tower, as many times as it is printed (tools aside)', () => {
    const depth: Depth = 4
    const lines = partsForTower(toEngineTower(full, depth)!, opts).filter((l) => !/jig/i.test(l.path))
    const scene = assembleTower(full, depth, opts)
    // A file drawn as several loose pieces (the springs) counts once per copy.
    const copies = scene.filter((p) => !p.piece)
    const count = (path: string) => copies.filter((p) => p.path === path).length
    for (const line of lines) expect([line.path, count(line.path)]).toEqual([line.path, line.qty])
    expect(copies.length).toBe(lines.reduce((n, l) => n + l.qty, 0))
    expect(new Set(scene.map((p) => p.key)).size).toBe(scene.length)
  })

  it('stacks rows bottom first: the roof on top, the base underneath', () => {
    const scene = assembleTower(full, 4, opts)
    const modules = scene.filter((p) => /module/i.test(file(p)))
    const roof = scene.find((p) => /grid roof/i.test(file(p)))!
    const base = scene.find((p) => /\bbase\b/i.test(file(p)))!
    for (const m of modules) {
      expect(boxTop(m)).toBeLessThanOrEqual(boxBottom(roof) + 0.01)
      // The base's 5 mm clips reach up into the bottom Module's feet; its top surface meets the Module's body.
      expect(boxBottom(m) + 0.5).toBeGreaterThanOrEqual(boxTop(base) - 5 - 0.01)
    }
    // Real heights (issue #17): the 1F drawer Row (48 mm), the split Row as tall as its taller Column, a 1F
    // sustainer (60.7) under a 2F drawer (96), then the top Row's 2F sustainer: its Module (84.8 mm, its feet
    // 4.5 mm below the floor line) and the lid's top surface 13.9 mm above the rim. The roof sits on that.
    expect(boxBottom(roof)).toBeCloseTo(48 + 60.7 + 96 - 4.5 + 84.8 + 13.9)
  })

  it('places the columns of a split row side by side, left first', () => {
    const scene = assembleTower(full, 4, opts)
    const left = scene.find((p) => p.unitId === full.rows[1].columns[0].units[0].id && /module/i.test(file(p)))!
    const right = scene.find((p) => p.unitId === full.rows[1].columns[1].units[0].id && /module/i.test(file(p)))!
    expect(left.center[0]).toBeLessThan(0)
    expect(right.center[0]).toBeGreaterThan(0)
  })

  it('keeps every unit part near its module', () => {
    const scene = assembleTower(full, 4, opts)
    for (const p of scene.filter((s) => s.unitId)) {
      const m = scene.find((s) => s.unitId === p.unitId && /module/i.test(file(s)))!
      for (const axis of [0, 1, 2]) {
        const reach = m.size[axis] / 2 + p.size[axis] / 2 + 60
        expect([file(p), axis, Math.abs(p.center[axis] - m.center[axis]) <= reach]).toEqual([file(p), axis, true])
      }
    }
  })

  it('shows an unfinished tower: empty space stays empty, and a lone right column sits on the right', () => {
    const floating = drawer('S', '1F', { gapBelow: 2 })
    const unfinished: EditorTower = {
      ...tower('L', [[[drawer('S', '1F')]]]),
      rows: [{ id: 'r0', soloSide: 'right', columns: [{ id: 'c0', width: 'S', units: [floating] }] }],
    }
    const module = assembleTower(unfinished, 4, opts).find((p) => p.unitId === floating.id && /module/i.test(file(p)))!
    expect(boxBottom(module)).toBeCloseTo(2 * 48)
    expect(module.center[0]).toBeGreaterThan(0)
  })

  it('draws nothing for a tower with no units yet', () => {
    expect(assembleTower({ ...full, width: null, rows: [] }, 4, opts)).toEqual([])
  })
})

describe('explodedCenter', () => {
  const t = tower('S', [[[drawer('S', '1F')]], [[drawer('S', '2F')]]], { roof: 'grid', bottom: 'none', backbone: 'none', stationaryHandle: false })
  const scene = assembleTower(t, 4, opts)
  const of = (unitId: string, pattern: RegExp) => scene.find((p) => p.unitId === unitId && pattern.test(file(p)))!
  const [lower, upper] = [t.rows[0].columns[0].units[0].id, t.rows[1].columns[0].units[0].id]

  it('is the assembled position at 0', () => {
    for (const p of scene) expect(explodedCenter(p, 0)).toEqual(p.center)
  })

  it('pulls the box out of the front and spreads units upward when fully apart', () => {
    const box = of(lower, /box/i)
    const module = of(lower, /module/i)
    expect(explodedCenter(box, 1)[2] - box.size[2] / 2).toBeGreaterThan(module.center[2])
    expect(explodedCenter(of(upper, /module/i), 1)[1]).toBeGreaterThan(of(upper, /module/i).center[1])
  })

  it('with a unit chosen, only that unit comes apart', () => {
    for (const p of scene) {
      const moved = explodedCenter(p, 1, upper).some((v, i) => v !== p.center[i])
      if (p.unitId !== upper) expect(moved).toBe(false)
    }
    expect(explodedCenter(of(upper, /box/i), 1, upper)[2]).toBeGreaterThan(of(upper, /box/i).center[2])
  })
})

describe('emptySpaces', () => {
  it('outlines empty space under a floating unit, above a short column and beside a lone column', () => {
    const floating = drawer('S', '1F', { gapBelow: 2 })
    const t: EditorTower = {
      ...tower('L', [[[drawer('S', '1F')]]]),
      rows: [{ id: 'r0', soloSide: 'right', columns: [{ id: 'c0', width: 'S', units: [floating] }] }],
    }
    const spaces = emptySpaces(t, 4)
    // Under the floating unit (2F on the right) and the whole missing left side (3F).
    expect(spaces.map((s) => [Math.sign(s.center[0]), Math.round(s.size[1] / 48)]).sort()).toEqual([[-1, 3], [1, 2]])
  })
})

describe('checked placements', () => {
  it('marks the drawer Module as checked against the manual, and leaves guesses unmarked', () => {
    const t = tower('S', [[[drawer('S', '1F')]]])
    const scene = assembleTower(t, 3, opts)
    expect(scene.find((p) => /module/i.test(file(p)))!.checked).toMatch(/Drawer Assembly p8/)
    expect(scene.find((p) => /grid roof/i.test(file(p)))!.checked).toBeUndefined()
  })
})

describe('runner stoppers', () => {
  it('sit in the side slots, which move with depth: 28.5 mm in front of the module middle', () => {
    for (const depth of [3, 7] as const) {
      const scene = assembleTower(tower('S', [[[drawer('S', '1F')]]]), depth, opts)
      const module = scene.find((p) => /module/i.test(file(p)))!
      for (const stopper of scene.filter((p) => /stopper/i.test(file(p)))) expect(stopper.center[2] - module.center[2]).toBeCloseTo(28.5)
    }
  })
})

describe('drawer front', () => {
  it('keeps the key, springs, label and a cap on the bottom floor of a taller drawer, two caps on its top floor', () => {
    const scene = assembleTower(tower('S', [[[drawer('S', '4F')]]]), 3, opts)
    const facade = scene.find((p) => /^S4F/.test(file(p)))!
    const fromBottom = (re: RegExp) => scene.filter((p) => re.test(file(p))).map((p) => Math.round(p.center[1] - boxBottom(facade)))
    expect(new Set(fromBottom(/^(key|springs|label)/i))).toEqual(new Set([24]))
    expect(fromBottom(/^facade cap/i).sort((a, b) => a - b)).toEqual([24, 168, 168])
  })
  it('puts two latches under an L drawer, a quarter of the width either side', () => {
    const scene = assembleTower(tower('L', [[[drawer('L', '1F')]]]), 4, opts)
    const module = scene.find((p) => /module/i.test(file(p)))!
    const xs = scene.filter((p) => /latch/i.test(file(p))).map((p) => p.center[0] - module.center[0]).sort((a, b) => a - b)
    expect(xs).toEqual([expect.closeTo(-module.size[0] / 4), expect.closeTo(module.size[0] / 4)])
  })
})

describe('runners', () => {
  it('stay inside the module sides at every width and depth', () => {
    for (const w of ['S', 'M', 'L', 'XL'] as const) {
      for (const depth of [3, 7] as const) {
        const scene = assembleTower(tower(w, [[[drawer(w, '1F')]]]), depth, opts)
        const module = scene.find((p) => /module/i.test(file(p)))!
        for (const r of scene.filter((p) => /runner (guide|slide)/i.test(file(p)))) {
          const reach = Math.abs(r.center[0] - module.center[0]) + r.size[0] / 2
          expect([w, depth, file(r), reach <= module.size[0] / 2]).toEqual([w, depth, file(r), true])
        }
      }
    }
  })
})

describe('a drawer Module holding several Boxes', () => {
  // Issue #16: each Box sits in its own slot, bottom first, with its key, springs and label on its bottom floor.
  it('puts each Box and its key on its own floor, and draws every copy once', () => {
    const unit = drawer('L', '4F', { boxes: ['2F', '1F', '1F'], gearedRails: false, baseplate: 'none' })
    const scene = assembleTower(tower('L', [[[unit]]], { roof: 'none', bottom: 'none', backbone: 'none' }), 4, opts)
    const module = scene.find((p) => /module/i.test(file(p)))!
    const floorOf = (p: ScenePart) => Math.floor((p.center[1] - boxBottom(module) - 4.5) / 48)
    const keys = scene.filter((p) => /^key \(/i.test(file(p))).map(floorOf).sort()
    expect(keys).toEqual([0, 2, 3])
    const boxes = scene.filter((p) => /box/i.test(file(p))).map((p) => [file(p), floorOf(p)]).sort()
    expect(boxes).toEqual([['L4 Box 1F.stl', 2], ['L4 Box 1F.stl', 3], ['L4 Box 2F.stl', 0]])
    expect(scene.filter((p) => /latch/i.test(file(p)))).toHaveLength(2)
  })
})

describe('roof over a sustainer', () => {
  it('sits on the lid top surface, which stands above the floor line', () => {
    const scene = assembleTower(tower('S', [[[sustainer('S', '1F')]]]), 4, opts)
    const lid = scene.find((p) => p.unitId && /roof/i.test(file(p)))!
    const roof = scene.find((p) => !p.unitId && /grid roof/i.test(file(p)))!
    // On its top surface, the 6 mm stacking tabs reaching up into the roof.
    expect(boxBottom(roof)).toBeCloseTo(boxTop(lid) - 6)
  })
})

describe('planTurn', () => {
  // A 100 × 20 rectangle, turned by `deg` on the bed.
  const turned = (deg: number) => {
    const r = (deg * Math.PI) / 180
    return ([[-50, -10], [50, -10], [50, 10], [-50, 10]] as const).map(([x, y]) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)] as const)
  }
  it('leaves a file stored square alone', () => {
    expect(planTurn(turned(0), [100, 20])).toBe(0)
  })
  it('squares up a file stored at an angle, long side where the part needs it', () => {
    const along = planTurn(turned(45), [100, 20])
    expect(Math.abs(along) % 180).toBeCloseTo(45)
    const across = planTurn(turned(45), [20, 100])
    expect(Math.abs(across) % 180).toBeCloseTo(45)
    expect(Math.abs(along - across) % 180).toBeCloseTo(90)
  })
  it('turns the real L4 1F module, stored diagonally, so its width lies along x', () => {
    const scene = assembleTower(tower('L', [[[drawer('L', '1F')]]]), 4, opts)
    const module = scene.find((p) => /module/i.test(file(p)))!
    expect(Math.abs(module.planDeg ?? 0)).toBeGreaterThan(10)
  })
})
