import type { DepthChoice } from '../engine/depth'
import type { Baseplate, Depth, RoofType, Width } from '../engine/model'
import type { TowerDimensions } from '../engine/dimensions'
import type { FilamentEstimate } from '../engine/filament'
import type { HardwareLine } from '../engine/hardware'
import type { Flag, PartLine } from '../engine/parts'
import {
  removeTower, removeUnit, rowProblems, setTowerWidth, toEngineTower, updateLayout, updateTower, updateUnit,
  type EditorTower, type EditorUnit,
} from '../editor/layoutOps'
import { depthMm } from './dims'
import { printerLabel } from './data'
import { ExportPanel } from './ExportPanel'
import { describe } from './text'
import type { Editor } from './useEditor'

export interface TowerInfo {
  depth?: Depth
  choice?: DepthChoice
  parts?: PartLine[]
  hardware?: HardwareLine[]
  grams?: FilamentEstimate
  dimensions?: TowerDimensions
  error?: string
}

export function Inspector({ editor, info }: { editor: Editor; info: Map<string, TowerInfo> }) {
  const { layout, selection } = editor
  const tower = selection && layout.towers.find((t) => t.id === selection.towerId)
  const row = selection?.type === 'unit' ? tower?.rows.find((r) => r.units.some((u) => u.id === selection.unitId)) : undefined
  const unit = row?.units.find((u) => selection?.type === 'unit' && u.id === selection.unitId)
  const index = tower ? layout.towers.indexOf(tower) : -1

  // Where you are, with a way back up: Layout › Tower 2 › M 1F drawer.
  const crumbs = (
    <nav className="crumbs" aria-label="Where you are">
      {tower ? <button type="button" className="link" onClick={() => editor.setSelection(null)}>{layout.name}</button> : <span>{layout.name}</span>}
      {tower && <span aria-hidden="true">›</span>}
      {tower && (unit
        ? <button type="button" className="link" onClick={() => editor.setSelection({ type: 'tower', towerId: tower.id })}>Tower {index + 1}</button>
        : <span>Tower {index + 1}</span>)}
      {unit && row && <><span aria-hidden="true">›</span><span>{describe(unit.kind, unit.width, row.height)}</span></>}
    </nav>
  )

  if (tower && unit && row) return <>{crumbs}<UnitPanel editor={editor} tower={tower} unit={unit} height={row.height} /></>
  if (tower) return <>{crumbs}<TowerPanel editor={editor} tower={tower} info={info.get(tower.id) ?? {}} /></>
  return <LayoutPanel editor={editor} info={info} />
}

function UnitPanel({ editor, tower, unit, height }: { editor: Editor; tower: EditorTower; unit: EditorUnit; height: string }) {
  const set = (patch: Parameters<typeof updateUnit>[3]) => editor.apply(updateUnit(editor.layout, tower.id, unit.id, patch))
  const sizeCode = `${unit.width}${tower.depth ?? ''} ${height}`
  return (
    <section className="panel" aria-label="Selected unit">
      <h2>{unit.kind === 'drawer' ? 'Drawer' : 'Sustainer'} {sizeCode}</h2>
      {unit.kind === 'drawer' ? (
        <>
          <Field label="Gridfinity baseplate">
            <select value={unit.baseplate} onChange={(e) => set({ baseplate: e.target.value as Baseplate })}>
              <option value="none">None</option>
              <option value="plain">Plain</option>
              {unit.width === 'S' && <option value="1 handle">With 1 handle</option>}
              {(unit.width === 'S' || unit.width === 'M') && <option value="2 handles">With 2 handles</option>}
            </select>
          </Field>
          <Field label="Key">
            <select value={unit.key} onChange={(e) => set({ key: e.target.value as 'normal' | 'hidden' })}>
              <option value="normal">Normal key</option>
              <option value="hidden">Hidden key</option>
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" checked={unit.gearedRails} onChange={(e) => set({ gearedRails: e.target.checked })} />
            Geared rails, for extra locking force or several boxes in one module
          </label>
        </>
      ) : unit.width === 'L' || unit.width === 'XL' ? (
        <Field label="Inside">
          <select value={unit.moduleType} onChange={(e) => set({ moduleType: e.target.value as 'flat' | 'dividers' | 'sealed' })}>
            <option value="flat">Flat</option>
            <option value="dividers">Dividers</option>
            <option value="sealed">Sealed</option>
          </select>
        </Field>
      ) : (
        <p className="muted">S and M sustainers come in one module type.</p>
      )}
      <div className="panel-actions">
        <button type="button" onClick={() => editor.setSelection({ type: 'tower', towerId: tower.id })}>Tower settings</button>
        <button
          type="button"
          className="danger"
          onClick={() => editor.apply(removeUnit(editor.layout, tower.id, unit.id)) && editor.setSelection({ type: 'tower', towerId: tower.id })}
        >
          Remove {describe(unit.kind, unit.width, height as never)}
        </button>
      </div>
    </section>
  )
}

