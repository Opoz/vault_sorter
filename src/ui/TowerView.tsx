import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { CSSProperties, ReactNode } from 'react'
import type { Depth } from '../engine/model'
import {
  columnFloors, columnShortfall, missingWidth, rowFloors, rowProblems, unitStarts, type Colours, type EditorColumn, type EditorRow, type EditorTower,
  type EditorUnit,
} from '../editor/layoutOps'
import type { Width } from '../engine/model'
import { columnMismatchMm } from '../engine/dimensions'
import { topHandleCount } from '../engine/parts'
import { BASE_MM, belowBaseMm, CASTER, FEET_INSET_MM, FOOT_MM, HANDLE_MM, HEAVYWEIGHT_HANDLE_MM, PULL_OUT, LIP_MM, ROOF_MM, towerHeightMm, TYRE_WIDTH_MM, WHEEL_MM, WIDTH_MM, floorsHeightMm, FLOOR_MM } from './dims'
import { describe } from './text'
import { UnitBlock } from './UnitBlock'
import { usePaint } from './paintContext'
import type { PaintTarget } from '../editor/paint'
import { drawingTargets } from './paintTargets'
import type { Selection } from './useEditor'

interface Props {
  tower: EditorTower
  index: number
  colours: Colours
  scale: number
  depth: Depth | undefined
  /** Height from the engine's measured dimensions, when the tower is complete. */
  heightMm?: number
  fitState: 'fits' | 'tight' | 'none' | 'incomplete'
  /** Why the tower doesn't fit, when it doesn't: a summary, and the units with a part too big. */
  fitWhy?: { readonly summary: string; readonly units: ReadonlyMap<string, string> }
  selection: Selection
  dragging: boolean
  onSelect: (s: Selection) => void
  onDuplicate: (towerId: string, unitId: string) => void
  onCopyColumn: (towerId: string, rowId: string, columnId: string) => void
  onCopyOnto: (towerId: string, unitId: string, rowId: string, columnId: string) => void
  /** Width of the unit being dragged, if any: columns of that width offer a spot on top. */
  dragWidth?: Width
}

