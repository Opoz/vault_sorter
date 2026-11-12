import { describe, expect, it } from 'vitest'
import type { Height, Tower, Unit } from './model'
import { partsForTower, type PartLine, type PartsOptions } from './parts'
import { realCatalog } from './testing'

const H2S = { name: 'Bambu Lab H2S', bed: { width: 340, depth: 320 }, height: 340 }
const opts: PartsOptions = { catalog: realCatalog, printer: H2S }

const drawer = (width: Unit['width'], extra: Partial<Extract<Unit, { kind: 'drawer' }>> = {}): Unit => ({
  kind: 'drawer', width, baseplate: 'none', gearedRails: false, key: 'normal', ...extra,
})

const tower = (t: Partial<Tower> & Pick<Tower, 'width' | 'depth' | 'rows'>): Tower => ({
  roof: 'none', bottom: 'none', backbone: 'none', ...t,
})

/** File name → quantity, which is how the manuals list parts. */
const byFile = (lines: PartLine[]) =>
  Object.fromEntries(lines.map((l) => [l.path.split('/').pop(), l.qty]))

describe('partsForTower', () => {
  // Drawer Assembly manual, pages 1–8.
  it('lists every part of a single drawer', () => {
    const t = tower({ width: 'S', depth: 3, rows: [{ height: '1F', units: [drawer('S')] }] })

    expect(byFile(partsForTower(t, opts))).toEqual({
      'S3 Module 1F.stl': 1,
      'S3 Box 1F.stl': 1,
      'S1F (Turn On Supports).stl': 1,
      'Key (Turn On Supports).stl': 1,
      'Key Cap.stl': 1,
      'Springs.stl': 1,
      'Facade Cap.stl': 1,
      'Label.stl': 1,
      'x3 Runner Slide.stl': 2,
      'x3 Runner Guide.stl': 2,
      'Runner Stopper.stl': 2,
      'Latch.stl': 1,
    })
  })

  describe('drawer options', () => {
    const one = (unit: Unit, width: Unit['width'] = unit.width, depth: Tower['depth'] = 3) =>
      byFile(partsForTower(tower({ width, depth, rows: [{ height: '1F', units: [unit] }] }), opts))

    it('adds the chosen Gridfinity baseplate', () => {
      expect(one(drawer('S', { baseplate: '2 handles' }))['S3 Baseplate_With 2 Handles.stl']).toBe(1)
    })

    // Drawer Assembly p4: "place top and bottom geared rails into a box". Each rail file is a single rail.
    it('adds a top and a bottom geared rail when asked', () => {
      expect(one(drawer('M', { gearedRails: true }))['M Rails.stl']).toBe(2)
    })

    it('swaps the key for the two-part hidden key', () => {
      const parts = one(drawer('S', { key: 'hidden' }))
      expect(parts['Hidden Key (Turn On Supports).stl']).toBe(1)
      expect(parts['Hidden Key Part 2 (Turn on Supports).stl']).toBe(1)
      expect(parts['Key (Turn On Supports).stl']).toBeUndefined()
    })

    it('uses the XL facade and XL runners for an XL drawer', () => {
      const parts = one(drawer('XL'))
      expect(parts['XL Facade 1F.stl']).toBe(1)
      expect(parts['x3 Runner Slide XL.stl']).toBe(2)
      expect(parts['x3 Runner Guide XL.stl']).toBe(2)
      expect(parts['x3 Runner Slide.stl']).toBeUndefined()
    })

    // The download only has M baseplates without handles or with 2 handles.
    it('refuses an option the Vault files do not include', () => {
      expect(() => one(drawer('M', { baseplate: '1 handle' }))).toThrow(/1 handle/)
    })
  })

  describe('sustainers', () => {
    const sustainer = (width: Unit['width'], moduleType: 'flat' | 'dividers' | 'sealed' = 'flat'): Unit =>
      ({ kind: 'sustainer', width, moduleType })
    const one = (unit: Unit, height: Height, depth: Tower['depth'] = 3, o = opts) =>
      byFile(partsForTower(tower({ width: unit.width, depth, rows: [{ height, units: [unit] }] }), o))

    // Instructions Manual p12 ("Sustainers Naming") and p17 (two hinges, two locks per module).
    it('lists every part of a single sustainer', () => {
      expect(one(sustainer('S'), '1F')).toEqual({
        'S3 1F Module.stl': 1,
        'S3 Roof.stl': 1,
        'S1F Facade.stl': 1,
        'S-M 1F Hinge.stl': 2,
        'S Hinge Top.stl': 2,
        'S-M Rods.stl': 1,
        'LOCK HOLDER.stl': 2,
        'LOCK INNER PART.stl': 2,
        'LOCK OUTER PART 1F.stl': 2,
        '1 SET OF PINS FOR 1 LOCK.stl': 2,
        'Label for Sustainers.stl': 1,
      })
    })

    it('uses the taller hinge and lock parts and the chosen module type for a 2F L sustainer', () => {
      const parts = one(sustainer('L', 'sealed'), '2F')
      expect(parts['L3 2F Sealed Module.stl']).toBe(1)
      expect(parts['L 2-4F Hinge.stl']).toBe(2)
      expect(parts['L-XL Hinge Top.stl']).toBe(2)
      expect(parts['LOCK OUTER PART 2-4F.stl']).toBe(2)
      expect(parts['L2F Facade.stl']).toBe(1)
    })

    // S7 Roof Whole is stored 324.1 mm tall: fits the H2S (340), not an X1C (256).
    it('uses the whole lid when it fits the printer, and the split lid when it does not', () => {
      const X1C = { name: 'Bambu Lab X1 Carbon', bed: { width: 256, depth: 256 }, height: 250 }
      const onH2S = one(sustainer('S'), '1F', 7)
      const onX1C = one(sustainer('S'), '1F', 7, { ...opts, printer: X1C })

      expect(onH2S['S7 Roof Whole.stl']).toBe(1)
      expect(onH2S['S7 Roof Part 1.stl']).toBeUndefined()
      expect(onX1C['S7 Roof Whole.stl']).toBeUndefined()
      expect(onX1C['S7 Roof Part 1.stl']).toBe(1)
      expect(onX1C['S7 Roof Part 2.stl']).toBe(1)
      expect(onX1C['Connector For Split Roof.stl']).toBe(1)
    })

    it('splits the lid anyway when the layout asks for split parts', () => {
      const parts = one(sustainer('S'), '1F', 7, { ...opts, splitParts: 'split' })
      expect(parts['S7 Roof Part 1.stl']).toBe(1)
      expect(parts['S7 Roof Whole.stl']).toBeUndefined()
    })
  })

  describe('tower parts', () => {
    const rows = (...heights: Height[]) =>
      heights.map((height) => ({ height, units: [drawer('M')] }))
    const parts = (t: Partial<Tower>) =>
      byFile(partsForTower(tower({ width: 'M', depth: 3, rows: rows('1F'), ...t }), opts))

    // Instructions Manual p18: the top handle sits on the grid roof.
    it('adds the roof, and the top handle for a grid roof', () => {
      const p = parts({ roof: 'grid' })
      expect(p['M3 Grid Roof.stl']).toBe(1)
      expect(p['Top Handle (Turn On Supports).stl']).toBe(1)
    })

    // The full XL heavyweight roof fits no Bambu printer; the undocumented "Cut" version does.
    it('uses the "Cut" heavyweight roof for XL and marks the swap as inferred', () => {
      const lines = partsForTower(
        tower({ width: 'XL', depth: 3, roof: 'heavyweight', rows: [{ height: '1F', units: [drawer('XL')] }] }),
        opts,
      )
      const roof = lines.find((l) => l.path.endsWith('XL3 Heavyweight Roof Cut.stl'))
      expect(roof?.qty).toBe(1)
      expect(roof?.flags.some((f) => f.kind === 'inferred')).toBe(true)
      expect(byFile(lines)['XL3 Heawyweight Roof.stl']).toBeUndefined()
    })

    it('refuses a heavyweight roof for widths that do not have one', () => {
      expect(() => parts({ roof: 'heavyweight' })).toThrow(/heavyweight/i)
    })

    // Modifications pp2–6: rod through the base, a wheel at each end, one foot at the other end.
    it('adds the base, two wheels and one foot for a wheeled tower', () => {
      const p = parts({ bottom: 'wheels' })
      expect(p['M3 Base.stl']).toBe(1)
      expect(p['Disk.stl']).toBe(2)
      expect(p['Bushing.stl']).toBe(2)
      expect(p['Tyre (TPU).stl']).toBe(2)
      expect(p['Cover.stl']).toBe(2)
      expect(p['M Feet.stl']).toBe(1)
    })

    it('adds the base and two feet for a tower on feet', () => {
      const p = parts({ bottom: 'feet' })
      expect(p['M3 Base.stl']).toBe(1)
      expect(p['M Feet.stl']).toBe(2)
    })

    it('adds one backbone per Row, two 2F backbones for a 4F Row', () => {
      const p = parts({ backbone: 'matching', rows: rows('1F', '2F', '4F') })
      expect(p['M1F Backbone.stl']).toBe(1)
      expect(p['M2F Backbone.stl']).toBe(3)
    })

    it('refuses wheels, feet or casters under an under-table tower', () => {
      expect(() => parts({ roof: 'under table mount', bottom: 'wheels' })).toThrow(/under.table/i)
    })

    it('refuses a Row whose Units do not add up to the Tower width', () => {
      expect(() => partsForTower(
        tower({ width: 'L', depth: 3, rows: [{ height: '1F', units: [drawer('S'), drawer('M')] }] }),
        opts,
      )).toThrow(/width/i)
    })
  })

  it('names where every part comes from, so the list can be checked against the manuals', () => {
    const t = tower({
      width: 'M', depth: 7, roof: 'grid', bottom: 'wheels', backbone: 'matching',
      rows: [
        { height: '2F', units: [drawer('M', { baseplate: 'plain', gearedRails: true })] },
        { height: '1F', units: [{ kind: 'sustainer', width: 'M', moduleType: 'flat' }] },
      ],
    })
    for (const line of partsForTower(t, opts)) expect(line.source, line.path).toMatch(/\bpp?\d+|File tree/)
  })

  // Instructions Manual p8: "L in width equals S+S".
  it('counts parts for two drawers side by side in one Row', () => {
    const t = tower({ width: 'L', depth: 4, rows: [{ height: '2F', units: [drawer('S'), drawer('S')] }] })
    const parts = byFile(partsForTower(t, opts))

    expect(parts['S4 Module 2f.stl']).toBe(2) // sic: the download names it with a lowercase f
    expect(parts['x4 Runner Slide.stl']).toBe(4)
    expect(parts['Latch.stl']).toBe(2)
  })

  // Colour roles as the group prints them: runners in the accent colour; keys, locks and handles in a
  // secondary colour; everything else in the body colour.
  it('gives runners the accent colour and keys, locks and handles the secondary colour', () => {
    const roles = (t: Tower) => Object.fromEntries(partsForTower(t, opts).map((l) => [l.path.split('/').pop(), l.role]))
    const drawers = roles(tower({ width: 'S', depth: 3, roof: 'grid', rows: [{ height: '1F', units: [drawer('S')] }] }))
    const sustainers = roles(tower({ width: 'S', depth: 3, rows: [{ height: '1F', units: [{ kind: 'sustainer', width: 'S', moduleType: 'flat' }] }] }))

    expect(drawers).toMatchObject({
      'x3 Runner Slide.stl': 'accent', 'x3 Runner Guide.stl': 'accent', 'Runner Stopper.stl': 'accent',
      'Key (Turn On Supports).stl': 'secondary', 'Top Handle (Turn On Supports).stl': 'secondary',
      'S3 Module 1F.stl': 'body', 'Key Cap.stl': 'body', 'Latch.stl': 'body',
    })
    expect(sustainers).toMatchObject({ 'LOCK OUTER PART 1F.stl': 'secondary', 'LOCK HOLDER.stl': 'body' })
  })

  // Modifications pp12–15 and Mounting Instructions pp1–9: what attaches to the back of a tower.
  describe('back attachments', () => {
    const mRows: Tower['rows'] = [
      { height: '2F', units: [drawer('M')] }, { height: '1F', units: [drawer('M')] }, { height: '4F', units: [drawer('M')] },
    ]
    const back = (t: Partial<Tower>) => byFile(partsForTower(tower({ width: 'M', depth: 3, rows: mRows, ...t }), opts))

    it('adds a stationary handle sized to the tower', () => {
      expect(back({ backbone: 'matching', stationaryHandle: true })['M Stationary Handle.stl']).toBe(1)
    })

    it('adds the pull-out handle, its lock and two knobs', () => {
      expect(back({ backbone: 'matching', pullOutHandle: true })).toMatchObject({
        'M Pull-out Handle.stl': 1, 'M Pull-out Handle Lock.stl': 1, 'Handle Lock Knob Part 1.stl': 2, 'Handle Lock Knob Part 2.stl': 2,
      })
    })

    it('adds one pegboard board per backbone, matching its height', () => {
      expect(back({ backbone: 'matching', pegboard: 'skadis' })).toMatchObject({ 'M2F.stl': 3, 'M1F.stl': 1 })
    })

    it('adds a wall mount per unit, matching its size, each with a part for the wall', () => {
      const parts = byFile(partsForTower(tower({
        width: 'L', depth: 3, wallMount: true, rows: [{ height: '1F', units: [drawer('S'), drawer('S')] }, { height: '2F', units: [drawer('L')] }],
      }), opts))
      expect(parts).toMatchObject({ 'S1F Wall Mount.stl': 2, 'L2F Wall Mount.stl': 1, 'Wall Mount Second Part.stl': 3 })
    })

    it('refuses handles or a pegboard without a backbone to fix them to', () => {
      expect(() => back({ pullOutHandle: true })).toThrow(/backbone/)
      expect(() => back({ stationaryHandle: true })).toThrow(/backbone/)
      expect(() => back({ pegboard: 'ussa' })).toThrow(/backbone/)
    })

    it('refuses a wall-mounted tower that also has a backbone or stands on a base', () => {
      expect(() => back({ wallMount: true, backbone: 'matching' })).toThrow(/wall/i)
      expect(() => back({ wallMount: true, bottom: 'wheels' })).toThrow(/wall/i)
    })
  })

  // Modules only connect at their top, so a split Row's two Columns need only reach the same height (GLOSSARY).
  describe('split rows', () => {
    const d = (width: Unit['width'], height: '1F' | '2F' | '4F') => ({ ...drawer(width), height })
    const split: Tower['rows'][number] = {
      columns: [
        { width: 'S', units: [d('S', '4F'), d('S', '1F')] },
        { width: 'S', units: [d('S', '2F'), d('S', '1F'), d('S', '2F')] },
      ],
    }

    it('counts each stacked unit at its own height', () => {
      const parts = byFile(partsForTower(tower({ width: 'L', depth: 3, rows: [split] }), opts))
      expect(parts).toMatchObject({ 'S3 Module 4f.stl': 1, 'S3 Module 1F.stl': 2, 'S3 Module 2F.stl': 2 })
    })

    it('refuses columns that do not reach the same height', () => {
      const short = { columns: [split.columns[0], { width: 'S' as const, units: [d('S', '2F'), d('S', '1F')] }] }
      expect(() => partsForTower(tower({ width: 'L', depth: 3, rows: [short] }), opts)).toThrow(/5F.*3F|same height/)
    })

    it('makes a backbone across a 5F row from 2F, 2F and 1F pieces, and says so', () => {
      const lines = partsForTower(tower({ width: 'L', depth: 3, backbone: 'matching', rows: [split] }), opts)
      const parts = byFile(lines)
      expect([parts['L2F Backbone.stl'], parts['L1F Backbone.stl']]).toEqual([2, 1])
      expect(lines.find((l) => l.path.endsWith('L2F Backbone.stl'))!.flags.some((f) => f.kind === 'inferred')).toBe(true)
    })
  })
})
