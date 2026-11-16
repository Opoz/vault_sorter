/**
 * The 3D view of a Layout's Towers, assembled or pulled apart (issue #9). View only: editing stays on the 2D
 * drawing and in the inspector. Parts are plain boxes at their measured size until the user's Vault folder is
 * chosen; then each real part replaces its box as it loads.
 */
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Colours, EditorTower } from '../editor/layoutOps'
import type { Depth } from '../engine/model'
import { assembleTower, emptySpaces, explodedCenter, turnMatrix, type Axes, type ScenePart, type Vec3 } from '../scene/assembly'
import { loadGeometry, pieceGeometry, squaredGeometry } from '../scene/meshCache'
import { QUALITIES, type Quality } from '../scene/simplify'
import { catalog, type Printer } from './data'
import { useVaultFolder } from './useVaultFolder'

/** Space between Towers standing side by side, in mm. */
const TOWER_GAP_MM = 160
const FOV = 35

export interface TowerSceneProps {
  readonly towers: readonly { readonly tower: EditorTower; readonly depth: Depth }[]
  readonly colours: Colours
  readonly printer: Printer
  readonly splitParts: 'auto' | 'whole' | 'split'
  /** The selected Unit: the view zooms to it and only it comes apart. */
  readonly focusUnitId?: string
  /** A part picked out: highlighted, with its name shown. Its owner is the focus Unit, or the Tower when there's none. */
  readonly picked?: { readonly towerId: string; readonly path: string }
  /** A part was clicked: its Tower, its Unit (none for the Tower's own parts) and its file. */
  readonly onPick: (towerId: string, unitId: string | undefined, path: string) => void
  /** Empty space was clicked. */
  readonly onClear: () => void
  /** Drops the picked part, keeping its owner selected (after hiding it). */
  readonly onUnpick: () => void
}

/** How far the pointer may move between press and release and still count as a click, not an orbit. */
const CLICK_SLOP_PX = 5

interface Placed {
  readonly parts: readonly (ScenePart & { readonly offset: number; readonly towerId: string })[]
  readonly spaces: readonly { center: Vec3; size: Vec3 }[]
  readonly bounds: THREE.Box3
  /** Assembled and fully apart together: what the camera frames, so pulling apart never runs off screen. */
  readonly apart: THREE.Box3
}

