/**
 * The paint tools over the drawing (issue #7): turn painting on, choose the colour (or the part's own Colour role,
 * to undo paint) and whether a click paints that one part or every copy of it in the Tower.
 */
import { useState } from 'react'
import type { PaintScope } from '../editor/paint'
import { ColorPicker } from './ColorPicker'
import { rememberColour } from './colour'

export interface PaintSettings {
  /** The colour to paint with; null puts parts back in their Colour role's colour. */
  readonly colour: string | null
  readonly scope: PaintScope
}

export function PaintBar({ painting, settings, onToggle, onChange }: {
  painting: boolean
  settings: PaintSettings
  onToggle: (on: boolean) => void
  onChange: (s: PaintSettings) => void
}) {
  const [picking, setPicking] = useState(false)
  if (!painting) {
    return (
      <div className="paint-bar">
        <button type="button" className="paint-start" onClick={() => onToggle(true)}>Paint</button>
      </div>
    )
  }
  const set = (patch: Partial<PaintSettings>) => onChange({ ...settings, ...patch })
  return (
    <div className="paint-bar is-painting" role="toolbar" aria-label="Paint">
      <button
        type="button"
        className={`paint-colour${settings.colour ? '' : ' is-role'}`}
        style={settings.colour ? { background: settings.colour } : undefined}
        aria-label={settings.colour ? `Painting ${settings.colour}; change colour` : 'Painting each part back to its colour role; change colour'}
        aria-expanded={picking}
        onClick={() => setPicking((p) => !p)}
      />
      <div className="paint-scope" role="group" aria-label="Paint">
        <button type="button" aria-pressed={settings.scope === 'one'} onClick={() => set({ scope: 'one' })}>This part</button>
        <button type="button" aria-pressed={settings.scope === 'all'} onClick={() => set({ scope: 'all' })}>All like it</button>
      </div>
      <button type="button" onClick={() => { setPicking(false); onToggle(false) }}>Done</button>
      {picking && (
        <div className="paint-picker">
          <ColorPicker
            label="Paint colour"
            value={settings.colour ?? '#c0392b'}
            onChange={(hex) => { set({ colour: hex }); rememberColour(hex) }}
          />
          <button type="button" className={`paint-role${settings.colour ? '' : ' is-on'}`} aria-pressed={!settings.colour} onClick={() => set({ colour: null })}>
            Colour role (undo paint)
          </button>
        </div>
      )}
      <p className="paint-hint">{settings.colour ? 'Click a part to paint it.' : 'Click a painted part to put it back.'}</p>
    </div>
  )
}
