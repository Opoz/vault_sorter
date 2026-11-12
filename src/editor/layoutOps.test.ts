import { describe, expect, it } from 'vitest'
import {
  addTower, changePrinted, duplicateUnit, moveRow, newLayout, placeUnit, removeUnit, rowProblems, setTowerWidth, toEngineTower, updateTower,
  type EditorLayout, type OpResult, type UnitSpec,
} from './layoutOps'

const drawer = (width: UnitSpec['width'], height: UnitSpec['height'] = '1F'): UnitSpec => ({ kind: 'drawer', width, height })
const ok = (r: OpResult): EditorLayout => {
  if (!r.ok) throw new Error(`expected success, got: ${r.reason}`)
  return r.layout
}

function towerWith(...specs: UnitSpec[]) {
  let layout = ok(addTower(newLayout('Test')))
  const towerId = layout.towers[0].id
  for (const spec of specs) layout = ok(placeUnit(layout, towerId, { kind: 'newRow', index: layout.towers[0].rows.length }, spec))
  return { layout, towerId }
}

describe('layout editing', () => {
  it('gives an empty tower the width of the first unit dropped into it', () => {
    const { layout } = towerWith(drawer('M', '2F'))

    expect(layout.towers[0].width).toBe('M')
    expect(layout.towers[0].rows).toHaveLength(1)
    expect(layout.towers[0].rows[0].height).toBe('2F')
  })

  // Instructions Manual p8: L = S+S, XL = S+M.
  it('lets a second S sit beside an S in an L tower row', () => {
    const { layout, towerId } = towerWith({ ...drawer('L') })
    const s = ok(setTowerWidth(ok(removeUnit(layout, towerId, layout.towers[0].rows[0].units[0].id)), towerId, 'L'))
    const withOne = ok(placeUnit(s, towerId, { kind: 'newRow', index: 0 }, drawer('S')))
    const rowId = withOne.towers[0].rows[0].id

    const withTwo = ok(placeUnit(withOne, towerId, { kind: 'beside', rowId }, drawer('S')))

    expect(withTwo.towers[0].rows[0].units.map((u) => u.width)).toEqual(['S', 'S'])
    expect(rowProblems(withTwo.towers[0])).toEqual([])
  })

  it('refuses a unit that would overfill a row, and says why', () => {
    const { layout, towerId } = towerWith(drawer('L'))
    const rowId = layout.towers[0].rows[0].id

    const result = placeUnit(layout, towerId, { kind: 'beside', rowId }, drawer('S'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/full|room/i)
  })

  it('refuses a unit of a different height beside another in the same row', () => {
    const { layout, towerId } = towerWith(drawer('L'))
    const narrowed = ok(placeUnit(
      ok(removeUnit(layout, towerId, layout.towers[0].rows[0].units[0].id)), towerId, { kind: 'newRow', index: 0 }, drawer('S'),
    ))
    // Tower is now S wide; widen it so the row has room for a second S.
    const wide = ok(setTowerWidth(narrowed, towerId, 'L'))

    const result = placeUnit(wide, towerId, { kind: 'beside', rowId: wide.towers[0].rows[0].id }, drawer('S', '2F'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/height|1F/i)
  })

  it('refuses an XL unit taller than 1F', () => {
    const result = placeUnit(ok(addTower(newLayout('Test'))), 'missing', { kind: 'newRow', index: 0 }, drawer('XL', '2F'))
    expect(result.ok).toBe(false)
  })

  it('flags a row that is not yet full instead of refusing it', () => {
    const { layout, towerId } = towerWith(drawer('S'))
    const wide = ok(setTowerWidth(layout, towerId, 'L'))

    expect(rowProblems(wide.towers[0])).toEqual([{ rowIndex: 0, problem: expect.stringMatching(/another S/) }])
  })

  it('removes a row when its last unit goes, and resets an emptied tower', () => {
    const { layout, towerId } = towerWith(drawer('M'))

    const empty = ok(removeUnit(layout, towerId, layout.towers[0].rows[0].units[0].id))

    expect(empty.towers[0].rows).toEqual([])
    expect(empty.towers[0].width).toBeNull()
  })

  it('moves a row up or down the tower', () => {
    const { layout, towerId } = towerWith(drawer('M', '1F'), drawer('M', '2F'), drawer('M', '4F'))

    const moved = ok(moveRow(layout, towerId, 2, 0))

    expect(moved.towers[0].rows.map((r) => r.height)).toEqual(['4F', '1F', '2F'])
  })

  it('refuses to narrow a tower below a row that needs the width', () => {
    const { layout, towerId } = towerWith(drawer('L'))

    const result = setTowerWidth(layout, towerId, 'S')

    expect(result.ok).toBe(false)
  })

  it('clears wheels, feet or casters when the roof becomes an under-table mount', () => {
    const { layout, towerId } = towerWith(drawer('M'))
    const wheeled = ok(updateTower(layout, towerId, { bottom: 'wheels' }))

    const hung = ok(updateTower(wheeled, towerId, { roof: 'under table mount' }))

    expect(hung.towers[0].bottom).toBe('none')
  })

  it('duplicates a unit into the free space beside it, keeping its settings', () => {
    const { layout, towerId } = towerWith(drawer('L'))
    const s = ok(placeUnit(ok(setTowerWidth(ok(removeUnit(layout, towerId, layout.towers[0].rows[0].units[0].id)), towerId, 'L')),
      towerId, { kind: 'newRow', index: 0 }, drawer('S')))
    const original = s.towers[0].rows[0].units[0]

    const copied = ok(duplicateUnit(s, towerId, original.id))

    const row = copied.towers[0].rows[0]
    expect(copied.towers[0].rows).toHaveLength(1)
    expect(row.units).toHaveLength(2)
    expect(row.units[1]).toEqual({ ...original, id: row.units[1].id })
    expect(row.units[1].id).not.toBe(original.id)
  })

  it('puts the copy in a new row directly above when there is no room beside it', () => {
    const { layout, towerId } = towerWith(drawer('M', '2F'), drawer('M'))
    const lower = layout.towers[0].rows[0]

    const copied = ok(duplicateUnit(layout, towerId, lower.units[0].id))

    const rows = copied.towers[0].rows
    expect(rows).toHaveLength(3)
    expect(rows[0].id).toBe(lower.id)
    expect(rows[1].height).toBe('2F')
    expect(rows[1].units[0].width).toBe('M')
  })

  it('counts printed parts up and down for a tower, never below zero', () => {
    const { layout, towerId } = towerWith(drawer('M'))

    const once = ok(changePrinted(layout, towerId, { 'A/Key.stl': 2, 'A/Module.stl': 1 }))
    const undone = ok(changePrinted(once, towerId, { 'A/Key.stl': -1, 'A/Module.stl': -3 }))

    expect(once.towers[0].printed).toEqual({ 'A/Key.stl': 2, 'A/Module.stl': 1 })
    expect(undone.towers[0].printed).toEqual({ 'A/Key.stl': 1 })
  })

  it('drops handles and pegboard when the backbone they fix to goes', () => {
    const { layout, towerId } = towerWith(drawer('M'))
    const fitted = ok(updateTower(layout, towerId, { backbone: 'matching', pullOutHandle: true, stationaryHandle: true, pegboard: 'skadis' }))

    const bare = ok(updateTower(fitted, towerId, { backbone: 'none' })).towers[0]

    expect([bare.pullOutHandle, bare.stationaryHandle, bare.pegboard]).toEqual([false, false, undefined])
  })

  it('takes away the backbone, base and under-table roof when a tower goes on the wall', () => {
    const { layout, towerId } = towerWith(drawer('M'))
    const fitted = ok(updateTower(layout, towerId, { backbone: 'matching', pullOutHandle: true, bottom: 'wheels', roof: 'grid' }))

    const hung = ok(updateTower(fitted, towerId, { wallMount: true })).towers[0]

    expect([hung.backbone, hung.pullOutHandle, hung.bottom, hung.roof]).toEqual(['none', false, 'none', 'grid'])
  })

  it('passes the back attachments on to the parts engine', () => {
    const { layout, towerId } = towerWith(drawer('M'))
    const fitted = ok(updateTower(layout, towerId, { backbone: 'matching', pullOutHandle: true, pegboard: 'ussa' })).towers[0]

    expect(toEngineTower(fitted, 3)).toMatchObject({ pullOutHandle: true, pegboard: 'ussa', stationaryHandle: false, wallMount: false })
  })
})
