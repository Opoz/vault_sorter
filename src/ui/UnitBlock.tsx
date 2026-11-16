import type { CSSProperties } from 'react'
import { FLOORS, type Height, type Unit, type Width } from '../engine/model'
import type { PaintTarget } from '../editor/paint'
import type { DrawingTargets } from './paintTargets'
import type { Colours } from '../editor/layoutOps'
import { rowHeightMm, WIDTH_MM } from './dims'

interface Props {
  kind: Unit['kind']
  width: Width
  height: Height
  colours: Colours
  /** Pixels per mm. */
  scale: number
  selected?: boolean
  label?: boolean
  /** Pixels taken off the drawn height, for the gap above it when stacked, so a stack keeps its true height. */
  trimPx?: number
  /** A drawer's Boxes, bottom first, when its Module holds several (issue #16): each gets its own Facade. */
  boxes?: readonly Height[]
  /** Painted parts (issue #7): which part each piece is, its painted colour, and, while painting, what a click does. */
  paint?: {
    readonly targets: DrawingTargets
    readonly colourOf: (t: PaintTarget) => string | undefined
    readonly onPaint?: (t: PaintTarget) => void
  }
}

/** Where a sustainer's latches sit across its width, as fractions: the Facade's lock recesses (measured). */
const LATCHES: Record<Width, readonly number[]> = { S: [0.5], M: [0.5], L: [0.25, 0.75], XL: [0.5 - 127.1 / 418.8, 0.5 + 127.1 / 418.8] }

/** Height of the lock's centre above the bottom of a drawer, the same at every height (from USSA's renders). */
const LOCK_MM = 25

/**
 * A Unit seen from the front, drawn to scale in the Layout's colours, after USSA's renders.
 * Drawer: a full-width facade with a label pill on the left and, level with it, a dark rotary lock with an
 * upright lever, a lock indicator and a plain cap; taller drawers split down the middle to the lock. A Module
 * holding several Boxes shows a Facade for each, stacked.
 * Sustainer: dark latches hanging from the top edge (one in the middle on S and M, two on L and XL, where the
 * Facade's lock recesses are), screws in the corners, a label pill bottom left.
 */