export function TowerView(props: Props) {
  const { tower, index, colours, scale, depth, heightMm: measuredHeight, fitState, selection, dragging, onSelect, dragWidth } = props
  const handles = tower.width ? topHandleCount({ width: tower.width, roof: tower.roof, topHandles: tower.topHandles }) : 0
  const width = tower.width
  const problems = rowProblems(tower)
  const isSelected = selection?.type === 'tower' && selection.towerId === tower.id
  const hasBase = tower.bottom !== 'none'
  const towerPx = width ? WIDTH_MM[width] * scale : 150
  const rowsTopFirst = [...tower.rows].map((row, i) => ({ row, i })).reverse()
  const drawnHeight = towerHeightMm(tower.rows, tower.roof, hasBase)
  const heightMm = measuredHeight ?? drawnHeight
  // The whole column above and around a tower is a safe zone: dropping anywhere in it adds to the top.
  const { setNodeRef: zoneRef, isOver: zoneOver } = useDroppable({
    id: `tower:${tower.id}`, data: { type: 'gap', towerId: tower.id, index: tower.rows.length },
  })

  return (
    <figure
      ref={zoneRef}
      onClick={(e) => {
        // Anywhere on a tower selects it, unless the click was on a unit (which selects the unit).
        if (!(e.target as HTMLElement).closest('.placed')) onSelect({ type: 'tower', towerId: tower.id })
      }}
      className={`tower${isSelected ? ' is-selected' : ''}${dragging && zoneOver ? ' is-zone-over' : ''}`}
      style={{ '--tower-w': `${towerPx}px`, '--body': colours.body, '--secondary': colours.secondary } as CSSProperties}
    >
      <button type="button" className="tower-head" onClick={() => onSelect({ type: 'tower', towerId: tower.id })}>
        <span className="tower-name">Tower {index + 1}</span>
        <span className="tower-meta">
          {width ? `${width}${depth ? depth : ''}` : 'Empty'}
          {fitState !== 'incomplete' && width && <FitBadge state={fitState} />}
        </span>
        {props.fitWhy && <span className="fit-why">{props.fitWhy.summary}</span>}
      </button>

      <div className="tower-body">
        {tower.rows.length === 0 ? (
          <EmptyDrop towerId={tower.id} />
        ) : (
          <div
            className="tower-stack"
            style={{
              // Room above the roof for its handle, unless the pull-out handle (taller) already makes room.
              paddingTop: handles > 0 && !tower.pullOutHandle ? HANDLE_MM.height * scale : undefined,
              paddingBottom: belowBaseMm(tower.bottom) * scale || undefined,
              // Wheels stand outside the base: keep their width free on both sides.
              marginInline: tower.bottom === 'wheels' ? (TYRE_WIDTH_MM + 4) * scale : undefined,
            }}
          >
            {tower.pullOutHandle && width && <PullOutHandle width={width} scale={scale} />}
            {tower.roof !== 'none' && tower.roof !== 'under table mount' && (
              <div
                className={`tower-roof${tower.roof === 'heavyweight' ? ' roof-heavyweight' : ''}`}
                style={{ height: Math.max(ROOF_MM[tower.roof] * scale, 4) }}
                title={`${tower.roof} roof`}
              >
                {tower.roof === 'heavyweight' && width && <HeavyweightRoof towerMm={WIDTH_MM[width]} scale={scale} />}
                {/* Spread evenly across the roof, each centred in its share of the width. */}
                {Array.from({ length: handles }, (_, i) => (
                  <span
                    key={i}
                    className="top-handle"
                    title="Top handle"
                    style={{
                      left: `${((i + 0.5) / handles) * 100}%`,
                      width: HANDLE_MM.length * scale,
                      height: HANDLE_MM.height * scale,
                      borderRadius: HANDLE_MM.corner * scale,
                      borderWidth: `${HANDLE_MM.top * scale}px ${HANDLE_MM.side * scale}px ${HANDLE_MM.bottom * scale}px`,
                    }}
                  />
                ))}
              </div>
            )}
            {tower.roof === 'under table mount' && <div className="tower-table" title="Under-table mount" />}
            <Gap towerId={tower.id} index={tower.rows.length} active={dragging} top />
            {rowsTopFirst.map(({ row, i }) => (
              <div key={row.id} className="tower-row-wrap">
                <RowView
                  towerId={tower.id}
                  row={row}
                  rowIndex={i}
                  towerWidthPx={towerPx}
                  colours={colours}
                  scale={scale}
                  problem={problems.find((p) => p.rowIndex === i)?.problem}
                  selection={selection}
                  dragging={dragging}
                  onSelect={onSelect}
                  copyable={width && row.columns.length === 1 && missingWidth(width, row) === row.columns[0].width ? row.columns[0] : undefined}
                  onCopyColumn={props.onCopyColumn}
                  blocked={props.fitWhy?.units}
                  onCopyOnto={props.onCopyOnto}
                  dragWidth={dragWidth}
                />
                <Gap towerId={tower.id} index={i} active={dragging} />
              </div>
            ))}
            <div className="tower-lip" style={{ height: LIP_MM * scale }} />
            {hasBase && width && <Bottom kind={tower.bottom} scale={scale} widthMm={WIDTH_MM[width]} />}
          </div>
        )}
        {tower.rows.length > 0 && width && (
          <div className="dim dim-height" style={{ height: drawnHeight * scale, marginBottom: belowBaseMm(tower.bottom) * scale }}>
            <span>{Math.round(heightMm)} mm</span>
          </div>
        )}
      </div>
      {width && tower.rows.length > 0 && (
        <figcaption className="dim dim-width">{WIDTH_MM[width].toFixed(1)} mm wide</figcaption>
      )}
    </figure>
  )
}

