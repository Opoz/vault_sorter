import { describe, expect, it } from 'vitest'
import { binaryStlCorners, cluster, simplify, splitPieces } from './simplify'
import { turnMatrix } from './assembly'

/** A flat grid of n×n squares, two triangles each, over a 10 mm square. */
function sheet(n: number): Float32Array {
  const out: number[] = []
  const s = 10 / n
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const [x, y] = [i * s, j * s]
      out.push(x, y, 0, x + s, y, 0, x + s, y + s, 0, x, y, 0, x + s, y + s, 0, x, y + s, 0)
    }
  }
  return Float32Array.from(out)
}

describe('cluster', () => {
  it('shares corners and keeps every triangle when the cell is finer than the mesh', () => {
    const mesh = cluster(sheet(4), 0.01)
    expect(mesh.index.length / 3).toBe(32)
    expect(mesh.positions.length / 3).toBe(25)
  })

  it('drops triangles that collapse on a coarse grid', () => {
    const mesh = cluster(sheet(40), 1)
    expect(mesh.index.length / 3).toBeLessThan(40 * 40 * 2)
    expect(mesh.index.length / 3).toBeGreaterThan(0)
  })
})

describe('simplify', () => {
  it('leaves small meshes alone and brings big ones under the target', () => {
    expect(simplify(sheet(10), 1000).index.length / 3).toBe(200)
    expect(simplify(sheet(100), 1000).index.length / 3).toBeLessThanOrEqual(1000)
  })
})

describe('binaryStlCorners', () => {
  it('reads a binary STL and refuses anything else', () => {
    const buffer = new ArrayBuffer(84 + 50)
    const view = new DataView(buffer)
    view.setUint32(80, 1, true)
    ;[1, 2, 3, 4, 5, 6, 7, 8, 9].forEach((v, k) => view.setFloat32(84 + 12 + 4 * k, v, true))
    expect([...binaryStlCorners(buffer)!]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(binaryStlCorners(new TextEncoder().encode('solid x').buffer as ArrayBuffer)).toBeNull()
  })
})

describe('turnMatrix', () => {
  const det = (m: number[]) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  it('turns without mirroring, for every way of assigning the axes', () => {
    for (const axes of [['+x', '+y', '+z'], ['+x', '+z', '+y'], ['+y', '+x', '+z'], ['-x', '-y', '+z'], ['+z', '-x', '-y']] as const) {
      const m = turnMatrix(axes)
      expect(det(m)).toBe(1)
      axes.forEach((a, row) => expect(Math.abs(m[row * 3 + 'xyz'.indexOf(a[1])])).toBe(1))
    }
  })

  it('keeps directions: a module stored upside down turns its −y side up', () => {
    // World up (row 1) is the file's −y.
    expect(turnMatrix(['-x', '-y', '+z']).slice(3, 6)).toEqual([0, -1, 0])
  })
})

describe('splitPieces', () => {
  it('finds loose pieces printed in one file, bottom one first', () => {
    // Two separate squares, the second above the first, given top one first.
    const square = (y: number) => [0, y, 0, 1, y, 0, 1, y + 1, 0, 0, y, 0, 1, y + 1, 0, 0, y + 1, 0]
    const mesh = splitPieces(cluster(Float32Array.from([...square(5), ...square(0)]), 0.01))
    expect([...mesh.pieces]).toEqual([0, 6, 6, 6])
    // The first piece is the lower square.
    const ys = [...mesh.index.slice(0, 6)].map((i) => mesh.positions[i * 3 + 1])
    expect(Math.max(...ys)).toBe(1)
  })

  it('keeps a connected mesh as one piece', () => {
    expect([...splitPieces(cluster(sheet(3), 0.01)).pieces]).toEqual([0, 54])
  })
})
