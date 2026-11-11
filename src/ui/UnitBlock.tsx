import type { CSSProperties } from 'react'
import type { Height, Unit, Width } from '../engine/model'
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
}

/** Height of the lock's centre above the bottom of a drawer, the same at every height (from USSA's renders). */
const LOCK_MM = 25

/**
 * A Unit seen from the front, drawn to scale in the Layout's colours, after USSA's renders.
 * Drawer: a full-width facade with a label pill on the left and, level with it, a dark rotary lock with an
 * upright lever, a lock indicator and a plain cap; taller drawers split down the middle to the lock.
 * Sustainer: two dark latches hanging from the top edge, screws in the corners, a label pill bottom left.
 */
export function UnitBlock({ kind, width, height, colours, scale, selected, label = true }: Props) {
  const w = WIDTH_MM[width]
  const h = rowHeightMm(height)
  const detailed = scale >= 0.3
  const showText = label && scale >= 0.45
  const mm = (n: number) => `${n * scale}px`
  const sizeCode = `${width} ${height}`
  const style = {
    width: w * scale,
    height: h * scale,
    borderRadius: mm(8),
    '--body': colours.body,
    '--accent': colours.accent,
  } as CSSProperties

  const pill = (bottom: number) => (
    <span className="unit-pill" style={{ left: mm(9), bottom: mm(bottom - 7), height: mm(14), minWidth: mm(40), borderRadius: mm(7), padding: `0 ${mm(5)}` }}>
      {showText && sizeCode}
    </span>
  )

  if (kind === 'drawer') {
    const tall = h > 60
    const lockBottom = tall ? LOCK_MM - 3 : h / 2 - 3
    return (
      <div className={`unit unit-drawer${selected ? ' is-selected' : ''}`} style={style} aria-hidden="true">
        <div className="unit-facade" style={{ inset: mm(3), borderRadius: mm(6) }}>
          {detailed && tall && (
            <>
              <span className="facade-split" style={{ bottom: mm(lockBottom + 12) }} />
              <span className="cap" style={{ left: mm(16), top: mm(12), width: mm(7) }} />
              <span className="cap" style={{ right: mm(16), top: mm(12), width: mm(7) }} />
            </>
          )}
          {detailed && pill(lockBottom)}
          <span className="lock" style={{ bottom: mm(lockBottom - 11), width: mm(22), height: mm(22) }}>
            <span className="lock-lever" style={{ width: mm(9), height: mm(25), borderRadius: mm(4.5), bottom: mm(6) }} />
          </span>
          {detailed && (
            <>
              <span className="cap cap-indicator" style={{ left: `calc(50% + ${mm(19)})`, bottom: mm(lockBottom - 3.5), width: mm(7) }} />
              {w > 200 && <span className="cap" style={{ left: `calc(50% + ${mm(38)})`, bottom: mm(lockBottom - 3.5), width: mm(7) }} />}
            </>
          )}
        </div>
      </div>
    )
  }

  const latchH = Math.min(h * 0.62, 70)
  return (
    <div className={`unit unit-sustainer${selected ? ' is-selected' : ''}`} style={style} aria-hidden="true">
      {[0.25, 0.75].map((x) => (
        <span
          key={x}
          className="latch"
          style={{ left: `calc(${x * 100}% - ${mm(18)})`, top: mm(2), width: mm(36), height: mm(latchH), borderRadius: `${mm(3)} ${mm(3)} ${mm(6)} ${mm(6)}` }}
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
          {h > 45 ? pill(Math.min(14, h / 2)) : null}
        </>
      )}
    </div>
  )
}
