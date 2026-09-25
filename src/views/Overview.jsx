import { useMemo } from 'react'
import {
  memberSeries, topicsFor, responsiveness, attribution, byCommunity,
  joinSources, leaveReasons, dailyByCommunity, acquisitionSources, groupActivity, delta,
} from '../lib/metrics.js'
import { fmtFull, fmtNum, sentimentLabel, sentimentColor } from '../lib/format.js'
import { fmtLong } from '../lib/dates.js'
import TrendChart from '../components/TrendChart.jsx'
import BarList from '../components/BarList.jsx'
import DataTable from '../components/DataTable.jsx'
import { Card, Delta, Sparkline } from '../components/ui.jsx'
import SourceSplit from '../components/SourceSplit.jsx'
import AcquisitionTiles from '../components/AcquisitionTiles.jsx'

/* The Overview answers different questions depending on where you are.
   Across communities it is a roll-up: how many members, where they came from,
   which community is alive. Inside a community it is the group breakdown:
   which country groups carry the activity and what they are talking about. */
export default function Overview({ data, state, range, prevRange, compare, onNavigate, onAddData, onScope }) {
  const rollup = data.isAggregate && (data.community.memberCommunities?.length ?? 1) > 1

  const m = useMemo(() => ({
    cur: memberSeries(data.events, range),
    prev: memberSeries(data.events, prevRange),
  }), [data.events, range, prevRange])


  const sources = useMemo(() => joinSources(data.events, range), [data.events, range])
  const prevSources = useMemo(() => joinSources(data.events, prevRange), [data.events, prevRange])
  const exits = useMemo(() => leaveReasons(data.events, range), [data.events, range])
  const prevExits = useMemo(() => leaveReasons(data.events, prevRange), [data.events, prevRange])
  const attrib = useMemo(() => attribution(data.ga, data.shortio, range), [data.ga, data.shortio, range])
  const acquisition = useMemo(
    () => acquisitionSources(data.ga, data.shortio, range, prevRange),
    [data.ga, data.shortio, range, prevRange]
  )

  const headline = [
    { label: 'Total members', value: m.cur.totals.members, prev: m.prev.totals.members, hint: 'Membership at the end of the range' },
    { label: 'New joins', value: m.cur.totals.joined, prev: m.prev.totals.joined },
    { label: 'Members left', value: m.cur.totals.left, prev: m.prev.totals.left, invert: true },
    { label: 'Net change', value: m.cur.totals.net, prev: m.prev.totals.net, signed: true },
  ]

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">{rollup ? 'Overview' : 'Community'}</span>
          <h1>{data.community.name}</h1>
          <p className="sub">
            {rollup && <>{data.community.memberCommunities.length} communities · </>}
            {data.community.groups.length} country groups · {fmtLong(range.from)} – {fmtLong(range.to)}
            {compare && <> · compared with {fmtLong(prevRange.from)} – {fmtLong(prevRange.to)}</>}
          </p>
        </div>
      </div>

      {/* ── the four numbers, everywhere ───────────────────────────────── */}
      <div className="grid-4">
        {headline.map((h) => (
          <div className="glass card" key={h.label} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-2)' }}>{h.label}</span>
            <span style={{
              fontSize: 27, fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
              color: h.signed ? (h.value >= 0 ? 'var(--pos)' : 'var(--neg)') : undefined,
            }}>
              {h.signed && h.value >= 0 ? '+' : h.signed && h.value < 0 ? '−' : ''}
              {fmtFull(Math.abs(h.value))}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-3)' }}>
              {compare ? <><Delta value={delta(h.value, h.prev)} invert={h.invert} /><span>vs {fmtFull(h.prev)}</span></>
                       : <span>{h.hint || ''}</span>}
            </span>
          </div>
        ))}
      </div>

      <MemberSplit m={m} compare={compare}
                   split={<SourceSplit sources={sources} prevSources={prevSources}
                                       exits={exits} prevExits={prevExits} compare={compare} />} />

      <AcquisitionTiles tiles={acquisition} />

      <ConversationsByGroup data={data} range={range} onNavigate={onNavigate} />
      {/* only the Overview tab spans communities; inside one it would be a single line */}
      {data.isAggregate && <ConversationsByCommunity data={data} range={range} onNavigate={onNavigate} />}
      {rollup && <MembersByCommunity data={data} range={range} onScope={onScope} />}
      <GroupThemes data={data} range={range} />

      <Card title="What drove traffic to amber"
            sub={data.ga || data.shortio
              ? 'From Google Analytics and short.io — the step before a join, so these cannot be tied to individual members'
              : 'No attribution data imported yet'}
