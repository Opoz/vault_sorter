import { cloneElement, useId, type CSSProperties } from 'react'
import type { DepthChoice } from '../engine/depth'
import type { Baseplate, Depth, RoofType, Width } from '../engine/model'
import type { TowerDimensions } from '../engine/dimensions'
import type { FilamentEstimate } from '../engine/filament'
import type { HardwareLine } from '../engine/hardware'
import type { ColourRole, Flag, PartLine } from '../engine/parts'
import { DENSITY_SPACING_MM, SMALL_PART_EDGE_MM, type Density } from '../engine/plates'
import { partProgress, type Printed } from '../engine/progress'
import {
  changePrinted, findUnit, removeTower, removeUnit, rowProblems, setTowerWidth, toEngineTower, updateLayout, updateTower, updateUnit,
  type Colours, type EditorLayout, type EditorTower, type EditorUnit,
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
  const unit = selection?.type === 'unit' && tower ? findUnit(tower, selection.unitId)?.unit : undefined
  const index = tower ? layout.towers.indexOf(tower) : -1

  // Where you are, with a way back up: Layout › Tower 2 › M 1F drawer.
  const crumbs = (
    <nav className="crumbs" aria-label="Where you are">
      {tower ? <button type="button" className="link" onClick={() => editor.setSelection(null)}>{layout.name}</button> : <span>{layout.name}</span>}
      {tower && <span aria-hidden="true">›</span>}
      {tower && (unit
        ? <button type="button" className="link" onClick={() => editor.setSelection({ type: 'tower', towerId: tower.id })}>Tower {index + 1}</button>
        : <span>Tower {index + 1}</span>)}
      {unit && <><span aria-hidden="true">›</span><span>{describe(unit.kind, unit.width, unit.height)}</span></>}
    </nav>
  )

  if (tower && unit) return <>{crumbs}<UnitPanel editor={editor} tower={tower} unit={unit} height={unit.height} /></>
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
          <Field
            label="Gridfinity baseplate"
            why={unit.width === 'S' ? undefined : unit.width === 'M'
              ? 'Baseplates with 1 handle are made for S drawers only.'
              : 'Baseplates with handles are made for S and M drawers only.'}
          >
            <select value={unit.baseplate} onChange={(e) => set({ baseplate: e.target.value as Baseplate })}>
              <option value="none">None</option>
              <option value="plain">Plain</option>
              <option value="1 handle" disabled={unit.width !== 'S'}>With 1 handle{unit.width !== 'S' ? ' (S only)' : ''}</option>
              <option value="2 handles" disabled={unit.width !== 'S' && unit.width !== 'M'}>
                With 2 handles{unit.width !== 'S' && unit.width !== 'M' ? ' (S and M only)' : ''}
              </option>
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
        <button type="button" onClick={() => editor.duplicateUnit(tower.id, unit.id)}>Duplicate</button>
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
      {(() => {
        const widths = (['S', 'M', 'L', 'XL'] as Width[]).map((w) => {
          const r = w === tower.width ? null : setTowerWidth(editor.layout, tower.id, w)
          return { w, why: r && !r.ok ? r.reason : undefined }
        })
        const blocked = widths.filter((x) => x.why)
        return (
          <Field label="Width" why={blocked.length ? blocked.map((x) => `${x.w}: ${x.why}.`).join(' ') : undefined}>
            <select
              value={tower.width ?? ''}
              onChange={(e) => editor.apply(setTowerWidth(editor.layout, tower.id, e.target.value as Width))}
            >
              {!tower.width && <option value="">Set by the first unit</option>}
              {widths.map(({ w, why }) => <option key={w} value={w} disabled={!!why}>{w}{why ? ' (unavailable)' : ''}</option>)}
            </select>
          </Field>
        )
      })()}
      {problems.length > 0 && (
        <ul className="problems">
          {problems.map((p) => <li key={p.rowIndex}>Row {p.rowIndex + 1}: {p.problem}</li>)}
        </ul>
      )}
      {info.choice && <DepthPicker tower={tower} info={info} onPick={(depth) => set({ depth })} printer={printerLabel(editor.printer)} />}
      {info.error && <p className="problems">{info.error}</p>}

      <Field label="Roof" why={tower.width === 'S' || tower.width === 'M' ? 'Heavyweight roofs are made for L and XL towers only.' : undefined}>
        <select value={tower.roof} onChange={(e) => set({ roof: e.target.value as RoofType })}>
          {ROOFS.map((r) => <option key={r.value} value={r.value} disabled={r.value === 'heavyweight' && (tower.width === 'S' || tower.width === 'M')}>
            {r.label}{r.value === 'heavyweight' && (tower.width === 'S' || tower.width === 'M') ? ' (L and XL only)' : ''}
          </option>)}
        </select>
      </Field>
      <Field
        label="Bottom"
        why={tower.roof === 'under table mount'
          ? 'An under-table tower hangs from its roof, so it has no base. Choose another roof to add one.'
          : tower.wallMount ? 'A wall-mounted tower hangs on the wall, so it has no base. Untick the wall mount to add one.' : undefined}
        whyDisables
      >
        <select
          value={tower.bottom}
          disabled={tower.roof === 'under table mount' || !!tower.wallMount}
          onChange={(e) => set({ bottom: e.target.value as EditorTower['bottom'] })}
        >
          <option value="none">Stands on the floor</option>
          <option value="feet">Base with feet</option>
          <option value="wheels">Base with wheels</option>
          <option value="casters">Base with casters</option>
        </select>
      </Field>
      <CheckField
        label="Hang on a wall (a wall mount on the back of each module)"
        checked={!!tower.wallMount}
        onChange={(wallMount) => set({ wallMount })}
        why={tower.roof === 'under table mount' ? 'This tower hangs under a table. Choose another roof to hang it on a wall instead.' : undefined}
      />
      <Field
        label="Backbone"
        why={tower.wallMount ? 'Wall mounts and a backbone both fix to the back of the modules. Untick the wall mount to add a backbone.' : undefined}
        whyDisables
      >
        <select
          value={tower.backbone}
          disabled={!!tower.wallMount}
          onChange={(e) => set({ backbone: e.target.value as EditorTower['backbone'] })}
        >
          <option value="none">None</option>
          <option value="matching">Matching width</option>
          <option value="universal">Universal</option>
        </select>
      </Field>
      {(() => {
        const noBackbone = tower.wallMount
          ? 'These fix to a backbone, which a wall-mounted tower has none of.'
          : tower.backbone === 'none' ? 'These fix to a backbone; choose one above to add them.' : undefined
        return (
          <fieldset className="attachments">
            <legend>On the backbone</legend>
            <CheckField label="Stationary handle" checked={!!tower.stationaryHandle} onChange={(stationaryHandle) => set({ stationaryHandle })} why={noBackbone} />
            <CheckField label="Pull-out handle (telescoping, on two rods)" checked={!!tower.pullOutHandle} onChange={(pullOutHandle) => set({ pullOutHandle })} why={noBackbone} />
            <Field label="Pegboard" why={noBackbone} whyDisables>
              <select
                value={tower.pegboard ?? 'none'}
                disabled={!!noBackbone}
                onChange={(e) => set({ pegboard: e.target.value === 'none' ? undefined : e.target.value as 'skadis' | 'ussa' })}
              >
                <option value="none">None</option>
                <option value="skadis">IKEA Skadis boards</option>
                <option value="ussa">USSA pegboard boards</option>
              </select>
            </Field>
          </fieldset>
        )
      })()}

      {info.dimensions && <SizeSummary dims={info.dimensions} />}
      {info.grams && <FilamentSummary grams={info.grams} colours={editor.layout.colours} />}
      {info.parts && (
        <ProgressSummary
          parts={info.parts}
          printed={tower.printed ?? {}}
          onReset={() => {
            if (window.confirm(`Clear the print progress for Tower ${index + 1}?`)) {
              editor.apply(changePrinted(editor.layout, tower.id, Object.fromEntries(Object.entries(tower.printed ?? {}).map(([p, n]) => [p, -n]))))
            }
          }}
        />
      )}
      {info.parts && (
        <PartsSummary
          parts={info.parts}
          colours={editor.layout.colours}
          printed={tower.printed ?? {}}
          onStep={(path, delta) => editor.apply(changePrinted(editor.layout, tower.id, { [path]: delta }))}
        />
      )}
      {info.hardware && info.hardware.length > 0 && <HardwareSummary lines={info.hardware} />}
      {info.depth && info.parts && (() => {
        const built = toEngineTower(tower, info.depth)
        return built ? <ExportPanel editor={editor} tower={built} towerId={tower.id} towerName={`Tower ${index + 1}`} /> : null
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

/** Colour roles in the order they're shown. "Primary" is the body colour (stored as `body`). */
const ROLES = [
  { role: 'body', name: 'Primary', covers: 'Modules, boxes, roofs, facades and bases' },
  { role: 'secondary', name: 'Secondary', covers: 'Keys, locks and handles' },
  { role: 'accent', name: 'Accent', covers: 'Runners and stoppers' },
] as const
const ROLE_NAME = Object.fromEntries(ROLES.map((r) => [r.role, r.name])) as Record<ColourRole, string>
const swatches = (c: Colours) => ({ '--swatch-body': c.body, '--swatch-accent': c.accent, '--swatch-secondary': c.secondary }) as CSSProperties

/** Print progress for a tower: parts printed out of the parts list. */
function ProgressSummary({ parts, printed, onReset }: { parts: PartLine[]; printed: Printed; onReset: () => void }) {
  const { done, total } = partProgress(parts, printed)
  return (
    <div className="summary">
      <h3>Print progress</h3>
      <p className="size-line">{done === total ? `All ${total} parts printed` : `${done} of ${total} parts printed`}</p>
      <progress className="print-progress" max={total} value={done} aria-label="Parts printed" />
      <p className="muted small">
        Count parts in the list below, or mark whole plates under Print files.
        {done > 0 && <> <button type="button" className="link" onClick={onReset}>Clear progress</button></>}
      </p>
    </div>
  )
}

function PartsSummary({ parts, colours, printed, onStep }: {
  parts: PartLine[]; colours: Colours; printed: Printed; onStep: (path: string, delta: number) => void
}) {
  const total = parts.reduce((s, l) => s + l.qty, 0)
  const flagged = parts.filter((l) => l.flags.length > 0)
  const { byPath } = partProgress(parts, printed)
  const seen = new Set<string>()
  return (
    <details className="parts" style={swatches(colours)}>
      <summary>{total} parts to print{flagged.length ? `, ${flagged.length} need checking` : ''}</summary>
      <table>
        <tbody>
          {parts.map((l) => (
            <tr key={l.path} className={`${l.flags.length ? 'is-flagged' : ''}${byPath.get(l.path) === l.qty ? ' is-printed' : ''}`}>
              <td className="qty">{l.qty}×</td>
              <td>
                <span className={`swatch swatch-${l.role}`} aria-label={`${ROLE_NAME[l.role]} colour`} />
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
              <td className="printed-count">
                <Counter
                  label={fileName(l.path)}
                  value={byPath.get(l.path) ?? 0}
                  max={l.qty}
                  onStep={(d) => onStep(l.path, d)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

/** A checkbox with the same "why it's unavailable" note as Field; the note also disables it. */
function CheckField({ label, checked, onChange, why }: { label: string; checked: boolean; onChange: (checked: boolean) => void; why?: string }) {
  const id = useId()
  return (
    <div className="check-field" title={why}>
      <label className="check">
        <input type="checkbox" checked={checked} disabled={!!why} aria-describedby={why ? id : undefined} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {why && <span id={id} className="field-why is-off">Unavailable: {why}</span>}
    </div>
  )
}

/** Printed count for one part: − n/qty +. */
function Counter({ label, value, max, onStep }: { label: string; value: number; max: number; onStep: (delta: number) => void }) {
  return (
    <span className="counter">
      <button type="button" aria-label={`One fewer ${label} printed`} disabled={value <= 0} onClick={() => onStep(-1)}>−</button>
      <span aria-label={`${value} of ${max} ${label} printed`}>{value}/{max}</span>
      <button type="button" aria-label={`One more ${label} printed`} disabled={value >= max} onClick={() => onStep(1)}>+</button>
    </span>
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

function FilamentSummary({ grams, colours }: { grams: FilamentEstimate; colours: Colours }) {
  return (
    <div className="summary" style={swatches(colours)}>
      <h3>Filament</h3>
      <p className="size-line">About {formatGrams(grams.total)}</p>
      <p className="small">
        {ROLES.map(({ role }) => (
          <span key={role} className="gram-role">
            <span className={`swatch swatch-${role}`} aria-hidden="true" />{ROLE_NAME[role]} {formatGrams(grams[role])}
          </span>
        ))}
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

function LayoutTotals({ info, layout }: { info: Map<string, TowerInfo>; layout: EditorLayout }) {
  const towers = [...info.values()].filter((t) => t.parts)
  if (towers.length === 0) return null
  const parts = towers.reduce((n, t) => n + t.parts!.reduce((m, l) => m + l.qty, 0), 0)
  const printed = layout.towers.reduce((n, t) => {
    const lines = info.get(t.id)?.parts
    return n + (lines ? partProgress(lines, t.printed ?? {}).done : 0)
  }, 0)
  const grams = towers.reduce((g, t) => ({
    body: g.body + (t.grams?.body ?? 0), accent: g.accent + (t.grams?.accent ?? 0),
    secondary: g.secondary + (t.grams?.secondary ?? 0), total: g.total + (t.grams?.total ?? 0),
  }), { body: 0, accent: 0, secondary: 0, total: 0 })
  const hardware = new Map<string, number>()
  for (const t of towers) for (const h of t.hardware ?? []) hardware.set(h.item, (hardware.get(h.item) ?? 0) + h.qty)
  return (
    <div className="summary">
      <h3>Whole layout</h3>
      <p className="size-line">{parts} parts, about {formatGrams(grams.total)}</p>
      {printed > 0 && <p className="small">{printed} of {parts} printed</p>}
      <p className="muted small">{ROLES.map(({ role, name }) => `${name} ${formatGrams(grams[role])}`).join(', ')}. Towers still being built aren't counted.</p>
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
          const progress = d?.parts && partProgress(d.parts, t.printed ?? {})
          const printedText = progress && progress.done > 0 ? `, ${progress.done}/${progress.total} printed` : ''
          const detail = !t.width ? 'empty' : `${t.width}${d?.depth ?? ''}, ${rows} row${rows === 1 ? '' : 's'}${printedText}`
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
      <fieldset className="colours">
        <legend>Colours</legend>
        {ROLES.map(({ role, name, covers }) => (
          <label key={role} className="colour-row">
            <input type="color" value={layout.colours[role]} onChange={(e) => set({ colours: { ...layout.colours, [role]: e.target.value } })} />
            <span className="colour-name">{name}</span>
            <span className="colour-covers small muted">{covers}</span>
          </label>
        ))}
      </fieldset>
      <Field label="Parts that come split">
        <select value={layout.splitParts} onChange={(e) => set({ splitParts: e.target.value as typeof layout.splitParts })}>
          <option value="auto">Whole when it fits, split when it doesn't</option>
          <option value="whole">Always whole</option>
          <option value="split">Always split</option>
        </select>
      </Field>
      <label className="check">
        <input type="checkbox" checked={layout.allowColourMixing} onChange={(e) => set({ allowColourMixing: e.target.checked })} />
        Mix colours on one plate (needs an AMS)
      </label>
      <fieldset className="plate-settings">
        <legend>Plates</legend>
        <div className="plate-fields">
          <Field label="Gap from the plate edge">
            <span className="mm-input">
              <input
                type="number" min={1} max={30} step={0.5} value={layout.plateEdgeMm}
                onChange={(e) => {
                  const mm = Number(e.target.value)
                  if (Number.isFinite(mm)) set({ plateEdgeMm: Math.min(30, Math.max(1, mm)) })
                }}
              />
              mm
            </span>
          </Field>
          <Field label="Space between parts">
            <select value={layout.plateDensity} onChange={(e) => set({ plateDensity: e.target.value as Density })}>
              <option value="roomy">Roomy ({DENSITY_SPACING_MM.roomy} mm)</option>
              <option value="normal">Normal ({DENSITY_SPACING_MM.normal} mm)</option>
              <option value="tight">Tight ({DENSITY_SPACING_MM.tight} mm)</option>
            </select>
          </Field>
        </div>
        <p className="small muted">
          Parts share a plate only within this gap. A part that can't keep it anywhere (one lying diagonally, say)
          prints on a plate of its own with as much as it can get, and the print files say so. Small parts go in front
          of the others, at least {SMALL_PART_EDGE_MM} mm from the edges when there's room.
        </p>
      </fieldset>
      <TowerList editor={editor} info={info} />
      <LayoutTotals info={info} layout={layout} />
    </section>
  )
}

/**
 * A labelled control. `why` explains what isn't available and why: shown under the control (so it isn't missed,
 * and works on touch), as its tooltip, and read out with it. `whyDisables` says the whole control is off.
 */
function Field({ label, why, whyDisables, children }: {
  label: string; why?: string; whyDisables?: boolean; children: React.ReactElement<{ 'aria-describedby'?: string }>
}) {
  const id = useId()
  return (
    <label className="field" title={why}>
      <span>{label}</span>
      {why ? cloneElement(children, { 'aria-describedby': id }) : children}
      {why && <span id={id} className={`field-why${whyDisables ? ' is-off' : ''}`}>{whyDisables ? 'Unavailable: ' : ''}{why}</span>}
    </label>
  )
}

const fileName = (path: string) => path.split('/').pop()!.replace(/\.stl$/i, '')