/**
 * The pull-out handle, pulled out, seen from the front (Instructions Manual p13): it stands behind the tower on two
 * rods that run down the backbone, so the rods carry on behind the roof and modules.
 */
function PullOutHandle({ width, scale }: { width: keyof typeof PULL_OUT.gripMm; scale: number }) {
  const px = (mm: number) => mm * scale
  const grip = PULL_OUT.gripMm[width]
  return (
    <div className="pullout" style={{ height: px(PULL_OUT.extendedMm) }} title="Pull-out handle">
      <span className="pullout-grip" style={{ width: px(grip), height: px(PULL_OUT.gripHeightMm), borderRadius: px(8) }} />
      {(['left', 'right'] as const).map((side) => (
        <span
          key={side}
          className="pullout-rod"
          style={{ width: Math.max(px(PULL_OUT.rodMm), 2), [side]: `calc(50% - ${px(grip / 2 - PULL_OUT.rodMm)}px)`, top: px(PULL_OUT.gripHeightMm) }}
        />
      ))}
    </div>
  )
}

/**
 * The heavyweight roof from the front (Instructions Manual p10): a tall bin at each end with the bar handle across
 * the gap between them, over a low floor. Bin height is the roof's measured 88.3 mm and the handle its measured
 * 156.5 × 29.5 mm; the floor thickness and the handle's height are drawn from the picture, not measured.
 */
function HeavyweightRoof({ towerMm, scale }: { towerMm: number; scale: number }) {
  const px = (mm: number) => mm * scale
  const gap = HEAVYWEIGHT_HANDLE_MM.length
  const bin = (towerMm - gap) / 2
  return (
    <>
      <span className="hw-floor" style={{ left: px(bin), width: px(gap), height: px(15) }} />
      <span className="hw-bin hw-bin-left" style={{ width: px(bin) }} />
      <span className="hw-bin hw-bin-right" style={{ width: px(bin) }} />
      <span
        className="hw-handle"
        title="Heavyweight roof handle"
        style={{ left: px(bin), width: px(gap), height: px(HEAVYWEIGHT_HANDLE_MM.thickness), bottom: px(42), borderRadius: px(HEAVYWEIGHT_HANDLE_MM.thickness / 2) }}
      />
    </>
  )
}

function FitBadge({ state }: { state: 'fits' | 'tight' | 'none' }) {
  const text = { fits: 'Fits printer', tight: 'Tight fit', none: "Doesn't fit" }[state]
  return <span className={`fit-badge fit-${state}`}>{text}</span>
}