export default function TowerScene({ towers, colours, printer, splitParts, focusUnitId, picked, onPick, onClear, onUnpick }: TowerSceneProps) {
  const [spread, setSpread] = useState(0)
  // Parts hidden to see behind them, by owner and file: hiding one hides its copies in that owner (both pins, say).
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const hideKey = (towerId: string, unitId: string | undefined, path: string) => `${towerId}\n${unitId ?? ''}\n${path}`
  const [quality, setQuality] = useState<Quality>(storedQuality)
  const chooseQuality = (q: Quality) => {
    setQuality(q)
    try { localStorage.setItem(QUALITY_KEY, q) } catch { /* not remembered: fine */ }
  }
  const [resetKey, setResetKey] = useState(0)
  // Over a part: the pointer shows it can be clicked.
  const [hovering, setHovering] = useState(false)
  // Where the pointer went down, to tell a click from the end of an orbit.
  const down = useRef<{ x: number; y: number } | null>(null)
  const isClick = (e: { clientX: number; clientY: number }) =>
    !!down.current && Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) <= CLICK_SLOP_PX

  const placed = useMemo((): Placed => {
    const parts: (ScenePart & { offset: number; towerId: string })[] = []
    const spaces: { center: Vec3; size: Vec3 }[] = []
    const groups = towers.map(({ tower, depth }) => ({
      towerId: tower.id,
      parts: assembleTower(tower, depth, { catalog, printer, splitParts }),
      spaces: emptySpaces(tower, depth),
    }))
    const widths = groups.map((g) => {
      const xs = [...g.parts, ...g.spaces].flatMap((p) => [p.center[0] - p.size[0] / 2, p.center[0] + p.size[0] / 2])
      return xs.length ? Math.max(...xs) - Math.min(...xs) : 0
    })
    const total = widths.reduce((s, w) => s + w, 0) + TOWER_GAP_MM * Math.max(0, widths.filter((w) => w > 0).length - 1)
    let x = -total / 2
    groups.forEach((g, i) => {
      if (widths[i] === 0) return
      const offset = x + widths[i] / 2
      parts.push(...g.parts.filter(devOnly).map((p) => ({ ...p, offset, towerId: g.towerId })))
      spaces.push(...g.spaces.map((s) => ({ ...s, center: [s.center[0] + offset, s.center[1], s.center[2]] as Vec3 })))
      x += widths[i] + TOWER_GAP_MM
    })
    const bounds = new THREE.Box3()
    for (const p of parts) bounds.union(boxOf([p.center[0] + p.offset, p.center[1], p.center[2]], p.size))
    const apart = bounds.clone()
    for (const p of parts) {
      const c = explodedCenter(p, 1)
      apart.union(boxOf([c[0] + p.offset, c[1], c[2]], p.size))
    }
    for (const s of spaces) bounds.union(boxOf(s.center, s.size))
    return { parts, spaces, bounds, apart }
  }, [towers, printer, splitParts])

  const focus = focusUnitId && placed.parts.some((p) => p.unitId === focusUnitId) ? focusUnitId : undefined
  const view = useMemo(() => {
    const box = new THREE.Box3()
    if (focus) {
      // Close in on the assembled Unit; pulled apart, its parts come toward the camera.
      for (const p of placed.parts.filter((q) => q.unitId === focus)) box.union(boxOf([p.center[0] + p.offset, p.center[1], p.center[2]], p.size))
    } else box.copy(placed.apart)
    if (box.isEmpty()) box.set(new THREE.Vector3(-200, 0, -200), new THREE.Vector3(200, 400, 200))
    // Far enough back for the whole box to fit in the 35° view.
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius
    return { target: box.getCenter(new THREE.Vector3()), distance: (radius / Math.sin((FOV / 2) * (Math.PI / 180))) * (focus ? 1.5 : 0.8) }
  }, [placed, focus])

  // Real parts from the Vault folder, by file, as they load.
  const vault = useVaultFolder()
  // `done` counts the files loaded at the current quality; byPath keeps the last quality's meshes on show until
  // their replacements arrive.
  const [meshes, setMeshes] = useState<{ source?: string; quality?: Quality; byPath: ReadonlyMap<string, THREE.BufferGeometry>; done: number; failed: number }>(
    { byPath: new Map(), done: 0, failed: 0 })
  const paths = useMemo(() => [...new Set(placed.parts.map((p) => p.path))].sort().join('\n'), [placed])
  useEffect(() => {
    if (vault.folder.kind !== 'ready') return
    const source = vault.folder.source
    let live = true
    for (const path of paths ? paths.split('\n') : []) {
      loadGeometry(source, path, quality).then(
        (g) => live && setMeshes((m) => {
          const sameSource = m.source === source.name
          const fresh = !sameSource || m.quality !== quality
          const byPath = new Map(sameSource ? m.byPath : [])
          byPath.set(path, g)
          return { source: source.name, quality, byPath, done: (fresh ? 0 : m.done) + 1, failed: fresh ? 0 : m.failed }
        }),
        (err: unknown) => {
          if (!live) return
          console.warn(`3D view: couldn't load ${path}:`, err)
          setMeshes((m) => {
            const sameSource = m.source === source.name
            const fresh = !sameSource || m.quality !== quality
            return { source: source.name, quality, byPath: sameSource ? m.byPath : new Map(), done: fresh ? 0 : m.done, failed: (fresh ? 0 : m.failed) + 1 }
          })
        },
      )
    }
    return () => { live = false }
  }, [vault.folder, paths, quality])
  const ready = vault.folder.kind === 'ready' && meshes.source === vault.folder.source.name ? meshes : undefined
  const loadedNow = ready && ready.quality === quality ? ready.done : 0
  const failedNow = ready && ready.quality === quality ? ready.failed : 0
  const total = paths ? paths.split('\n').length : 0

  const floorY = placed.bounds.isEmpty() ? 0 : placed.bounds.min.y
  // The picked part's copies within its owner (both runners of a drawer, say).
  const isPicked = (p: Placed['parts'][number]) =>
    !!picked && p.towerId === picked.towerId && p.path === picked.path && p.unitId === focus

  return (
    <div className="scene3d" style={{ cursor: hovering ? 'pointer' : undefined }} onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY } }}>
      <Canvas
        camera={{ fov: FOV, near: 5, far: 50000 }} dpr={[1, 2]}
        onPointerMissed={(e) => { if (isClick(e)) onClear() }}
      >
        <color attach="background" args={['#eef0ef']} />
        <hemisphereLight args={['#ffffff', '#8a8f93', 1.4]} />
        <directionalLight position={[1500, 2500, 2000]} intensity={1.6} />
        <directionalLight position={[-2000, 800, -1000]} intensity={0.5} />
        <Controls target={view.target} distance={view.distance} resetKey={resetKey} />
        <gridHelper args={[6000, 60, '#c4c8c6', '#d9dcdb']} position={[0, floorY - 1, 0]} />
        {placed.parts.filter((p) => !hidden.has(hideKey(p.towerId, p.unitId, p.path))).map((p) => {
          const c = explodedCenter(p, spread, focus)
          return (
            <PartBox
              // Part keys are unique within a Tower; several Towers can show at once.
              key={`${p.towerId}
${p.key}`}
              center={[c[0] + p.offset, c[1], c[2]]}
              size={p.size}
              axes={p.axes}
              slopeDeg={p.slopeDeg}
              geometry={(() => {
                const whole = ready?.byPath.get(p.path)
                const piece = whole && p.piece !== undefined ? pieceGeometry(whole, p.piece) : whole
                return piece && squaredGeometry(piece, p.planDeg ?? 0)
              })()}
              colour={colours[p.role]}
              faded={focus !== undefined && p.unitId !== focus}
              picked={isPicked(p)}
              onHover={setHovering}
              onClick={(e) => {
                // A faded part in front of the chosen Unit lets the click through to it.
                const faded = focus !== undefined && p.unitId !== focus
                if (faded && e.intersections.some((i) => i.object.userData.focused)) return
                e.stopPropagation()
                if (isClick(e.nativeEvent)) onPick(p.towerId, p.unitId, p.path)
              }}
            />
          )
        })}
        {spread < 0.05 && placed.spaces.map((s, i) => <SpaceOutline key={i} center={s.center} size={s.size} />)}
      </Canvas>
      <div className="scene3d-controls">
        <label className="scene3d-spread">
          <span>Assembled</span>
          <input type="range" min={0} max={1} step={0.01} value={spread} onChange={(e) => setSpread(Number(e.target.value))} aria-label="Pull apart" />
          <span>Apart</span>
        </label>
        <button type="button" onClick={() => setResetKey((k) => k + 1)}>Reset view</button>
        {hidden.size > 0 && (
          <button type="button" onClick={() => setHidden(new Set())}>Show all ({hidden.size} hidden)</button>
        )}
        <div className="scene3d-quality" role="group" aria-label="Detail">
          <span>Detail</span>
          {QUALITIES.map((q) => (
            <button
              key={q} type="button" aria-pressed={quality === q} onClick={() => chooseQuality(q)}
              title={q === 'high' ? 'Sharpest; slower to load and to turn for a big tower' : q === 'low' ? 'Fastest' : undefined}
            >
              {q[0].toUpperCase() + q.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="scene3d-note">
        {vault.folder.kind === 'ready' ? (
          <>
            {loadedNow + failedNow < total && <p>Loading the real parts: {loadedNow} of {total}…</p>}
            {failedNow > 0 && <p>{failedNow} part file(s) couldn't be read from {vault.folder.source.name}, so they stay as boxes.</p>}
            <p className="small">Real parts are placed by best guess for now; they're being checked against the manual.</p>
          </>
        ) : vault.folder.kind === 'needs-permission' ? (
          <p>
            Parts are shown as plain boxes.{' '}
            <button type="button" className="link" onClick={() => { if (vault.folder.kind === 'needs-permission') vault.allow(vault.folder.folder).catch(() => {}) }}>
              Allow reading {vault.folder.folder.name}
            </button>{' '}to see the real parts.
          </p>
        ) : vault.folder.kind === 'none' ? (
          <p>
            Parts are shown as plain boxes.{' '}
            <button type="button" className="link" onClick={() => vault.pick().catch(() => {})}>Choose your Vault folder</button>{' '}
            to see the real parts. Nothing is uploaded.
          </p>
        ) : null}
      </div>
      {picked && placed.parts.some(isPicked) && (
        <div className="scene3d-picked">
          <span>{partLabel(picked.path)}</span>
          <button
            type="button"
            onClick={() => {
              setHidden((h) => new Set(h).add(hideKey(picked.towerId, focus, picked.path)))
              onUnpick()
            }}
          >
            Hide
          </button>
        </div>
      )}
    </div>
  )
}

const boxOf = (center: Vec3, size: Vec3) =>
  new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...center), new THREE.Vector3(...size))

// One unit cube, scaled per part, and its outline.
const CUBE = new THREE.BoxGeometry(1, 1, 1)
const CUBE_EDGES = new THREE.EdgesGeometry(CUBE)

/** A part's file name without folder or extension, as the parts list shows it. */
const partLabel = (path: string) => path.split('/').pop()!.replace(/\.stl$/i, '')

const PICKED_COLOUR = '#2f6feb'

/** The turn from a file's stored axes to how the part sits, as a quaternion. */
const QUALITY_KEY = 'vault-planner:3d-quality'
/** The detail chosen last time, medium at first. */
function storedQuality(): Quality {
  try {
    const q = localStorage.getItem(QUALITY_KEY)
    return QUALITIES.includes(q as Quality) ? (q as Quality) : 'medium'
  } catch {
    return 'medium'
  }
}

// A file stored turned on the bed arrives already squared up (squaredGeometry), so only `axes` turns it here.
const turnOf = (axes: Axes) => {
  const m = turnMatrix(axes)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1))
}

