/**
 * Lighter copies of the Vault meshes for the 3D view. The files carry up to 7 million triangles each, far more
 * than a whole Tower can draw smoothly, so corners closer together than a grid cell are merged (vertex
 * clustering) and the triangles that collapse are dropped. At a 1 mm cell a part looks the same at Tower scale.
 * Only the view uses these; print files always use the full meshes.
 */

export interface DisplayMesh {
  /** x, y, z per corner. */
  readonly positions: Float32Array
  /** Three corner indexes per triangle. */
  readonly index: Uint32Array
}

/** Triangles a part is cut down to, at most (unless even a coarse grid can't get there). */
export const TARGET_TRIANGLES = 150_000
/** The finest grid tried, in mm; doubled until the target is met. */
const FIRST_CELL_MM = 0.5
const LAST_CELL_MM = 8

/** How much detail the 3D view keeps, chosen by the user: more is sharper but slower to load and draw. */
export type Quality = 'low' | 'medium' | 'high'
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high']
/** Per quality: the triangle target and the finest grid tried. */
export const QUALITY_SETTINGS: Record<Quality, { readonly target: number; readonly firstCell: number }> = {
  low: { target: 40_000, firstCell: 1 },
  medium: { target: TARGET_TRIANGLES, firstCell: FIRST_CELL_MM },
  high: { target: 1_000_000, firstCell: 0.125 },
}

/** A binary STL's triangle corners, 9 floats per triangle; null if the buffer isn't binary STL. */
export function binaryStlCorners(buffer: ArrayBuffer): Float32Array | null {
  if (buffer.byteLength < 84) return null
  const view = new DataView(buffer)
  const count = view.getUint32(80, true)
  if (84 + 50 * count !== buffer.byteLength) return null
  const out = new Float32Array(count * 9)
  for (let i = 0; i < count; i++) {
    const base = 84 + 50 * i + 12
    for (let k = 0; k < 9; k++) out[i * 9 + k] = view.getFloat32(base + 4 * k, true)
  }
  return out
}

/** Merges corners onto a grid of `cell` mm and drops the triangles that collapse. */
export function cluster(corners: Float32Array, cell: number): DisplayMesh {
  const triangles = corners.length / 9
  let minX = Infinity, minY = Infinity, minZ = Infinity
  for (let i = 0; i < corners.length; i += 3) {
    if (corners[i] < minX) minX = corners[i]
    if (corners[i + 1] < minY) minY = corners[i + 1]
    if (corners[i + 2] < minZ) minZ = corners[i + 2]
  }
  // Grid cells are numbered into one safe integer: 2^17 cells a side covers 65 m at 0.5 mm.
  const SIDE = 131072
  const ids = new Map<number, number>()
  const positions: number[] = []
  const index: number[] = []
  const corner = (i: number) => {
    const x = corners[i], y = corners[i + 1], z = corners[i + 2]
    const key = Math.floor((x - minX) / cell) + SIDE * (Math.floor((y - minY) / cell) + SIDE * Math.floor((z - minZ) / cell))
    let id = ids.get(key)
    if (id === undefined) {
      id = positions.length / 3
      ids.set(key, id)
      positions.push(x, y, z)
    }
    return id
  }
  for (let t = 0; t < triangles; t++) {
    const a = corner(t * 9), b = corner(t * 9 + 3), c = corner(t * 9 + 6)
    if (a !== b && b !== c && a !== c) index.push(a, b, c)
  }
  return { positions: Float32Array.from(positions), index: Uint32Array.from(index) }
}

/** A display copy of a mesh: the finest grid that meets the triangle target. */
export function simplify(corners: Float32Array, target = TARGET_TRIANGLES, firstCell = FIRST_CELL_MM): DisplayMesh {
  if (corners.length / 9 <= target) return cluster(corners, 0.01)
  let mesh = cluster(corners, firstCell)
  for (let cell = firstCell * 2; mesh.index.length / 3 > target && cell <= LAST_CELL_MM; cell *= 2) mesh = cluster(corners, cell)
  return mesh
}

/**
 * The separate pieces of a mesh (groups of triangles that share corners), for files that hold several loose
 * parts printed together, like a pair of springs. The triangles are reordered piece by piece; `pieces` holds
 * each piece's first index and index count, ordered by where the piece sits in the file (its lowest y, then x).
 */
export function splitPieces(mesh: DisplayMesh): DisplayMesh & { readonly pieces: Uint32Array } {
  const { positions, index } = mesh
  const parent = new Uint32Array(positions.length / 3).map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] }
    return i
  }
  const join = (a: number, b: number) => { const [ra, rb] = [find(a), find(b)]; if (ra !== rb) parent[ra] = rb }
  for (let t = 0; t < index.length; t += 3) { join(index[t], index[t + 1]); join(index[t], index[t + 2]) }
  // Each piece's triangles, and where it sits.
  const groups = new Map<number, { tris: number[]; minY: number; minX: number }>()
  for (let t = 0; t < index.length; t += 3) {
    const root = find(index[t])
    let g = groups.get(root)
    if (!g) { g = { tris: [], minY: Infinity, minX: Infinity }; groups.set(root, g) }
    g.tris.push(t)
    for (let k = 0; k < 3; k++) {
      g.minX = Math.min(g.minX, positions[index[t + k] * 3])
      g.minY = Math.min(g.minY, positions[index[t + k] * 3 + 1])
    }
  }
  const ordered = [...groups.values()].sort((a, b) => a.minY - b.minY || a.minX - b.minX)
  const out = new Uint32Array(index.length)
  const pieces = new Uint32Array(ordered.length * 2)
  let at = 0
  ordered.forEach((g, i) => {
    pieces[i * 2] = at
    for (const t of g.tris) { out[at++] = index[t]; out[at++] = index[t + 1]; out[at++] = index[t + 2] }
    pieces[i * 2 + 1] = at - pieces[i * 2]
  })
  return { positions, index: out, pieces }
}
