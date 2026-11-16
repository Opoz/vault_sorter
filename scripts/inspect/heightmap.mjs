// Renders a stored STL as a shaded height map seen from one side (+x/-x/+y/-y/+z/-z), as a PNG.
// Usage: node heightmap.mjs <stl> <side> <out.png>
import { readFileSync, writeFileSync } from 'node:fs'
import { zlibSync } from 'fflate'
const [file, side, out] = process.argv.slice(2)
const ax = 'xyz'.indexOf(side[1]); const sign = side[0] === '+' ? 1 : -1
const [ua, va] = [0, 1, 2].filter((a) => a !== ax)
const buf = readFileSync(file); const n = buf.readUInt32LE(80)
const P = (i, c, a) => buf.readFloatLE(84 + 50 * i + 12 + 12 * c + 4 * a)
let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) for (let a = 0; a < 3; a++) { const v = P(i, c, a); min[a] = Math.min(min[a], v); max[a] = Math.max(max[a], v) }
const S = 3 // px per mm
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
let dmin = Infinity, dmax = -Infinity; for (const d of depth) if (d > -Infinity) { dmin = Math.min(dmin, d); dmax = Math.max(dmax, d) }
const raw = new Uint8Array(H * (W * 3 + 1))
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const d = depth[y * W + x]; const o = y * (W * 3 + 1) + 1 + x * 3
  if (d === -Infinity) { raw[o] = 200; raw[o + 1] = 220; raw[o + 2] = 255; continue }
  // height shading plus a slope light from the top-left
  const dx = x > 0 && depth[y * W + x - 1] > -Infinity ? d - depth[y * W + x - 1] : 0, dy = y > 0 && depth[(y - 1) * W + x] > -Infinity ? d - depth[(y - 1) * W + x] : 0
  const v = Math.max(0, Math.min(255, 40 + 180 * (d - dmin) / (dmax - dmin || 1) + 60 * (dx + dy)))
  raw[o] = raw[o + 1] = raw[o + 2] = v
}
const crcT = new Uint32Array(256).map((_, k) => { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); Buffer.from(d).copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b }
const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlibSync(raw)), chunk('IEND', [])]))
console.log(out, W, 'x', H, `(right = +${'xyz'[ua]}, up = +${'xyz'[va]})`)