function RowView(props: {
  towerId: string
  row: EditorRow
  rowIndex: number
  towerWidthPx: number
  colours: Colours
  scale: number
  problem?: string
  selection: Selection
  dragging: boolean
  onSelect: (s: Selection) => void
  /** Offered in the row's free space when a copy of its column would fill it. */
  copyable?: EditorColumn
  onCopyColumn: (towerId: string, rowId: string, columnId: string) => void
  onCopyOnto: (towerId: string, unitId: string, rowId: string, columnId: string) => void
  dragWidth?: Width
  blocked?: ReadonlyMap<string, string>
}) {
  const { towerId, row, rowIndex, towerWidthPx, colours, scale, problem, selection, dragging, onSelect, copyable, onCopyColumn, onCopyOnto, dragWidth, blocked } = props
  const usedPx = row.columns.reduce((sum, c) => sum + WIDTH_MM[c.width] * scale, 0)
  const rowPx = floorsHeightMm(rowFloors(row)) * scale
  const short = columnShortfall(row)
  const missing = row.columns.length === 1 && problem !== undefined
  // Columns that end at different real heights (a 1F sustainer beside a 1F drawer): not blocking, but worth a look.
  const mismatch = columnMismatchMm(row.columns)
  const warning = mismatch === undefined ? undefined
    : `The columns end ${mismatch.toFixed(1)} mm apart, so what sits on them won't be level (a 1F sustainer stands 12.7 mm taller than a 1F drawer).`
  return (
    <div className={`tower-row${problem ? ' is-incomplete' : ''}${missing && row.soloSide === 'right' ? ' is-solo-right' : ''}`} style={{ height: rowPx }}>
      {warning && <span className="row-warning" title={warning} role="img" aria-label={warning}>⚠ {mismatch!.toFixed(1)} mm</span>}
      {row.columns.map((column, ci) => (
        <ColumnView
          key={column.id}
          towerId={towerId}
          rowId={row.id}
          column={column}
          shortFloors={short[ci]}
          split={row.columns.length > 1 || WIDTH_MM[column.width] * scale < towerWidthPx - 1}
          colours={colours}
          scale={scale}
          selection={selection}
          dragging={dragging}
          stackable={dragWidth === column.width}
          onSelect={onSelect}
          // The tallest unit of this width in the row that fits the gap, to offer as "+ Copy".
          fillWith={rowUnitsOfWidth(row, column.width).filter((u) => FLOORS_OF[u.height] <= short[ci])
            .sort((a, b) => FLOORS_OF[b.height] - FLOORS_OF[a.height])[0]}
          onCopyOnto={(unitId) => onCopyOnto(towerId, unitId, row.id, column.id)}
          blocked={blocked}
        />
      ))}
      {missing && (() => {
        // A short row (zoomed out, or 1F) has room for the copy button or the text, not both: the text then
        // shows on hover and is read out.
        const roomy = rowPx >= 64
        return (
          <Slot
            towerId={towerId} rowId={row.id} widthPx={Math.max(towerWidthPx - usedPx, 24)} active={dragging} title={problem}
            side={row.soloSide === 'right' ? 'left' : 'right'} floors={rowFloors(row)} scale={scale}
          >
            <span className={roomy || !copyable || dragging ? 'slot-text' : 'sr-only'}>{problem}</span>
            {copyable && !dragging && (() => {
              const one = copyable.units.length === 1 ? copyable.units[0] : undefined
              return (
                <button
                  type="button"
                  className="slot-copy"
                  aria-label={one ? `Copy the ${one.width} ${one.kind} into this row` : `Copy the ${copyable.width} stack into this row`}
                  onClick={(e) => { e.stopPropagation(); onCopyColumn(towerId, row.id, copyable.id) }}
                >
                  {one ? (roomy ? `+ Copy the ${one.width} ${one.kind}` : `+ Copy ${one.width}`) : roomy ? `+ Copy the ${copyable.width} stack` : '+ Copy stack'}
                </button>
              )
            })()}
          </Slot>
        )
      })()}
      <span className="sr-only">Row {rowIndex + 1}{problem ? `: ${problem}` : ''}{warning ? `. ${warning}` : ''}</span>
    </div>
  )
}

/**
 * One Column of a Row: its units stacked bottom first, each at its own height. A Column shorter than its
 * neighbour shows the gap as a slot to drop into; in a split Row, a unit of the Column's width can also be
 * dropped on top while dragging.
 */
