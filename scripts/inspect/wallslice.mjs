// Vertex scatter of a slab of a turned file, to find features inside a wall.
// Usage: node wallslice.mjs <stl> <deg> <slabFrom> <slabTo> (mm along the squared-up y from its minimum)
import { readFileSync } from 'node:fs'
const [file, degS, fromS, toS] = process.argv.slice(2)
const b = readFileSync(file); const n = b.readUInt32LE(80)
const r = (+degS * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
const P = []
for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
  const o = 84 + 50 * i + 12 + 12 * k
  const x = b.readFloatLE(o), y = b.readFloatLE(o + 4), z = b.readFloatLE(o + 8)
  P.push([x * c - y * s, x * s + y * c, z])
}
const ext = (a) => { let lo = Infinity, hi = -Infinity; for (const p of P) { lo = Math.min(lo, p[a]); hi = Math.max(hi, p[a]) } return [lo, hi] }
const X = ext(0), Y = ext(1), Z = ext(2)
const lo = Y[0] + +fromS, hi = Y[0] + +toS
const W = Math.ceil((Z[1] - Z[0]) / 3) + 1, H = Math.ceil((X[1] - X[0]) / 3) + 1
const g = Array.from({ length: H }, () => Array(W).fill(' '))
for (const p of P) if (p[1] > lo && p[1] < hi) g[Math.floor((X[1] - p[0]) / 3)][Math.floor((p[2] - Z[0]) / 3)] = 'o'
console.log(`x (height) ${X[0].toFixed(1)}..${X[1].toFixed(1)}; z ${Z[0].toFixed(1)} (left)..${Z[1].toFixed(1)} (right); 3 mm cells; row label = mm above the bottom`)
g.forEach((row, i) => console.log(String(Math.round(X[1] - i * 3 - X[0])).padStart(3), row.join('')))
