import type { Catalog } from './catalog'
import { checkFit, type PrinterBed } from './fit'
import type { DrawerUnit, RoofType, SustainerUnit, Tower, Width } from './model'
import { createResolver, type Resolver } from './resolve'

export type ColourRole = 'body' | 'accent'

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
}

/** Every Part needed to build one Tower. Lines for the same file are combined. */
export function partsForTower(tower: Tower, options: PartsOptions): PartLine[] {
  validateTower(tower)
  const resolver = createResolver(options.catalog)
  const ctx: Ctx = { ...options, resolver, splitParts: options.splitParts ?? 'auto' }
  const wants: Want[] = [...roofParts(tower, resolver), ...bottomParts(tower, ctx), ...backboneParts(tower)]
  for (const row of tower.rows) {
    for (const unit of row.units) {
      wants.push(
        ...(unit.kind === 'drawer'
          ? drawerParts(unit, tower.depth, row.height, resolver)
          : sustainerParts(unit, tower.depth, row.height, ctx)),
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
  tower.rows.forEach((row, i) => {
    const fill = row.units.map((u) => u.width).join('+')
    if (!ROW_FILLS[tower.width].includes(fill)) {
      throw new UnavailableError(`Row ${i + 1}: ${fill || 'no units'} does not fill the ${tower.width} tower width`)
    }
    if (row.height !== '1F' && row.units.some((u) => u.width === 'XL')) {
      throw new UnavailableError(`Row ${i + 1}: XL only comes in 1F`)
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
    if (roof === 'grid') wants.push({ tidyPath: `${UNIVERSAL}/top handle.stl`, qty: 1, role: 'accent' })
    return wants
  }
  const handleFlag: Flag = {
    kind: 'inferred',
    note: 'One heavyweight roof handle and one insert assumed per heavyweight roof.',
    source: 'File tree only',
  }
  const extras: Want[] = [
    { tidyPath: `${UNIVERSAL}/heavyweight roof handle.stl`, qty: 1, role: 'accent', flags: [handleFlag] },
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

// Modifications pp7–11: backbones bolt down the back, bridging neighbouring modules.
function backboneParts(tower: Tower): Want[] {
  if (tower.backbone === 'none') return []
  const prefix = tower.backbone === 'universal' ? 'universal ' : tower.width.toLowerCase()
  const flag: Flag = {
    kind: 'inferred',
    note: 'One backbone per Row matching its height (two 2F backbones for a 4F Row); no manual gives the count.',
    source: 'Modifications pp7–11',
  }
  return tower.rows.flatMap((row): Want[] => {
    const h = row.height === '1F' ? '1f' : '2f'
    return [{ tidyPath: `${MODS}/backbone/${prefix}${h} backbone.stl`, qty: row.height === '4F' ? 2 : 1, role: 'body', flags: [flag] }]
  })
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
      qty: 1, role: 'accent',
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
    { tidyPath: `${SUSTAINER_UNIVERSAL}/locks/${lockOuter}.stl`, qty: 2, role: 'accent', flags: [fromPicture] },
    {
      tidyPath: `${SUSTAINER_UNIVERSAL}/locks/1 set of pins for 1 lock.stl`, qty: 2, role: 'body',
      flags: [fromPicture],
    },
    {
      tidyPath: `${SUSTAINER_UNIVERSAL}/label for sustainers.stl`, qty: 1, role: 'accent',
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
      qty: 1, role: 'accent',
    },
    ...(unit.key === 'hidden'
      ? [
          { tidyPath: `${UNIVERSAL}/hidden key.stl`, qty: 1, role: 'accent' as const },
          { tidyPath: `${UNIVERSAL}/hidden key part 2.stl`, qty: 1, role: 'accent' as const },
        ]
      : [
          { tidyPath: `${UNIVERSAL}/key.stl`, qty: 1, role: 'accent' as const },
          { tidyPath: `${UNIVERSAL}/key cap.stl`, qty: 1, role: 'accent' as const },
        ]),
    {
      tidyPath: `${UNIVERSAL}/springs.stl`, qty: 1, role: 'body',
      flags: [{
        kind: 'inferred',
        note: 'A drawer needs 2 springs; the file is sized like a pair (47.5 × 75.6 mm), so 1 print.',
        source: 'Drawer Assembly p2; Springs.stl size',
      }],
    },
    { tidyPath: `${UNIVERSAL}/facade cap.stl`, qty: 1, role: 'accent' },
    { tidyPath: `${UNIVERSAL}/label.stl`, qty: 1, role: 'accent' },
    {
      tidyPath: xl
        ? `${UNIVERSAL}/runners/xl runners/x${depth} runner slide xl.stl`
        : `${UNIVERSAL}/runners/x${depth} runner slide.stl`,
      qty: 2, role: 'body',
    },
    {
      tidyPath: xl
        ? `${UNIVERSAL}/runners/xl runners/x${depth} runner guide xl.stl`
        : `${UNIVERSAL}/runners/x${depth} runner guide.stl`,
      qty: 2, role: 'body',
    },
    { tidyPath: `${UNIVERSAL}/runners/runner stopper.stl`, qty: 2, role: 'body' },
    { tidyPath: `${UNIVERSAL}/latch.stl`, qty: 1, role: 'body' },
  ]

  if (unit.gearedRails) {
    wants.push({
      tidyPath: `${UNIVERSAL}/geared rails/${w} rails.stl`, qty: 2, role: 'body',
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
      wants.push({ tidyPath: whole, qty: 1, role: 'body' })
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
  const byPath = new Map<string, { path: string; qty: number; role: ColourRole; flags: Flag[] }>()
  for (const l of lines) {
    const existing = byPath.get(l.path)
    if (existing) {
      existing.qty += l.qty
      for (const f of l.flags ?? []) {
        if (!existing.flags.some((e) => e.note === f.note)) existing.flags.push(f)
      }
    } else {
      byPath.set(l.path, { path: l.path, qty: l.qty, role: l.role, flags: [...(l.flags ?? [])] })
    }
  }
  return [...byPath.values()]
}
