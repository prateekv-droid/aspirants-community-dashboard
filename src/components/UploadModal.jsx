import { useCallback, useEffect, useRef, useState } from 'react'
import { detectAndParse, SOURCES } from '../lib/detect.js'
import { LEAD_FIELDS } from '../lib/parseLeads.js'
import { slug, communityContents, validateCommunityName } from '../lib/store.js'
import { fmtFull, fmtNum } from '../lib/format.js'
import { fmtLong } from '../lib/dates.js'

const MAX_MB = 400
const NEW = '__new__'

/* ── Add data dialog ──────────────────────────────────────────────────────
   Everything manual enters the tool through here. Dropped files are
   inspected before anything is committed, and each card says what the file
   was detected as and which community it will go to, so a wrong guess is
   visible and correctable rather than silent.

   Communities are created and edited on their own tab and chosen from a
   dropdown per file, by id — so a rename never splits a community in two. */
export default function UploadModal({
  state, onClose, onImport, initialTab = 'upload', currentCommunityId, onReset,
  onCreateCommunity, onRenameCommunity, onDeleteCommunity,
}) {
  const [tab, setTab] = useState(initialTab)
  const [staged, setStaged] = useState([])   // { id, name, size, status, result, communityId, suggestedName, error }
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  // a file whose dropdown asked to create a community, to assign on return
  const [assignAfterCreate, setAssignAfterCreate] = useState(null)
  const inputRef = useRef(null)

  const communities = state.communities
  const exists = (id) => communities.some((c) => c.id === id)

  /* Default community for a detected file — only ever a choice that is not a
     guess:
       1. a WhatsApp export whose file name names an existing community
       2. the community tab you had open
       3. the only community, when there is just one
     Otherwise nothing is selected and the file cannot be imported until you
     pick — no file lands in "the first community" by accident. A WhatsApp
     file name that names a community which doesn't exist yet ("WA community
     3.zip") is offered as a one-click create instead. */
  const defaultFor = useCallback((result) => {
    let suggestedName = null
    if (result.source === 'whatsapp') {
      const guess = result.payload.communityName
      const match = communities.find((c) => slug(c.name) === slug(guess))
      if (match) return { communityId: match.id, suggestedName: null }
      if (/^Community #\d+$/.test(guess)) {
        // the file names a specific community — don't second-guess it
        return { communityId: '', suggestedName: guess }
      }
    }
    const fallback = currentCommunityId || (communities.length === 1 ? communities[0].id : '')
    return { communityId: fallback, suggestedName }
  }, [communities, currentCommunityId])

  const handleFiles = useCallback(async (fileList) => {
    const files = [...fileList]
    if (!files.length) return
    setBusy(true)
    const stamp = Date.now()
    const ids = files.map((_, i) => `${stamp}-${i}`)
    setStaged((s) => [...s, ...files.map((f, i) => ({ id: ids[i], name: f.name, size: f.size, status: 'reading' }))])
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const patch = (p) => setStaged((s) => s.map((x) => (x.id === ids[i] ? { ...x, ...p } : x)))
      try {
        if (f.size > MAX_MB * 1024 * 1024) throw new Error(`File is ${(f.size / 1048576).toFixed(0)} MB — over the ${MAX_MB} MB limit.`)
        const buffer = await f.arrayBuffer()
        patch({ status: 'detecting' })
        const result = await detectAndParse({ name: f.name, buffer })
        if (!result.source) {
          patch({ status: 'error', error: result.evidence.join(' · ') || 'Could not identify this file.' })
          continue
        }
        patch({ status: 'ready', result, ...defaultFor(result), error: null })
      } catch (e) {
        patch({ status: 'error', error: e.message || String(e) })
      }
    }
    setBusy(false)
  }, [defaultFor])

  const setCommunity = (fileId, communityId) =>
    setStaged((all) => all.map((x) => (x.id === fileId ? { ...x, communityId } : x)))

  const pickCommunity = (fileId, value) => {
    if (value === NEW) { setAssignAfterCreate(fileId); setTab('communities'); return }
    setCommunity(fileId, value)
  }

  /* create from inside a file card, straight from the name the file suggests */
  const createFor = (fileId, name) => {
    const r = onCreateCommunity(name)
    if (!r.error) setCommunity(fileId, r.community.id)
    return r
  }

  const onDrop = (e) => {
    e.preventDefault(); setOver(false)
    handleFiles(e.dataTransfer.files)
  }

  const ready = staged.filter((s) => s.status === 'ready')
  const unassigned = ready.filter((s) => !exists(s.communityId))

  const doImport = () => {
    onImport(ready.map((s) => ({ fileName: s.name, size: s.size, communityId: s.communityId, ...s.result })))
    setStaged([])
  }

  const tabs = [
    ['upload', 'Upload files'],
    ['communities', `Communities${communities.length ? ` (${communities.length})` : ''}`],
    ['history', `Import history${state.imports.length ? ` (${state.imports.length})` : ''}`],
  ]

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Add data">
        <div className="modal-head">
          <div>
            <h2>Add data</h2>
            <p className="sub">Upload WhatsApp exports, GA snapshots and short.io reports, and choose which community each belongs to.</p>
          </div>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-tabs" role="tablist">
          {tabs.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k}
                    className={`modal-tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{l}</button>
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
                  {['whatsapp', 'ga', 'shortio'].map((k) => (
                    <span className="chip" key={k}>{SOURCES[k].icon} {SOURCES[k].label}</span>
                  ))}
                </div>
                <input ref={inputRef} type="file" multiple hidden
                       accept=".zip,.csv,.tsv,.txt,.xlsx,.xlsm"
                       onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }} />
              </div>

              {staged.map((s) => (
                <StagedFile key={s.id} item={s} communities={communities}
                            onPick={(v) => pickCommunity(s.id, v)}
                            onCreateSuggested={(name) => createFor(s.id, name)}
                            onRemove={() => setStaged((all) => all.filter((x) => x.id !== s.id))} />
              ))}
            </div>
            <div className="modal-foot">
              <span className="muted">
                {busy ? <><span className="spinner" style={{ display: 'inline-block', verticalAlign: -2, marginRight: 6 }} />Reading…</>
                  : !ready.length ? 'Nothing staged yet'
                  : unassigned.length ? `Choose a community for ${unassigned.length} file${unassigned.length > 1 ? 's' : ''}`
                  : `${ready.length} file${ready.length > 1 ? 's' : ''} ready`}
              </span>
              <span className="spacer" />
              {staged.length > 0 && <button className="btn ghost" onClick={() => setStaged([])}>Clear</button>}
              <button className="btn primary" disabled={!ready.length || busy || unassigned.length > 0} onClick={doImport}>
                Import {ready.length || ''} file{ready.length === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}

        {tab === 'communities' && (
          <CommunitiesTab
            state={state}
            returning={!!assignAfterCreate}
            onCreate={(name) => {
              const r = onCreateCommunity(name)
              if (!r.error && assignAfterCreate) {
                setCommunity(assignAfterCreate, r.community.id)
                setAssignAfterCreate(null)
                setTab('upload')
              }
              return r
            }}
            onRename={onRenameCommunity}
            onDelete={onDeleteCommunity}
            onBack={assignAfterCreate ? () => { setAssignAfterCreate(null); setTab('upload') } : null}
          />
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
                        <td>{communities.find((c) => c.id === im.communityId)?.name || im.communityName}</td>
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

/* ── one staged file: what it is on the left, where it goes on the right ─ */
function StagedFile({ item, communities, onPick, onCreateSuggested, onRemove }) {
  const s = item.result ? SOURCES[item.result.source] : null
  const busy = item.status === 'reading' || item.status === 'detecting'
  const chosen = communities.some((c) => c.id === item.communityId)
  const [createError, setCreateError] = useState(null)

  return (
    <div className="glass-inner filecard">
      <div className="fc-head">
        <span className="fc-ico" aria-hidden>{busy ? <span className="spinner" /> : item.status === 'error' ? '⚠' : s?.icon}</span>

        <div className="fc-id">
          <div className="fc-name">{item.name}</div>
          <div className="fc-src">
            {item.status === 'ready' && <span className="badge soft">{s.label}</span>}
            <span className="muted">{(item.size / 1024).toFixed(0)} KB</span>
            {item.status === 'ready' && <span className="muted">· {Math.round(item.result.confidence * 100)}% match</span>}
            {busy && <span className="muted">· {item.status === 'reading' ? 'reading' : 'identifying source'}…</span>}
            {item.status === 'error' && <span style={{ color: 'var(--danger)' }}>· {item.error}</span>}
          </div>
        </div>

        {item.status === 'ready' && (
          <div className="fc-assign">
            <label className="fc-assign-label" htmlFor={`c-${item.id}`}>Community</label>
            <select id={`c-${item.id}`} value={chosen ? item.communityId : ''}
                    className={chosen ? '' : 'needs-choice'}
                    onChange={(e) => onPick(e.target.value)}>
              {!chosen && <option value="" disabled>Choose a community…</option>}
              {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option disabled>──────────</option>
              <option value={NEW}>+ New community…</option>
            </select>
            {item.suggestedName && !chosen && (
              <button className="btn tiny ghost fc-suggest" onClick={() => {
                const r = onCreateSuggested(item.suggestedName)
                setCreateError(r.error || null)
              }}>
                + Create “{item.suggestedName}” from the file name
              </button>
            )}
            {createError && <span className="fc-err">{createError}</span>}
          </div>
        )}

        <button className="btn tiny ghost" onClick={onRemove} aria-label={`Remove ${item.name}`}>✕</button>
      </div>

      {item.status === 'ready' && (
        <>
          <p className="fc-why">{item.result.evidence.map(prettyDates).join(' · ')}</p>
          {item.result.warnings?.map((w, i) => <div className="alert warn" key={i}>{w}</div>)}
          {item.result.source === 'leads' && (
            <div className="alert warn">Leads aren't shown anywhere in the dashboard at the moment — this file would be stored but not displayed.</div>
          )}
          <Preview result={item.result} />
        </>
      )}
    </div>
  )
}

/* ISO dates in the detector's evidence read better as "28 Jul 2026". */
const prettyDates = (text) => String(text).replace(/\d{4}-\d{2}-\d{2}/g, (d) => fmtLong(d))

/* ── what will actually be imported ──────────────────────────────────── */
const GA_METRIC = {
  'Active users': 'Active users',
  'New users': 'New users',
  'Average engagement time per active user': 'Avg engagement',
  'Event count': 'Events',
}
const GA_BLOCK = {
  pages: 'Pages', firstUser: 'First-user sources', firstUserSrc: 'First-user sources',
  sessions: 'Session sources', sessionsSrc: 'Session sources', campaigns: 'Campaigns',
  cities: 'Cities', countries: 'Countries', devices: 'Devices', audiences: 'Audiences',
  events: 'Event names', landing: 'Landing pages', platform: 'Platforms',
}
const SHORTIO_DIM = {
  links: 'Short links', countries: 'Countries', cities: 'Cities', os: 'Operating systems',
  browser: 'Browsers', social: 'Social referrers', referrers: 'Referrers', devices: 'Devices',
  languages: 'Languages', utmSource: 'utm_source', utmMedium: 'utm_medium',
  utmCampaign: 'utm_campaign', utmContent: 'utm_content', utmTerm: 'utm_term',
}

function Stats({ items }) {
  return (
    <div className="fc-stats">
      {items.map(([k, v]) => (
        <span className="fc-stat" key={k}><span className="k">{k}</span><b>{v}</b></span>
      ))}
    </div>
  )
}

function Contains({ items }) {
  const live = items.filter(([, n]) => n > 0)
  if (!live.length) return null
  return (
    <p className="fc-contains">
      <span className="k">Contains</span>
      {live.map(([k, n]) => <span key={k}>{k} <b>{fmtFull(n)}</b></span>)}
    </p>
  )
}

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
    const metrics = Object.entries(s)
      .filter(([k]) => k !== 'from' && k !== 'to')
      .map(([k, v]) => [GA_METRIC[k] || k, typeof v !== 'number' ? v
        : /time/i.test(k) ? fmtNum(v, 'sec')
        : /average|rate|per /i.test(k) ? fmtNum(v, 'dec')
        : fmtFull(v)])
    const blocks = Object.entries(p.blocks)
      .filter(([k]) => k !== 'summary' && k !== 'nthDay')
      .map(([k, b]) => [GA_BLOCK[k] || k, b.items?.length ?? 0])
    return (
      <>
        <Stats items={metrics} />
        <Contains items={[['Days of daily users', p.daily.length], ...blocks]} />
      </>
    )
  }
  if (result.source === 'shortio') {
    return (
      <>
        <Stats items={[['Total clicks', fmtFull(p.totals.clicks)], ['Short links', fmtFull(p.totals.links)]]} />
        <Contains items={[['Days of clicks', p.daily.length],
          ...Object.entries(p.dims).map(([k, v]) => [SHORTIO_DIM[k] || k, v.length])]} />
      </>
    )
  }
  if (result.source === 'leads') {
    const mapped = Object.entries(p.mapping).filter(([, f]) => f)
    return (
      <>
        <Stats items={[['Lead records', fmtFull(p.leads.length)]]} />
        <p className="fc-contains">
          <span className="k">Columns</span>
          {mapped.map(([col, f]) => <span key={col}>{col} → <b>{LEAD_FIELDS.find((x) => x.key === f)?.label || f}</b></span>)}
        </p>
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

/* ── Communities: create, rename, delete ──────────────────────────────── */
function CommunitiesTab({ state, onCreate, onRename, onDelete, onBack, returning }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)   // { id, name, error }
  const createRef = useRef(null)

  useEffect(() => { if (returning) createRef.current?.focus() }, [returning])

  const create = (e) => {
    e?.preventDefault()
    const r = onCreate(name)
    if (r.error) { setError(r.error); return }
    setName(''); setError(null)
  }

  const saveRename = () => {
    const r = onRename(editing.id, editing.name)
    if (r.error) setEditing((x) => ({ ...x, error: r.error }))
    else setEditing(null)
  }

  const remove = (c) => {
    const k = communityContents(c)
    const parts = [
      k.groups && `${k.groups} country group${k.groups > 1 ? 's' : ''} (${fmtFull(k.events)} WhatsApp events)`,
      k.ga && `${k.ga} GA snapshot${k.ga > 1 ? 's' : ''}`,
      k.shortio && `${k.shortio} short.io report${k.shortio > 1 ? 's' : ''}`,
      k.leads && `${fmtFull(k.leads)} leads`,
    ].filter(Boolean)
    const msg = k.empty
      ? `Delete “${c.name}”? It has no data.`
      : `Delete “${c.name}”?\n\nThis removes ${parts.join(', ')} from this browser. Import history is kept. This cannot be undone.`
    if (confirm(msg)) onDelete(c.id)
  }

  const liveError = name.trim() ? validateCommunityName(state, name) : null

  return (
    <>
      <div className="modal-body">
        {returning && (
          <div className="alert good">Create the community, and it will be selected for the file you were uploading.</div>
        )}

        <form className="cm-create" onSubmit={create}>
          <label className="field" style={{ flex: 1 }}>
            <span>New community</span>
            <input ref={createRef} type="text" value={name} maxLength={60}
                   placeholder="e.g. Community #2"
                   onChange={(e) => { setName(e.target.value); setError(null) }} />
          </label>
          <button type="submit" className="btn primary" disabled={!name.trim() || !!liveError}>Create community</button>
        </form>
        {(error || liveError) && <p className="fc-err" style={{ marginTop: -8 }}>{error || liveError}</p>}

        {!state.communities.length ? (
          <p className="sub">No communities yet. Create one, then choose it from the dropdown when you upload a file.</p>
        ) : (
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Community</th><th>Data</th><th>Created</th><th /></tr></thead>
              <tbody>
                {state.communities.map((c) => {
                  const k = communityContents(c)
                  const isEditing = editing?.id === c.id
                  return (
                    <tr key={c.id}>
                      <td style={{ minWidth: 220 }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <input type="text" value={editing.name} maxLength={60} autoFocus
                                   aria-label={`New name for ${c.name}`}
                                   onChange={(e) => setEditing({ ...editing, name: e.target.value, error: null })}
                                   onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditing(null) }} />
                            {editing.error && <span className="fc-err">{editing.error}</span>}
                          </div>
                        ) : <span className="cell-main">{c.name}</span>}
                      </td>
                      <td className="muted">
                        {k.empty ? 'No data yet' : [
                          k.groups && `${k.groups} groups`,
                          k.ga && 'GA',
                          k.shortio && 'short.io',
                          k.leads && 'leads',
                        ].filter(Boolean).join(' · ')}
                      </td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                        {c.createdAt ? fmtLong(c.createdAt.slice(0, 10)) : '—'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {isEditing ? (
                          <>
                            <button className="btn tiny primary" onClick={saveRename}>Save</button>{' '}
                            <button className="btn tiny ghost" onClick={() => setEditing(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button className="btn tiny" onClick={() => setEditing({ id: c.id, name: c.name, error: null })}>Rename</button>{' '}
                            <button className="btn tiny ghost danger" onClick={() => remove(c)}>Delete</button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {onBack && (
        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn ghost" onClick={onBack}>← Back to upload</button>
        </div>
      )}
    </>
  )
}
