// Max depth (along side axis) profile: rows of the heightmap, in mm, printed coarsely.
// Usage: node profile.mjs <stl> <side> <step-mm>
import { readFileSync } from 'node:fs'
const [file, side, stepS, degS, offS] = process.argv.slice(2); const off = +(offS ?? 0); const step = +stepS || 5
const ax = 'xyz'.indexOf(side[1]); const sign = side[0] === '+' ? 1 : -1
const [ua, va] = [0, 1, 2].filter((a) => a !== ax)
const buf = readFileSync(file); const n = buf.readUInt32LE(80)
const P0 = (i, c, a) => buf.readFloatLE(84 + 50 * i + 12 + 12 * c + 4 * a)
let deg = degS === undefined ? 0 : +degS
if (degS === 'auto') { // square up a file stored turned on the bed: least bounding area over xy
  let best = [Infinity, 0]
  for (let d = 0; d < 90; d += 0.25) { const r = d * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); let a = [Infinity, -Infinity, Infinity, -Infinity]
    for (let i = 0; i < n; i += 7) for (let k = 0; k < 3; k++) { const x = P0(i, k, 0), y = P0(i, k, 1), u = x * c - y * s, v = x * s + y * c; a = [Math.min(a[0], u), Math.max(a[1], u), Math.min(a[2], v), Math.max(a[3], v)] }
    const ar = (a[1] - a[0]) * (a[3] - a[2]); if (ar < best[0]) best = [ar, d] }
  deg = best[1]; console.log('turned by', deg)
}
const rc = Math.cos(deg * Math.PI / 180), rs = Math.sin(deg * Math.PI / 180)
const P = (i, c, a) => a === 2 ? P0(i, c, 2) : a === 0 ? P0(i, c, 0) * rc - P0(i, c, 1) * rs : P0(i, c, 0) * rs + P0(i, c, 1) * rc
let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) for (let a = 0; a < 3; a++) { const v = P(i, c, a); min[a] = Math.min(min[a], v); max[a] = Math.max(max[a], v) }
const S = 1 / step
const W = Math.ceil((max[ua] - min[ua]) * S) + 1, H = Math.ceil((max[va] - min[va]) * S) + 1
const depth = new Float32Array(W * H).fill(-Infinity)
for (let i = 0; i < n; i++) {
  const pts = [0, 1, 2].map((c) => [(P(i, c, ua) - min[ua]) * S, (max[va] - P(i, c, va)) * S, sign * P(i, c, ax)])
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])))), x1 = Math.min(W - 1, Math.ceil(Math.max(...pts.map((p) => p[0]))))
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])))), y1 = Math.min(H - 1, Math.ceil(Math.max(...pts.map((p) => p[1]))))
  const [a, b, c] = pts; const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]); if (!den) continue
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / den, l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den, l3 = 1 - l1 - l2
    if (l1 < -0.01 || l2 < -0.01 || l3 < -0.01) continue
    const d = l1 * a[2] + l2 * b[2] + l3 * c[2]; if (d > depth[y * W + x]) depth[y * W + x] = d
  }
}
let dmax = -Infinity; for (const d of depth) if (d > dmax) dmax = d
console.log(`u=${'xyz'[ua]} ${min[ua].toFixed(1)}..${max[ua].toFixed(1)}, v=${'xyz'[va]} ${max[va].toFixed(1)} (top)..${min[va].toFixed(1)}; digits = mm below the top surface (. = 0, # = 9+, space = none)`)
for (let y = 0; y < H; y++) {
  let s = ''
  for (let x = 0; x < W; x++) { const d = depth[y * W + x]; if (d === -Infinity) { s += ' '; continue } const k = Math.round(dmax - d) - off; s += k <= 0 ? '.' : k >= 9 ? '#' : String(k) }
  console.log(s)
}
