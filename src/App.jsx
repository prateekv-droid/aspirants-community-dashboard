import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  loadState, saveState, clearState, emptyState, resolveCommunity,
  createCommunity, renameCommunity, deleteCommunity,
  mergeWhatsApp, addSnapshot, mergeGA, mergeShortIo, communityExtent,
  aggregateCommunities, planMigration, PARSER_VERSION,
} from './lib/store.js'
import { enrichEvents, eventsFor } from './lib/metrics.js'
import { resolveRange, previousRange, fmtLong } from './lib/dates.js'
import { detectAndParse, SOURCES } from './lib/detect.js'
import { Toasts, Empty } from './components/ui.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import DateRangePicker from './components/DateRangePicker.jsx'
import UploadModal from './components/UploadModal.jsx'
import Overview from './views/Overview.jsx'
import MemberGrowth from './views/MemberGrowth.jsx'
import Conversations from './views/Conversations.jsx'
import Groups from './views/Groups.jsx'

/* Sections live *inside* a community. Uploading, managing communities and
   the import history all live in the Add data dialog rather than in a tab. */
const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'members', label: 'Member growth' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'groups', label: 'Groups' },
]

const ALL = '__all__'

/* The three sample exports ship with the tool and are imported through the
   exact same detection pipeline as a manual upload, so first run shows real
   numbers and the pipeline is exercised end to end. */
const SAMPLES = [
  'samples/WA community 1.zip',
  'samples/GA Data.csv',
  'samples/Short io click data.xlsx',
]

