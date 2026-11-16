/// <reference lib="webworker" />
/**
 * Reads one Vault STL and makes its display copy, off the page's thread so the planner stays responsive while
 * big files load. The file comes from the user's own folder and goes nowhere else (docs/adr/0004).
 */
import { readStl } from '../export/stl'
import { binaryStlCorners, simplify } from './simplify'

export interface MeshRequest { readonly id: number; readonly file: File }
export type MeshReply =
  | { readonly id: number; readonly positions: Float32Array; readonly index: Uint32Array }
  | { readonly id: number; readonly error: string }

self.onmessage = async (e: MessageEvent<MeshRequest>) => {
  const { id, file } = e.data
  try {
    const buffer = await file.arrayBuffer()
    const corners = binaryStlCorners(buffer) ?? textCorners(buffer)
    const mesh = simplify(corners)
    const reply: MeshReply = { id, positions: mesh.positions, index: mesh.index }
    ;(self as unknown as Worker).postMessage(reply, [mesh.positions.buffer, mesh.index.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies MeshReply)
  }
}

/** A text STL's corners, through the full reader (rare: the Vault files are binary). */
function textCorners(buffer: ArrayBuffer): Float32Array {
  const mesh = readStl(buffer)
  const out = new Float32Array(mesh.triangles.length * 3)
  for (let i = 0; i < mesh.triangles.length; i++) out.set(mesh.vertices.subarray(mesh.triangles[i] * 3, mesh.triangles[i] * 3 + 3), i * 3)
  return out
}
