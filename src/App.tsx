import {
  DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, PointerSensor, pointerWithin, useDroppable, useSensor,
  useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { depthOptions } from './engine/depth'
import { towerDimensions } from './engine/dimensions'
import { filamentEstimate } from './engine/filament'
import { hardwareForTower } from './engine/hardware'
import { partsForTower, UnavailableError } from './engine/parts'
import {
  addTower, moveUnit, placeUnit, removeUnit, toEngineTower, type DropTarget, type EditorLayout, type UnitSpec,
} from './editor/layoutOps'
import { HEIGHTS, WIDTHS, type Depth, type Unit } from './engine/model'
import { catalog, printerLabel, printers, printerSource } from './ui/data'
import { belowBaseMm, HANDLE_MM, PULL_OUT, towerHeightMm, TYRE_WIDTH_MM, WIDTH_MM } from './ui/dims'
import { Inspector, type TowerInfo } from './ui/Inspector'
import { Palette, PALETTE_SCALE } from './ui/Palette'
import { TowerView } from './ui/TowerView'
import { UnitBlock } from './ui/UnitBlock'
import { specKey } from './ui/text'
import { useEditor, type Editor } from './ui/useEditor'

/**
 * Pixels per mm for the canvas: the tallest tower fills about three quarters of its height and every tower
 * fits across, within sensible limits.
 */
function useCanvasScale(layout: EditorLayout) {
  const [size, setSize] = useState({ width: 800, height: 600 })
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect()
    if (!el) return
    observer.current = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.current.observe(el)
  }, [])
  const tallest = Math.max(400, ...layout.towers.map((t) =>
    towerHeightMm(t.rows, t.roof, t.bottom !== 'none') + belowBaseMm(t.bottom) +
      (t.pullOutHandle ? PULL_OUT.extendedMm : t.roof === 'grid' ? HANDLE_MM.height : 0)))
  // Each tower's width, plus the wheels standing beside it; the extra 250 mm is the "Add a tower" spot.
  const across = layout.towers.reduce((sum, t) =>
    sum + (t.width ? WIDTH_MM[t.width] : 250) + (t.bottom === 'wheels' ? 2 * (TYRE_WIDTH_MM + 4) : 0), 0) + 250
  const gaps = (layout.towers.length + 1) * 80
  // Leave room for the drop gaps that open between rows during a drag, so the canvas never has to scroll then.
  const mostRows = Math.max(0, ...layout.towers.map((t) => t.rows.length))
  const fitHeight = Math.min(((size.height - 120 - 48 - mostRows * 14) * 0.85) / tallest, 1.4)
  const fitWidth = (size.width - gaps) / across
  // Shrink to fit every tower across, but not below a readable size (an S drawer still about 65 px wide): past
  // that, the canvas scrolls sideways.
  return { ref, scale: Math.max(0.3, Math.min(fitHeight, Math.max(fitWidth, 0.4))) }
}

/**
 * Drop on whatever is under the pointer, most specific first: a gap, slot or button, then a tower's
 * column (adds on top), and the bare canvas (new tower) only when nothing else is there.
 */
const dropRank = (id: string | number) => {
  const key = String(id)
  if (key === 'canvas') return 3
  if (key.startsWith('tower:')) return 2
  // Stacking on a column beats starting a new row on the same seam.
  if (key.startsWith('col:') || key.startsWith('colslot:')) return 0
  return 1
}
const dropUnderPointer: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  if (hits.length === 0) return hits
  const best = Math.min(...hits.map((h) => dropRank(h.id)))
  return hits.filter((h) => dropRank(h.id) === best)
}

// Gaps open up between rows once a drag starts, so drop zones must be re-measured as the layout shifts.
const MEASURING = { droppable: { strategy: MeasuringStrategy.Always, frequency: 100 } }

interface DropNotice { x: number; y: number; text: string }

type DragData =
  | { type: 'palette'; spec: UnitSpec }
  | { type: 'unit'; towerId: string; unitId: string; spec: UnitSpec }
type DropData =
  | { type: 'gap'; towerId: string; index: number }
  | { type: 'slot'; towerId: string; rowId: string }
  | { type: 'column'; towerId: string; rowId: string; columnId: string }
  | { type: 'newTower'; useEmptyTower?: boolean }
  | { type: 'trash' }

