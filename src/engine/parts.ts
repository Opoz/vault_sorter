import type { Catalog } from './catalog'
import { checkFit, type PrinterBed } from './fit'
import { columnFloors, columnsOf, rowFloors, unitsOf, type DrawerUnit, type RoofType, type SustainerUnit, type Tower, type Width } from './model'
import { createResolver, type Resolver } from './resolve'

/**
 * Which filament colour a part prints in: body for the bulk, accent for the runners, secondary for keys,
 * locks and handles. Chosen by the user's group (issue #3).
 */
export type ColourRole = 'body' | 'accent' | 'secondary'

/** Why a line can't be taken purely at face value. Shown to the user with its source. */
export interface Flag {
  readonly kind: 'inferred' | 'conflict'
  readonly note: string
  /** Manual and page, or the evidence used, e.g. "Drawer Assembly p2". */
  readonly source: string
}

export interface PartLine {
  /** Real path inside the Vault download. */
  readonly path: string
  readonly qty: number
  readonly role: ColourRole
  /** Where the part and its count come from, e.g. "Drawer Assembly pp1–8". */
  readonly source: string
  readonly flags: readonly Flag[]
}

export interface PartsOptions {
  readonly catalog: Catalog
  readonly printer: PrinterBed
  readonly splitParts?: 'auto' | 'whole' | 'split'
}

interface Want {
  tidyPath: string
  qty: number
  role: ColourRole
  flags?: Flag[]
  source?: string
}

const SOURCES = {
  drawer: 'Drawer Assembly pp1–8; Instructions Manual p11',
  sustainer: 'Instructions Manual p12 and p17',
  roof: 'Instructions Manual p10 and p18',
  bottom: 'Modifications pp2–6 and p17',
  backbone: 'Modifications pp7–11',
  stationaryHandle: 'Modifications p12',
  pullOutHandle: 'Modifications pp13–14; Instructions Manual p13',
  pegboard: 'Modifications p15',
  wallMount: 'Mounting Instructions pp1–9',
}
const from = (source: string, wants: Want[]): Want[] => wants.map((w) => ({ ...w, source: w.source ?? source }))

/** Every Part needed to build one Tower. Lines for the same file are combined. */
export function partsForTower(tower: Tower, options: PartsOptions): PartLine[] {
  validateTower(tower)
  const resolver = createResolver(options.catalog)
  const ctx: Ctx = { ...options, resolver, splitParts: options.splitParts ?? 'auto' }
  const wants: Want[] = [
    ...from(SOURCES.roof, roofParts(tower, resolver)),
    ...from(SOURCES.bottom, bottomParts(tower, ctx)),
    ...from(SOURCES.backbone, backboneParts(tower)),
    ...backAttachmentParts(tower),
  ]
  for (const row of tower.rows) {
    for (const unit of unitsOf(row)) {
      wants.push(
        ...(unit.kind === 'drawer'
          ? from(SOURCES.drawer, drawerParts(unit, tower.depth, unit.height, resolver))
          : from(SOURCES.sustainer, sustainerParts(unit, tower.depth, unit.height, ctx))),
      )
    }
  }
  return combine(wants.map((w) => ({ ...w, path: resolver.get(w.tidyPath) })))
}

/** Units side by side in a Row must add up to the Tower's Width (Instructions Manual p8). */
const ROW_FILLS: Record<Width, readonly string[]> = {
  S: ['S'],
  M: ['M'],
  L: ['L', 'S+S'],
  XL: ['XL', 'M+S', 'S+M'],
}