/** A part: the real mesh when it has loaded, turned into place, otherwise a box at its measured size. */
function PartBox({ center, size, axes, slopeDeg = 0, geometry, colour, faded, picked, onClick, onHover }: {
  center: Vec3; size: Vec3; axes: Axes; slopeDeg?: number; geometry?: THREE.BufferGeometry; colour: string; faded: boolean; picked: boolean
  onClick: (e: ThreeEvent<MouseEvent>) => void; onHover: (over: boolean) => void
}) {
  const turn = useMemo(() => {
    const t = turnOf(axes)
    return slopeDeg ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (slopeDeg * Math.PI) / 180).multiply(t) : t
  }, [axes, slopeDeg])
  const material = (
    <meshStandardMaterial
      key={`${faded ? 'faded' : 'solid'}-${geometry ? 'mesh' : 'box'}`}
      color={colour} roughness={0.75} transparent={faded} opacity={faded ? 0.07 : 1} depthWrite={!faded}
      emissive={picked ? PICKED_COLOUR : '#000000'} emissiveIntensity={picked ? 0.45 : 0}
      flatShading={!!geometry} side={geometry ? THREE.DoubleSide : THREE.FrontSide}
    />
  )
  if (geometry) {
    return (
      <group position={center}>
        <mesh
          geometry={geometry}
          quaternion={turn}
          userData={{ focused: !faded }}
          onClick={onClick}
          onPointerOver={(e) => { e.stopPropagation(); onHover(true) }}
          onPointerOut={() => onHover(false)}
        >
          {material}
        </mesh>
        {picked && (
          <lineSegments geometry={CUBE_EDGES} scale={size} renderOrder={10}>
            <lineBasicMaterial color={PICKED_COLOUR} depthTest={false} transparent />
          </lineSegments>
        )}
      </group>
    )
  }
  return (
    <group position={center} scale={size}>
      <mesh
        geometry={CUBE}
        userData={{ focused: !faded }}
        onClick={onClick}
        onPointerOver={(e) => { e.stopPropagation(); onHover(true) }}
        onPointerOut={() => onHover(false)}
      >
        {/* A new material when fading changes (its key): three.js doesn't pick up a change to `transparent` on its own. */}
        {material}
      </mesh>
      {/* The picked part's outline shows through whatever is in front of it. */}
      <lineSegments geometry={CUBE_EDGES} renderOrder={picked ? 10 : 0}>
        <lineBasicMaterial
          key={picked ? 'picked' : 'plain'}
          color={picked ? PICKED_COLOUR : '#24272a'} transparent opacity={picked ? 1 : faded ? 0.05 : 0.35} depthTest={!picked}
        />
      </lineSegments>
    </group>
  )
}