>
        {attrib.length ? (
          <>
            <BarList items={attrib.slice(0, 6).map((a) => ({ label: `${a.source} / ${a.medium}`, value: a.users || a.sessions || a.clicks }))} unit="users" />
            {attrib.untagged?.clicks > 0 && (
              <p className="muted" style={{ marginTop: 10 }}>
                Plus {fmtFull(attrib.untagged.clicks)} short-link clicks with no utm_source — unattributable to any group or campaign.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="sub">Import a GA snapshot or a short.io workbook to see which channels feed the community.</p>
            <button className="btn tiny" style={{ marginTop: 10 }} onClick={onAddData}>Add data</button>
          </>
        )}
      </Card>
    </>
  )
}

/* ── member split: the trend, beside where joins came from and exits went ── */
function MemberSplit({ m, compare, split }) {
  const series = [
    { key: 'members', label: 'Total members', color: 'var(--s1)',
      values: m.cur.series.map((d) => ({ date: d.date, value: d.members })),
      prev: compare ? m.prev.series.map((d) => ({ date: d.date, value: d.members })) : null },
    { key: 'joined', label: 'New joins', color: 'var(--s4)',
      values: m.cur.series.map((d) => ({ date: d.date, value: d.joined })),
      prev: compare ? m.prev.series.map((d) => ({ date: d.date, value: d.joined })) : null },
    { key: 'left', label: 'Members left', color: 'var(--s2)',
      values: m.cur.series.map((d) => ({ date: d.date, value: d.left })),
      prev: compare ? m.prev.series.map((d) => ({ date: d.date, value: d.left })) : null },
  ]

  return (
    <div className="split">
      <Card title="Members"
            sub={`${fmtFull(m.cur.baseline)} at the start, ${m.cur.totals.net >= 0 ? '+' : '−'}${fmtFull(Math.abs(m.cur.totals.net))} over the range, ${fmtFull(m.cur.totals.members)} now`}
            pad={false}>
        <div style={{ padding: '10px 8px 4px' }}>
          <TrendChart series={series} height={236} showArea={false} />
          <div className="legend">
            {series.map((s) => <span className="legend-item" key={s.key}><i className="sw" style={{ background: s.color }} />{s.label}</span>)}
            {compare && <span className="legend-item" style={{ color: 'var(--text-3)' }}><i className="sw dash" style={{ color: 'var(--text-3)' }} />Previous period</span>}
            <span className="legend-item" style={{ color: 'var(--text-3)' }}>each metric on its own scale; axis shows total members</span>
          </div>
        </div>
      </Card>
      {split}
    </div>
  )
}

/* ── daily conversations, one line per country group ─────────────────────── */
function ConversationsByGroup({ data, range, onNavigate }) {
  const rows = useMemo(() => groupActivity(data.community, range), [data.community, range])
  const busiest = rows[0]
  const quietest = rows[rows.length - 1]
  const series = rows.map((g, i) => ({
    key: g.key, label: g.label, color: `var(--s${(i % 10) + 1})`,
    values: g.series.map((x) => ({ date: x.date, value: x.messages })),
  }))

  return (
    <Card title="Daily conversations by country group"
          sub={busiest && quietest && busiest !== quietest
            ? `${busiest.label} carries the most at ${fmtFull(busiest.messages)} messages; ${quietest.label} the least at ${fmtFull(quietest.messages)}`
            : 'Messages per day in each country group'}
          right={<button className="btn tiny ghost" onClick={() => onNavigate('conversations')}>Conversations →</button>}
          pad={false}>
      <div style={{ padding: '12px 8px 4px' }}>
        {/* one metric across groups, so they must share a y-scale */}
        <TrendChart series={series} height={250} showArea={series.length === 1} shared />
        <div className="legend">
          {series.map((x) => <span className="legend-item" key={x.key}><i className="sw" style={{ background: x.color }} />{x.label}</span>)}
          {series.length > 1 && <span className="legend-item" style={{ color: 'var(--text-3)' }}>all groups on one shared scale</span>}
        </div>
      </div>
    </Card>
  )
}