function validateTower(tower: Tower) {
  if (tower.roof === 'under table mount' && tower.bottom !== 'none') {
    throw new UnavailableError('An under-table tower hangs from its roof, so it has no wheels, feet or casters')
  }
  if (tower.backbone === 'none' && (tower.stationaryHandle || tower.pullOutHandle || tower.pegboard)) {
    throw new UnavailableError('Handles and pegboards fix to a backbone, so the tower needs one')
  }
  if (tower.wallMount) {
    if (tower.backbone !== 'none') throw new UnavailableError('Wall mounts and a backbone both fix to the back of the modules; a wall-mounted tower has no backbone')
    if (tower.bottom !== 'none') throw new UnavailableError('A wall-mounted tower hangs on the wall, so it has no wheels, feet or casters')
    if (tower.roof === 'under table mount') throw new UnavailableError('A tower hangs either on a wall or under a table, not both')
  }
  tower.rows.forEach((row, i) => {
    const columns = columnsOf(row)
    const fill = columns.map((c) => c.width).join('+')
    if (!ROW_FILLS[tower.width].includes(fill)) {
      throw new UnavailableError(`Row ${i + 1}: ${fill || 'no units'} does not fill the ${tower.width} tower width`)
    }
    for (const column of columns) {
      if (column.units.length === 0) throw new UnavailableError(`Row ${i + 1}: a column is empty`)
      if (column.units.some((u) => u.width !== column.width)) throw new UnavailableError(`Row ${i + 1}: a column mixes widths`)
      if (column.units.some((u) => u.width === 'XL' && u.height !== '1F')) throw new UnavailableError(`Row ${i + 1}: XL only comes in 1F`)
    }
    const heights = columns.map(columnFloors)
    if (heights.some((h) => h !== heights[0])) {
      throw new UnavailableError(`Row ${i + 1}: its columns must reach the same height, but are ${heights.map((h) => `${h}F`).join(' and ')}`)
    }
  })
}

const ROOF_FILE: Record<Exclude<RoofType, 'none' | 'heavyweight'>, string> = {
  grid: 'grid roof', table: 'table roof', bowl: 'bowl roof', 'under table mount': 'under table mount roof',
}

// Instructions Manual p10 (five roof types) and p18 (top handle on the grid roof).
function roofParts(tower: Tower, resolver: Resolver): Want[] {
  const { width: w, depth, roof } = tower
  if (roof === 'none') return []
  const dir = `${DRAWERS}/${w} families/${w}${depth}/roof`
  if (roof !== 'heavyweight') {
    const wants: Want[] = [{ tidyPath: `${dir}/${w}${depth} ${ROOF_FILE[roof]}.stl`, qty: 1, role: 'body' }]
    if (roof === 'grid') wants.push({ tidyPath: `${UNIVERSAL}/top handle.stl`, qty: 1, role: 'secondary' })
    return wants
  }
  const handleFlag: Flag = {
    kind: 'inferred',
    note: 'One heavyweight roof handle and one insert assumed per heavyweight roof.',
    source: 'File tree only',
  }
  const extras: Want[] = [
    { tidyPath: `${UNIVERSAL}/heavyweight roof handle.stl`, qty: 1, role: 'secondary', flags: [handleFlag] },
    { tidyPath: `${UNIVERSAL}/heavyweight roof insert.stl`, qty: 1, role: 'body', flags: [handleFlag] },
  ]
  const cut = `${dir}/${w}${depth} heavyweight roof cut.stl`
  if (resolver.find(cut)) {
    return [{
      tidyPath: cut, qty: 1, role: 'body',
      flags: [{
        kind: 'inferred',
        note: `The full ${w} heavyweight roof fits no Bambu printer; using the undocumented "Cut" version instead.`,
        source: 'Part measurements; no manual mentions "Cut"',
      }],
    }, ...extras]
  }
  const full = `${dir}/${w}${depth} heavyweight roof.stl`
  if (!resolver.find(full)) throw new UnavailableError(`There is no heavyweight roof for ${w} towers`)
  return [{ tidyPath: full, qty: 1, role: 'body' }, ...extras]
}

const MODS = 'modifications'

