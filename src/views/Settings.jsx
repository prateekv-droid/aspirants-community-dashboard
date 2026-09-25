import { SOURCES } from '../lib/detect.js'
import { nextRunLabel } from '../lib/sync.js'
import { fmtFull } from '../lib/format.js'
import { fmtLong } from '../lib/dates.js'
import { Card } from '../components/ui.jsx'

/* What is loaded, where it came from, and how fresh it is. */
export default function Settings({ data, state, onAddData, onConfigureSync, onSync, syncBusy, onReset }) {
  const c = data.community
  const syncFeedsThis = !!state.sync?.url &&
    (data.isAggregate || state.sync.communityName === c.name)
  const feeds = [
    {
      src: 'whatsapp',
      loaded: c.groups.length > 0,
      detail: c.groups.length
        ? `${c.groups.length} group transcripts · ${fmtFull(c.groups.reduce((s, g) => s + g.events.length, 0))} timeline events`
        : 'No transcripts imported',
      range: c.groups.length ? `${fmtLong(c.groups.reduce((a, g) => (a && a < g.first ? a : g.first), null))} → ${fmtLong(c.groups.reduce((a, g) => (a && a > g.last ? a : g.last), null))}` : null,
      how: 'Manual upload — export each group from WhatsApp, zip them together, drop the zip in.',
    },
    {
      src: 'ga',
      loaded: c.gaSnapshots.length > 0,
      detail: c.gaSnapshots.length ? `${c.gaSnapshots.length} snapshot(s) · ${c.gaSnapshots.at(-1).daily.length} days of user history` : 'No GA snapshot imported',
      range: c.gaSnapshots.length ? `${fmtLong(c.gaSnapshots[0].range.from)} → ${fmtLong(c.gaSnapshots.at(-1).range.to)}` : null,
      how: 'Manual upload — GA4 → Reports snapshot → share/download CSV.',
    },
    {
      src: 'shortio',
      loaded: c.shortioSnapshots.length > 0,
      detail: c.shortioSnapshots.length ? `${c.shortioSnapshots.length} workbook(s) · ${fmtFull(c.shortioSnapshots.reduce((s, x) => s + (x.totals.clicks || 0), 0))} clicks` : 'No click data imported',
      range: c.shortioSnapshots.length ? `${fmtLong(c.shortioSnapshots[0].range.from)} → ${fmtLong(c.shortioSnapshots.at(-1).range.to)}` : null,
      how: 'Manual upload — short.io → Statistics → Export to Excel.',
    },
    {
      src: 'leads',
      loaded: !!c.leads,
      detail: c.leads
        ? `${fmtFull(c.leads.leads.length)} records · read ${new Date(c.leads.updatedAt).toLocaleString()}`
        : 'No leads connected',
      range: null,
      // The sync targets one named community, so do not imply it feeds this one
      how: !syncFeedsThis
        ? (state.sync?.url
            ? `The configured sync feeds “${state.sync.communityName}”. Point a sync at this community to keep its leads current.`
            : 'Configure a sync so the tool pulls the latest sheet itself.')
        : `Synced from a URL · ${nextRunLabel(state.sync)}`,
      action: <button className="btn tiny" onClick={onConfigureSync}>{state.sync?.url ? 'Sync settings' : 'Configure sync'}</button>,
    },
  ]

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Manage</span>
          <h1>Data &amp; sources</h1>
          <p className="sub">
            Four feeds describe a community. Three are uploaded when you have a fresh export; the leads sheet
            keeps itself current. The source of every file is recognised from its structure, not its name.
            {data.isAggregate && (data.community.memberCommunities?.length ?? 1) > 1 && (
              <> These totals fold every community together — switch to a community tab to see just its own feeds.</>
            )}
          </p>
        </div>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn primary" onClick={onAddData}>＋ Add data</button>
      </div>

      <div className="grid-2">
        {feeds.map((f) => {
          const meta = SOURCES[f.src]
          return (
            <Card key={f.src} title={<>{meta.icon} {meta.label}</>}
                  badge={{ text: f.loaded ? 'loaded' : 'not loaded', tone: f.loaded ? 'good' : 'quiet' }}
                  right={f.action}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{f.detail}</p>
              {f.range && <p className="muted" style={{ marginTop: 4 }}>{f.range}</p>}
              <p className="sub" style={{ marginTop: 10 }}>{f.how}</p>
            </Card>
          )
        })}
      </div>

      <Card title="How each source is recognised"
            sub="Files are classified by structure so operators never have to label an upload.">
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Source</th><th>Signature the detector looks for</th><th>What it becomes</th></tr></thead>
            <tbody>
              <tr>
                <td><b>💬 WhatsApp</b></td>
                <td>A zip containing <code>_chat.txt</code>, or a zip of per-group zips named <code>WhatsApp Chat – …</code></td>
                <td>Per-group timelines: joins, exits, join requests, messages, media, and the links posted in chat</td>
              </tr>
              <tr>
                <td><b>📈 Google Analytics</b></td>
                <td>CSV whose comment lines carry <code>Reports snapshot</code>, <code>Property:</code> and per-block <code>Start date:</code></td>
                <td>Each report card matched by its header row — first-user source/medium, sessions, pages, cities, daily new vs returning</td>
              </tr>
              <tr>
                <td><b>🔗 short.io</b></td>
                <td>An <code>.xlsx</code> whose tabs include <code>General statistic</code>, <code>Click statistics</code> and the <code>UTM …</code> sheets</td>
                <td>Daily clicks plus every UTM, geo, device and top-link breakdown</td>
              </tr>
              <tr>
                <td><b>🎯 Leads</b></td>
                <td>Any flat table whose columns score against the lead field aliases and value shapes</td>
                <td>Lead records with an auto-built column mapping you can review</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Import history" sub={`${state.imports.length} import(s) recorded`} pad={false}>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>When</th><th>File / URL</th><th>Detected as</th><th>Confidence</th><th>Community</th><th>Result</th></tr></thead>
            <tbody>
              {[...state.imports].reverse().map((im) => (
                <tr key={im.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(im.at).toLocaleString()}</td>
                  <td style={{ wordBreak: 'break-all', maxWidth: 240 }}>{im.fileName}</td>
                  <td><span className="chip">{SOURCES[im.source]?.icon} {SOURCES[im.source]?.label || im.source}</span></td>
                  <td className="n">{im.confidence ? `${Math.round(im.confidence * 100)}%` : '—'}</td>
                  <td>{im.communityName}</td>
                  <td className="muted">{im.summary}</td>
                </tr>
              ))}
              {!state.imports.length && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-3)' }}>Nothing imported yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Storage & privacy"
            sub="Everything stays in this browser. The transcripts contain members' phone numbers, so nothing is uploaded anywhere.">
        <p className="sub">
          Data is held in this browser's IndexedDB under <code>amber-aspirants-dashboard</code>. Phone numbers are
          masked in every table and chart. The only network request the tool makes is the leads-sheet sync you
          configure yourself.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn" onClick={onSync} disabled={!state.sync?.url || syncBusy}
                  title={state.sync?.url ? `Re-reads the sheet configured for “${state.sync.communityName}”` : 'No sync configured'}>
            {syncBusy ? <><span className="spinner" />Syncing…</> : '↻ Sync leads now'}
          </button>
          <button className="btn danger ghost" onClick={() => {
            if (confirm('Delete every imported dataset from this browser and start over? This cannot be undone.')) onReset()
          }}>Clear all data</button>
        </div>
      </Card>
    </>
  )
}
