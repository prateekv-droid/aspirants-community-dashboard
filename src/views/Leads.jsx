import { useMemo, useState } from 'react'
import { leadSeries, leadBreakdown, delta } from '../lib/metrics.js'
import { LEAD_FIELDS } from '../lib/parseLeads.js'
import { nextRunLabel } from '../lib/sync.js'
import { fmtFull, fmtNum, maskIdentity } from '../lib/format.js'
import { fmtLong } from '../lib/dates.js'
import TrendChart from '../components/TrendChart.jsx'
import DataTable from '../components/DataTable.jsx'
import BarList from '../components/BarList.jsx'
import { Card, Empty } from '../components/ui.jsx'

export default function Leads({ data, state, range, prevRange, compare, onConfigureSync, onSync, syncBusy }) {
  const [tab, setTab] = useState('records')
  const leads = data.leads
  const records = leads?.leads || []

  /* Every hook runs before the empty-state return — leads arriving mid-session
     must not change the hook order. */
  const cur = useMemo(() => leadSeries(records, range), [records, range])
  const prev = useMemo(() => leadSeries(records, prevRange), [records, prevRange])

  const mappedFields = useMemo(
    () => Object.values(leads?.mapping || {}).filter(Boolean),
    [leads]
  )

  const dims = useMemo(() => (
    ['country', 'source', 'medium', 'campaign', 'stage', 'university', 'intake', 'city', 'owner', 'community']
      .filter((f) => mappedFields.includes(f))
      .map((f) => ({ field: f, label: LEAD_FIELDS.find((x) => x.key === f)?.label || f, items: leadBreakdown(records, range, f) }))
  ), [records, range, mappedFields])

  const inRange = useMemo(
    () => records.filter((l) => !l.date || (l.date >= range.from && l.date <= range.to)),
    [records, range]
  )

  if (!leads) {
    return (
      <Empty icon="🎯" title="No leads connected yet"
             sub={`Leads come from a spreadsheet the team keeps updated. Point the dashboard at its URL once and it re-reads it on a schedule — or drop the file in directly.${
               state.sync?.url && state.sync.communityName !== data.community.name
                 ? ` The existing sync feeds “${state.sync.communityName}”, not this community.`
                 : ''
             }`}
             action={<button className="btn primary big" onClick={onConfigureSync}>Configure leads sync</button>} />
    )
  }

  const cols = [
    mappedFields.includes('name') && { key: 'name', label: 'Name' },
    mappedFields.includes('phone') && { key: 'phone', label: 'Phone', render: (r) => maskIdentity(r.phone) },
    mappedFields.includes('email') && { key: 'email', label: 'Email', render: (r) => r.email ? r.email.replace(/^(.{2}).*(@.*)$/, '$1•••$2') : '—' },
    mappedFields.includes('country') && { key: 'country', label: 'Destination' },
    mappedFields.includes('city') && { key: 'city', label: 'City' },
    mappedFields.includes('source') && { key: 'source', label: 'Source' },
    mappedFields.includes('campaign') && { key: 'campaign', label: 'Campaign' },
    mappedFields.includes('stage') && { key: 'stage', label: 'Stage' },
    mappedFields.includes('date') && { key: 'date', label: 'Created', render: (r) => r.date ? fmtLong(r.date) : <span className="muted">no date</span> },
  ].filter(Boolean)

  // the sync feeds one named community; in another community's tab it is
  // configuration that exists but does not apply here
  const sync = state.sync?.url && (data.isAggregate || state.sync.communityName === data.community.name)
    ? state.sync
    : null

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Acquisition</span>
          <h1>Leads</h1>
          <p className="sub">
            {fmtFull(records.length)} records from {leads.origin === 'sync' ? 'the synced sheet' : leads.fileName || 'an uploaded sheet'}
            {leads.sheet ? ` · tab “${leads.sheet}”` : ''} · last read {leads.updatedAt ? new Date(leads.updatedAt).toLocaleString() : 'unknown'}.
          </p>
        </div>
        <span className="spacer" style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onSync} disabled={!sync?.url || syncBusy}>
            {syncBusy ? <><span className="spinner" />Syncing…</> : '↻ Sync now'}
          </button>
          <button className="btn ghost" onClick={onConfigureSync}>Sync settings</button>
        </div>
      </div>

      {sync?.url ? (
        <div className={`alert ${sync.lastError ? 'bad' : 'good'}`}>
          {sync.lastError
            ? <><b>Last sync failed.</b> {sync.lastError}</>
            : <><b>Syncing.</b> {sync.lastStatus || 'Configured'} · last run {sync.lastRun ? new Date(sync.lastRun).toLocaleString() : 'never'} · next {nextRunLabel(sync)}.</>}
        </div>
      ) : (
        <div className="alert warn">
          These leads were uploaded as a file, so they will go stale. <b>Configure a sync</b> to have the dashboard re-read the sheet automatically.
        </div>
      )}

      <div className="grid-3" style={{ gap: 14 }}>
        <div className="glass card">
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-2)' }}>Leads in range</span>
          <div style={{ fontSize: 27, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtFull(cur.total)}</div>
          {compare && <div className="muted">vs {fmtFull(prev.total)} previous period</div>}
        </div>
        <div className="glass card">
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-2)' }}>Total stored</span>
          <div style={{ fontSize: 27, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtFull(records.length)}</div>
          <div className="muted">{cur.undated ? `${fmtFull(cur.undated)} have no date` : 'all dated'}</div>
        </div>
        <div className="glass card">
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-2)' }}>Columns mapped</span>
          <div style={{ fontSize: 27, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{mappedFields.length}<span className="muted" style={{ fontSize: 15 }}> / {leads.header?.length ?? '—'}</span></div>
          <div className="muted">unmapped columns are kept on each record</div>
        </div>
      </div>

      {mappedFields.includes('date') ? (
        <Card title="Leads over time" pad={false}>
          <div style={{ padding: '12px 8px 4px' }}>
            <TrendChart height={240}
              series={[{
                key: 'leads', label: 'Leads', color: 'var(--s5)',
                values: cur.series.map((d) => ({ date: d.date, value: d.leads })),
                prev: compare ? prev.series.map((d) => ({ date: d.date, value: d.leads })) : null,
              }]} />
          </div>
        </Card>
      ) : (
        <div className="alert warn">No date column was recognised in this sheet, so leads cannot be plotted over time. Rename the column to “Created at” (or map it in the sync settings) to enable the trend.</div>
      )}

      {dims.length > 0 && (
        <div className="grid-3">
          {dims.slice(0, 6).map((d, i) => (
            <Card key={d.field} title={d.label} sub={`${d.items.length} distinct values`}>
              <BarList items={d.items} limit={7} color={`var(--s${(i % 10) + 1})`} unit="leads" />
            </Card>
          ))}
        </div>
      )}

      <section className="glass">
        <div className="tabs">
          <button className={`tab${tab === 'records' ? ' active' : ''}`} onClick={() => setTab('records')}>Records<span className="n">{inRange.length}</span></button>
          <button className={`tab${tab === 'mapping' ? ' active' : ''}`} onClick={() => setTab('mapping')}>Column mapping</button>
        </div>

        {tab === 'records' && (
          <DataTable rows={inRange} columns={cols} pageSize={20}
                     initialSort={{ key: mappedFields.includes('date') ? 'date' : cols[0].key, dir: 'desc' }}
                     rowKey={(r, i) => `${r.id}-${i}`}
                     empty="No leads fall in this date range." />
        )}

        {tab === 'mapping' && (
          <div style={{ padding: '16px 18px 18px' }}>
            <p className="sub" style={{ marginBottom: 12 }}>
              Column names are matched to fields by name and by the shape of the values, so a sheet that renames
              “Phone” to “WhatsApp Number” still lands correctly. Unrecognised columns are preserved on each record.
            </p>
            <div className="table-scroll">
              <table className="data">
                <thead><tr><th>Sheet column</th><th>Mapped to</th><th>Example value</th></tr></thead>
                <tbody>
                  {(leads.header || []).map((h) => {
                    const f = leads.mapping?.[h]
                    const example = records.find((l) => (f ? l[f] : l.extra?.[h]))
                    return (
                      <tr key={h}>
                        <td><b>{h}</b></td>
                        <td>{f ? <span className="badge soft">{LEAD_FIELDS.find((x) => x.key === f)?.label || f}</span> : <span className="muted">kept as extra field</span>}</td>
                        <td className="muted">{String((f ? example?.[f] : example?.extra?.[h]) ?? '—').slice(0, 60)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </>
  )
}
