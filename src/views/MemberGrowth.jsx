import { useMemo, useState } from 'react'
import { memberSeries, memberByGroup, acquisitionSources, delta } from '../lib/metrics.js'
import { fmtFull, fmtNum } from '../lib/format.js'
import { fmtLong } from '../lib/dates.js'
import TrendChart from '../components/TrendChart.jsx'
import MetricTiles from '../components/MetricTiles.jsx'
import DataTable from '../components/DataTable.jsx'
import { Card, ChartLegend } from '../components/ui.jsx'
import AcquisitionTiles from '../components/AcquisitionTiles.jsx'

/* Search-Console pattern: the tiles are the metric picker for one shared
   chart. Below it the page answers, in order, the questions the chart raises
   — which channels brought people in, which groups they landed in, and what
   the shape of the period was. */
const METRICS = [
  { key: 'members', label: 'Total members', color: 'var(--s1)', pick: (d) => d.members, hint: 'Running membership at the end of each day' },
  { key: 'joined', label: 'New joins', color: 'var(--s4)', pick: (d) => d.joined },
  { key: 'left', label: 'Members left', color: 'var(--s2)', pick: (d) => d.left, invert: true },
  { key: 'net', label: 'Net change', color: 'var(--s5)', pick: (d) => d.net },
  { key: 'requests', label: 'Join requests', color: 'var(--s3)', pick: (d) => d.requests, hint: 'Requests to join raised in the group' },
]

export default function MemberGrowth({ data, range, prevRange, compare }) {
  const [selected, setSelected] = useState(['members', 'joined', 'left'])

  const cur = useMemo(() => memberSeries(data.events, range), [data.events, range])
  const prev = useMemo(() => memberSeries(data.events, prevRange), [data.events, prevRange])
  const byGroup = useMemo(() => memberByGroup(data.community, { ...range, groups: [] }), [data.community, range])

  const acquisition = useMemo(
    () => acquisitionSources(data.ga, data.shortio, range, prevRange),
    [data.ga, data.shortio, range, prevRange]
  )

  const totalsOf = (t, key) => (key === 'members' ? t.members : key === 'net' ? t.net : t[key])

  const tiles = METRICS.map((m) => ({
    key: m.key, label: m.label, color: m.color, invert: m.invert, hint: m.hint,
    value: totalsOf(cur.totals, m.key),
    delta: compare ? delta(totalsOf(cur.totals, m.key), totalsOf(prev.totals, m.key)) : undefined,
    foot: compare ? `vs ${fmtFull(totalsOf(prev.totals, m.key))}` : undefined,
  }))

  const series = METRICS.filter((m) => selected.includes(m.key)).map((m) => ({
    key: m.key, label: m.label, color: m.color,
    values: cur.series.map((d) => ({ date: d.date, value: m.pick(d) })),
    prev: compare ? prev.series.map((d) => ({ date: d.date, value: m.pick(d) })) : null,
  }))

  const toggle = (k) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))

  const netPositive = cur.series.filter((d) => d.net > 0).length
  const bestDay = [...cur.series].sort((a, b) => b.joined - a.joined)[0]
  const worstDay = [...cur.series].sort((a, b) => b.left - a.left)[0]

  /* slowest rolling 7 days of joining — where growth stalled */
  const quietest = useMemo(() => {
    const s = cur.series
    if (s.length < 7) return null
    let best = null
    for (let i = 0; i + 7 <= s.length; i++) {
      const n = s.slice(i, i + 7).reduce((a, d) => a + d.joined, 0)
      if (!best || n < best.n) best = { n, from: s[i].date }
    }
    return best
  }, [cur.series])

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Community</span>
          <h1>Member growth</h1>
          <p className="sub">
            Joins, exits and running membership, reconstructed from the membership notices in each group's transcript.
            {cur.baseline > 0 && <> {fmtFull(cur.baseline)} members were already in these groups before {fmtLong(range.from)}.</>}
          </p>
        </div>
      </div>

      <div>
        <MetricTiles metrics={tiles} selected={selected} onToggle={toggle} max={4} />
        <div className="chart-wrap">
          <TrendChart series={series} height={300} showArea={series.length === 1} />
          <ChartLegend series={series} compare={compare}
                       prevLabel={`Previous period (${fmtLong(prevRange.from)} – ${fmtLong(prevRange.to)})`} />
        </div>
      </div>

      <AcquisitionTiles tiles={acquisition} />

      <Card title="By group" sub="Same window, split by country group. Engagement is the share of members who posted at least once." pad={false}>
        <DataTable
          rows={byGroup}
          initialSort={{ key: 'members', dir: 'desc' }}
          columns={[
            { key: 'label', label: 'Group', sub: (r) => r.country },
            { key: 'members', label: 'Members', bar: true, color: 'var(--s1)' },
            { key: 'joined', label: 'Joined', bar: true, color: 'var(--s4)' },
            { key: 'left', label: 'Left', bar: true, color: 'var(--s2)' },
            { key: 'net', label: 'Net', render: (r) => <span style={{ color: r.net >= 0 ? 'var(--pos)' : 'var(--neg)', fontWeight: 700 }}>{r.net >= 0 ? '+' : '−'}{fmtFull(Math.abs(r.net))}</span> },
            { key: 'requests', label: 'Requests' },
            { key: 'churnRate', label: 'Churn', format: 'pct1' },
            { key: 'engagement', label: 'Engaged', format: 'pct' },
          ]}
        />
      </Card>

      <div className="grid-3">
        <Card title="Balance">
          <Row k="Started the range at" v={fmtFull(cur.baseline)} />
          <Row k="Joined" v={`+${fmtFull(cur.totals.joined)}`} tone="pos" />
          <Row k="Left" v={`−${fmtFull(cur.totals.left)}`} tone="neg" />
          <Row k="Ended at" v={fmtFull(cur.totals.members)} strong />
        </Card>
        <Card title="Quality of growth">
          <Row k="Churn rate" v={fmtNum(cur.totals.churnRate, 'pct1')} />
          <Row k="Retention" v={fmtNum(cur.totals.retention, 'pct1')} />
          <Row k="Days with net growth" v={`${netPositive} of ${cur.series.length}`} />
          <Row k="Avg joins / day" v={fmtNum(cur.totals.joined / Math.max(1, cur.series.length), 'dec')} />
        </Card>
        <Card title="Notable days">
          <Row k="Biggest join day" v={bestDay?.joined ? `${fmtFull(bestDay.joined)} · ${fmtLong(bestDay.date)}` : '—'} />
          <Row k="Biggest exit day" v={worstDay?.left ? `${fmtFull(worstDay.left)} · ${fmtLong(worstDay.date)}` : '—'} />
          <Row k="Join requests logged" v={fmtFull(cur.totals.requests)} />
          <Row k="Quietest week" v={quietest ? `${fmtFull(quietest.n)} joins · from ${fmtLong(quietest.from)}` : '—'} />
        </Card>
      </div>
    </>
  )
}

function Row({ k, v, tone, strong }) {
  return (
    <div className="stat-row">
      <span className="k">{k}</span>
      <span className="v" style={{
        color: tone === 'pos' ? 'var(--pos)' : tone === 'neg' ? 'var(--neg)' : undefined,
        fontSize: strong ? 17 : undefined,
      }}>{v}</span>
    </div>
  )
}