// Modifications manual pp2–6 (base, wheels and foot) and p17 (casters).
function bottomParts(tower: Tower, ctx: Ctx): Want[] {
  const { width: w, depth, bottom } = tower
  if (bottom === 'none') return []
  const base = wholeOrSplit(ctx, `${MODS}/base/${w}`, `${w}${depth} base`, `${MODS}/base/base connector.stl`)
  const foot = `${MODS}/feet/${w} feet.stl`
  if (bottom === 'casters') return base // casters are bought, bolted under the base with M8
  if (bottom === 'feet') {
    return [...base, {
      tidyPath: foot, qty: 2, role: 'body',
      flags: [{
        kind: 'inferred',
        note: 'Wheeled towers use one foot opposite the wheels; a tower on feet alone is assumed to need two.',
        source: 'Modifications p6',
      }],
    }]
  }
  const perWheel: Flag = {
    kind: 'inferred',
    note: 'One disk, bushing, tyre and cover per wheel, two wheels per base, counted from the illustrations.',
    source: 'Modifications pp2–6',
  }
  return [
    ...base,
    { tidyPath: `${MODS}/wheels/disk.stl`, qty: 2, role: 'body', flags: [perWheel] },
    { tidyPath: `${MODS}/wheels/bushing.stl`, qty: 2, role: 'body', flags: [perWheel] },
    { tidyPath: `${MODS}/wheels/tyre (tpu).stl`, qty: 2, role: 'body', flags: [perWheel] },
    { tidyPath: `${MODS}/wheels/cover.stl`, qty: 2, role: 'body', flags: [perWheel] },
    {
      tidyPath: `${MODS}/wheels/jig.stl`, qty: 1, role: 'body',
      flags: [{ kind: 'inferred', note: 'A tool for pressing in the bushings; one is enough.', source: 'Modifications p3' }],
    },
    { tidyPath: foot, qty: 1, role: 'body' },
  ]
}

/**
 * Backbones and pegboard boards come in 1F and 2F heights (XL only in 1F): the pieces covering a Row of this
 * many floors, as many 2F pieces as fit and a 1F piece for an odd height.
 */
export function backPieces(width: Width, floors: number): { height: '1f' | '2f'; qty: number }[] {
  const twos = width === 'XL' ? 0 : Math.floor(floors / 2)
  const ones = floors - 2 * twos
  return [...(twos ? [{ height: '2f' as const, qty: twos }] : []), ...(ones ? [{ height: '1f' as const, qty: ones }] : [])]
}

const BACK_PIECES_FLAG: Flag = {
  kind: 'inferred',
  note: 'Each Row is covered by 2F pieces plus a 1F piece for an odd height (two 2F for a 4F Row); no manual gives the count.',
  source: 'Modifications pp7–11; piece sizes',
}

// Modifications pp7–11: backbones bolt down the back, bridging neighbouring modules.
function backboneParts(tower: Tower): Want[] {
  if (tower.backbone === 'none') return []
  const prefix = tower.backbone === 'universal' ? 'universal ' : tower.width.toLowerCase()
  return tower.rows.flatMap((row): Want[] => backPieces(tower.width, rowFloors(row)).map(({ height, qty }) => ({
    tidyPath: `${MODS}/backbone/${prefix}${height} backbone.stl`, qty, role: 'body', flags: [BACK_PIECES_FLAG],
  })))
}

/** Handles, pegboard boards and wall mounts: what attaches to the back of a Tower. */
function backAttachmentParts(tower: Tower): Want[] {
  const w = tower.width.toLowerCase()
  const wants: Want[] = []
  if (tower.stationaryHandle) {
    wants.push(...from(SOURCES.stationaryHandle, [{ tidyPath: `${MODS}/stationary handle/${w} stationary handle.stl`, qty: 1, role: 'secondary' }]))
  }
  if (tower.pullOutHandle) {
    const universal = tower.backbone === 'universal'
    const lock: Want[] = universal
      ? [{
        tidyPath: `${MODS}/backbone/universal pull-out handle lock.stl`, qty: 2, role: 'body',
        flags: [{ kind: 'inferred', note: 'The universal lock is narrow (89 mm) and holds one rod, so two are assumed, one per rod.', source: 'Modifications pp13–14; Universal Pull-out Handle Lock size' }],
      }]
      : [
        { tidyPath: `${MODS}/backbone/${w} pull-out handle lock.stl`, qty: 1, role: 'body' },
        ...(w === 's' ? [{ tidyPath: `${MODS}/backbone/s pull-out handle lock part 2.stl`, qty: 1, role: 'body' as const }] : []),
      ]
    wants.push(...from(SOURCES.pullOutHandle, [
      { tidyPath: `${MODS}/pull-out handle/${w} pull-out handle.stl`, qty: 1, role: 'secondary' },
      ...lock,
      // Two knobs tighten the lock, one per rod (Modifications p13): a knob and its cap.
      { tidyPath: `${MODS}/backbone/handle lock knob part 1.stl`, qty: 2, role: 'body' },
      { tidyPath: `${MODS}/backbone/handle lock knob part 2.stl`, qty: 2, role: 'secondary' },
    ]))
  }
  if (tower.pegboard) {
    const dir = `${MODS}/pegboard attachment/${tower.pegboard === 'skadis' ? 'ikea skadis' : 'ussa'} pegboard`
    const flag: Flag = { kind: 'inferred', note: 'One pegboard board per backbone piece, matching its height (they come in the same 1F and 2F sizes).', source: 'Modifications p15; board sizes' }
    wants.push(...from(SOURCES.pegboard, tower.rows.flatMap((row) => backPieces(tower.width, rowFloors(row)).map(({ height, qty }): Want => ({
      tidyPath: `${dir}/${w}${height}.stl`, qty, role: 'body', flags: [flag],
    })))))
  }
  if (tower.wallMount) {
    const second: Flag = { kind: 'inferred', note: 'One second part on the wall for each wall mount; the manual shows them but gives no count.', source: 'Mounting Instructions pp6–9' }
    for (const row of tower.rows) {
      for (const unit of unitsOf(row)) {
        wants.push(...from(SOURCES.wallMount, [
          { tidyPath: `${MODS}/wall mounts/${unit.width.toLowerCase()}${unit.height.toLowerCase()} wall mount.stl`, qty: 1, role: 'body' },
          { tidyPath: `${MODS}/wall mounts/wall mount second part.stl`, qty: 1, role: 'body', flags: [second] },
        ]))
      }
    }
  }
  return wants
}