function ColumnView(props: {
  towerId: string
  rowId: string
  column: EditorColumn
  shortFloors: number
  split: boolean
  colours: Colours
  scale: number
  selection: Selection
  dragging: boolean
  stackable: boolean
  onSelect: (s: Selection) => void
  /** A unit whose copy fits this column's gap, if any. */
  fillWith?: EditorColumn['units'][number]
  onCopyOnto: (unitId: string) => void
  blocked?: ReadonlyMap<string, string>
}) {
  const { towerId, rowId, column, shortFloors, split, colours, scale, selection, dragging, stackable, onSelect, fillWith, onCopyOnto, blocked } = props
  const starts = unitStarts(column.units)
  return (
    <div className="tower-column" style={{ width: WIDTH_MM[column.width] * scale }}>
      {column.units.map((unit, i) => [
        (unit.gapBelow ?? 0) > 0 && (
          <EmptySpace
            key={`gap-${unit.id}`}
            towerId={towerId} rowId={rowId} columnId={column.id}
            from={starts[i] - unit.gapBelow!} floors={unit.gapBelow!} scale={scale}
            trimPx={i === 0 ? 0 : STACK_GAP_PX} active={dragging}
          />
        ),
        <PlacedUnit
          key={unit.id}
          towerId={towerId}
          unit={unit}
          // Every unit above the bottom one gives up the 2 px gap below it, so a column is exactly its floors
          // high however it's split; otherwise stacks of many units drift out of line with their neighbours.
          trimPx={i === 0 && !unit.gapBelow ? 0 : STACK_GAP_PX}
          blockedBy={blocked?.get(unit.id)}
          height={unit.height}
          colours={colours}
          scale={scale}
          selected={selection?.type === 'unit' && selection.unitId === unit.id}
          onSelect={onSelect}
        />,
      ])}
      {shortFloors > 0 && (
        <ColumnSlot
          towerId={towerId} rowId={rowId} columnId={column.id} heightPx={shortFloors * FLOOR_MM * scale - STACK_GAP_PX} active={dragging}
          from={columnFloors(column)} floors={shortFloors} scale={scale}
        >
          <span className={shortFloors * FLOOR_MM * scale >= 44 || !fillWith || dragging ? 'slot-text' : 'sr-only'}>Needs {shortFloors}F</span>
          {fillWith && !dragging && (
            <button
              type="button"
              className="slot-copy"
              aria-label={`Copy the ${fillWith.width} ${fillWith.height} ${fillWith.kind} onto this column`}
              onClick={(e) => { e.stopPropagation(); onCopyOnto(fillWith.id) }}
            >
              + Copy {fillWith.height}
            </button>
          )}
        </ColumnSlot>
      )}
      {split && stackable && shortFloors === 0 && <ColumnTop towerId={towerId} rowId={rowId} columnId={column.id} />}
      {split && stackable && column.units.slice(1).map((unit, i) => (
        <ColumnJoin
          key={unit.id}
          towerId={towerId}
          rowId={rowId}
          columnId={column.id}
          index={i + 1}
          bottomPx={starts[i + 1] * FLOOR_MM * scale}
        />
      ))}
    </div>
  )
}

const FLOORS_OF = { '1F': 1, '2F': 2, '4F': 4 } as const
const rowUnitsOfWidth = (row: EditorRow, width: Width) => row.columns.flatMap((c) => c.units).filter((u) => u.width === width)
/** The gap drawn between stacked units (matches .tower-column's CSS gap). */
const STACK_GAP_PX = 2

/** The empty top of a short Column: drop a unit here to stack it. */
function ColumnSlot({ towerId, rowId, columnId, heightPx, active, from, floors, scale, children }: {
  towerId: string; rowId: string; columnId: string; heightPx: number; active: boolean
  from: number; floors: number; scale: number; children: ReactNode
}) {
  return (
    <div className={`slot column-slot${active ? ' is-active' : ''}`} style={{ height: heightPx }} title="Drop a unit here to stack it, on any floor">
      {children}
      <FloorCells idPrefix={`colslot:${columnId}`} from={from} count={floors} scale={scale}
        data={(floor) => ({ type: 'column', towerId, rowId, columnId, floor })} />
    </div>
  )
}

/** Empty space under a unit, left while planning: drop a unit on one of its floors to fill it. */
function EmptySpace({ towerId, rowId, columnId, from, floors, scale, trimPx, active }: {
  towerId: string; rowId: string; columnId: string; from: number; floors: number; scale: number; trimPx: number; active: boolean
}) {
  return (
    <div className={`slot column-slot empty-space${active ? ' is-active' : ''}`} style={{ height: floors * FLOOR_MM * scale - trimPx }} title={`${floors}F of empty space`}>
      <span className="slot-text">Empty {floors}F</span>
      <FloorCells idPrefix={`colslot:${columnId}:gap`} from={from} count={floors} scale={scale}
        data={(floor) => ({ type: 'column', towerId, rowId, columnId, floor })} />
    </div>
  )
}