/* ── daily conversations, one line per community ─────────────────────────── */
function ConversationsByCommunity({ data, range, onNavigate }) {
  const daily = useMemo(() => dailyByCommunity(data.community.memberCommunities, range), [data.community, range])
  const series = daily.map((d, i) => ({
    key: d.id, label: d.label, color: `var(--s${(i % 10) + 1})`,
    values: d.series.map((x) => ({ date: x.date, value: x.messages })),
  }))
  const busiest = [...daily].sort((a, b) => b.totals.messages - a.totals.messages)[0]

  return (
    <Card title="Daily conversations by community"
          sub={daily.length > 1 && busiest
            ? `${busiest.label} carries the most at ${fmtFull(busiest.totals.messages)} messages`
            : 'Messages per day in each community'}
          pad={false}>
      <div style={{ padding: '12px 8px 4px' }}>
        {/* one metric across communities, so they share a y-scale too */}
        <TrendChart series={series} height={250} showArea={series.length === 1} shared />
        <div className="legend">
          {series.map((x) => <span className="legend-item" key={x.key}><i className="sw" style={{ background: x.color }} />{x.label}</span>)}
          {series.length > 1 && <span className="legend-item" style={{ color: 'var(--text-3)' }}>all communities on one shared scale</span>}
        </div>
      </div>
      <div style={{ padding: '0 18px 16px' }}>
        <div className="grid-3" style={{ gap: 12 }}>
          {daily.map((d) => (
            <div className="glass-inner" key={d.id} style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{d.label}</div>
              <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
                <Mini k="Messages" v={fmtFull(d.totals.messages)} />
                <Mini k="Per active day" v={fmtNum(d.totals.msgsPerDay, 'dec')} />
                <Mini k="Contributors" v={fmtFull(d.totals.contributors)} />
                <Mini k="Tone" v={`${d.totals.sentiment > 0 ? '+' : ''}${d.totals.sentiment.toFixed(2)}`} tone={sentimentColor(d.totals.sentiment)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

/* ── members per community — only when there is more than one ───────────── */
function MembersByCommunity({ data, range, onScope }) {
  const rows = useMemo(() => byCommunity(data.community.memberCommunities, range), [data.community, range])
  return (
    <Card title="Members by community" sub="Click a row to open that community's own tab." pad={false}>
      <DataTable
        rows={rows}
        initialSort={{ key: 'members', dir: 'desc' }}
        rowKey={(r) => r.id}
        onRowClick={(r) => onScope?.(r.id)}
        columns={[
          { key: 'label', label: 'Community', sub: (r) => `${r.groups} country groups` },
          { key: 'members', label: 'Members', bar: true, color: 'var(--s1)' },
          { key: 'joined', label: 'New joins', bar: true, color: 'var(--s4)' },
          { key: 'left', label: 'Left', bar: true, color: 'var(--s2)' },
          { key: 'net', label: 'Net', render: (r) => (
            <span style={{ color: r.net >= 0 ? 'var(--pos)' : 'var(--neg)', fontWeight: 700 }}>
              {r.net >= 0 ? '+' : '−'}{fmtFull(Math.abs(r.net))}
            </span>
          ) },
          { key: 'churnRate', label: 'Churn', format: 'pct1' },
          { key: 'messages', label: 'Messages', bar: true, color: 'var(--s3)' },
          { key: 'contributors', label: 'Contributors' },
        ]}
      />
    </Card>
  )
}

/* ── a card per country group: movement, responsiveness, and its themes ─── */
function GroupThemes({ data, range }) {
  const cards = useMemo(() => {
    const byKey = new Map(data.community.groups.map((g) => [g.group, g]))
    return groupActivity(data.community, range).map((row) => {
      const g = byKey.get(row.key)
      return {
        ...row,
        topics: topicsFor(g.events, range).topics.slice(0, 4),
        resp: responsiveness(g.events, range),
      }
    })
  }, [data.community, range])

  return (
    <div className="grid-2">
      {cards.map((g) => (
        <Card key={g.key} title={g.label}
              sub={`${fmtFull(g.messages)} messages from ${fmtFull(g.contributors)} people · ${sentimentLabel(g.sentiment)}`}>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>
            <Mini k="Members" v={fmtFull(g.members)} />
            <Mini k="Joined" v={`+${fmtFull(g.joined)}`} tone="var(--pos)" />
            <Mini k="Left" v={`−${fmtFull(g.left)}`} tone="var(--neg)" />
            <Mini k="Questions" v={fmtFull(g.questions)} />
            <Mini k="Answered" v={fmtNum(g.resp.answerRate, 'pct')} />
            <Mini k="Median reply" v={fmtNum(g.resp.medianMinutes, 'min')} />
          </div>
          <Sparkline values={g.series.map((d) => d.messages)} w={280} h={36} color="var(--s3)" />
          <p className="muted" style={{ marginTop: 2 }}>Daily message volume</p>

          <h3 style={{ margin: '14px 0 8px' }}>What this group talks about</h3>
          {g.topics.length ? (
            <BarList items={g.topics.map((t) => ({ label: t.label, value: t.messages, color: t.color }))}
                     limit={4} unit="msgs" showPct={false} />
          ) : <p className="muted">Not enough conversation in this range to rank themes.</p>}
        </Card>
      ))}
    </div>
  )
}

function Mini({ k, v, tone }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11 }}>{k}</div>
      <div style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: tone }}>{v}</div>
    </div>
  )
}