interface Ctx extends Required<PartsOptions> {
  readonly resolver: Resolver
}

/**
 * Parts that come both Whole and as Part 1 + Part 2 + a connector (depth 6–7 sustainer lids and bases):
 * Whole when it fits the printer, unless the layout forces one version.
 */
function wholeOrSplit(ctx: Ctx, dir: string, stem: string, connector: string): Want[] {
  const whole = `${dir}/${stem} whole.stl`
  const wholePath = ctx.resolver.find(whole)
  if (!wholePath) return [{ tidyPath: `${dir}/${stem}.stl`, qty: 1, role: 'body' }]
  const useWhole =
    ctx.splitParts === 'whole' ||
    (ctx.splitParts === 'auto' && checkFit(ctx.catalog.get(wholePath), ctx.printer).fits)
  if (useWhole) return [{ tidyPath: whole, qty: 1, role: 'body' }]
  const flag: Flag = {
    kind: 'inferred',
    note: 'One connector assumed per split part; no manual gives the count.',
    source: 'File tree only',
  }
  return [
    { tidyPath: `${dir}/${stem} part 1.stl`, qty: 1, role: 'body' },
    { tidyPath: `${dir}/${stem} part 2.stl`, qty: 1, role: 'body' },
    { tidyPath: connector, qty: 1, role: 'body', flags: [flag] },
  ]
}

const SUSTAINERS = 'sustainers'
const SUSTAINER_UNIVERSAL = `${SUSTAINERS}/universal`

