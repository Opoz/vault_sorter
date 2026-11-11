import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { CSSProperties, ReactNode } from 'react'
import type { Depth } from '../engine/model'
import { rowProblems, type Colours, type EditorRow, type EditorTower, type EditorUnit } from '../editor/layoutOps'
import { BASE_MM, FOOT_MM, LIP_MM, ROOF_MM, towerHeightMm, WHEEL_MM, WIDTH_MM, rowHeightMm } from './dims'
import { describe } from './text'
import { UnitBlock } from './UnitBlock'
import type { Selection } from './useEditor'

interface Props {
  tower: EditorTower
  index: number
  colours: Colours
  scale: number
  depth: Depth | undefined
  fitState: 'fits' | 'tight' | 'none' | 'incomplete'
  selection: Selection
  dragging: boolean
  onSelect: (s: Selection) => void
}

export function TowerView({ tower, index, colours, scale, depth, fitState, selection, dragging, onSelect }: Props) {
  const width = tower.width
  const problems = rowProblems(tower)
  const isSelected = selection?.type === 'tower' && selection.towerId === tower.id
  const hasBase = tower.bottom !== 'none'
  const towerPx = width ? WIDTH_MM[width] * scale : 150
  const rowsTopFirst = [...tower.rows].map((row, i) => ({ row, i })).reverse()
  const heightMm = towerHeightMm(tower.rows, tower.roof !== 'none', hasBase)
  // The whole column above and around a tower is a safe zone: dropping anywhere in it adds to the top.
  const { setNodeRef: zoneRef, isOver: zoneOver } = useDroppable({
    id: `tower:${tower.id}`, data: { type: 'gap', towerId: tower.id, index: tower.rows.length },
  })

  return (
    <figure
      ref={zoneRef}
      className={`tower${isSelected ? ' is-selected' : ''}${dragging && zoneOver ? ' is-zone-over' : ''}`}
      style={{ '--tower-w': `${towerPx}px` } as CSSProperties}
    >
      <button type="button" className="tower-head" onClick={() => onSelect({ type: 'tower', towerId: tower.id })}>
        <span className="tower-name">Tower {index + 1}</span>
        <span className="tower-meta">
          {width ? `${width}${depth ? depth : ''}` : 'Empty'}
          {fitState !== 'incomplete' && width && <FitBadge state={fitState} />}
        </span>
      </button>

      <div className="tower-body">
        {tower.rows.length === 0 ? (
          <EmptyDrop towerId={tower.id} />
        ) : (
          <div className="tower-stack">
            {tower.roof !== 'none' && tower.roof !== 'under table mount' && (
              <div className="tower-roof" style={{ height: Math.max(ROOF_MM * scale, 6) }} title={`${tower.roof} roof`} />
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
                />
                <Gap towerId={tower.id} index={i} active={dragging} />
              </div>
            ))}
            <div className="tower-lip" style={{ height: LIP_MM * scale }} />
            {hasBase && <Bottom kind={tower.bottom} scale={scale} />}
          </div>
        )}
        {tower.rows.length > 0 && width && (
          <div className="dim dim-height" style={{ height: heightMm * scale }}>
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
}) {
  const { towerId, row, rowIndex, towerWidthPx, colours, scale, problem, selection, dragging, onSelect } = props
  const usedPx = row.units.reduce((sum, u) => sum + WIDTH_MM[u.width] * scale, 0)
  return (
    <div className={`tower-row${problem ? ' is-incomplete' : ''}`} style={{ height: rowHeightMm(row.height) * scale }}>
      {row.units.map((unit) => (
        <PlacedUnit
          key={unit.id}
          towerId={towerId}
          unit={unit}
          height={row.height}
          colours={colours}
          scale={scale}
          selected={selection?.type === 'unit' && selection.unitId === unit.id}
          onSelect={onSelect}
        />
      ))}
      {problem && (
        <Slot towerId={towerId} rowId={row.id} widthPx={Math.max(towerWidthPx - usedPx, 24)} active={dragging}>
          <span className="slot-text">{problem}</span>
        </Slot>
      )}
      <span className="sr-only">Row {rowIndex + 1}</span>
    </div>
  )
}

function PlacedUnit(props: {
  towerId: string
  unit: EditorUnit
  height: EditorRow['height']
  colours: Colours
  scale: number
  selected: boolean
  onSelect: (s: Selection) => void
}) {
  const { towerId, unit, height, colours, scale, selected, onSelect } = props
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `unit:${unit.id}`,
    data: { type: 'unit', towerId, unitId: unit.id, spec: { kind: unit.kind, width: unit.width, height } },
  })
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`placed${isDragging ? ' is-dragging' : ''}`}
      aria-label={`${describe(unit.kind, unit.width, height)}, select to edit`}
      onClick={() => onSelect({ type: 'unit', towerId, unitId: unit.id })}
      {...listeners}
      {...attributes}
      aria-pressed={selected}
    >
      <UnitBlock kind={unit.kind} width={unit.width} height={height} colours={colours} scale={scale} selected={selected} />
    </button>
  )
}

function Gap({ towerId, index, active, top }: { towerId: string; index: number; active: boolean; top?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `gap:${towerId}:${index}`, data: { type: 'gap', towerId, index } })
  return (
    <div ref={setNodeRef} className={`gap${top ? ' gap-top' : ''}${active ? ' is-active' : ''}${isOver ? ' is-over' : ''}`}>
      {top && active && <span>Add on top</span>}
    </div>
  )
}

function Slot({ towerId, rowId, widthPx, active, children }: {
  towerId: string; rowId: string; widthPx: number; active: boolean; children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${rowId}`, data: { type: 'slot', towerId, rowId } })
  return (
    <div ref={setNodeRef} className={`slot${active ? ' is-active' : ''}${isOver ? ' is-over' : ''}`} style={{ width: widthPx }}>
      {children}
    </div>
  )
}

function EmptyDrop({ towerId }: { towerId: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `empty:${towerId}`, data: { type: 'gap', towerId, index: 0 } })
  return (
    <div ref={setNodeRef} className={`tower-empty${isOver ? ' is-over' : ''}`}>
      Drop a unit here to start this tower
    </div>
  )
}

function Bottom({ kind, scale }: { kind: EditorTower['bottom']; scale: number }) {
  return (
    <div className="tower-base" style={{ height: BASE_MM * scale }}>
      {kind === 'wheels' && (
        <>
          <span className="wheel wheel-left" style={{ width: WHEEL_MM * scale * 0.35, height: WHEEL_MM * scale }} />
          <span className="foot foot-right" style={{ height: FOOT_MM * scale }} />
        </>
      )}
      {kind === 'feet' && (
        <>
          <span className="foot foot-left" style={{ height: FOOT_MM * scale }} />
          <span className="foot foot-right" style={{ height: FOOT_MM * scale }} />
        </>
      )}
      {kind === 'casters' && (
        <>
          <span className="caster caster-left" />
          <span className="caster caster-right" />
        </>
      )}
    </div>
  )
}