function SpaceOutline({ center, size }: { center: Vec3; size: Vec3 }) {
  return (
    <lineSegments geometry={CUBE_EDGES} position={center} scale={size}>
      <lineBasicMaterial color="#b7791f" transparent opacity={0.6} />
    </lineSegments>
  )
}

/** Orbit with the mouse, zoom with the wheel; starts at a three-quarter front view, and again on reset. */
function Controls({ target, distance, resetKey }: { target: THREE.Vector3; distance: number; resetKey: number }) {
  const { camera, gl } = useThree()
  const controls = useRef<OrbitControls | null>(null)
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.enableDamping = true
    controls.current = c
    return () => { c.dispose(); controls.current = null }
  }, [camera, gl])
  useEffect(() => {
    const c = controls.current
    if (!c) return
    c.target.copy(target)
    // Front and a little to the right, from slightly above, like the manual's pictures.
    const dir = devCameraAngle() ?? new THREE.Vector3(0.45, 0.3, 0.85)
    camera.position.copy(target).addScaledVector(dir.normalize(), distance)
    c.update()
  }, [camera, target, distance, resetKey])
  useFrame(() => controls.current?.update())
  return null
}

/**
 * For checking part poses against the manual while developing: `?cam=<azimuth>,<elevation>` in degrees (azimuth
 * from the front, positive toward the right) sets the starting camera angle. Ignored in the published app.
 */
function devCameraAngle(): THREE.Vector3 | undefined {
  if (!import.meta.env.DEV) return undefined
  const m = new URLSearchParams(window.location.search).get('cam')?.match(/^(-?[\d.]+),(-?[\d.]+)$/)
  if (!m) return undefined
  const [az, el] = [Number(m[1]) * (Math.PI / 180), Number(m[2]) * (Math.PI / 180)]
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
}

/** For checking poses while developing: `?only=<pattern>` shows just the parts whose file name matches. */
function devOnly(part: ScenePart): boolean {
  if (!import.meta.env.DEV) return true
  const only = new URLSearchParams(window.location.search).get('only')
  return !only || new RegExp(only, 'i').test(part.path.split('/').pop()!)
}