// Instructions Manual p12 ("Sustainers Naming") and p17 (hardware illustration).
function sustainerParts(unit: SustainerUnit, depth: number, height: string, ctx: Ctx): Want[] {
  const w = unit.width
  const family = `${SUSTAINERS}/${w} families`
  const sizeDir = `${family}/${w}${depth}`
  const h = height.toLowerCase()
  const small = w === 'S' || w === 'M'
  const tall = height !== '1F'
  const typed = !small ? ` ${unit.moduleType}` : ''
  const fromPicture: Flag = {
    kind: 'inferred',
    note: 'Two hinges and two locks per module, counted from the illustration; not stated in text.',
    source: 'Instructions Manual p17',
  }
  const hinge = small ? (tall ? 's-m 2-4f hinge' : 's-m 1f hinge') : tall ? 'l 2-4f hinge' : 'l-xl 1f hinge'
  const lockOuter = tall ? 'lock outer part 2-4f' : 'lock outer part 1f'
  return [
    { tidyPath: `${sizeDir}/modules/${w}${depth} ${h}${typed} module.stl`, qty: 1, role: 'body' },
    ...wholeOrSplit(ctx, `${sizeDir}/roof`, `${w}${depth} roof`, `${sizeDir}/roof/connector for split roof.stl`),
    {
      tidyPath: w === 'XL' ? `${family}/xl${h} facade.stl` : `${family}/facades/${w}${h} facade.stl`,
      qty: 1, role: 'body',
    },
    { tidyPath: `${SUSTAINER_UNIVERSAL}/hinges/${hinge}.stl`, qty: 2, role: 'body', flags: [fromPicture] },
    {
      tidyPath: `${SUSTAINER_UNIVERSAL}/hinges/${small ? w : 'l-xl'} hinge top.stl`,
      qty: 2, role: 'body', flags: [fromPicture],
    },
    {
      tidyPath: `${SUSTAINER_UNIVERSAL}/rods/${small ? 's-m' : 'l-xl'} rods.stl`, qty: 1, role: 'body',
      flags: [{
        kind: 'inferred',
        note: 'The rods file is sized like a pair of hinge pins (about 27 mm across), so 1 print for both hinges.',
        source: 'Instructions Manual p12; Rods.stl size',
      }],
    },
    { tidyPath: `${SUSTAINER_UNIVERSAL}/locks/lock holder.stl`, qty: 2, role: 'body', flags: [fromPicture] },
    { tidyPath: `${SUSTAINER_UNIVERSAL}/locks/lock inner part.stl`, qty: 2, role: 'body', flags: [fromPicture] },
    { tidyPath: `${SUSTAINER_UNIVERSAL}/locks/${lockOuter}.stl`, qty: 2, role: 'secondary', flags: [fromPicture] },
    {
      tidyPath: `${SUSTAINER_UNIVERSAL}/locks/1 set of pins for 1 lock.stl`, qty: 2, role: 'body',
      flags: [fromPicture],
    },
    {
      tidyPath: `${SUSTAINER_UNIVERSAL}/label for sustainers.stl`, qty: 1, role: 'body',
      flags: [{
        kind: 'conflict',
        note: 'The naming page points at both "Label" and "Label for Sustainers" on sustainer facades; only "Label for Sustainers" is listed.',
        source: 'Instructions Manual p12',
      }],
    },
  ]
}

const DRAWERS = 'drawers'
const UNIVERSAL = `${DRAWERS}/universal`

/** Thrown when a Tower asks for something the Vault download doesn't contain. */
export class UnavailableError extends Error {}

// Drawer Assembly manual pp1–8; part names from Instructions Manual p11 ("Drawers Naming").
function drawerParts(unit: DrawerUnit, depth: number, height: string, resolver: Resolver): Want[] {
  const w = unit.width
  const xl = w === 'XL'
  const family = `${DRAWERS}/${w} families`
  const sizeDir = `${family}/${w}${depth}`
  const h = height.toLowerCase()
  const label = `${w}${depth} ${height} Drawer`
  const wants: Want[] = [
    { tidyPath: `${sizeDir}/modules/${w}${depth} module ${h}.stl`, qty: 1, role: 'body' },
    ...drawerBox(unit, depth, h, resolver),
    {
      tidyPath: xl ? `${family}/xl facade ${h}.stl` : `${family}/facades/${w}${h}.stl`,
      qty: 1, role: 'body',
    },
    ...(unit.key === 'hidden'
      ? [
          { tidyPath: `${UNIVERSAL}/hidden key.stl`, qty: 1, role: 'secondary' as const },
          { tidyPath: `${UNIVERSAL}/hidden key part 2.stl`, qty: 1, role: 'body' as const },
        ]
      : [
          { tidyPath: `${UNIVERSAL}/key.stl`, qty: 1, role: 'secondary' as const },
          { tidyPath: `${UNIVERSAL}/key cap.stl`, qty: 1, role: 'body' as const },
        ]),
    {
      tidyPath: `${UNIVERSAL}/springs.stl`, qty: 1, role: 'body',
      flags: [{
        kind: 'inferred',
        note: 'A drawer needs 2 springs; the file is sized like a pair (47.5 × 75.6 mm), so 1 print.',
        source: 'Drawer Assembly p2; Springs.stl size',
      }],
    },
    { tidyPath: `${UNIVERSAL}/facade cap.stl`, qty: 1, role: 'body' },
    { tidyPath: `${UNIVERSAL}/label.stl`, qty: 1, role: 'body' },
    {
      tidyPath: xl
        ? `${UNIVERSAL}/runners/xl runners/x${depth} runner slide xl.stl`
        : `${UNIVERSAL}/runners/x${depth} runner slide.stl`,
      qty: 2, role: 'accent',
    },
    {
      tidyPath: xl
        ? `${UNIVERSAL}/runners/xl runners/x${depth} runner guide xl.stl`
        : `${UNIVERSAL}/runners/x${depth} runner guide.stl`,
      qty: 2, role: 'accent',
    },
    { tidyPath: `${UNIVERSAL}/runners/runner stopper.stl`, qty: 2, role: 'accent' },
    { tidyPath: `${UNIVERSAL}/latch.stl`, qty: 1, role: 'body' },
  ]

  if (unit.gearedRails) {
    wants.push({
      tidyPath: `${UNIVERSAL}/geared rails/${w} rails.stl`, qty: 2, role: 'body', source: 'Drawer Assembly p4',
      flags: [{
        kind: 'inferred',
        note: 'Top and bottom rails per box; each rail file holds one rail (about 12 mm wide), so 2 prints.',
        source: 'Drawer Assembly p4; Rails.stl size',
      }],
    })
  }

  if (unit.baseplate !== 'none') {
    const suffix = { plain: '', '1 handle': '_with 1 handle', '2 handles': '_with 2 handles' }[unit.baseplate]
    const dir = `${sizeDir}/gridfinity baseplate`
    const whole = `${dir}/${w}${depth} baseplate${suffix}.stl`
    if (resolver.find(whole)) {
      wants.push({ tidyPath: whole, qty: 1, role: 'body', source: 'Instructions Manual p9 and p11' })
    } else if (unit.baseplate === 'plain' && resolver.find(`${dir}/${w}${depth} baseplate part 1.stl`)) {
      wants.push(...splitOnly(dir, `${w}${depth} baseplate`, `${w}${depth} baseplate`))
    } else {
      throw new UnavailableError(`${label}: the Vault files have no baseplate "${unit.baseplate}" for ${w}${depth}`)
    }
  }
  return wants
}