export default function App() {
  const editor = useEditor()
  const { layout, printer } = editor
  const [dragging, setDragging] = useState<DragData | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const info = useMemo(() => towerInfo(layout, printer), [layout, printer])
  const paletteFit = useMemo(() => unitFitByPrinter(printer, layout.splitParts), [printer, layout.splitParts])
  const { ref: canvasRef, scale } = useCanvasScale(layout)
  const [dropNotice, setDropNotice] = useState<DropNotice | null>(null)

  // Opening a share link (#share=…), on load or pasted into a tab already open: import it once, then take it out
  // of the address so a reload doesn't import it again.
  const openShared = useRef(editor.openShared)
  useEffect(() => { openShared.current = editor.openShared })
  useEffect(() => {
    const check = () => {
      const match = window.location.hash.match(/^#share=(.+)$/)
      if (!match) return
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      openShared.current(match[1])
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [])

  useEffect(() => {
    if (!dropNotice) return
    const timer = setTimeout(() => setDropNotice(null), 4500)
    return () => clearTimeout(timer)
  }, [dropNotice])

  function onDragStart(e: DragStartEvent) {
    setDragging((e.active.data.current as DragData) ?? null)
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    const drag = e.active.data.current as DragData | undefined
    const drop = e.over?.data.current as DropData | undefined
    if (!drag || !drop) return
    if (drop.type === 'trash') {
      if (drag.type === 'unit') editor.apply(removeUnit(layout, drag.towerId, drag.unitId))
      return
    }
    let base: EditorLayout = layout
    let towerId: string
    let target: DropTarget
    const emptyTower = layout.towers.find((t) => t.rows.length === 0)
    if (drop.type === 'newTower' && drop.useEmptyTower && emptyTower) {
      // Dropping on the bare canvas fills an empty tower before starting another one.
      towerId = emptyTower.id
      target = { kind: 'newRow', index: 0 }
    } else if (drop.type === 'newTower') {
      const created = addTower(layout)
      if (!created.ok) return
      base = created.layout
      towerId = base.towers[base.towers.length - 1].id
      target = { kind: 'newRow', index: 0 }
    } else {
      towerId = drop.towerId
      target = drop.type === 'gap' ? { kind: 'newRow', index: drop.index }
        : drop.type === 'column' ? { kind: 'onColumn', rowId: drop.rowId, columnId: drop.columnId }
        : { kind: 'beside', rowId: drop.rowId }
    }
    const result = drag.type === 'palette'
      ? placeUnit(base, towerId, target, drag.spec)
      : moveUnit(base, drag.towerId, drag.unitId, towerId, target)
    const pointer = e.activatorEvent as PointerEvent
    if (!result.ok && typeof pointer.clientX === 'number') {
      // Explain a refused drop right where it happened, not in a corner of the screen.
      setDropNotice({ x: pointer.clientX + e.delta.x, y: pointer.clientY + e.delta.y, text: result.reason })
      return
    }
    setDropNotice(null)
    if (editor.apply(result) && drag.type === 'palette') editor.setSelection({ type: 'tower', towerId })
  }

  function addFromPalette(spec: UnitSpec) {
    let base = layout
    let tower = editor.selection ? base.towers.find((t) => t.id === editor.selection!.towerId) : base.towers.at(-1)
    if (!tower) {
      const created = addTower(base)
      if (!created.ok) return
      base = created.layout
      tower = base.towers.at(-1)!
    }
    editor.apply(placeUnit(base, tower.id, { kind: 'newRow', index: tower.rows.length }, spec))
  }

  return (
    <div className="app">
      <TopBar editor={editor} />
      {!editor.persistent && (
        <p className="banner">This browser isn't letting the page save, so layouts last only until you close the tab.</p>
      )}
      {editor.unreadable.length > 0 && (
        <p className="banner">{editor.unreadable.length} saved layout(s) couldn't be read and were skipped.</p>
      )}
      <DndContext sensors={sensors} collisionDetection={dropUnderPointer} measuring={MEASURING} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="workbench">
          <Palette colours={layout.colours} onAdd={addFromPalette} fit={paletteFit} printerName={printerLabel(printer)} />
          <Canvas
            canvasRef={canvasRef}
            active={dragging !== null}
            hint={(() => {
              const empty = layout.towers.findIndex((t) => t.rows.length === 0)
              return empty >= 0 ? `Drop to start tower ${empty + 1}` : 'Drop to start a new tower'
            })()}
            onClickEmpty={() => editor.setSelection(null)}>
            <div className="towers">
              {layout.towers.map((tower, i) => {
                const t = info.get(tower.id)
                return (
                  <TowerView
                    key={tower.id}
                    tower={tower}
                    index={i}
                    colours={layout.colours}
                    scale={scale}
                    depth={t?.depth}
                    heightMm={t?.dimensions?.heightMm}
                    fitState={fitState(t)}
                    selection={editor.selection}
                    dragging={dragging !== null}
                    onSelect={editor.setSelection}
                    onDuplicate={editor.duplicateUnit}
                    dragWidth={dragging && 'spec' in dragging ? dragging.spec.width : undefined}
                  />
                )
              })}
              <NewTowerDrop
                active={dragging !== null}
                onAdd={() => {
                  const r = addTower(layout)
                  if (editor.apply(r) && r.ok) editor.setSelection({ type: 'tower', towerId: r.layout.towers.at(-1)!.id })
                }}
              />
            </div>
            <div className="floor" aria-hidden="true" />
            {dragging?.type === 'unit' && <Trash />}
          </Canvas>
          <aside className="inspector">
            {editor.notice && (
              <p className="notice" role="status">
                {editor.notice}
                <button type="button" className="link" onClick={() => editor.setNotice(null)}>Dismiss</button>
              </p>
            )}
            <Inspector editor={editor} info={info} />
          </aside>
        </div>
        {/* Rendered at the top of the page, outside the scrolling canvas, so moving it repaints cleanly. */}
        {createPortal(
          <DragOverlay dropAnimation={null} className="drag-preview">
            {dragging && (
              <UnitBlock {...dragging.spec} colours={layout.colours} scale={dragging.type === 'palette' ? Math.max(PALETTE_SCALE, scale) : scale} />
            )}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
      {dropNotice && (
        <p className="drop-notice" role="alert" style={{ left: dropNotice.x, top: dropNotice.y }}>
          {dropNotice.text}
        </p>
      )}
      <footer className="footer">
        An unofficial planner for USSA's Vault. You need your own copy of the Vault files to print anything.
        Printer sizes from Bambu Studio ({printerSource.split('@')[1]?.slice(0, 7)}).
      </footer>
    </div>
  )
}

function TopBar({ editor }: { editor: Editor }) {
  const { layout, layouts } = editor
  return (
    <header className="topbar">
      <h1 className="brand">Vault Planner</h1>
      <div className="layout-picker">
        <label className="sr-only" htmlFor="layout-select">Layout</label>
        <select id="layout-select" value={layout.id} onChange={(e) => editor.open(e.target.value)}>
          {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button type="button" onClick={editor.create}>New layout</button>
        <button type="button" onClick={() => editor.duplicate(layout.id)}>Duplicate</button>
        <button type="button" onClick={() => share(editor)}>Share</button>
        <button
          type="button"
          className="danger"
          onClick={() => { if (window.confirm(`Delete "${layout.name}"? This can't be undone.`)) editor.remove(layout.id) }}
        >
          Delete
        </button>
      </div>
      <label className="printer-picker">
        <span>Printer</span>
        <select value={editor.printer.id} onChange={(e) => editor.setPrinterId(e.target.value)}>
          {printers.map((p) => (
            <option key={p.id} value={p.id}>{printerLabel(p)} ({p.bed.width} × {p.bed.depth} × {p.height} mm)</option>
          ))}
        </select>
      </label>
    </header>
  )
}

/** Copy a link to the current layout; if the browser won't allow copying, show the link to copy by hand. */
async function share(editor: Editor) {
  const link = editor.shareLink()
  try {
    await navigator.clipboard.writeText(link)
    editor.setNotice(`Link to "${editor.layout.name}" copied. Anyone with it can open their own copy of this layout.`)
  } catch {
    window.prompt('Copy this link to share the layout:', link)
  }
}

function Canvas({ canvasRef, active, hint, onClickEmpty, children }: {
  canvasRef: (el: HTMLElement | null) => void
  active: boolean
  hint: string
  onClickEmpty: () => void
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas', data: { type: 'newTower', useEmptyTower: true } })
  const ref = useCallback((el: HTMLElement | null) => { setNodeRef(el); canvasRef(el) }, [setNodeRef, canvasRef])
  return (
    <main
      ref={ref}
      className={`canvas${active ? ' is-dragging' : ''}${active && isOver ? ' is-over' : ''}`}
      aria-label="Towers"
      onClick={(e) => {
        // Empty space deselects, including the empty part of a tower's column; a tower's name selects it.
        const el = e.target as HTMLElement
        if (el === e.currentTarget || el.classList.contains('towers')) onClickEmpty()
      }}
    >
      {children}
      {active && isOver && <p className="canvas-hint">{hint}</p>}
    </main>
  )
}

function NewTowerDrop({ active, onAdd }: { active: boolean; onAdd: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'new-tower', data: { type: 'newTower' } })
  return (
    <button ref={setNodeRef} type="button" className={`new-tower${active ? ' is-active' : ''}${isOver ? ' is-over' : ''}`} onClick={onAdd}>
      {active ? 'Drop to start a new tower' : 'Add a tower'}
    </button>
  )
}

function Trash() {
  const { setNodeRef, isOver } = useDroppable({ id: 'trash', data: { type: 'trash' } })
  return <div ref={setNodeRef} className={`trash${isOver ? ' is-over' : ''}`}>Drop here to remove</div>
}

function towerInfo(layout: EditorLayout, printer: Editor['printer']): Map<string, TowerInfo> {
  const map = new Map<string, TowerInfo>()
  const options = { catalog, printer, splitParts: layout.splitParts }
  for (const tower of layout.towers) {
    const probe = toEngineTower(tower, 3)
    if (!probe) {
      map.set(tower.id, {})
      continue
    }
    const { depth: _ignored, ...withoutDepth } = probe
    try {
      const choice = depthOptions(withoutDepth, options)
      const depth = tower.depth ?? choice.suggested
      const built = depth ? { ...probe, depth } : undefined
      const parts = built ? partsForTower(built, options) : undefined
      map.set(tower.id, {
        choice, depth, parts,
        hardware: hardwareForTower(probe),
        grams: parts ? filamentEstimate(parts, catalog) : undefined,
        dimensions: built ? towerDimensions(built, options) : undefined,
      })
    } catch (e) {
      map.set(tower.id, { error: e instanceof UnavailableError ? e.message : String(e) })
    }
  }
  return map
}

/**
 * For the palette: the largest depth at which each Unit's own parts fit the printer, or null if none does.
 * Roof and base are left out, since they depend on the tower, not the unit.
 */
function unitFitByPrinter(printer: Editor['printer'], splitParts: EditorLayout['splitParts']) {
  const fit = new Map<string, Depth | null>()
  for (const kind of ['drawer', 'sustainer'] as const) {
    for (const width of WIDTHS) {
      for (const height of HEIGHTS) {
        if (width === 'XL' && height !== '1F') continue
        const unit: Unit = kind === 'drawer'
          ? { kind, width, baseplate: 'none', gearedRails: false, key: 'normal' }
          : { kind, width, moduleType: 'flat' }
        const choice = depthOptions(
          { width, roof: 'none', bottom: 'none', backbone: 'none', rows: [{ height, units: [unit] }] },
          { catalog, printer, splitParts },
        )
        fit.set(specKey({ kind, width, height }), choice.suggested ?? null)
      }
    }
  }
  return fit
}


function fitState(t: TowerInfo | undefined): 'fits' | 'tight' | 'none' | 'incomplete' {
  if (!t?.choice) return 'incomplete'
  const chosen = t.choice.options.find((o) => o.depth === t.depth)
  if (!chosen) return 'none'
  if (!chosen.fits) return 'none'
  return chosen.tight.length ? 'tight' : 'fits'
}
