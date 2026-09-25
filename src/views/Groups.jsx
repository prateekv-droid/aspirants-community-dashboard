import { useMemo } from 'react'
import { memberSeries, conversationSeries, topicsFor, groupActivity } from '../lib/metrics.js'
import { shortLabel } from '../lib/parseWhatsApp.js'
import { fmtFull, fmtNum, sentimentColor } from '../lib/format.js'
import CountryGroupsTable from '../components/CountryGroupsTable.jsx'
import { fmtLong } from '../lib/dates.js'
import TrendChart from '../components/TrendChart.jsx'
import { Card, Sparkline } from '../components/ui.jsx'

/* Per-country comparison. The point of this page is ranking: which country
   group deserves the next campaign, and which is quietly bleeding members. */
export default function Groups({ data, range, prevRange, compare, groupFilter, onGroupFilter }) {
  const rows = useMemo(() => groupActivity(data.community, range), [data.community, range])

  const perGroup = useMemo(() => data.community.groups.map((g) => {
    const m = memberSeries(g.events, range)
    const c = conversationSeries(g.events, range)
    const t = topicsFor(g.events, range)
    return { group: g.rawGroup || g.group, country: g.country, community: g.communityName || null, m, c,
             topTopics: t.topics.slice(0, 3), media: g.media, first: g.first, last: g.last }
  }), [data.community, range])

  const totalMembers = rows.reduce((s, r) => s + r.members, 0)
  const stacked = data.community.groups.map((g, i) => ({
    key: g.group,
    label: g.communityName ? `${shortLabel(g.rawGroup || g.group)} · ${g.communityName}` : shortLabel(g.group),
    color: `var(--s${(i % 10) + 1})`,
    values: memberSeries(g.events, range).series.map((d) => ({ date: d.date, value: d.members })),
  }))

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Community</span>
          <h1>Groups</h1>
          <p className="sub">
            {data.community.groups.length} country groups
            {data.isAggregate && (data.community.memberCommunities?.length ?? 1) > 1 &&
              <> across {data.community.memberCommunities.length} communities</>},
            {' '}{fmtFull(totalMembers)} members between them. Click a row to filter every section to that group.
          </p>
        </div>
      </div>

      <Card title="Membership by group" sub="Running membership per country over the selected range" pad={false}>
        <div style={{ padding: '12px 8px 4px' }}>
          <TrendChart series={stacked} height={280} showArea={false} shared />
          <div className="legend">
            {stacked.map((s) => <span className="legend-item" key={s.key}><i className="sw" style={{ background: s.color }} />{s.label}</span>)}
            <span className="legend-item" style={{ color: 'var(--text-3)' }}>all groups on one shared scale</span>
          </div>
        </div>
      </Card>

      <CountryGroupsTable
        rows={rows}
        filtered={groupFilter}
        onRowClick={(r) => onGroupFilter(groupFilter.length === 1 && groupFilter[0] === r.key ? [] : [r.key])} />

      <div className="grid-2">
        {perGroup.map((g) => (
          <Card key={`${g.community || ''}${g.group}`} title={g.group}
                badge={g.community ? { text: g.community, tone: 'quiet' } : undefined}
                sub={`${fmtLong(g.first)} → ${fmtLong(g.last)} · ${fmtFull(g.media)} media files in the export`}>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>
              <Mini k="Members" v={fmtFull(g.m.totals.members)} />
              <Mini k="Joined" v={`+${fmtFull(g.m.totals.joined)}`} tone="var(--pos)" />
              <Mini k="Left" v={`−${fmtFull(g.m.totals.left)}`} tone="var(--neg)" />
              <Mini k="Messages" v={fmtFull(g.c.totals.messages)} />
              <Mini k="Tone" v={`${g.c.totals.sentiment > 0 ? '+' : ''}${g.c.totals.sentiment.toFixed(2)}`} tone={sentimentColor(g.c.totals.sentiment)} />
            </div>
            <Sparkline values={g.c.series.map((d) => d.messages)} w={260} h={38} color="var(--s3)" />
            <p className="muted" style={{ marginTop: 4 }}>Daily message volume</p>
            {g.topTopics.length > 0 && (
              <div className="chips" style={{ marginTop: 12 }}>
                {g.topTopics.map((t) => (
                  <span className="chip" key={t.key} style={{ borderColor: t.color, color: t.color }}>
                    {t.label} · {fmtFull(t.messages)}
                  </span>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  )
}

function Mini({ k, v, tone }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11 }}>{k}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: tone }}>{v}</div>
    </div>
  )
}