/** While dragging a unit of this Column's width: a drop zone on the Column's top edge, to stack it there. */
function ColumnTop({ towerId, rowId, columnId }: { towerId: string; rowId: string; columnId: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${columnId}`, data: { type: 'column', towerId, rowId, columnId } })
  return <div ref={setNodeRef} className={`column-top${isOver ? ' is-over' : ''}`}><span>Stack here</span></div>
}

/** While dragging a unit of this Column's width: a drop zone on a join between two stacked units, to insert it there. */
function ColumnJoin({ towerId, rowId, columnId, index, bottomPx }: {
  towerId: string; rowId: string; columnId: string; index: number; bottomPx: number
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${columnId}:at${index}`, data: { type: 'column', towerId, rowId, columnId, index } })
  return (
    <div ref={setNodeRef} className={`column-top column-join${isOver ? ' is-over' : ''}`} style={{ bottom: bottomPx - 11 }}>
      <span>Insert here</span>
    </div>
  )
}

function PlacedUnit(props: {
  towerId: string
  unit: EditorUnit
  height: EditorColumn['units'][number]['height']
  trimPx?: number
  /** Why this unit doesn't fit the printer, if it doesn't. */
  blockedBy?: string
  colours: Colours
  scale: number
  selected: boolean
  onSelect: (s: Selection) => void
}) {
  const { towerId, unit, height, colours, scale, selected, onSelect, trimPx, blockedBy } = props
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `unit:${unit.id}`,
    data: { type: 'unit', towerId, unitId: unit.id, spec: { kind: unit.kind, width: unit.width, height } },
  })
  // Painted parts show in their colour; while painting, clicking a piece paints it instead of selecting or dragging.
  const paintCtx = usePaint()
  const depth = paintCtx?.depthOf(towerId)
  const paint = paintCtx && depth ? {
    targets: drawingTargets({ ...unit, height }, depth),
    colourOf: (t: PaintTarget) => paintCtx.colourOf(towerId, t),
    onPaint: paintCtx.painting ? (t: PaintTarget) => paintCtx.onPaint(towerId, t) : undefined,
  } : undefined
  const painting = !!paint?.onPaint
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`placed${isDragging ? ' is-dragging' : ''}${blockedBy ? ' is-blocked' : ''}`}
      title={blockedBy ? `Doesn't fit the printer. ${blockedBy}` : undefined}
      aria-label={`${describe(unit.kind, unit.width, height)}${blockedBy ? `, doesn't fit the printer (${blockedBy})` : ''}, select to edit`}
      onClick={() => { if (!painting) onSelect({ type: 'unit', towerId, unitId: unit.id }) }}
      {...(painting ? {} : listeners)}
      {...attributes}
      aria-pressed={selected}
    >
      <UnitBlock kind={unit.kind} width={unit.width} height={height} colours={colours} scale={scale} selected={selected} trimPx={trimPx} boxes={unit.kind === 'drawer' ? unit.boxes : undefined} paint={paint} />
    </button>
  )
}

/**
 * A drop zone on the seam between rows (or above the top row). It takes no space, so picking a unit up never
 * moves the tower: its hit area overlays the seam, and a bar shows where the unit will go.
 */
function Gap({ towerId, index, active, top }: { towerId: string; index: number; active: boolean; top?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `gap:${towerId}:${index}`, data: { type: 'gap', towerId, index } })
  return (
    <div className={`gap${top ? ' gap-top' : ''}${active ? ' is-active' : ''}${isOver ? ' is-over' : ''}`}>
      <div ref={setNodeRef} className="gap-hit">{top && active && <span>Add on top</span>}</div>
    </div>
  )
}