export default function App() {
  const [state, setState] = useState(null)
  const [booting, setBooting] = useState('Loading saved data…')
  const [scope, setScope] = useState(ALL)          // ALL or a community id
  const [section, setSection] = useState('overview')
  const [uploadTab, setUploadTab] = useState(null) // null = closed
  const [toasts, setToasts] = useState([])
  const [groupFilter, setGroupFilter] = useState([])
  const [range, setRange] = useState({ preset: '28d', range: { from: '2026-01-01', to: '2026-12-31' }, compare: true })
  const rangeInit = useRef(false)

  const toast = useCallback((text, tone = 'info', sticky = false) => {
    setToasts((t) => [...t, { id: `${Date.now()}-${Math.random()}`, text, tone, sticky }])
  }, [])

  // light only; drop the preference left behind by the old theme switch
  useEffect(() => { try { localStorage.removeItem('amber-theme') } catch {} }, [])

  /* ── boot: restore, or seed from the bundled samples ─────────────────── */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const saved = await loadState()
      if (cancelled) return
      if (saved?.communities?.length) {
        /* Data parsed by an older parser: re-parse what came from the bundled
           samples, flag the rest for re-upload. */
        const plan = planMigration(saved, SAMPLES.map((p) => p.split('/').pop()))
        if (plan.reparse.length || plan.stale.length) {
          setBooting('Re-reading WhatsApp data with the updated parser…')
          if (plan.reparse.length) {
            let groups = null
            try {
              const wa = SAMPLES.find((p) => /\.zip$/i.test(p))
              const res = await fetch(`${import.meta.env.BASE_URL || '/'}${wa}`)
              if (res.ok) {
                const detected = await detectAndParse({ name: wa.split('/').pop(), buffer: await res.arrayBuffer() })
                if (detected.source === 'whatsapp') groups = detected.payload.groups
              }
            } catch (e) {
              console.warn('sample re-parse failed', e)
            }
            for (const id of plan.reparse) {
              const c = saved.communities.find((x) => x.id === id)
              if (!groups) { plan.stale.push(id); continue }
              c.groups = []
              mergeWhatsApp(c, structuredClone(groups))
            }
          }
          saved.staleWhatsApp = saved.communities.filter((c) => plan.stale.includes(c.id)).map((c) => c.name)
          saved.parserVersion = PARSER_VERSION
          saveState(saved)
        }
        if (cancelled) return
        for (const c of saved.communities) for (const g of c.groups) enrichEvents(g.events)
        setState(saved)
        setBooting(null)
        return
      }
      setBooting('Importing the bundled sample exports…')
      const fresh = emptyState()
      for (const path of SAMPLES) {
        try {
          const res = await fetch(`${import.meta.env.BASE_URL || '/'}${path}`)
          if (!res.ok) continue
          const buffer = await res.arrayBuffer()
          const name = path.split('/').pop()
          const detected = await detectAndParse({ name, buffer })
          if (detected.source) applyImport(fresh, { fileName: name, size: buffer.byteLength, community: null, ...detected })
        } catch (e) {
          console.warn('sample import failed', path, e)
        }
      }
      fresh.seeded = true
      for (const c of fresh.communities) for (const g of c.groups) enrichEvents(g.events)
      if (cancelled) return
      setState(fresh)
      setBooting(null)
      saveState(fresh)
      if (fresh.communities.length) toast('Loaded the three sample exports. Use “Add data” to bring in your own.', 'good', true)
    })()
    return () => { cancelled = true }
  }, [toast])

  /* ── the community (or the fold of all of them) this view is scoped to ── */
  const community = useMemo(() => {
    if (!state?.communities.length) return null
    if (scope === ALL) return aggregateCommunities(state.communities)
    return state.communities.find((c) => c.id === scope) || aggregateCommunities(state.communities)
  }, [state, scope])

  const extent = useMemo(() => (community ? communityExtent(community) : null), [community])

  /* settle the date range once we know how far the data actually goes */
  useEffect(() => {
    if (!extent || rangeInit.current) return
    rangeInit.current = true
    setRange((r) => ({ ...r, range: resolveRange(r.preset, extent.from, extent.to) }))
  }, [extent])

  /* a group filter from one community is meaningless in another */
  useEffect(() => { setGroupFilter([]) }, [scope])

  /* persist (debounced — the state holds tens of thousands of events) */
  const saveTimer = useRef(null)
  useEffect(() => {
    if (!state) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveState(state), 600)
    return () => clearTimeout(saveTimer.current)
  }, [state])

  /* ── derived dataset for the current scope + window ─────────────────── */
  const data = useMemo(() => {
    if (!community) return null
    return {
      community,
      isAggregate: !!community.isAggregate,
      events: eventsFor(community, groupFilter),
      allGroups: community.groups.map((g) => g.group),
      ga: mergeGA(community.gaSnapshots, range.range),
      shortio: mergeShortIo(community.shortioSnapshots, range.range),
      leads: community.leads,
    }
  }, [community, groupFilter, range.range])

  /* ── imports ────────────────────────────────────────────────────────── */
  const onImport = (items) => {
    setState((prev) => {
      const next = structuredClone(prev)
      const messages = []
      for (const item of items) messages.push(applyImport(next, item))
      for (const c of next.communities) for (const g of c.groups) enrichEvents(g.events)
      toast(messages.join(' · '), 'good', true)
      return next
    })
    setUploadTab(null)
    rangeInit.current = false
  }

  /* ── communities: create, rename, delete ─────────────────────────────
     A shallow copy is enough — these touch names, the community list and
     the history records, never the event arrays, which stay shared. The
     result comes back synchronously so the dialog can show a refusal. */
  const editCommunities = (fn) => {
    const next = {
      ...state,
      communities: state.communities.map((c) => ({ ...c })),
      imports: state.imports.map((i) => ({ ...i })),
      staleWhatsApp: state.staleWhatsApp ? [...state.staleWhatsApp] : state.staleWhatsApp,
    }
    const result = fn(next)
    if (!result.error) setState(next)
    return result
  }
  const onCreateCommunity = (name) => {
    const r = editCommunities((next) => createCommunity(next, name))
    if (!r.error) toast(`Created “${r.community.name}”.`, 'good')
    return r
  }
  const onRenameCommunity = (id, name) => editCommunities((next) => renameCommunity(next, id, name))
  const onDeleteCommunity = (id) => {
    const r = editCommunities((next) => deleteCommunity(next, id))
    if (!r.error) {
      if (scope === id) setScope(ALL)
      toast(`Deleted “${r.removed.name}”.`, 'good')
    }
    return r
  }

  /* ── render ─────────────────────────────────────────────────────────── */
  if (booting || !state) {
    return (
      <div className="shell">
        <div className="page" style={{ paddingTop: 80 }}>
          <div className="glass empty">
            <span className="spinner" style={{ width: 26, height: 26 }} />
            <h2>{booting || 'Starting…'}</h2>
            <p className="sub">Parsing chat transcripts, analytics snapshots and click data.</p>
          </div>
        </div>
      </div>
    )
  }

  const prev = previousRange(range.range)
  const shared = { data, range: range.range, prevRange: prev, compare: range.compare, toast, state }
  const many = state.communities.length > 1

  return (
    <div className="shell">
      <div className="chrome">
      <header className="masthead">
        <h1 className="logo">Aspirants Community Dashboard</h1>

        {community && (
          <div className="ctabs" role="tablist" aria-label="Community">
            <button role="tab" aria-selected={scope === ALL}
                    className={`ctab${scope === ALL ? ' active' : ''}`}
                    onClick={() => setScope(ALL)}
                    title={many ? 'Every community rolled up' : 'All data'}>
              Overview
              {many && <span className="n">{state.communities.length}</span>}
            </button>
            {state.communities.length > 0 && <span className="ctab-div" aria-hidden />}
            {state.communities.map((c) => (
              <button key={c.id} role="tab" aria-selected={scope === c.id}
                      className={`ctab${scope === c.id ? ' active' : ''}`}
                      onClick={() => setScope(c.id)}>
                {c.name}
                <span className="n">{c.groups.length}</span>
              </button>
            ))}
          </div>
        )}

        <span className="spacer" />
        <button className="btn primary" onClick={() => setUploadTab('upload')}>
          <span aria-hidden>＋</span> Add data
        </button>
      </header>

      {community && (
        <nav className="subbar">
          <div className="stabs" role="tablist" aria-label="Section">
            {SECTIONS.map((s) => (
              <button key={s.key} role="tab" aria-selected={section === s.key}
                      className={`stab${section === s.key ? ' active' : ''}`}
                      onClick={() => setSection(s.key)} title={s.label}>
                <span>{s.label}</span>
                {s.key === 'groups' && <span className="count">{community.groups.length}</span>}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <div className="controls">
            {community.groups.length > 1 && (
              <GroupFilter groups={community.groups} value={groupFilter} onChange={setGroupFilter} />
            )}
            <DateRangePicker value={range} onChange={setRange} extent={extent} />
          </div>
        </nav>
      )}
      </div>

      {state.staleWhatsApp?.length > 0 && (
        <div style={{ padding: '14px 26px 0' }}>
          <div className="alert warn" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 260 }}>
              <b>{state.staleWhatsApp.join(', ')}</b> {state.staleWhatsApp.length === 1 ? 'was' : 'were'} read with an
              earlier version of the parser, so join sources show as “Not stated” and a few join and exit counts are
              slightly off. Re-upload the WhatsApp export — it will replace the old data rather than add to it.
            </span>
            <button className="btn tiny" onClick={() => setUploadTab('upload')}>Re-upload</button>
          </div>
        </div>
      )}

      {!community ? (
        <div className="page">
          <Empty icon="📥" title="No data yet"
                 sub="Upload a WhatsApp community export, a GA snapshot or a short.io workbook — the tool works out which is which from the file itself."
                 action={<button className="btn primary big" onClick={() => setUploadTab('upload')}>Add data</button>} />
        </div>
      ) : (
        <div className="page">
          <ErrorBoundary resetKey={`${section}|${scope}|${range.range.from}|${range.range.to}`}>
            {section === 'overview' && <Overview {...shared} onNavigate={setSection} onAddData={() => setUploadTab('upload')} onScope={setScope} />}
            {section === 'members' && <MemberGrowth {...shared} />}
            {section === 'conversations' && <Conversations {...shared} />}
            {section === 'groups' && <Groups {...shared} groupFilter={groupFilter} onGroupFilter={setGroupFilter} />}
          </ErrorBoundary>
        </div>
      )}

      {uploadTab && (
        <UploadModal state={state} initialTab={uploadTab} onClose={() => setUploadTab(null)}
                     currentCommunityId={scope === ALL ? null : scope}
                     onReset={async () => { await clearState(); location.reload() }}
                     onImport={onImport}
                     onCreateCommunity={onCreateCommunity}
                     onRenameCommunity={onRenameCommunity}
                     onDeleteCommunity={onDeleteCommunity} />
      )}
      <Toasts items={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  )
}

/* ── apply one detected file to the state, returning a human summary ──── */
function applyImport(state, item) {
  // an upload names its community by id; the first-run samples only by name
  const c = resolveCommunity(state, { communityId: item.communityId, name: item.payload?.communityName })
  const at = new Date().toISOString()
  let summary = ''

  if (item.source === 'whatsapp') {
    // Events from an older parser don't share fingerprints with fresh ones, so
    // merging would double-count; a stale community is replaced outright.
    const wasStale = (state.staleWhatsApp || []).includes(c.name)
    if (wasStale) {
      c.groups = []
      state.staleWhatsApp = state.staleWhatsApp.filter((n) => n !== c.name)
    }
    const s = mergeWhatsApp(c, item.payload.groups)
    summary = `${s.groupsAdded + s.groupsUpdated} group(s), ${s.eventsAdded.toLocaleString()} new events` +
      (s.duplicates ? `, ${s.duplicates.toLocaleString()} duplicates skipped` : '') +
      (wasStale ? ' — replaced data read by the earlier parser' : '')
  } else if (item.source === 'ga') {
    const how = addSnapshot(c.gaSnapshots, { ...item.payload, importedAt: at })
    summary = `GA snapshot ${how} (${fmtLong(item.payload.range.from)} → ${fmtLong(item.payload.range.to)})`
  } else if (item.source === 'shortio') {
    const how = addSnapshot(c.shortioSnapshots, { ...item.payload, importedAt: at })
    summary = `short.io snapshot ${how} (${item.payload.totals.clicks.toLocaleString()} clicks)`
  } else if (item.source === 'leads') {
    c.leads = {
      leads: item.payload.leads, mapping: item.payload.mapping, header: item.payload.header,
      sheet: item.payload.sheet, updatedAt: at, rowCount: item.payload.rows?.length ?? item.payload.leads.length,
      origin: 'upload', fileName: item.fileName,
    }
    summary = `${item.payload.leads.length.toLocaleString()} leads loaded`
  }

  state.imports.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at, fileName: item.fileName, source: item.source, communityId: c.id, communityName: c.name,
    confidence: item.confidence, evidence: item.evidence, summary,
  })
  return `${SOURCES[item.source]?.label || item.source}: ${summary}`
}

/* ── group multi-select ─────────────────────────────────────────────── */
function GroupFilter({ groups, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [])
  const label = !value.length ? `All ${groups.length} groups` : value.length === 1 ? value[0] : `${value.length} groups`
  return (
    <div className="pop-anchor" ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}
              aria-label={`Filter groups — currently ${label}`} title="Filter which country groups are included">
        <span aria-hidden>🌍</span><span>{label}</span>
        <span aria-hidden style={{ opacity: 0.5, fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div className="pop" style={{ width: 280 }} role="dialog" aria-label="Filter groups">
          <button className={`opt${!value.length ? ' active' : ''}`} onClick={() => onChange([])}>All groups</button>
          <hr />
          {groups.map((g) => {
            const on = value.includes(g.group)
            return (
              <button key={g.group} className={`opt${on ? ' active' : ''}`}
                      onClick={() => onChange(on ? value.filter((x) => x !== g.group) : [...value, g.group])}>
                <span aria-hidden>{on ? '☑' : '☐'}</span>{g.group}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
