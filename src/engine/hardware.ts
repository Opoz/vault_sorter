/**
 * Hardware to buy for a Tower: bolts, rods, bearings, casters. Counts come from the Instructions Manual's
 * hardware list (p3) and illustrations (pp17–19) and the Modifications manual; disagreements between
 * pages are flagged, never resolved silently.
 */
import type { Height, Tower, Width } from './model'
import type { Flag } from './parts'

export interface HardwareLine {
  readonly item: string
  readonly qty: number
  /** Manual page(s) the count comes from. */
  readonly source: string
  readonly flags: readonly Flag[]
}

const ROD_MM: Record<Width, number> = { S: 248, M: 338, L: 414, XL: 504 }
const FLOORS: Record<Height, number> = { '1F': 1, '2F': 2, '4F': 4 }

interface Want { item: string; qty: number; source: string; flags?: Flag[] }

export function hardwareForTower(tower: Tower): HardwareLine[] {
  const wants: Want[] = []

  for (const row of tower.rows) {
    for (const unit of row.units) {
      if (unit.kind === 'drawer') {
        // p18: "x4 for 1F, x6 for 2F/4F"; p3: "x4 per floor".
        const perPage18 = row.height === '1F' ? 4 : 6
        const perPage3 = 4 * FLOORS[row.height]
        wants.push({
          item: 'M4 × 14 mm bolt',
          qty: perPage18,
          source: 'Instructions Manual p3 and p18',
          flags: perPage3 === perPage18 ? [] : [{
            kind: 'conflict',
            note: `${row.height} drawer: ${perPage18} bolts per p18 ("x6 for 2F/4F"), but ${perPage3} per p3 ("x4 per floor").`,
            source: 'Instructions Manual p3 and p18',
          }],
        })
      } else {
        // p17: "x16 M4 14mm bolts, x8 M4 10mm bolts, x7 M4 20mm bolts - per module".
        wants.push(
          { item: 'M4 × 14 mm bolt', qty: 16, source: 'Instructions Manual p3 and p17' },
          { item: 'M4 × 10 mm bolt', qty: 8, source: 'Instructions Manual p3 and p17' },
          { item: 'M4 × 20 mm bolt', qty: 7, source: 'Instructions Manual p3 and p17' },
        )
      }
    }
  }

  if (tower.roof === 'grid') wants.push({ item: 'M6 × 50 mm bolt', qty: 2, source: 'Instructions Manual p3 and p18' })
  if (tower.roof === 'under table mount') {
    wants.push({
      item: 'Screws or thread inserts to fix the mount under the table',
      qty: 1,
      source: 'Mounting Instructions pp10–12',
      flags: [{ kind: 'inferred', note: 'The manual shows screws or thread inserts but no size or count.', source: 'Mounting Instructions pp10–12' }],
    })
  }

  if (tower.bottom !== 'none') {
    wants.push({ item: `M16 threaded rod, ${ROD_MM[tower.width]} mm`, qty: 1, source: 'Instructions Manual p3; Modifications p2' })
  }
  if (tower.bottom === 'wheels') {
    wants.push(
      { item: 'M4 × 25 mm bolt', qty: 2 * 6, source: 'Instructions Manual p3 and p19' },
      { item: '6205ZZ bearing', qty: 2, source: 'Instructions Manual p3' },
      {
        item: 'SCSAW stopper',
        qty: 2,
        source: 'Instructions Manual p3',
        flags: [{
          kind: 'conflict',
          note: 'Size given as 16d / 35D / 10 mm on one page and 16d / 30D / 10 mm on another.',
          source: 'Instructions Manual p19 and Modifications p5',
        }],
      },
      { item: 'M6 × 90 mm bolt', qty: 2, source: 'Instructions Manual p3; Modifications p6' }, // the one foot opposite the wheels
    )
  }
  if (tower.bottom === 'feet') {
    wants.push({
      item: 'M6 × 90 mm bolt', qty: 4, source: 'Instructions Manual p3',
      flags: [{ kind: 'inferred', note: 'Two bolts per foot, and two feet assumed for a tower on feet alone.', source: 'Instructions Manual p3' }],
    })
  }
  if (tower.bottom === 'casters') {
    wants.push({
      item: 'Caster with M8 bolt',
      qty: 4,
      source: 'Modifications p17',
      flags: [{ kind: 'inferred', note: 'Four casters under the base; the manual gives the M8 thread but no bolt length.', source: 'Modifications p17' }],
    })
  }

  if (tower.backbone !== 'none') {
    const boards = tower.rows.reduce((n, r) => n + (r.height === '4F' ? 2 : 1), 0)
    wants.push({
      item: 'M4 × 60–100 mm bolt',
      qty: 4 * boards,
      source: 'Instructions Manual p3',
      flags: [{ kind: 'inferred', note: 'Length depends on how many modules each backbone spans; count follows one backbone per Row.', source: 'Instructions Manual p3' }],
    })
  }

  return combine(wants)
}

function combine(wants: Want[]): HardwareLine[] {
  const byItem = new Map<string, { item: string; qty: number; source: string; flags: Flag[] }>()
  for (const w of wants) {
    const line = byItem.get(w.item) ?? { item: w.item, qty: 0, source: w.source, flags: [] }
    line.source = mergeSources(line.source, w.source)
    line.qty += w.qty
    for (const f of w.flags ?? []) if (!line.flags.some((e) => e.note === f.note)) line.flags.push(f)
    byItem.set(w.item, line)
  }
  return [...byItem.values()]
}

/** "Instructions Manual p3 and p18" + "Instructions Manual p3 and p17" -> "Instructions Manual p3, p17 and p18". */
export function mergeSources(a: string, b: string): string {
  const pages = new Map<string, string[]>()
  for (const entry of `${a}; ${b}`.split('; ')) {
    const match = entry.match(/^(.*?) (pp?[\d–]+(?:(?:, | and )pp?[\d–]+)*)$/)
    const manual = match ? match[1] : entry
    const list = pages.get(manual) ?? []
    for (const page of match ? match[2].match(/pp?[\d–]+/g)! : []) if (!list.includes(page)) list.push(page)
    pages.set(manual, list)
  }
  return [...pages].map(([manual, list]) => {
    const sorted = [...list].sort((x, y) => parseInt(x.replace(/\D/g, '')) - parseInt(y.replace(/\D/g, '')))
    if (sorted.length === 0) return manual
    const last = sorted.pop()!
    return `${manual} ${sorted.length ? `${sorted.join(', ')} and ${last}` : last}`
  }).join('; ')
}