/** The empty side of a Row: drop on a floor of it to start the other Column there (higher floors leave Empty space). */
function Slot({ towerId, rowId, widthPx, active, title, side, floors, scale, children }: {
  towerId: string; rowId: string; widthPx: number; active: boolean; title?: string
  side: 'left' | 'right'; floors: number; scale: number; children: ReactNode
}) {
  return (
    <div className={`slot${active ? ' is-active' : ''}`} style={{ width: widthPx }} title={title}>
      {children}
      <FloorCells
        idPrefix={`slot:${rowId}`} from={0} count={floors} scale={scale}
        data={(floor) => ({ type: 'slot', towerId, rowId, side, floor })}
      />
    </div>
  )
}

/**
 * Drop zones one floor high over an empty area, bottom first, so a unit can be dropped on any floor of it.
 * They take no clicks: buttons underneath still work.
 */
function FloorCells({ idPrefix, from, count, scale, data }: {
  idPrefix: string; from: number; count: number; scale: number; data: (floor: number) => Record<string, unknown>
}) {
  return <>{Array.from({ length: count }, (_, k) => (
    <FloorCell key={k} id={`${idPrefix}:${from + k}`} bottomPx={k * FLOOR_MM * scale} heightPx={FLOOR_MM * scale} data={data(from + k)} />
  ))}</>
}

function FloorCell({ id, bottomPx, heightPx, data }: { id: string; bottomPx: number; heightPx: number; data: Record<string, unknown> }) {
  const { setNodeRef, isOver } = useDroppable({ id, data })
  return <div ref={setNodeRef} className={`floor-cell${isOver ? ' is-over' : ''}`} style={{ bottom: bottomPx, height: heightPx }} />
}

function EmptyDrop({ towerId }: { towerId: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `empty:${towerId}`, data: { type: 'gap', towerId, index: 0 } })
  return (
    <div ref={setNodeRef} className={`tower-empty${isOver ? ' is-over' : ''}`}>
      Drop a unit here to start this tower
    </div>
  )
}

/**
 * The base and what it stands on, seen from the front. Feet come as a front and a back bar, each 60 mm narrower
 * than the tower (measured), so one bar shows. Wheels sit outside the base at the back, edge-on from the
 * front: a tall tyre beside each side, standing on the floor level with the front foot. Casters are bought; drawn at a typical size.
 */
function Bottom({ kind, scale, widthMm }: { kind: EditorTower['bottom']; scale: number; widthMm: number }) {
  const px = (mm: number) => mm * scale
  const foot = <span className="foot" style={{ width: px(widthMm - FEET_INSET_MM), height: px(FOOT_MM) }} />
  return (
    <div className="tower-base" style={{ height: px(BASE_MM) }}>
      {kind === 'wheels' && (
        <>
          {(['left', 'right'] as const).map((side) => (
            <span key={side} className={`tyre tyre-${side}`} style={{ width: px(TYRE_WIDTH_MM), height: px(WHEEL_MM), bottom: -px(FOOT_MM), borderRadius: px(10) }} />
          ))}
          {foot}
        </>
      )}
      {kind === 'feet' && foot}
      {kind === 'casters' && (['left', 'right'] as const).map((side) => (
        <span key={side} className={`caster caster-${side}`} style={{ width: px(CASTER.plate), height: px(CASTER.height) }}>
          <span className="caster-plate" style={{ height: px(4) }} />
          <span className="caster-fork" style={{ width: px(CASTER.fork), height: px(CASTER.height - CASTER.wheel / 2 - 4) }} />
          <span className="caster-wheel" style={{ width: px(CASTER.wheel), height: px(CASTER.wheel), marginTop: -px(CASTER.wheel / 2) }} />
        </span>
      ))}
    </div>
  )
}
