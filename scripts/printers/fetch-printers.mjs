// Builds src/data/printers.json from Bambu Studio's own printer profiles (the files the slicer ships with),
// so bed sizes are never typed in by hand. Records the exact Bambu Studio commit the sizes came from.
//
// Usage: node scripts/printers/fetch-printers.mjs
import { writeFile } from 'node:fs/promises'

const REPO = 'bambulab/BambuStudio'
const UA = { headers: { 'User-Agent': 'vault-planner-printer-sync', Accept: 'application/vnd.github+json' } }

const commit = (await (await fetch(`https://api.github.com/repos/${REPO}/commits/master`, UA)).json()).sha
if (!commit) throw new Error('Could not read the Bambu Studio commit')
const raw = (path) => `https://raw.githubusercontent.com/${REPO}/${commit}/resources/profiles/BBL/${path}`
const getJson = async (url) => {
  const res = await fetch(url, UA)
  if (!res.ok) throw new Error(`${res.status} for ${url}`)
  return res.json()
}

const index = await getJson(`https://raw.githubusercontent.com/${REPO}/${commit}/resources/profiles/BBL.json`)
const subPath = new Map(index.machine_list.map((m) => [m.name, m.sub_path]))

const cache = new Map()
async function resolved(name) {
  if (cache.has(name)) return cache.get(name)
  const sub = subPath.get(name)
  if (!sub) throw new Error(`No profile named "${name}"`)
  const own = await getJson(raw(sub))
  const merged = own.inherits ? { ...(await resolved(own.inherits)), ...own } : own
  cache.set(name, merged)
  return merged
}

/** Width and depth of a printable area given as ["0x0", "340x0", ...] or "0x0,325x0,...". */
function areaSize(points) {
  const list = (Array.isArray(points) ? points : points.split(',')).map((p) => p.split('x').map(Number))
  const xs = list.map(([x]) => x)
  const ys = list.map(([, y]) => y)
  return { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys) }
}

const printers = []
for (const name of subPath.keys()) {
  if (!/ 0\.4 nozzle$/.test(name)) continue
  const p = await resolved(name)
  if (p.instantiation !== 'true') continue
  const plate = areaSize(p.printable_area)
  const plateHeight = Number(p.printable_height)
  // A one-colour part is printed by one nozzle, so on multi-nozzle printers use the roomiest nozzle's reach.
  let bed = plate
  let height = plateHeight
  if (p.extruder_printable_area?.length > 1) {
    const perNozzle = p.extruder_printable_area.map((a, i) => ({
      ...areaSize(a),
      height: Number(p.extruder_printable_height?.[i] ?? plateHeight),
    }))
    const best = perNozzle.sort((a, b) => b.width * b.depth - a.width * a.depth || b.height - a.height)[0]
    bed = { width: best.width, depth: best.depth }
    height = best.height
  }
  printers.push({
    id: name.replace(/^Bambu Lab /, '').replace(/ 0\.4 nozzle$/, '').toLowerCase().replace(/\s+/g, '-'),
    name: name.replace(/ 0\.4 nozzle$/, ''),
    bed,
    height,
    plate: { ...plate, height: plateHeight },
    excludedAreas: (p.bed_exclude_area ?? []).filter((a) => a && a !== '0x0'),
  })
}
printers.sort((a, b) => a.name.localeCompare(b.name))

const out = new URL('../../src/data/printers.json', import.meta.url)
await writeFile(out, JSON.stringify({ source: `${REPO}@${commit}`, printers }, null, 2) + '\n')
console.log(`${printers.length} printers from ${REPO}@${commit.slice(0, 7)}`)
for (const p of printers) console.log(`  ${p.name.padEnd(26)} ${p.bed.width} × ${p.bed.depth} × ${p.height}${p.excludedAreas.length ? '  (has excluded areas)' : ''}`)
