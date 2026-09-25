import { useMemo, useState } from 'react'
import { attribution, clip, scaleDimensions, chatLinks, delta, comparability } from '../lib/metrics.js'
import { splitSourceMedium } from '../lib/parseGA.js'
import { fmtFull, fmtNum } from '../lib/format.js'
import { fmtLong, eachDay } from '../lib/dates.js'
import TrendChart from '../components/TrendChart.jsx'
import MetricTiles from '../components/MetricTiles.jsx'
import DataTable from '../components/DataTable.jsx'
import BarList from '../components/BarList.jsx'
import { Card, Empty, EstimateNote, ChartLegend } from '../components/ui.jsx'

/* Attribution across three feeds that each know a different part of the
   journey: GA sees who arrived on the landing pages, short.io sees who
   clicked the links, and the chat transcripts themselves record the tagged
   links amber posted into the groups. */
export default function Sources({ data, range, prevRange, compare, toast }) {
  const [selected, setSelected] = useState(['gaUsers', 'clicks'])
  const [tab, setTab] = useState('source')

  const ga = data.ga
  const si = data.shortio

  const gaDaily = useMemo(() => clip(ga?.daily, range), [ga, range])
  const gaDailyPrev = useMemo(() => clip(ga?.daily, prevRange), [ga, prevRange])
  const siDaily = useMemo(() => clip(si?.daily, range), [si, range])
  const siDailyPrev = useMemo(() => clip(si?.daily, prevRange), [si, prevRange])

  const attrib = useMemo(() => attribution(ga, si, range), [ga, si, range])
  const links = useMemo(() => chatLinks(data.events, range), [data.events, range])

  const gaScaled = useMemo(() => {
    if (!ga) return null
    const dims = {
      firstUser: ga.blocks.firstUser?.items || [],
      sessions: ga.blocks.sessions?.items || [],
      cities: ga.blocks.cities?.items || [],
      pages: ga.blocks.pages?.items || [],
      countries: ga.blocks.countries?.items || [],
    }
    return scaleDimensions(dims, ga.daily?.map((d) => ({ date: d.date, value: (d.new || 0) + (d.returning || 0) })), range)
  }, [ga, range])

  const siScaled = useMemo(() => (si ? scaleDimensions(si.dims, si.daily, range) : null), [si, range])

  if (!ga && !si && !links.length) {
    return (
      <Empty icon="🔗" title="No attribution data yet"
             sub="Import a Google Analytics snapshot (attribution and audience) or a short.io workbook (link clicks and UTM breakdowns) from Add data." />
    )
  }

  /* one x-axis for both feeds */
  const days = eachDay(range.from, range.to)
  const byDate = (rows, pick) => {
    const m = new Map(rows.map((r) => [r.date, pick(r)]))
    return days.map((d) => ({ date: d, value: m.get(d) ?? 0 }))
  }
  const prevDays = eachDay(prevRange.from, prevRange.to)
  const byDatePrev = (rows, pick) => {
    const m = new Map(rows.map((r) => [r.date, pick(r)]))
    return prevDays.map((d) => ({ date: d, value: m.get(d) ?? 0 }))
  }

  const sum = (rows, pick) => rows.reduce((s, r) => s + pick(r), 0)
  const gaNew = (d) => d.new || 0
  const gaRet = (d) => d.returning || 0
  const gaAll = (d) => gaNew(d) + gaRet(d)
  const clicks = (d) => d.clicks || 0

  /* Each feed only knows its own export window, so a comparison that reaches
     outside it is not a comparison — suppress the delta and say why. */
  const gaCmp = comparability(ga?.range, prevRange)
  const siCmp = comparability(si?.range, prevRange)

  const available = [
    ga && { key: 'gaUsers', label: 'Daily active users', color: 'var(--s2)', cmp: gaCmp,
            cur: byDate(gaDaily, gaAll), prv: byDatePrev(gaDailyPrev, gaAll),
            total: sum(gaDaily, gaAll), prevTotal: sum(gaDailyPrev, gaAll),
            hint: 'New + returning users summed across days — the same person on two days counts twice. GA’s de-duplicated total is in the snapshot card below.' },
    ga && { key: 'gaNew', label: 'Daily new users', color: 'var(--s4)', cmp: gaCmp,
            cur: byDate(gaDaily, gaNew), prv: byDatePrev(gaDailyPrev, gaNew),
            total: sum(gaDaily, gaNew), prevTotal: sum(gaDailyPrev, gaNew) },
    si && { key: 'clicks', label: 'Short-link clicks', color: 'var(--s1)', cmp: siCmp,
            cur: byDate(siDaily, clicks), prv: byDatePrev(siDailyPrev, clicks),
            total: sum(siDaily, clicks), prevTotal: sum(siDailyPrev, clicks) },
    links.length && { key: 'posts', label: 'Tagged links posted', color: 'var(--s3)',
                      cur: days.map((d) => ({ date: d, value: 0 })), prv: null,
                      total: links.reduce((s, l) => s + (l.tagged ? l.posts : 0), 0), static: true },
  ].filter(Boolean)

  const tiles = available.map((a) => ({
    key: a.key, label: a.label, color: a.color, hint: a.hint,
    value: a.total,
    delta: compare && !a.static && a.cmp?.comparable ? delta(a.total, a.prevTotal) : undefined,
    foot: a.static
      ? 'in chat'
      : !compare
        ? undefined
        : a.cmp?.comparable
          ? `vs ${fmtFull(a.prevTotal)}`
          : `no data before ${fmtLong(a.key === 'clicks' ? si.range.from : ga.range.from)}`,
  }))

  const series = available
    .filter((a) => selected.includes(a.key) && !a.static)
    .map((a) => ({ key: a.key, label: a.label, color: a.color, values: a.cur, prev: compare && a.cmp?.coverage > 0 ? a.prv : null }))

  const utmTabs = [
    ['source', 'Source / medium', attrib.length],
    si && ['utm', 'UTM breakdown', Object.keys(si.dims).length],
    ['chat', 'Links posted in chat', links.length],
    ga && ['geo', 'Geography', gaScaled?.dims.cities?.length || 0],
    ga && ['pages', 'Landing pages', gaScaled?.dims.pages?.length || 0],
    si && ['tech', 'Devices', si.dims.os?.length || 0],
  ].filter(Boolean)

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Acquisition</span>
          <h1>UTM &amp; sources</h1>
          <p className="sub">
            {[ga && `GA snapshot ${fmtLong(ga.range.from)} → ${fmtLong(ga.range.to)}`,
              si && `short.io ${fmtLong(si.range.from)} → ${fmtLong(si.range.to)}`]
              .filter(Boolean).join(' · ')}
            {' — daily series are exact; pre-aggregated breakdowns are scaled to your window.'}
          </p>
          {compare && ((ga && !gaCmp.comparable) || (si && !siCmp.comparable)) && (
            <p className="muted" style={{ marginTop: 6 }}>
              The previous period reaches back before these exports begin, so period-over-period change is not shown
              for the affected feeds. Import an earlier snapshot to compare.
            </p>
          )}
        </div>
      </div>

      <div>
        <MetricTiles metrics={tiles} selected={selected} onToggle={(k) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))} max={4} />
        <div className="chart-wrap">
          <TrendChart series={series} height={290} showArea={series.length === 1} />
          <ChartLegend series={series} compare={compare} />
        </div>
      </div>

      <section className="glass">
        <div className="tabs">
          {utmTabs.map(([k, l, n]) => (
            <button key={k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
              {l}{n ? <span className="n">{n}</span> : null}
            </button>
          ))}
        </div>

        {tab === 'source' && (
          <>
            <DataTable
              rows={attrib}
              initialSort={{ key: 'total', dir: 'desc' }}
              rowKey={(r) => `${r.source}|${r.medium}`}
              columns={[
                { key: 'source', label: 'Source', render: (r) => <b>{r.source}</b> },
                { key: 'medium', label: 'Medium' },
                { key: 'users', label: 'GA users', bar: true, color: 'var(--s2)' },
                { key: 'sessions', label: 'GA sessions', bar: true, color: 'var(--s6)' },
                { key: 'clicks', label: 'Link clicks', bar: true, color: 'var(--s1)' },
                { key: 'campaigns', label: 'Campaigns', render: (r) => r.campaigns.length ? <span className="chips">{r.campaigns.map((c) => <span className="chip" key={c}>{c}</span>)}</span> : <span className="muted">—</span> },
                { key: 'from', label: 'Reported by', render: (r) => (
                  <span className="chips">{r.from.map((f) => <span className="chip" key={f}>{f === 'ga' ? 'GA' : 'short.io'}</span>)}</span>
                ) },
              ]}
            />
            <div style={{ padding: '0 18px 16px' }}>
              {attrib.untagged?.clicks > 0 && (
                <div className="alert warn" style={{ marginTop: 12 }}>
                  <b>{fmtFull(attrib.untagged.clicks)} short-link clicks carry no utm_source</b>, so they cannot be
                  placed against any source, group or campaign — that is {fmtNum(attrib.untagged.clicks / Math.max(1, attrib.untagged.clicks + attrib.reduce((s, r) => s + r.clicks, 0)), 'pct')} of
                  all clicks in this range. GA rows and short.io clicks are only joined where a <code>utm_source</code> names
                  the GA source unambiguously; short.io reports each UTM dimension separately, so combinations are never inferred.
                </div>
              )}
              <EstimateNote coverage={gaScaled?.coverage} source="Google Analytics" />
            </div>
          </>
        )}

        {tab === 'utm' && si && (
          <div style={{ padding: '16px 18px 18px' }} className="grid-2">
            {[
              ['utmSource', 'utm_source', 'var(--s1)'],
              ['utmMedium', 'utm_medium', 'var(--s2)'],
              ['utmCampaign', 'utm_campaign', 'var(--s4)'],
              ['utmContent', 'utm_content', 'var(--s5)'],
              ['links', 'Short links', 'var(--s3)'],
              ['referrers', 'Referrers', 'var(--s6)'],
            ].map(([key, label, color]) => (
              <div key={key}>
                <h3 style={{ marginBottom: 10 }}>{label}</h3>
                <BarList items={(siScaled.dims[key] || []).map((i) => ({ ...i, color }))} limit={7} unit="clicks" />
              </div>
            ))}
            <div style={{ gridColumn: '1 / -1' }}>
              <EstimateNote coverage={siScaled.coverage} source="short.io" />
              {(si.dims.utmSource || []).some((d) => d.label === '(not set)') && (
                <div className="alert warn" style={{ marginTop: 10 }}>
                  <b>Most clicks arrive untagged.</b> {fmtFull((siScaled.dims.utmSource || []).find((d) => d.label === '(not set)')?.value || 0)} clicks
                  carry no utm_source, so they cannot be attributed to a group or campaign. Tagging the links posted in
                  each country group — one <code>utm_content</code> per group — would close that gap.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'chat' && (
          <>
            <DataTable
              rows={links}
              initialSort={{ key: 'posts', dir: 'desc' }}
              rowKey={(r, i) => `${r.host}${r.path}${i}`}
              empty="No links were posted in the selected groups in this range."
              columns={[
                { key: 'host', label: 'Destination', render: (r) => <><b>{r.host}</b><span className="muted">{r.path}</span></> },
                { key: 'utm_source', label: 'utm_source', render: (r) => r.utm_source || <span className="muted">untagged</span> },
                { key: 'utm_medium', label: 'utm_medium', render: (r) => r.utm_medium || '—' },
                { key: 'utm_campaign', label: 'utm_campaign', render: (r) => r.utm_campaign || '—' },
                { key: 'posts', label: 'Times posted', bar: true },
                { key: 'groups', label: 'Groups' },
                { key: 'posters', label: 'Posters' },
              ]}
            />
            <div style={{ padding: '0 18px 16px' }}>
              <p className="muted">
                Read straight out of the transcripts, so it shows what was actually distributed into the groups —
                including links posted by members. Cross-check the tagged rows against the UTM breakdown to see which
                distribution actually converted.
              </p>
            </div>
          </>
        )}

        {tab === 'geo' && ga && (
          <div style={{ padding: '16px 18px 18px' }} className="grid-2">
            <div>
              <h3 style={{ marginBottom: 10 }}>Cities</h3>
              <BarList items={gaScaled.dims.cities || []} limit={12} unit="users" />
            </div>
            <div>
              <h3 style={{ marginBottom: 10 }}>Countries {!gaScaled.dims.countries?.length && <span className="badge quiet">from short.io</span>}</h3>
              <BarList items={(gaScaled.dims.countries?.length ? gaScaled.dims.countries : siScaled?.dims.countries) || []} limit={12} unit={gaScaled.dims.countries?.length ? 'users' : 'clicks'} color="var(--s2)" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}><EstimateNote coverage={gaScaled.coverage} source="Google Analytics" /></div>
          </div>
        )}

        {tab === 'pages' && ga && (
          <DataTable
            rows={(ga.blocks.pages?.items || []).map((p) => ({ ...p, label: p.label }))}
            initialSort={{ key: 'Views', dir: 'desc' }}
            columns={[
              { key: 'label', label: 'Page' },
              { key: 'Views', label: 'Views', bar: true },
              { key: 'Active users', label: 'Users', bar: true, color: 'var(--s2)' },
              { key: 'Event count', label: 'Events' },
              { key: 'Bounce rate', label: 'Bounce', format: 'pct1' },
            ]}
          />
        )}

        {tab === 'tech' && si && (
          <div style={{ padding: '16px 18px 18px' }} className="grid-3">
            <div><h3 style={{ marginBottom: 10 }}>Operating system</h3><BarList items={siScaled.dims.os || []} limit={6} unit="clicks" /></div>
            <div><h3 style={{ marginBottom: 10 }}>Browser</h3><BarList items={siScaled.dims.browser || []} limit={6} unit="clicks" color="var(--s2)" /></div>
            <div><h3 style={{ marginBottom: 10 }}>Social referrer</h3><BarList items={siScaled.dims.social || []} limit={6} unit="clicks" color="var(--s4)" /></div>
            <div style={{ gridColumn: '1 / -1' }}><EstimateNote coverage={siScaled.coverage} source="short.io" /></div>
          </div>
        )}
      </section>

      {ga?.blocks?.summary && (
        <Card title="GA snapshot totals" sub={`As reported by GA for ${fmtLong(ga.range.from)} → ${fmtLong(ga.range.to)}${ga.snapshots > 1 ? ` across ${ga.snapshots} snapshots` : ''}`}>
          <div className="chips">
            {Object.entries(ga.blocks.summary).filter(([k]) => k !== 'from' && k !== 'to').map(([k, v]) => (
              <span className="chip" key={k}>{k}: <b>{/average|rate|per /i.test(k) ? (k.includes('time') ? fmtNum(v, 'sec') : fmtNum(v, 'dec')) : fmtFull(v)}</b></span>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}
