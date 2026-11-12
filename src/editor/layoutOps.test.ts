import { describe, expect, it } from 'vitest'
import {
  addTower, changePrinted, copyUnitOnto, duplicateColumn, duplicateUnit, moveUnit, moveRow, newLayout, placeUnit, removeUnit, rowProblems, setTowerWidth, toEngineTower, updateTower,
  rowFloors, rowUnits, type EditorLayout, type OpResult, type UnitSpec,
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
    expect(rowFloors(layout.towers[0].rows[0])).toBe(2)
  })

  // Instructions Manual p8: L = S+S, XL = S+M.
  it('lets a second S sit beside an S in an L tower row', () => {
    const { layout, towerId } = towerWith({ ...drawer('L') })
    const s = ok(setTowerWidth(ok(removeUnit(layout, towerId, layout.towers[0].rows[0].columns[0].units[0].id)), towerId, 'L'))
    const withOne = ok(placeUnit(s, towerId, { kind: 'newRow', index: 0 }, drawer('S')))
    const rowId = withOne.towers[0].rows[0].id

    const withTwo = ok(placeUnit(withOne, towerId, { kind: 'beside', rowId }, drawer('S')))

    expect(rowUnits(withTwo.towers[0].rows[0]).map((u) => u.width)).toEqual(['S', 'S'])
    expect(rowProblems(withTwo.towers[0])).toEqual([])
  })

  it('refuses a unit that would overfill a row, and says why', () => {
    const { layout, towerId } = towerWith(drawer('L'))
    const rowId = layout.towers[0].rows[0].id

    const result = placeUnit(layout, towerId, { kind: 'beside', rowId }, drawer('S'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/full|room/i)
  })

  it('starts a second column of a different height, and flags the row until the columns match', () => {
    const { layout, towerId } = towerWith(drawer('L'))
    const narrowed = ok(placeUnit(
      ok(removeUnit(layout, towerId, layout.towers[0].rows[0].columns[0].units[0].id)), towerId, { kind: 'newRow', index: 0 }, drawer('S'),
    ))
    // Tower is now S wide; widen it so the row has room for a second S.
    const wide = ok(setTowerWidth(narrowed, towerId, 'L'))

    const result = ok(placeUnit(wide, towerId, { kind: 'beside', rowId: wide.towers[0].rows[0].id }, drawer('S', '2F')))

    expect(result.towers[0].rows[0].columns).toHaveLength(2)
    expect(rowProblems(result.towers[0])[0].problem).toMatch(/left column needs 1F more/)
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

    const empty = ok(removeUnit(layout, towerId, layout.towers[0].rows[0].columns[0].units[0].id))

    expect(empty.towers[0].rows).toEqual([])
    expect(empty.towers[0].width).toBeNull()
  })

  it('moves a row up or down the tower', () => {
    const { layout, towerId } = towerWith(drawer('M', '1F'), drawer('M', '2F'), drawer('M', '4F'))

    const moved = ok(moveRow(layout, towerId, 2, 0))

    expect(moved.towers[0].rows.map(rowFloors)).toEqual([4, 1, 2])
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
    const s = ok(placeUnit(ok(setTowerWidth(ok(removeUnit(layout, towerId, layout.towers[0].rows[0].columns[0].units[0].id)), towerId, 'L')),
      towerId, { kind: 'newRow', index: 0 }, drawer('S')))
    const original = s.towers[0].rows[0].columns[0].units[0]

    const copied = ok(duplicateUnit(s, towerId, original.id))

    const row = copied.towers[0].rows[0]
    expect(copied.towers[0].rows).toHaveLength(1)
    const units = rowUnits(row)
    expect(units).toHaveLength(2)
    expect(units[1]).toEqual({ ...original, id: units[1].id })
    expect(units[1].id).not.toBe(original.id)
  })

  it('puts the copy in a new row directly above when there is no room beside it', () => {
    const { layout, towerId } = towerWith(drawer('M', '2F'), drawer('M'))
    const lower = layout.towers[0].rows[0]

    const copied = ok(duplicateUnit(layout, towerId, lower.columns[0].units[0].id))

    const rows = copied.towers[0].rows
    expect(rows).toHaveLength(3)
    expect(rows[0].id).toBe(lower.id)
    expect(rowFloors(rows[1])).toBe(2)
    expect(rowUnits(rows[1])[0].width).toBe('M')
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

  // The reporter's example: S4F + S1F on the left, S2F + S1F + S2F on the right, both 5F.
  it('stacks units in each column of a split row, and accepts columns that reach the same height', () => {
    let { layout, towerId } = towerWith(drawer('S', '4F'))
    layout = ok(setTowerWidth(layout, towerId, 'L'))
    const rowId = () => layout.towers[0].rows[0].id
    const column = (i: number) => layout.towers[0].rows[0].columns[i].id
    layout = ok(placeUnit(layout, towerId, { kind: 'onColumn', rowId: rowId(), columnId: column(0) }, drawer('S', '1F')))
    layout = ok(placeUnit(layout, towerId, { kind: 'beside', rowId: rowId() }, drawer('S', '2F')))
    expect(rowProblems(layout.towers[0])[0].problem).toMatch(/right column needs 3F more to reach 5F/)

    layout = ok(placeUnit(layout, towerId, { kind: 'onColumn', rowId: rowId(), columnId: column(1) }, drawer('S', '1F')))
    layout = ok(placeUnit(layout, towerId, { kind: 'onColumn', rowId: rowId(), columnId: column(1) }, drawer('S', '2F')))

    expect(rowProblems(layout.towers[0])).toEqual([])
    expect(layout.towers[0].rows[0].columns.map((c) => c.units.map((u) => u.height))).toEqual([['4F', '1F'], ['2F', '1F', '2F']])
    expect(toEngineTower(layout.towers[0], 3)).not.toBeNull()
  })

  it('refuses a unit of another width on top of a column', () => {
    const { layout, towerId } = towerWith(drawer('S'))
    const wide = ok(setTowerWidth(layout, towerId, 'L'))
    const row = wide.towers[0].rows[0]

    const result = placeUnit(wide, towerId, { kind: 'onColumn', rowId: row.id, columnId: row.columns[0].id }, drawer('M'))

    expect(result.ok).toBe(false)
  })

  it('duplicates onto the shorter column of a split row', () => {
    let { layout, towerId } = towerWith(drawer('S', '2F'))
    layout = ok(setTowerWidth(layout, towerId, 'L'))
    layout = ok(placeUnit(layout, towerId, { kind: 'beside', rowId: layout.towers[0].rows[0].id }, drawer('S', '1F')))
    const short = layout.towers[0].rows[0].columns[1].units[0]

    const copied = ok(duplicateUnit(layout, towerId, short.id))

    expect(copied.towers[0].rows[0].columns[1].units.map((u) => u.height)).toEqual(['1F', '1F'])
    expect(rowProblems(copied.towers[0])).toEqual([])
  })

  // Issue #13: duplicating from the right column into a shorter left one.
  it('duplicates into whichever column is short of it, left or right', () => {
    let { layout, towerId } = towerWith(drawer('S', '1F'))
    layout = ok(setTowerWidth(layout, towerId, 'L'))
    layout = ok(placeUnit(layout, towerId, { kind: 'beside', rowId: layout.towers[0].rows[0].id }, drawer('S', '1F')))
    const row = layout.towers[0].rows[0]
    layout = ok(placeUnit(layout, towerId, { kind: 'onColumn', rowId: row.id, columnId: row.columns[1].id }, drawer('S', '1F')))
    const rightBottom = layout.towers[0].rows[0].columns[1].units[0]

    const copied = ok(duplicateUnit(layout, towerId, rightBottom.id))

    expect(copied.towers[0].rows[0].columns.map((c) => c.units.length)).toEqual([2, 2])
  })

  // Issue #12: a lone stack with nothing beside it can be copied across whole, finishing the row.
  it('copies a whole column across to fill its row', () => {
    let { layout, towerId } = towerWith(drawer('S', '2F'))
    layout = ok(setTowerWidth(layout, towerId, 'L'))
    const row = layout.towers[0].rows[0]
    layout = ok(placeUnit(layout, towerId, { kind: 'onColumn', rowId: row.id, columnId: row.columns[0].id }, drawer('S', '1F')))

    const copied = ok(duplicateColumn(layout, towerId, row.id, row.columns[0].id))

    const columns = copied.towers[0].rows[0].columns
    expect(columns.map((c) => c.units.map((u) => u.height))).toEqual([['2F', '1F'], ['2F', '1F']])
    expect(columns[1].units[0].id).not.toBe(columns[0].units[0].id)
    expect(rowProblems(copied.towers[0])).toEqual([])
  })

  it('copies a chosen unit onto a chosen column', () => {
    let { layout, towerId } = towerWith(drawer('S', '2F'))
    layout = ok(setTowerWidth(layout, towerId, 'L'))
    layout = ok(placeUnit(layout, towerId, { kind: 'beside', rowId: layout.towers[0].rows[0].id }, drawer('S', '4F')))
    const row = layout.towers[0].rows[0]

    const copied = ok(copyUnitOnto(layout, towerId, row.columns[0].units[0].id, row.id, row.columns[0].id))

    expect(copied.towers[0].rows[0].columns[0].units.map((u) => u.height)).toEqual(['2F', '2F'])
  })

  // Inserting between two stacked units (reported with an L tower: S2F sustainer under an S2F drawer).
  it('inserts a unit between two stacked units of a column', () => {
    let { layout, towerId } = towerWith(drawer('S', '2F'))
    layout = ok(setTowerWidth(layout, towerId, 'L'))
    const row = layout.towers[0].rows[0]
    layout = ok(placeUnit(layout, towerId, { kind: 'onColumn', rowId: row.id, columnId: row.columns[0].id }, drawer('S', '4F')))

    const inserted = ok(placeUnit(layout, towerId, { kind: 'onColumn', rowId: row.id, columnId: row.columns[0].id, index: 1 }, drawer('S', '1F')))

    expect(inserted.towers[0].rows[0].columns[0].units.map((u) => u.height)).toEqual(['2F', '1F', '4F'])
  })

  it('moves a unit to a new place in its own column', () => {
    let { layout, towerId } = towerWith(drawer('S', '1F'))
    layout = ok(setTowerWidth(layout, towerId, 'L'))
    const row = layout.towers[0].rows[0]
    const columnId = row.columns[0].id
    layout = ok(placeUnit(layout, towerId, { kind: 'onColumn', rowId: row.id, columnId }, drawer('S', '2F')))
    layout = ok(placeUnit(layout, towerId, { kind: 'onColumn', rowId: row.id, columnId }, drawer('S', '4F')))
    const bottom = layout.towers[0].rows[0].columns[0].units[0]

    // Dropped on the join between the 2F and the 4F (index 2, counted before the move).
    const moved = ok(moveUnit(layout, towerId, bottom.id, towerId, { kind: 'onColumn', rowId: row.id, columnId, index: 2 }))

    expect(moved.towers[0].rows[0].columns[0].units.map((u) => u.height)).toEqual(['2F', '1F', '4F'])
  })
})
