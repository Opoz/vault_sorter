import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { CSSProperties, ReactNode } from 'react'
import type { Depth } from '../engine/model'
import { missingWidth, rowProblems, type Colours, type EditorRow, type EditorTower, type EditorUnit } from '../editor/layoutOps'
import { BASE_MM, belowBaseMm, CASTER, FEET_INSET_MM, FOOT_MM, HANDLE_MM, HEAVYWEIGHT_HANDLE_MM, LIP_MM, ROOF_MM, towerHeightMm, TYRE_WIDTH_MM, WHEEL_MM, WIDTH_MM, rowHeightMm } from './dims'
import { describe } from './text'
import { UnitBlock } from './UnitBlock'
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
  selection: Selection
  dragging: boolean
  onSelect: (s: Selection) => void
  onDuplicate: (towerId: string, unitId: string) => void
}

export function TowerView({ tower, index, colours, scale, depth, heightMm: measuredHeight, fitState, selection, dragging, onSelect, onDuplicate }: Props) {
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
      </button>

      <div className="tower-body">
        {tower.rows.length === 0 ? (
          <EmptyDrop towerId={tower.id} />
        ) : (
          <div
            className="tower-stack"
            style={{
              paddingTop: tower.roof === 'grid' ? HANDLE_MM.height * scale : undefined,
              paddingBottom: belowBaseMm(tower.bottom) * scale || undefined,
              // Wheels stand outside the base: keep their width free on both sides.
              marginInline: tower.bottom === 'wheels' ? (TYRE_WIDTH_MM + 4) * scale : undefined,
            }}
          >
            {tower.roof !== 'none' && tower.roof !== 'under table mount' && (
              <div
                className={`tower-roof${tower.roof === 'heavyweight' ? ' roof-heavyweight' : ''}`}
                style={{ height: Math.max(ROOF_MM[tower.roof] * scale, 4) }}
                title={`${tower.roof} roof`}
              >
                {tower.roof === 'heavyweight' && width && <HeavyweightRoof towerMm={WIDTH_MM[width]} scale={scale} />}
                {tower.roof === 'grid' && (
                  <span
                    className="top-handle"
                    title="Top handle"
                    style={{
                      width: HANDLE_MM.length * scale,
                      height: HANDLE_MM.height * scale,
                      borderRadius: HANDLE_MM.corner * scale,
                      borderWidth: `${HANDLE_MM.top * scale}px ${HANDLE_MM.side * scale}px ${HANDLE_MM.bottom * scale}px`,
                    }}
                  />
                )}
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
                  copyable={width && missingWidth(width, row) === row.units.at(-1)?.width ? row.units.at(-1) : undefined}
                  onDuplicate={onDuplicate}
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
  /** Offered in the row's free space when a copy of its last unit would fill it. */
  copyable?: EditorUnit
  onDuplicate: (towerId: string, unitId: string) => void
}) {
  const { towerId, row, rowIndex, towerWidthPx, colours, scale, problem, selection, dragging, onSelect, copyable, onDuplicate } = props
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
      {problem && (() => {
        // A short row (zoomed out, or 1F) has room for the copy button or the text, not both: the text then
        // shows on hover and is read out.
        const roomy = rowHeightMm(row.height) * scale >= 64
        return (
          <Slot towerId={towerId} rowId={row.id} widthPx={Math.max(towerWidthPx - usedPx, 24)} active={dragging} title={problem}>
            <span className={roomy || !copyable || dragging ? 'slot-text' : 'sr-only'}>{problem}</span>
            {copyable && !dragging && (
              <button
                type="button"
                className="slot-copy"
                aria-label={`Copy the ${copyable.width} ${copyable.kind} into this row`}
                onClick={(e) => { e.stopPropagation(); onDuplicate(towerId, copyable.id) }}
              >
                {roomy ? `+ Copy the ${copyable.width} ${copyable.kind}` : `+ Copy ${copyable.width}`}
              </button>
            )}
          </Slot>
        )
      })()}
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

function Slot({ towerId, rowId, widthPx, active, title, children }: {
  towerId: string; rowId: string; widthPx: number; active: boolean; title?: string; children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${rowId}`, data: { type: 'slot', towerId, rowId } })
  return (
    <div ref={setNodeRef} className={`slot${active ? ' is-active' : ''}${isOver ? ' is-over' : ''}`} style={{ width: widthPx }} title={title}>
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
