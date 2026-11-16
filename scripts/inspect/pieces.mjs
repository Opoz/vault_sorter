// Counts the loose pieces in an STL (triangles joined by shared corners) and prints each piece's size.
import { readFileSync } from 'node:fs'
for (const file of process.argv.slice(2)) {
  const buf = readFileSync(file); const n = buf.readUInt32LE(80)
  const ids = new Map(); const parent = []; const pos = []
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  const tri = []
  for (let t = 0; t < n; t++) {
    const c = []
    for (let k = 0; k < 3; k++) {
      const o = 84 + 50 * t + 12 + 12 * k
      const key = buf.toString('hex', o, o + 12)
      let id = ids.get(key)
      if (id === undefined) { id = parent.length; ids.set(key, id); parent.push(id); pos.push([buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]) }
      c.push(id)
    }
    tri.push(c)
    const [a, b, d] = c.map(find); if (a !== b) parent[a] = b; const r = find(b); if (find(d) !== r) parent[find(d)] = r
  }
  const box = new Map()
  for (let v = 0; v < parent.length; v++) {
    const r = find(v); const p = pos[v]
    const bb = box.get(r) ?? [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]]
    for (let a = 0; a < 3; a++) { bb[0][a] = Math.min(bb[0][a], p[a]); bb[1][a] = Math.max(bb[1][a], p[a]) }
    box.set(r, bb)
  }
  console.log(file.split('/').pop(), '->', box.size, 'piece(s):', [...box.values()].map((b) => b[1].map((v, a) => (v - b[0][a]).toFixed(1)).join('x') + ` at y ${b[0][1].toFixed(1)}`).join(' | '))
}
