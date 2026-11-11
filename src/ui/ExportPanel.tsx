import { useEffect, useMemo, useRef, useState } from 'react'
import type { Tower } from '../engine/model'
import {
  canStreamToFile, estimateProjectBytes, hasTemplate, platesFor, saveBambuProject, saveStlZip, type ExportRequest,
} from '../export/exportTower'
import {
  allowFolder, canRememberFolders, chooseFolder, filesSource, folderSource, rememberedFolder,
  type VaultFolder, type VaultSource,
} from '../export/vaultFolder'
import { catalog, printerLabel, type Printer } from './data'
import type { Editor } from './useEditor'

type FolderState =
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'needs-permission'; folder: VaultFolder }
  | { kind: 'ready'; source: VaultSource }

/** Building a file in memory (browsers that can't stream to disk) gets risky above this size. */
const MEMORY_WARNING_BYTES = 1.5e9

const sizeText = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`)
const cancelled = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

// A folder chosen through the folder input lasts for the visit, shared by every tower's panel.
let sessionSource: VaultSource | undefined

export function ExportPanel({ editor, tower, towerName }: { editor: Editor; tower: Tower; towerName: string }) {
  const printer: Printer = editor.printer
  const remembers = canRememberFolders()
  const [folder, setFolder] = useState<FolderState>(() =>
    sessionSource ? { kind: 'ready', source: sessionSource } : remembers ? { kind: 'checking' } : { kind: 'none' })
  const [progress, setProgress] = useState<{ done: number; total: number; what: string } | null>(null)
  const [message, setMessage] = useState<{ kind: 'done' | 'error'; text: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (sessionSource || !remembers) return
    let live = true
    rememberedFolder().then((r) => {
      if (!live) return
      setFolder(!r ? { kind: 'none' } : r.granted ? { kind: 'ready', source: folderSource(r.folder) } : { kind: 'needs-permission', folder: r.folder })
    })
    return () => { live = false }
  }, [remembers])

  const req: ExportRequest = {
    tower, towerName, printer, catalog,
    splitParts: editor.layout.splitParts,
    allowColourMixing: editor.layout.allowColourMixing,
    plateEdgeMm: editor.layout.plateEdgeMm,
    plateDensity: editor.layout.plateDensity,
    colours: editor.layout.colours,
  }
  const plates = useMemo(() => {
    try { return platesFor(req) } catch { return undefined }
  }, [tower, printer, editor.layout.splitParts, editor.layout.allowColourMixing, editor.layout.plateEdgeMm, editor.layout.plateDensity]) // eslint-disable-line react-hooks/exhaustive-deps
  const templated = hasTemplate(printer.id)
  const estimate = plates ? estimateProjectBytes(plates, catalog) : 0

  const fail = (e: unknown) => { if (!cancelled(e)) setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) }) }

  async function pick() {
    setMessage(null)
    if (!remembers) { input.current?.click(); return }
    try { setFolder({ kind: 'ready', source: folderSource(await chooseFolder()) }) } catch (e) { fail(e) }
  }

  function picked(files: FileList | null) {
    if (!files?.length) return
    try {
      sessionSource = filesSource(files)
      setFolder({ kind: 'ready', source: sessionSource })
    } catch (e) { fail(e) }
  }

  async function allow(f: VaultFolder) {
    setFolder((await allowFolder(f)) ? { kind: 'ready', source: folderSource(f) } : { kind: 'needs-permission', folder: f })
  }

  async function save(kind: 'project' | 'zip') {
    if (folder.kind !== 'ready') return
    setMessage(null)
    const what = kind === 'project' ? 'Writing the Bambu project' : 'Writing the STL zip'
    try {
      const onProgress = (done: number, total: number) => setProgress({ done, total, what })
      if (kind === 'project') await saveBambuProject(req, folder.source, onProgress)
      else await saveStlZip(req, folder.source, onProgress)
      setMessage({
        kind: 'done',
        text: kind === 'project'
          ? `Saved. Open it in Bambu Studio: ${plates?.length ?? ''} plates, ready to slice.`
          : 'Saved. Each folder in the zip is one plate.',
      })
    } catch (e) {
      fail(e)
    } finally {
      setProgress(null)
    }
  }

  const busy = progress !== null
  return (
    <div className="summary export">
      <h3>Print files</h3>
      {plates && <p className="size-line">{plates.length} plates{templated ? `, about ${sizeText(estimate)}` : ''}</p>}
      {plates && plates.filter((p) => p.edgeMm < editor.layout.plateEdgeMm - 0.01).map((p) => (
        <p key={p.index} className="small export-warning">
          Plate {p.index}: {p.items[0].path.split('/').pop()!.replace(/\.stl$/i, '')} only fits {p.edgeMm.toFixed(1)} mm
          from the edge (you chose {editor.layout.plateEdgeMm} mm), so it prints on a plate of its own.
        </p>
      ))}

      <p className="small folder-line">
        {folder.kind === 'checking' && 'Looking for your Vault folder…'}
        {folder.kind === 'none' && (remembers
          ? 'Parts are read from your own copy of the Vault files. Nothing is uploaded.'
          : 'Parts are read from your own copy of the Vault files. Your browser may ask to "upload" the folder: nothing leaves your computer.')}
        {folder.kind === 'needs-permission' && <>Vault folder: <strong>{folder.folder.name}</strong>. The browser needs your OK to read it again.</>}
        {folder.kind === 'ready' && <>Vault folder: <strong>{folder.source.name}</strong>{remembers ? '' : ' (choose it again next visit)'}</>}
      </p>
      {!remembers && (
        <input
          ref={input}
          type="file"
          hidden
          // Not in React's types, but supported by every major browser.
          {...{ webkitdirectory: '', directory: '' }}
          multiple
          onChange={(e) => { picked(e.target.files); e.target.value = '' }}
        />
      )}
      <div className="panel-actions inline">
        {folder.kind === 'none' && <button type="button" onClick={pick}>Choose your Vault folder</button>}
        {folder.kind === 'needs-permission' && <button type="button" onClick={() => allow(folder.folder)}>Allow reading {folder.folder.name}</button>}
        {folder.kind === 'ready' && !busy && <button type="button" className="link" onClick={pick}>Change folder</button>}
      </div>

      {!templated && (
        <p className="small muted">
          Bambu Studio settings for the {printerLabel(printer)} haven't been added yet, so you can save the STLs grouped by plate and arrange them in Bambu Studio yourself.
        </p>
      )}
      {templated && !canStreamToFile() && estimate > MEMORY_WARNING_BYTES && (
        <p className="small export-warning">
          This browser builds the file in memory before downloading it, and at about {sizeText(estimate)} that may fail. Chrome or Edge can save it straight to disk.
        </p>
      )}
      <div className="panel-actions inline">
        {templated && (
          <button type="button" className="primary" disabled={folder.kind !== 'ready' || busy || !plates} onClick={() => save('project')}>
            Save Bambu project
          </button>
        )}
        <button type="button" disabled={folder.kind !== 'ready' || busy || !plates} onClick={() => save('zip')}>
          Save STLs (zip)
        </button>
      </div>

      {!busy && (folder.kind !== 'ready' || !plates) && (
        <p className="small muted">
          {folder.kind !== 'ready'
            ? 'Saving is available once the Vault folder is chosen: the parts are read from it.'
            : "Saving isn't available: some of this tower's parts couldn't be laid out on plates."}
        </p>
      )}
      {progress && (
        <div className="progress" role="status">
          <span>{progress.what}: part {progress.done} of {progress.total}</span>
          <progress max={progress.total} value={progress.done} />
        </div>
      )}
      {message && <p className={`small ${message.kind === 'error' ? 'export-error' : 'export-done'}`} role="status">{message.text}</p>}
    </div>
  )
}