const ROOFS: { value: RoofType; label: string }[] = [
  { value: 'grid', label: 'Grid (with top handle)' },
  { value: 'table', label: 'Table' },
  { value: 'heavyweight', label: 'Heavyweight' },
  { value: 'bowl', label: 'Bowl' },
  { value: 'under table mount', label: 'Under-table mount' },
  { value: 'none', label: 'No roof' },
]

function TowerPanel({ editor, tower, info }: { editor: Editor; tower: EditorTower; info: TowerInfo }) {
  const set = (patch: Parameters<typeof updateTower>[2]) => editor.apply(updateTower(editor.layout, tower.id, patch))
  const index = editor.layout.towers.indexOf(tower)
  const problems = rowProblems(tower)
  return (
    <section className="panel" aria-label="Selected tower">
      <h2>Tower {index + 1}</h2>
      <Field label="Width">
        <select
          value={tower.width ?? ''}
          onChange={(e) => editor.apply(setTowerWidth(editor.layout, tower.id, e.target.value as Width))}
        >
          {!tower.width && <option value="">Set by the first unit</option>}
          {(['S', 'M', 'L', 'XL'] as Width[]).map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      </Field>
      {problems.length > 0 && (
        <ul className="problems">
          {problems.map((p) => <li key={p.rowIndex}>Row {p.rowIndex + 1}: {p.problem}</li>)}
        </ul>
      )}
      {info.choice && <DepthPicker tower={tower} info={info} onPick={(depth) => set({ depth })} printer={printerLabel(editor.printer)} />}
      {info.error && <p className="problems">{info.error}</p>}

      <Field label="Roof">
        <select value={tower.roof} onChange={(e) => set({ roof: e.target.value as RoofType })}>
          {ROOFS.map((r) => <option key={r.value} value={r.value} disabled={r.value === 'heavyweight' && (tower.width === 'S' || tower.width === 'M')}>
            {r.label}{r.value === 'heavyweight' && (tower.width === 'S' || tower.width === 'M') ? ' (L and XL only)' : ''}
          </option>)}
        </select>
      </Field>
      <Field label="Bottom">
        <select
          value={tower.bottom}
          disabled={tower.roof === 'under table mount'}
          onChange={(e) => set({ bottom: e.target.value as EditorTower['bottom'] })}
        >
          <option value="none">Stands on the floor</option>
          <option value="feet">Base with feet</option>
          <option value="wheels">Base with wheels</option>
          <option value="casters">Base with casters</option>
        </select>
      </Field>
      {tower.roof === 'under table mount' && <p className="muted">An under-table tower hangs from its roof.</p>}
      <Field label="Backbone">
        <select value={tower.backbone} onChange={(e) => set({ backbone: e.target.value as EditorTower['backbone'] })}>
          <option value="none">None</option>
          <option value="matching">Matching width</option>
          <option value="universal">Universal</option>
        </select>
      </Field>

      {info.dimensions && <SizeSummary dims={info.dimensions} />}
      {info.grams && <FilamentSummary grams={info.grams} colours={editor.layout.colours} />}
      {info.parts && <PartsSummary parts={info.parts} colours={editor.layout.colours} />}
      {info.hardware && info.hardware.length > 0 && <HardwareSummary lines={info.hardware} />}
      {info.depth && info.parts && (() => {
        const built = toEngineTower(tower, info.depth)
        return built ? <ExportPanel editor={editor} tower={built} towerName={`Tower ${index + 1}`} /> : null
      })()}

      <div className="panel-actions">
        <button type="button" className="danger" onClick={() => editor.apply(removeTower(editor.layout, tower.id)) && editor.setSelection(null)}>
          Remove tower {index + 1}
        </button>
      </div>
    </section>
  )
}

function DepthPicker({ tower, info, onPick, printer }: { tower: EditorTower; info: TowerInfo; onPick: (d: Depth | null) => void; printer: string }) {
  const choice = info.choice!
  return (
    <fieldset className="depths">
      <legend>Depth, on the {printer}</legend>
      <label className="depth-option">
        <input type="radio" name={`depth-${tower.id}`} checked={tower.depth === null} onChange={() => onPick(null)} />
        <span className="depth-main">
          Largest that fits{choice.suggested ? `: ${choice.suggested}` : ''}
        </span>
        {!choice.suggested && <span className="depth-why fit-none">No depth fits this printer</span>}
      </label>
      {choice.options.map((o) => {
        const worst = o.blockers[0]
        const tight = o.tight[0]
        return (
          <label key={o.depth} className={`depth-option${o.fits ? '' : ' is-blocked'}`}>
            <input type="radio" name={`depth-${tower.id}`} checked={tower.depth === o.depth} onChange={() => onPick(o.depth)} />
            <span className="depth-main">{o.depth} <span className="muted">({depthMm(o.depth).toFixed(0)} mm deep)</span></span>
            <span className={`depth-why fit-${o.fits ? (o.tight.length ? 'tight' : 'fits') : 'none'}`}>
              {o.unavailable
                ? o.unavailable
                : worst
                  ? `${fileName(worst.path)}: ${worst.fit.limitedBy === 'height' ? 'too tall' : 'too big'} by ${(-worst.fit.spareMm).toFixed(1)} mm${o.blockers.length > 1 ? `, and ${o.blockers.length - 1} more` : ''}`
                  : tight
                    ? `Fits; tightest is ${fileName(tight.path)} with ${tight.fit.spareMm.toFixed(1)} mm to spare`
                    : 'Fits'}
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}

function PartsSummary({ parts, colours }: { parts: PartLine[]; colours: { body: string; accent: string } }) {
  const total = parts.reduce((s, l) => s + l.qty, 0)
  const flagged = parts.filter((l) => l.flags.length > 0)
  const seen = new Set<string>()
  return (
    <details className="parts" style={{ '--swatch-body': colours.body, '--swatch-accent': colours.accent } as React.CSSProperties}>
      <summary>{total} parts to print{flagged.length ? `, ${flagged.length} need checking` : ''}</summary>
      <table>
        <tbody>
          {parts.map((l) => (
            <tr key={l.path} className={l.flags.length ? 'is-flagged' : ''}>
              <td className="qty">{l.qty}×</td>
              <td>
                <span className={`swatch swatch-${l.role}`} aria-label={l.role === 'body' ? 'Body colour' : 'Accent colour'} />
                {fileName(l.path)}
                <cite className="line-source">{l.source}</cite>
                {l.flags.map((f) => {
                  // Spell each note out once; later lines with the same note just point back to it.
                  const repeat = seen.has(f.note)
                  seen.add(f.note)
                  return (
                    <span key={f.note} className={`flag flag-${f.kind}`}>
                      {f.kind === 'conflict' ? 'Manuals disagree' : 'Inferred'}
                      {repeat ? ', as noted above' : <>: {f.note} <cite>{f.source}</cite></>}
                    </span>
                  )
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

function SizeSummary({ dims }: { dims: TowerDimensions }) {
  return (
    <div className="summary">
      <h3>Size</h3>
      <p className="size-line">
        {dims.widthMm.toFixed(0)} wide × {dims.depthMm.toFixed(0)} deep × {dims.heightMm.toFixed(0)} mm tall
      </p>
      <p className="muted small">
        {dims.breakdown.map((b) => `${b.label} ${b.mm.toFixed(1)}`).join(', ')} mm. Wheels and feet not included.
      </p>
      <Flags flags={dims.flags} />
    </div>
  )
}

function FilamentSummary({ grams, colours }: { grams: FilamentEstimate; colours: { body: string; accent: string } }) {
  return (
    <div className="summary" style={{ '--swatch-body': colours.body, '--swatch-accent': colours.accent } as React.CSSProperties}>
      <h3>Filament</h3>
      <p className="size-line">About {formatGrams(grams.total)}</p>
      <p className="small">
        <span className="swatch swatch-body" aria-hidden="true" />Body {formatGrams(grams.body)}
        <span className="swatch swatch-accent" aria-hidden="true" style={{ marginLeft: '0.9rem' }} />Accent {formatGrams(grams.accent)}
      </p>
      <p className="muted small">Parts only, at Bambu Studio's default settings. Supports and colour-change purge aren't included.</p>
    </div>
  )
}

function HardwareSummary({ lines }: { lines: HardwareLine[] }) {
  const flagged = lines.filter((l) => l.flags.length > 0).length
  return (
    <details className="parts">
      <summary>Hardware to buy{flagged ? `, ${flagged} need checking` : ''}</summary>
      <table>
        <tbody>
          {lines.map((l) => (
            <tr key={l.item} className={l.flags.length ? 'is-flagged' : ''}>
              <td className="qty">{l.qty}×</td>
              <td>{l.item}<cite className="line-source">{l.source}</cite><Flags flags={l.flags} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

function Flags({ flags }: { flags: readonly Flag[] }) {
  return (
    <>
      {flags.map((f) => (
        <span key={f.note} className={`flag flag-${f.kind}`}>
          {f.kind === 'conflict' ? 'Manuals disagree: ' : 'Inferred: '}{f.note} <cite>{f.source}</cite>
        </span>
      ))}
    </>
  )
}

const formatGrams = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${Math.round(g)} g`)

function LayoutTotals({ info }: { info: Map<string, TowerInfo> }) {
  const towers = [...info.values()].filter((t) => t.parts)
  if (towers.length === 0) return null
  const parts = towers.reduce((n, t) => n + t.parts!.reduce((m, l) => m + l.qty, 0), 0)
  const grams = towers.reduce((g, t) => ({
    body: g.body + (t.grams?.body ?? 0), accent: g.accent + (t.grams?.accent ?? 0), total: g.total + (t.grams?.total ?? 0),
  }), { body: 0, accent: 0, total: 0 })
  const hardware = new Map<string, number>()
  for (const t of towers) for (const h of t.hardware ?? []) hardware.set(h.item, (hardware.get(h.item) ?? 0) + h.qty)
  return (
    <div className="summary">
      <h3>Whole layout</h3>
      <p className="size-line">{parts} parts, about {formatGrams(grams.total)}</p>
      <p className="muted small">Body {formatGrams(grams.body)}, accent {formatGrams(grams.accent)}. Towers still being built aren't counted.</p>
      {hardware.size > 0 && (
        <details className="parts">
          <summary>Hardware for every tower</summary>
          <table>
            <tbody>
              {[...hardware].map(([item, qty]) => <tr key={item}><td className="qty">{qty}×</td><td>{item}</td></tr>)}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}

function TowerList({ editor, info }: { editor: Editor; info: Map<string, TowerInfo> }) {
  const towers = editor.layout.towers
  return (
    <div className="summary">
      <h3>Towers</h3>
      {towers.length === 0 && <p className="small muted">Drag a unit onto the canvas to start a tower.</p>}
      <ul className="tower-list">
        {towers.map((t, i) => {
          const d = info.get(t.id)
          const rows = t.rows.length
          const detail = !t.width ? 'empty' : `${t.width}${d?.depth ?? ''}, ${rows} row${rows === 1 ? '' : 's'}`
          return (
            <li key={t.id}>
              <button type="button" onClick={() => editor.setSelection({ type: 'tower', towerId: t.id })}>
                <span className="tower-list-name">Tower {i + 1}</span>
                <span className="muted">{detail}</span>
                <span className="tower-list-go" aria-hidden="true">Settings ›</span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="small muted">Or click a tower on the canvas. Click empty space to come back here.</p>
    </div>
  )
}

function LayoutPanel({ editor, info }: { editor: Editor; info: Map<string, TowerInfo> }) {
  const { layout } = editor
  const set = (patch: Parameters<typeof updateLayout>[1]) => editor.apply(updateLayout(layout, patch))
  return (
    <section className="panel" aria-label="Layout settings">
      <h2>Layout</h2>
      <Field label="Name">
        <input value={layout.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <div className="colours">
        <Field label="Body colour">
          <input type="color" value={layout.colours.body} onChange={(e) => set({ colours: { ...layout.colours, body: e.target.value } })} />
        </Field>
        <Field label="Accent colour">
          <input type="color" value={layout.colours.accent} onChange={(e) => set({ colours: { ...layout.colours, accent: e.target.value } })} />
        </Field>
      </div>
      <Field label="Parts that come split">
        <select value={layout.splitParts} onChange={(e) => set({ splitParts: e.target.value as typeof layout.splitParts })}>
          <option value="auto">Whole when it fits, split when it doesn't</option>
          <option value="whole">Always whole</option>
          <option value="split">Always split</option>
        </select>
      </Field>
      <label className="check">
        <input type="checkbox" checked={layout.allowColourMixing} onChange={(e) => set({ allowColourMixing: e.target.checked })} />
        Mix body and accent parts on one plate (needs an AMS)
      </label>
      <TowerList editor={editor} info={info} />
      <LayoutTotals info={info} />
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

const fileName = (path: string) => path.split('/').pop()!.replace(/\.stl$/i, '')
