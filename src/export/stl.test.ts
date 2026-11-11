import { describe, expect, it } from 'vitest'
import { readStl } from './stl'

type V = [number, number, number]
const cube = (): [V, V, V][] => {
  const p: V[] = [[0, 0, 0], [10, 0, 0], [10, 20, 0], [0, 20, 0], [0, 0, 30], [10, 0, 30], [10, 20, 30], [0, 20, 30]]
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]]
  return f.map(([a, b, c]) => [p[a], p[b], p[c]])
}

function binary(tris: [V, V, V][]): ArrayBuffer {
  const buf = new ArrayBuffer(84 + 50 * tris.length)
  const view = new DataView(buf)
  view.setUint32(80, tris.length, true)
  tris.forEach((t, i) => t.forEach((v, k) => v.forEach((c, j) => view.setFloat32(84 + 50 * i + 12 + 12 * k + 4 * j, c, true))))
  return buf
}

function ascii(tris: [V, V, V][]): ArrayBuffer {
  const body = tris.map((t) => `facet normal 0 0 0\n outer loop\n${t.map((v) => `  vertex ${v.join(' ')}`).join('\n')}\n endloop\nendfacet`).join('\n')
  return new TextEncoder().encode(`solid cube\n${body}\nendsolid cube\n`).buffer as ArrayBuffer
}

describe('readStl', () => {
  it('reads a binary STL into shared corner points and triangles', () => {
    const mesh = readStl(binary(cube()))

    expect(mesh.vertices.length / 3).toBe(8)
    expect(mesh.triangles.length / 3).toBe(12)
    expect([...mesh.min]).toEqual([0, 0, 0])
    expect([...mesh.max]).toEqual([10, 20, 30])
  })

  it('reads a text STL the same way', () => {
    const mesh = readStl(ascii(cube()))

    expect(mesh.vertices.length / 3).toBe(8)
    expect(mesh.triangles.length / 3).toBe(12)
  })

  it('keeps each triangle pointing at the right corners', () => {
    const tris = cube()
    const mesh = readStl(binary(tris))
    const corner = (i: number) => [...mesh.vertices.slice(i * 3, i * 3 + 3)]

    tris.forEach((t, i) => t.forEach((v, k) => expect(corner(mesh.triangles[i * 3 + k])).toEqual(v)))
  })
})
