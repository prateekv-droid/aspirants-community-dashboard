import { useCallback, useEffect, useRef, useState } from 'react'
import { detectAndParse, SOURCES } from '../lib/detect.js'
import { LEAD_FIELDS } from '../lib/parseLeads.js'
import { INTERVALS, normalizeSyncUrl, nextRunLabel } from '../lib/sync.js'
import { fmtFull, fmtNum } from '../lib/format.js'
import { fmtLong } from '../lib/dates.js'

const MAX_MB = 400

/* ── Upload / sync / history dialog ───────────────────────────────────────
   Everything manual enters the tool through here. Dropped files are
   inspected before anything is committed, and the dialog shows *why* it
   thinks a file is what it is, so a misdetection is visible and correctable
   rather than silent. ------------------------------------------------------ */
export default function UploadModal({ state, onClose, onImport, onSaveSync, onRunSync, syncBusy, initialTab = 'upload', currentCommunity, onReset }) {
  const [tab, setTab] = useState(initialTab)
  const [staged, setStaged] = useState([])   // { id, name, size, status, result, community, error }
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  const communityNames = state.communities.map((c) => c.name)

  const handleFiles = useCallback(async (fileList) => {
    const files = [...fileList]
    if (!files.length) return
    setBusy(true)
    const base = staged.length
    setStaged((s) => [
      ...s,
      ...files.map((f, i) => ({ id: `${Date.now()}-${base + i}`, name: f.name, size: f.size, status: 'reading' })),
    ])
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const id = `${Date.now()}-${base + i}`
      const patch = (p) => setStaged((s) => s.map((x) => (x.name === f.name && x.status !== 'ready' && x.status !== 'error' ? { ...x, ...p } : x)))
      try {
        if (f.size > MAX_MB * 1024 * 1024) throw new Error(`File is ${(f.size / 1048576).toFixed(0)} MB — over the ${MAX_MB} MB limit.`)
        const buffer = await f.arrayBuffer()
        patch({ status: 'detecting' })
        const result = await detectAndParse({ name: f.name, buffer })
        if (!result.source) {
          patch({ status: 'error', error: result.evidence.join(' · ') || 'Could not identify this file.' })
          continue
        }
        // a WhatsApp export names its own community; anything else defaults to
        // whichever community tab the operator is looking at
        const suggested = result.source === 'whatsapp'
          ? result.payload.communityName
          : currentCommunity || communityNames[0] || 'Community #1'
        patch({ status: 'ready', result, community: suggested, error: null })
      } catch (e) {
        patch({ status: 'error', error: e.message || String(e) })
      }
    }
    setBusy(false)
  }, [staged.length, communityNames, currentCommunity])

  const onDrop = (e) => {
    e.preventDefault(); setOver(false)
    handleFiles(e.dataTransfer.files)
  }

  const ready = staged.filter((s) => s.status === 'ready')

  const doImport = () => {
    onImport(ready.map((s) => ({ fileName: s.name, size: s.size, community: s.community, ...s.result })))
    setStaged([])
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Add data">
        <div className="modal-head">
          <div>
            <h2>Add data</h2>
            <p className="sub">WhatsApp exports, GA snapshots and short.io workbooks are uploaded; the leads sheet syncs from a URL.</p>
          </div>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-tabs">
          {[
            ['upload', 'Upload files'],
            ['sync', 'Leads sync'],
            ['history', `Import history${state.imports.length ? ` (${state.imports.length})` : ''}`],
          ].map(([k, l]) => (
            <button key={k} className={`modal-tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        {tab === 'upload' && (
          <>
            <div className="modal-body">
              <div
                className={`dropzone${over ? ' over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true) }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                role="button" tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
              >
                <span className="big-ico" aria-hidden>📥</span>
                <h3>Drop files here, or click to choose</h3>
                <p className="sub">The source is identified from the file's own structure — no need to say which is which.</p>
                <div className="chips" style={{ justifyContent: 'center', marginTop: 12 }}>
                  {Object.entries(SOURCES).map(([k, s]) => (
                    <span className="chip" key={k}>{s.icon} {s.label}</span>
                  ))}
                </div>
                <input ref={inputRef} type="file" multiple hidden
                       accept=".zip,.csv,.tsv,.txt,.xlsx,.xlsm"
                       onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }} />
              </div>

              {staged.map((s) => (
                <StagedFile key={s.id} item={s} communityNames={communityNames}
                            onSetCommunity={(v) => setStaged((all) => all.map((x) => (x.id === s.id ? { ...x, community: v } : x)))}
                            onRemove={() => setStaged((all) => all.filter((x) => x.id !== s.id))} />
              ))}
            </div>
            <div className="modal-foot">
              <span className="muted">
                {busy ? <><span className="spinner" style={{ display: 'inline-block', verticalAlign: -2, marginRight: 6 }} />Reading…</>
                      : ready.length ? `${ready.length} file${ready.length > 1 ? 's' : ''} ready` : 'Nothing staged yet'}
              </span>
              <span className="spacer" />
              {staged.length > 0 && <button className="btn ghost" onClick={() => setStaged([])}>Clear</button>}
              <button className="btn primary" disabled={!ready.length || busy} onClick={doImport}>
                Import {ready.length || ''} file{ready.length === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}

        {tab === 'sync' && (
          <SyncTab state={state} onSave={onSaveSync} onRun={onRunSync} busy={syncBusy}
                   currentCommunity={currentCommunity} />
        )}

        {tab === 'history' && (
          <div className="modal-body">
            {!state.imports.length && <p className="sub">No imports yet.</p>}
            {state.imports.length > 0 && (
              <div className="table-scroll">
                <table className="data">
                  <thead><tr><th>When</th><th>File</th><th>Detected as</th><th>Community</th><th>Result</th></tr></thead>
                  <tbody>
                    {[...state.imports].reverse().map((im) => (
                      <tr key={im.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{new Date(im.at).toLocaleString()}</td>
                        <td style={{ wordBreak: 'break-all', maxWidth: 210 }}>{im.fileName}</td>
                        <td><span className="chip">{SOURCES[im.source]?.icon} {SOURCES[im.source]?.label || im.source}</span></td>
                        <td>{im.communityName}</td>
                        <td className="muted">{im.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {tab === 'history' && onReset && (
          <div className="modal-foot">
            <span className="muted">
              Everything is stored in this browser only — nothing is uploaded, since the transcripts contain members' phone numbers.
            </span>
            <span className="spacer" />
            <button className="btn danger ghost" onClick={() => {
              if (confirm('Delete every imported dataset from this browser and start over? This cannot be undone.')) onReset()
            }}>Clear all data</button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── one staged file, with the detector's reasoning ───────────────────── */
function StagedFile({ item, communityNames, onSetCommunity, onRemove }) {
  const s = item.result ? SOURCES[item.result.source] : null
  const busy = item.status === 'reading' || item.status === 'detecting'
  return (
    <div className="glass-inner filecard">
      <div className="fc-head">
        <span className="fc-ico" aria-hidden>{busy ? <span className="spinner" /> : item.status === 'error' ? '⚠' : s?.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="fc-name">{item.name}</div>
          <div className="fc-src">
            <span className="muted">{(item.size / 1024).toFixed(0)} KB</span>
            {busy && <span>· {item.status === 'reading' ? 'reading' : 'identifying source'}…</span>}
            {item.status === 'ready' && (
              <>
                <span>· detected as</span>
                <span className="badge soft">{s.label}</span>
                <span className="muted">{Math.round(item.result.confidence * 100)}% confidence</span>
              </>
            )}
            {item.status === 'error' && <span style={{ color: 'var(--danger)' }}>· {item.error}</span>}
          </div>
        </div>
        <button className="btn tiny ghost" onClick={onRemove} aria-label={`Remove ${item.name}`}>✕</button>
      </div>

      {item.status === 'ready' && (
        <>
          <ul className="why">
            {item.result.evidence.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          {item.result.warnings?.map((w, i) => <div className="alert warn" key={i}>{w}</div>)}
          <Preview result={item.result} />
          <div className="fc-row">
            <label className="field">
              <span>Assign to community</span>
              <input type="text" list="community-names" value={item.community || ''}
                     onChange={(e) => onSetCommunity(e.target.value)} placeholder="Community #1" />
              <datalist id="community-names">
                {communityNames.map((n) => <option key={n} value={n} />)}
              </datalist>
            </label>
          </div>
        </>
      )}
    </div>
  )
}

/* ── what will actually be imported ──────────────────────────────────── */
function Preview({ result }) {
  const p = result.payload
  if (result.source === 'whatsapp') {
    return (
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Group</th><th className="n">Messages</th><th className="n">Joins</th><th className="n">Leaves</th><th className="n">Requests</th><th>Covers</th></tr></thead>
          <tbody>
            {p.groups.map((g) => {
              const c = tally(g.events)
              return (
                <tr key={g.group}>
                  <td><div className="cell-main">{g.group}</div><div className="cell-sub">{g.senders} distinct senders</div></td>
                  <td className="n">{fmtFull(c.message + c.attachment)}</td>
                  <td className="n">{fmtFull(c.join)}</td>
                  <td className="n">{fmtFull(c.leave)}</td>
                  <td className="n">{fmtFull(c.request)}</td>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtLong(g.first)} → {fmtLong(g.last)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }
  if (result.source === 'ga') {
    const s = p.blocks.summary || {}
    return (
      <div className="chips">
        {Object.entries(s).filter(([k]) => k !== 'from' && k !== 'to').map(([k, v]) => (
          <span className="chip" key={k}>
            {k}: <b>{typeof v !== 'number' ? v
              : /time/i.test(k) ? fmtNum(v, 'sec')
              : /average|rate|per /i.test(k) ? fmtNum(v, 'dec')
              : fmtFull(v)}</b>
          </span>
        ))}
        <span className="chip">{p.daily.length} days of new/returning users</span>
        {Object.keys(p.blocks).filter((k) => k !== 'summary' && k !== 'nthDay').map((k) => (
          <span className="chip" key={k}>{k}: {p.blocks[k].items?.length ?? 0} rows</span>
        ))}
      </div>
    )
  }
  if (result.source === 'shortio') {
    return (
      <div className="chips">
        <span className="chip">Total clicks: <b>{fmtFull(p.totals.clicks)}</b></span>
        <span className="chip">Short links: <b>{p.totals.links}</b></span>
        <span className="chip">{p.daily.length} days of click history</span>
        {Object.entries(p.dims).map(([k, v]) => <span className="chip" key={k}>{k}: {v.length}</span>)}
      </div>
    )
  }
  if (result.source === 'leads') {
    const mapped = Object.entries(p.mapping).filter(([, f]) => f)
    return (
      <>
        <div className="chips">
          <span className="chip">{fmtFull(p.leads.length)} lead records</span>
          {mapped.map(([col, f]) => (
            <span className="chip" key={col}>{col} → <b>{LEAD_FIELDS.find((x) => x.key === f)?.label || f}</b></span>
          ))}
        </div>
        {!mapped.some(([, f]) => f === 'date') && (
          <div className="alert warn">No date column was recognised, so these leads will show in every date range rather than on a timeline.</div>
        )}
      </>
    )
  }
  return null
}

function tally(events) {
  const c = { message: 0, attachment: 0, join: 0, leave: 0, request: 0 }
  for (const e of events) if (e.type in c) c[e.type]++
  return c
}

/* ── sync configuration ──────────────────────────────────────────────── */
function SyncTab({ state, onSave, onRun, busy, currentCommunity }) {
  const cur = state.sync || {}
  const [url, setUrl] = useState(cur.url || '')
  const [interval, setInterval] = useState(cur.interval || '6h')
  const [community, setCommunity] = useState(cur.communityName || currentCommunity || state.communities[0]?.name || 'Community #1')
  const [probe, setProbe] = useState(null)

  useEffect(() => {
    if (!url.trim()) { setProbe(null); return }
    try { setProbe({ ok: true, ...normalizeSyncUrl(url) }) }
    catch (e) { setProbe({ ok: false, error: e.message }) }
  }, [url])

  const save = () => onSave({ url: url.trim(), interval, communityName: community })
  const dirty = url.trim() !== (cur.url || '') || interval !== (cur.interval || '6h') || community !== (cur.communityName || '')

  return (
    <>
      <div className="modal-body">
        <p className="sub">
          Point the dashboard at the leads sheet and it re-reads it on the schedule you choose — no re-upload.
          The read happens from this browser, so the sheet has to be readable without a login.
        </p>

        <label className="field">
          <span>Leads sheet URL</span>
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
                 placeholder="https://docs.google.com/spreadsheets/d/…" />
        </label>

        {probe?.ok && (
          <div className="alert good">
            <b>{probe.note}.</b> {probe.requirement || 'Ready to sync.'}
            <div className="muted" style={{ marginTop: 6, wordBreak: 'break-all' }}>Will read: {probe.fetchUrl}</div>
          </div>
        )}
        {probe && !probe.ok && <div className="alert bad">{probe.error}</div>}

        <div className="fc-row">
          <label className="field">
            <span>Refresh</span>
            <select value={interval} onChange={(e) => setInterval(e.target.value)}>
              {INTERVALS.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Attach leads to community</span>
            <input type="text" list="community-names-sync" value={community} onChange={(e) => setCommunity(e.target.value)} />
            <datalist id="community-names-sync">
              {state.communities.map((c) => <option key={c.id} value={c.name} />)}
            </datalist>
          </label>
        </div>

        {cur.url && (
          <div className="glass-inner" style={{ padding: '12px 14px' }}>
            <div className="stat-row"><span className="k">Last synced</span><span className="v" style={{ fontSize: 13 }}>{cur.lastRun ? new Date(cur.lastRun).toLocaleString() : 'never'}</span></div>
            <div className="stat-row"><span className="k">Last result</span><span className="v" style={{ fontSize: 13, color: cur.lastError ? 'var(--danger)' : undefined }}>{cur.lastError || cur.lastStatus || '—'}</span></div>
            <div className="stat-row"><span className="k">Next refresh</span><span className="v" style={{ fontSize: 13 }}>{nextRunLabel(cur)}</span></div>
          </div>
        )}

        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }}>
            How to make a Google Sheet readable
          </summary>
          <ol className="sub" style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>Open the leads sheet → <b>Share</b>.</li>
            <li>Under <i>General access</i> choose <b>Anyone with the link</b>, role <b>Viewer</b>.</li>
            <li>Copy the address bar URL and paste it above — the tab you were on is kept.</li>
            <li>Column names are matched automatically; anything unrecognised is preserved on the record.</li>
          </ol>
        </details>
      </div>
      <div className="modal-foot">
        <span className="muted">{state.communities.find((c) => c.name === community)?.leads
          ? `${fmtFull(state.communities.find((c) => c.name === community).leads.leads.length)} leads currently stored`
          : 'No leads stored yet'}</span>
        <span className="spacer" />
        <button className="btn" disabled={!probe?.ok || busy} onClick={() => { save(); onRun({ url: url.trim(), interval, communityName: community }) }}>
          {busy ? <><span className="spinner" />Syncing…</> : 'Save & sync now'}
        </button>
        <button className="btn primary" disabled={!dirty || !probe?.ok} onClick={save}>Save</button>
      </div>
    </>
  )
}
