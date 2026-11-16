/**
 * Display meshes for the 3D view, read from the user's Vault folder: each file once per folder, a couple at a
 * time in background workers, centred on their middle so a part can be placed by its centre.
 */
import * as THREE from 'three'
import type { VaultSource } from '../export/vaultFolder'
import type { MeshReply, MeshRequest } from './meshWorker'

const WORKERS = 2
const cache = new Map<string, Promise<THREE.BufferGeometry>>()
let pool: { worker: Worker; busy: boolean }[] = []
const queue: { file: () => Promise<File>; resolve: (g: THREE.BufferGeometry) => void; reject: (e: Error) => void }[] = []
let nextId = 0

/** The display mesh for one part file of this folder. */
export function loadGeometry(source: VaultSource, path: string): Promise<THREE.BufferGeometry> {
  const key = `${source.name}\n${path}`
  let found = cache.get(key)
  if (!found) {
    found = new Promise((resolve, reject) => {
      queue.push({ file: () => source.readFile(path), resolve, reject })
      pump()
    })
    // A failed read can be tried again later, e.g. after choosing another folder.
    found.catch(() => cache.delete(key))
    cache.set(key, found)
  }
  return found
}

function pump() {
  if (pool.length === 0) {
    pool = Array.from({ length: WORKERS }, () => ({
      worker: new Worker(new URL('./meshWorker.ts', import.meta.url), { type: 'module' }),
      busy: false,
    }))
  }
  for (const slot of pool) {
    if (slot.busy || queue.length === 0) continue
    const job = queue.shift()!
    slot.busy = true
    const id = nextId++
    const done = () => { slot.busy = false; pump() }
    job.file().then((file) => {
      slot.worker.onmessage = (e: MessageEvent<MeshReply>) => {
        if (e.data.id !== id) return
        if ('error' in e.data) job.reject(new Error(e.data.error))
        else job.resolve(toGeometry(e.data.positions, e.data.index, e.data.pieces))
        done()
      }
      slot.worker.postMessage({ id, file } satisfies MeshRequest)
    }, (err: unknown) => {
      job.reject(err instanceof Error ? err : new Error(String(err)))
      done()
    })
  }
}

function toGeometry(positions: Float32Array, index: Uint32Array, pieces: Uint32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.userData.pieces = pieces
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeBoundingBox()
  const c = g.boundingBox!.getCenter(new THREE.Vector3())
  g.translate(-c.x, -c.y, -c.z)
  g.computeBoundingBox()
  return g
}

const pieceCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry[]>()

/**
 * One loose piece of a file that holds several (see splitPieces), as its own mesh centred on its middle; the
 * whole mesh when the file has no such piece.
 */
export function pieceGeometry(whole: THREE.BufferGeometry, piece: number): THREE.BufferGeometry {
  const pieces = whole.userData.pieces as Uint32Array | undefined
  if (!pieces || piece * 2 >= pieces.length) return whole
  let made = pieceCache.get(whole)
  if (!made) { made = []; pieceCache.set(whole, made) }
  if (made[piece]) return made[piece]
  const [start, count] = [pieces[piece * 2], pieces[piece * 2 + 1]]
  const index = whole.getIndex()!.array as Uint32Array
  const source = whole.getAttribute('position').array as Float32Array
  // Only this piece's corners, renumbered.
  const remap = new Map<number, number>()
  const positions: number[] = []
  const sub = new Uint32Array(count)
  for (let k = 0; k < count; k++) {
    const v = index[start + k]
    let id = remap.get(v)
    if (id === undefined) {
      id = positions.length / 3
      remap.set(v, id)
      positions.push(source[v * 3], source[v * 3 + 1], source[v * 3 + 2])
    }
    sub[k] = id
  }
  made[piece] = toGeometry(Float32Array.from(positions), sub, new Uint32Array([0, count]))
  return made[piece]
}
