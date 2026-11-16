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
        else job.resolve(toGeometry(e.data.positions, e.data.index))
        done()
      }
      slot.worker.postMessage({ id, file } satisfies MeshRequest)
    }, (err: unknown) => {
      job.reject(err instanceof Error ? err : new Error(String(err)))
      done()
    })
  }
}

function toGeometry(positions: Float32Array, index: Uint32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeBoundingBox()
  const c = g.boundingBox!.getCenter(new THREE.Vector3())
  g.translate(-c.x, -c.y, -c.z)
  g.computeBoundingBox()
  return g
}