export function UnitBlock({ kind, width, height, colours, scale, selected, label = true, trimPx = 0, boxes, paint }: Props) {
  // A piece's painted colour, and a click that paints it while painting.
  const painted = (t: PaintTarget | undefined, style: CSSProperties = {}): CSSProperties => {
    const colour = t && paint?.colourOf(t)
    return colour ? { ...style, background: colour } : style
  }
  const paintable = (t: PaintTarget | undefined) => (t && paint?.onPaint
    ? { onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation(); paint.onPaint!(t) }, 'data-paintable': true }
    : {})
  const w = WIDTH_MM[width]
  const h = rowHeightMm(height)
  const detailed = scale >= 0.3
  // Below this the size code no longer fits its pill.
  const showText = label && scale >= 0.6
  const mm = (n: number) => `${n * scale}px`
  const sizeCode = `${width} ${height}`
  const style = {
    width: w * scale,
    height: h * scale - trimPx,
    borderRadius: mm(8),
    '--body': colours.body,
    '--accent': colours.accent,
    '--secondary': colours.secondary,
  } as CSSProperties

  const pill = (bottom: number, code = sizeCode, t?: PaintTarget) => (
    <span className="unit-pill" {...paintable(t)} style={painted(t, { left: mm(9), bottom: mm(bottom - 7), height: mm(14), minWidth: mm(40), borderRadius: mm(7), padding: `0 ${mm(5)}` })}>
      {showText && code}
    </span>
  )

  if (kind === 'drawer') {
    // One Facade per Box, bottom first; a Module of one Box fills it.
    const parts = boxes && boxes.length > 1 ? boxes : [height]
    const mmPerFloor = h / parts.reduce((n, b) => n + FLOORS[b], 0)
    const startFloors = parts.map((_, i) => parts.slice(0, i).reduce((n, b) => n + FLOORS[b], 0))
    const facades = parts.map((box, i) => {
      const fh = FLOORS[box] * mmPerFloor
      const bottom = startFloors[i] * mmPerFloor
      const tall = fh > 60
      const lockBottom = tall ? LOCK_MM - 3 : fh / 2 - 3
      const position = parts.length > 1
        ? { left: mm(3), right: mm(3), bottom: mm(bottom + 3), height: `${(fh - 6) * scale - (i === parts.length - 1 ? trimPx : 0)}px` }
        : { inset: mm(3) }
      // The drawn caps stand for this Box's caps: those beside the lock first, then the two on a tall Facade's top.
      const t = paint?.targets.boxes[i]
      const caps = t?.caps ?? []
      return (
        <div key={i} className="unit-facade" {...paintable(t?.facade)} style={painted(t?.facade, { ...position, borderRadius: mm(6) })}>
          {detailed && tall && (
            <>
              <span className="facade-split" style={{ bottom: mm(lockBottom + 12) }} />
              <span className="cap" {...paintable(caps.at(-2))} style={painted(caps.at(-2), { left: mm(16), top: mm(12), width: mm(7) })} />
              <span className="cap" {...paintable(caps.at(-1))} style={painted(caps.at(-1), { right: mm(16), top: mm(12), width: mm(7) })} />
            </>
          )}
          {detailed && pill(lockBottom, `${width} ${box}`, t?.label)}
          <span className="lock" {...paintable(t?.key)} style={painted(t?.key, { bottom: mm(lockBottom - 11), width: mm(22), height: mm(22) })}>
            <span className="lock-lever" {...paintable(t?.keyCap)} style={painted(t?.keyCap, { width: mm(9), height: mm(25), borderRadius: mm(4.5), bottom: mm(6) })} />
          </span>
          {detailed && (
            <>
              <span className="cap cap-indicator" {...paintable(caps[0])} style={painted(caps[0], { left: `calc(50% + ${mm(19)})`, bottom: mm(lockBottom - 3.5), width: mm(7) })} />
              {w > 200 && <span className="cap" {...paintable(caps[1])} style={painted(caps[1], { left: `calc(50% + ${mm(38)})`, bottom: mm(lockBottom - 3.5), width: mm(7) })} />}
            </>
          )}
        </div>
      )
    })
    return (
      <div className={`unit unit-drawer${selected ? ' is-selected' : ''}`} {...paintable(paint?.targets.module)} style={painted(paint?.targets.module, style)} aria-hidden="true">
        {facades}
      </div>
    )
  }

  const latchH = Math.min(h * 0.62, 70)
  return (
    // A Sustainer's face is its Facade; its latches are its locks, left to right.
    <div className={`unit unit-sustainer${selected ? ' is-selected' : ''}`} {...paintable(paint?.targets.facade)} style={painted(paint?.targets.facade, style)} aria-hidden="true">
      {LATCHES[width].map((x, i) => (
        <span
          key={x}
          className="latch"
          {...paintable(paint?.targets.locks[i])}
          style={painted(paint?.targets.locks[i], { left: `calc(${x * 100}% - ${mm(18)})`, top: mm(2), width: mm(36), height: mm(latchH), borderRadius: `${mm(3)} ${mm(3)} ${mm(6)} ${mm(6)}` })}
        >
          {detailed && <span className="latch-slot" style={{ width: mm(16), height: mm(3), borderRadius: mm(1.5) }} />}
        </span>
      ))}
      {detailed && (
        <>
          {[[5, 5], [5, null], [null, 5], [null, null]].map(([l, t], i) => (
            <span
              key={i}
              className="bolt"
              style={{ width: mm(4), ...(l ? { left: mm(4) } : { right: mm(4) }), ...(t ? { top: mm(4) } : { bottom: mm(4) }) }}
            />
          ))}
          {h > 45 ? pill(Math.min(14, h / 2), sizeCode, paint?.targets.label) : null}
        </>
      )}
    </div>
  )
}
