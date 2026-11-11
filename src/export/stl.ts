/**
 * Reading STL files (binary or text) into an indexed mesh: each distinct corner once, and triangles that refer
 * to corners by index, which is what a Bambu project stores. Corners are merged by their exact float bits with
 * an open-addressing hash table, fast enough for the largest Vault files (about 3 million triangles).
 */
export interface Mesh {
  /** x, y, z per corner. */
  readonly vertices: Float32Array
  /** Three corner indexes per triangle. */
  readonly triangles: Uint32Array
  readonly min: Float32Array
  readonly max: Float32Array
}

export function readStl(buffer: ArrayBuffer): Mesh {
  const view = new DataView(buffer)
  const count = buffer.byteLength >= 84 ? view.getUint32(80, true) : -1
  const corners = count >= 0 && 84 + 50 * count === buffer.byteLength ? binaryCorners(view, count) : textCorners(buffer)
  return index(corners)
}

/** Every triangle corner in order, 9 floats per triangle. */
function binaryCorners(view: DataView, count: number): Float32Array {
  const out = new Float32Array(count * 9)
  for (let i = 0; i < count; i++) {
    const base = 84 + 50 * i + 12
    for (let k = 0; k < 9; k++) out[i * 9 + k] = view.getFloat32(base + 4 * k, true)
  }
  return out
}

function textCorners(buffer: ArrayBuffer): Float32Array {
  const text = new TextDecoder().decode(buffer)
  const values: number[] = []
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g
  for (let m = re.exec(text); m; m = re.exec(text)) values.push(+m[1], +m[2], +m[3])
  return Float32Array.from(values)
}

function index(corners: Float32Array): Mesh {
  const total = corners.length / 3
  const bits = new Uint32Array(corners.buffer, corners.byteOffset, corners.length)
  let size = 1
  while (size < total * 2) size <<= 1
  const table = new Int32Array(size).fill(-1)
  const mask = size - 1
  const vertices = new Float32Array(corners.length)
  const vertexBits = new Uint32Array(vertices.buffer)
  const triangles = new Uint32Array(total)
  const min = new Float32Array([Infinity, Infinity, Infinity])
  const max = new Float32Array([-Infinity, -Infinity, -Infinity])
  let unique = 0

  for (let c = 0; c < total; c++) {
    const x = bits[c * 3], y = bits[c * 3 + 1], z = bits[c * 3 + 2]
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask
    for (;;) {
      const at = table[h]
      if (at === -1) {
        table[h] = unique
        vertices.set(corners.subarray(c * 3, c * 3 + 3), unique * 3)
        for (let k = 0; k < 3; k++) {
          const v = corners[c * 3 + k]
          if (v < min[k]) min[k] = v
          if (v > max[k]) max[k] = v
        }
        triangles[c] = unique++
        break
      }
      if (vertexBits[at * 3] === x && vertexBits[at * 3 + 1] === y && vertexBits[at * 3 + 2] === z) {
        triangles[c] = at
        break
      }
      h = (h + 1) & mask
    }
  }
  return { vertices: vertices.slice(0, unique * 3), triangles, min, max }
}
