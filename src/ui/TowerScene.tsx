/**
 * The 3D view of a Layout's Towers, assembled or pulled apart (issue #9). View only: editing stays on the 2D
 * drawing and in the inspector. Parts are plain boxes at their measured size for now.
 */
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Colours, EditorTower } from '../editor/layoutOps'
import type { Depth } from '../engine/model'
import { assembleTower, emptySpaces, explodedCenter, type ScenePart, type Vec3 } from '../scene/assembly'
import { catalog, type Printer } from './data'

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

export default function TowerScene({ towers, colours, printer, splitParts, focusUnitId, picked, onPick, onClear }: TowerSceneProps) {
  const [spread, setSpread] = useState(0)
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
      parts.push(...g.parts.map((p) => ({ ...p, offset, towerId: g.towerId })))
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
        {placed.parts.map((p) => {
          const c = explodedCenter(p, spread, focus)
          return (
            <PartBox
              key={p.key}
              center={[c[0] + p.offset, c[1], c[2]]}
              size={p.size}
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
      </div>
      <p className="scene3d-note">Parts are shown as plain boxes. Choose your Vault folder to see the real parts.</p>
      {picked && placed.parts.some(isPicked) && <p className="scene3d-picked">{partLabel(picked.path)}</p>}
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

function PartBox({ center, size, colour, faded, picked, onClick, onHover }: {
  center: Vec3; size: Vec3; colour: string; faded: boolean; picked: boolean
  onClick: (e: ThreeEvent<MouseEvent>) => void; onHover: (over: boolean) => void
}) {
  return (
    <group position={center} scale={size}>
      <mesh
        geometry={CUBE}
        userData={{ focused: !faded }}
        onClick={onClick}
        onPointerOver={(e) => { e.stopPropagation(); onHover(true) }}
        onPointerOut={() => onHover(false)}
      >
        {/* A new material when fading changes: three.js doesn't pick up a change to `transparent` on its own. */}
        <meshStandardMaterial
          key={faded ? 'faded' : 'solid'}
          color={colour} roughness={0.75} transparent={faded} opacity={faded ? 0.07 : 1} depthWrite={!faded}
          emissive={picked ? PICKED_COLOUR : '#000000'} emissiveIntensity={picked ? 0.45 : 0}
        />
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
    camera.position.set(target.x + distance * 0.45, target.y + distance * 0.3, target.z + distance * 0.85)
    c.update()
  }, [camera, target, distance, resetKey])
  useFrame(() => controls.current?.update())
  return null
}
