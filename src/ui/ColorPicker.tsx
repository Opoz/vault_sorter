/**
 * A colour picker that opens in place (issue #7), not the browser's pop-up: a saturation and brightness square, a
 * hue slider, a hex field and the colours used lately.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { hexToHsv, hsvToHex, readRecent, RECENT_EVENT, type Hsv } from './colour'

export function ColorPicker({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value))
  const [text, setText] = useState(value)
  const [recent, setRecent] = useState(readRecent)
  useEffect(() => {
    const update = () => setRecent(readRecent())
    window.addEventListener(RECENT_EVENT, update)
    return () => window.removeEventListener(RECENT_EVENT, update)
  }, [])
  const area = useRef<HTMLDivElement>(null)
  // Follow the value when it changes from outside (another swatch picked, a layout opened).
  useEffect(() => {
    if (hsvToHex(hsv).toLowerCase() !== value.toLowerCase()) setHsv(hexToHsv(value))
    setText(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const choose = (next: Hsv) => { setHsv(next); const hex = hsvToHex(next); setText(hex); onChange(hex) }
  const pickAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = area.current?.getBoundingClientRect()
    if (!box) return
    const s = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - box.top) / box.height))
    choose({ ...hsv, s, v })
  }

  return (
    <div className="color-picker" role="group" aria-label={label}>
      <div
        ref={area}
        className="color-picker-area"
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pickAt(e) }}
        onPointerMove={(e) => { if (e.buttons) pickAt(e) }}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02
          const moves: Record<string, Partial<Hsv>> = {
            ArrowLeft: { s: Math.max(0, hsv.s - step) }, ArrowRight: { s: Math.min(1, hsv.s + step) },
            ArrowDown: { v: Math.max(0, hsv.v - step) }, ArrowUp: { v: Math.min(1, hsv.v + step) },
          }
          if (moves[e.key]) { e.preventDefault(); choose({ ...hsv, ...moves[e.key] }) }
        }}
      >
        <span className="color-picker-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }} />
      </div>
      <input
        className="color-picker-hue"
        type="range" min={0} max={359} step={1} value={Math.round(hsv.h)}
        onChange={(e) => choose({ ...hsv, h: Number(e.target.value) })}
        aria-label="Hue"
      />
      <div className="color-picker-row">
        <span className="color-picker-swatch" style={{ background: hsvToHex(hsv) }} aria-hidden="true" />
        <input
          className="color-picker-hex"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const hex = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
            if (/^#[0-9a-f]{6}$/i.test(hex)) { setHsv(hexToHsv(hex)); onChange(hex.toLowerCase()) }
          }}
          aria-label="Hex colour"
          spellCheck={false}
        />
      </div>
      {recent.length > 0 && (
        <div className="color-picker-recent" aria-label="Recent colours">
          {recent.map((c) => (
            <button key={c} type="button" className="color-picker-chip" style={{ background: c }} aria-label={c} title={c}
              onClick={() => { setHsv(hexToHsv(c)); setText(c); onChange(c) }} />
          ))}
        </div>
      )}
    </div>
  )
}