function drawerBox(unit: DrawerUnit, depth: number, h: string, resolver: Resolver): Want[] {
  const w = unit.width
  const dir = `${DRAWERS}/${w} families/${w}${depth}/boxes`
  const whole = `${dir}/${w}${depth} box ${h}.stl`
  if (resolver.find(whole)) {
    const wants: Want[] = [{ tidyPath: whole, qty: 1, role: 'body' }]
    const backPanel = `${dir}/${w}${depth} back panel.stl`
    if (resolver.find(backPanel)) {
      wants.push({
        tidyPath: backPanel, qty: 1, role: 'body',
        flags: [{
          kind: 'inferred',
          note: 'The XL3–XL5 box folders include a Back Panel that no manual mentions; assumed 1 per box.',
          source: 'File tree only',
        }],
      })
    }
    return wants
  }
  return splitOnly(dir, `${w}${depth} box ${h}`, `${w}${depth} ${h} box`)
}

/** Parts that only come split in two (XL6/XL7 boxes and baseplates): both halves, no Whole version. */
function splitOnly(dir: string, stem: string, what: string): Want[] {
  const flag: Flag = {
    kind: 'inferred',
    note: `The ${what} only comes as Part 1 + Part 2, with no connector file; assumed the halves join directly.`,
    source: 'File tree only',
  }
  return [
    { tidyPath: `${dir}/${stem} part 1.stl`, qty: 1, role: 'body', flags: [flag] },
    { tidyPath: `${dir}/${stem} part 2.stl`, qty: 1, role: 'body', flags: [flag] },
  ]
}

function combine(lines: (Want & { path: string })[]): PartLine[] {
  const byPath = new Map<string, { path: string; qty: number; role: ColourRole; source: string; flags: Flag[] }>()
  for (const l of lines) {
    const existing = byPath.get(l.path)
    if (existing) {
      existing.qty += l.qty
      for (const f of l.flags ?? []) {
        if (!existing.flags.some((e) => e.note === f.note)) existing.flags.push(f)
      }
    } else {
      byPath.set(l.path, { path: l.path, qty: l.qty, role: l.role, source: l.source ?? 'File tree only', flags: [...(l.flags ?? [])] })
    }
  }
  return [...byPath.values()]
}
