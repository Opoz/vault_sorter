import { useDraggable } from '@dnd-kit/core'
import { HEIGHTS, WIDTHS, type Depth } from '../engine/model'
import type { Colours, UnitSpec } from '../editor/layoutOps'
import { describe, specKey } from './text'
import { UnitBlock } from './UnitBlock'

export const PALETTE_SCALE = 0.2

interface Props {
  colours: Colours
  /** Largest depth at which each unit fits the printer, or null when none does. */
  fit: ReadonlyMap<string, Depth | null>
  printerName: string
  /** Keyboard and tap alternative to dragging: add to the selected tower. */
  onAdd: (spec: UnitSpec) => void
}

export function Palette({ colours, fit, printerName, onAdd }: Props) {
  const printer = printerName
  return (
    <nav className="palette" aria-label="Units">
      <p className="palette-hint">Drag a unit onto a tower, or press one to add it to the selected tower.</p>
      {(['drawer', 'sustainer'] as const).map((kind) => (
        <section key={kind} className="palette-group">
          <h2>{kind === 'drawer' ? 'Drawers' : 'Sustainers'}</h2>
          {WIDTHS.map((width) => (
            <div key={width} className="palette-row">
              {HEIGHTS.filter((h) => width !== 'XL' || h === '1F').map((height) => {
                const spec = { kind, width, height }
                return <PaletteTile key={height} spec={spec} colours={colours} maxDepth={fit.get(specKey(spec))} printer={printer} onAdd={onAdd} />
              })}
            </div>
          ))}
        </section>
      ))}
    </nav>
  )
}

function PaletteTile({ spec, colours, maxDepth, printer, onAdd }: {
  spec: UnitSpec
  colours: Colours
  maxDepth: Depth | null | undefined
  printer: string
  onAdd: (s: UnitSpec) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${spec.kind}:${spec.width}:${spec.height}`,
    data: { type: 'palette', spec },
  })
  const unfit = maxDepth === null
  const limited = typeof maxDepth === 'number' && maxDepth < 7
  const note = unfit ? `Too big for the ${printer} at any depth` : limited ? `Fits the ${printer} up to depth ${maxDepth}` : undefined
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`palette-tile${isDragging ? ' is-dragging' : ''}${unfit ? ' is-unfit' : ''}`}
      title={note}
      onClick={() => onAdd(spec)}
      {...listeners}
      {...attributes}
      aria-label={`Add ${describe(spec.kind, spec.width, spec.height)}${note ? `. ${note}` : ''}`}
    >
      <UnitBlock {...spec} colours={colours} scale={PALETTE_SCALE} label={false} />
      <span className="palette-name">
        {spec.width} {spec.height}
        {unfit && <span className="palette-fit fit-none"> too big</span>}
        {limited && <span className="palette-fit fit-tight"> ≤{maxDepth}</span>}
      </span>
    </button>
  )
}
