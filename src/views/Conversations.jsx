import { useMemo, useState } from 'react'
import {
  conversationSeries, contributors, topicsFor, responsiveness,
  activityHeatmap, delta,
} from '../lib/metrics.js'
import { shortLabel } from '../lib/parseWhatsApp.js'
import { fmtFull, fmtNum, maskIdentity, sentimentLabel, sentimentColor } from '../lib/format.js'
import { fmtLong } from '../lib/dates.js'
import TrendChart from '../components/TrendChart.jsx'
import MetricTiles from '../components/MetricTiles.jsx'
import DataTable from '../components/DataTable.jsx'
import BarList from '../components/BarList.jsx'
import { Card, SentimentBar, SentimentScore, Heatmap, ChartLegend } from '../components/ui.jsx'

const METRICS = [
  { key: 'messages', label: 'Messages', color: 'var(--s3)', pick: (d) => d.messages },
  { key: 'contributors', label: 'Contributors', color: 'var(--s2)', pick: (d) => d.contributors, hint: 'Distinct members who posted that day' },
  { key: 'questions', label: 'Questions', color: 'var(--s5)', pick: (d) => d.questions },
  { key: 'sentiment', label: 'Sentiment', color: 'var(--s4)', pick: (d) => d.sentiment, format: 'sent', hint: 'Mean message sentiment, −1 to +1' },
  { key: 'media', label: 'Media shared', color: 'var(--s6)', pick: (d) => d.media },
]

const TABS = [
  ['topics', 'Topics'],
  ['people', 'Contributors'],
  ['keywords', 'Keywords'],
  ['timing', 'Timing'],
]

export default function Conversations({ data, range, prevRange, compare }) {
  const [selected, setSelected] = useState(['messages', 'contributors'])
  const [tab, setTab] = useState('topics')
  const [openTopic, setOpenTopic] = useState(null)

  const cur = useMemo(() => conversationSeries(data.events, range), [data.events, range])
  const prev = useMemo(() => conversationSeries(data.events, prevRange), [data.events, prevRange])
  const people = useMemo(() => contributors(data.events, range), [data.events, range])
  const t = useMemo(() => topicsFor(data.events, range), [data.events, range])
  const resp = useMemo(() => responsiveness(data.events, range), [data.events, range])
  const heat = useMemo(() => activityHeatmap(data.events, range), [data.events, range])

  const tiles = METRICS.map((m) => ({
    key: m.key, label: m.label, color: m.color, format: m.format, hint: m.hint,
    value: cur.totals[m.key] ?? 0,
    // sentiment is a −1…+1 index; a percentage change of it means nothing,
    // so that tile reports the movement in index points instead
    delta: compare && m.key !== 'sentiment' ? delta(cur.totals[m.key] ?? 0, prev.totals[m.key] ?? 0) : undefined,
    display: m.key === 'sentiment' ? (cur.totals.sentiment > 0 ? '+' : '') + cur.totals.sentiment.toFixed(2) : undefined,
    foot: compare
      ? (m.key === 'sentiment'
          ? `${cur.totals.sentiment - prev.totals.sentiment >= 0 ? '+' : '−'}${Math.abs(cur.totals.sentiment - prev.totals.sentiment).toFixed(2)} pts vs ${prev.totals.sentiment.toFixed(2)}`
          : `vs ${fmtFull(prev.totals[m.key] ?? 0)}`)
      : undefined,
  }))

  const series = METRICS.filter((m) => selected.includes(m.key)).map((m) => ({
    key: m.key, label: m.label, color: m.color, format: m.format,
    values: cur.series.map((d) => ({ date: d.date, value: m.pick(d) })),
    prev: compare ? prev.series.map((d) => ({ date: d.date, value: m.pick(d) })) : null,
  }))

  /* One colour per country group, fixed by the group's position in the
     community rather than in the filtered list, so narrowing the group filter
     never recolours a group. */
  const groupStyle = useMemo(() => {
    const m = new Map()
    data.community.groups.forEach((g, i) => {
      const base = shortLabel(g.rawGroup || g.group)
      m.set(g.group, {
        color: `var(--s${(i % 10) + 1})`,
        label: g.communityName ? `${base} · ${g.communityName}` : base,
      })
    })
    return m
  }, [data.community])
  const inTopics = useMemo(() => {
    const seen = new Set()
    for (const topic of t.topics) for (const b of topic.byGroup) seen.add(b.group)
    return data.community.groups.filter((g) => seen.has(g.group))
  }, [t.topics, data.community])

  const toggle = (k) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Community</span>
          <h1>Conversations</h1>
          <p className="sub">
            Every message in the selected groups is scored for sentiment and tagged against a study-abroad topic
            taxonomy. {fmtFull(t.sampled)} messages analysed in this range.
          </p>
        </div>
      </div>

      <div>
        <MetricTiles metrics={tiles} selected={selected} onToggle={toggle} max={4} />
        <div className="chart-wrap">
          <TrendChart series={series} height={300} showArea={series.length === 1} />
          <ChartLegend series={series} compare={compare} />
        </div>
      </div>

      <div className="grid-3">
        <Card title="Sentiment" sub={sentimentLabel(cur.totals.sentiment)}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <SentimentScore value={cur.totals.sentiment} />
            <span className="muted">of {fmtFull(cur.totals.messages)} messages</span>
          </div>
          <SentimentBar pos={cur.totals.pos} neu={cur.totals.neu} neg={cur.totals.neg} />
        </Card>

        <Card title="Responsiveness" sub={`Question answered within ${fmtNum(resp.medianMinutes, 'min')} at the median`}>
          <Row k="Questions asked" v={fmtFull(resp.questions)} />
          <Row k="Got a reply" v={`${fmtNum(resp.answerRate, 'pct')} (${fmtFull(resp.answered)})`} />
          <Row k="Median reply time" v={fmtNum(resp.medianMinutes, 'min')} />
          <Row k="Slowest 10%" v={fmtNum(resp.p90Minutes, 'min')} />
        </Card>

        <Card title="Volume">
          <Row k="Messages / active day" v={fmtNum(cur.totals.msgsPerDay, 'dec')} />
          <Row k="Active days" v={`${cur.totals.activeDays} of ${cur.series.length}`} />
          <Row k="Media shared" v={fmtFull(cur.totals.media)} />
          <Row k="Messages / contributor" v={cur.totals.contributors ? fmtNum(cur.totals.messages / cur.totals.contributors, 'dec') : '—'} />
        </Card>
      </div>

      <section className="glass">
        <div className="tabs">
          {TABS.map(([k, l]) => (
            <button key={k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
              {l}
              {k === 'topics' && <span className="n">{t.topics.length}</span>}
              {k === 'people' && <span className="n">{people.length}</span>}
            </button>
          ))}
        </div>

        {tab === 'topics' && inTopics.length > 1 && (
          <div className="sent-legend" style={{ padding: '12px 18px 2px' }} aria-label="Country split colours">
            {inTopics.map((g) => (
              <span key={g.group}>
                <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, marginRight: 5,
                            background: groupStyle.get(g.group).color }} />
                {groupStyle.get(g.group).label}
              </span>
            ))}
          </div>
        )}

        {tab === 'topics' && (
          <DataTable
            rows={t.topics}
            initialSort={{ key: 'score', dir: 'desc' }}
            onRowClick={(r) => setOpenTopic(openTopic === r.key ? null : r.key)}
            rowKey={(r) => r.key}
            columns={[
              { key: 'label', label: 'Topic' },
              { key: 'messages', label: 'Messages', bar: true },
              { key: 'people', label: 'People', bar: true, color: 'var(--s2)' },
              { key: 'questionRate', label: 'Asked as ?', format: 'pct' },
              { key: 'sentiment', label: 'Sentiment', render: (r) => (
                <span style={{ color: sentimentColor(r.sentiment), fontWeight: 700 }}>
                  {r.sentiment > 0 ? '+' : ''}{r.sentiment.toFixed(2)}
                </span>
              ) },
              { key: 'groups', label: 'Country split', width: 220, align: 'left',
                render: (r) => <GroupSplitBar parts={r.byGroup} total={r.messages} styles={groupStyle} />,
                sub: (r) => {
                  const lead = r.byGroup[0]
                  if (!lead) return null
                  const share = Math.round((lead.messages / r.messages) * 100)
                  return r.byGroup.length === 1
                    ? `all in ${groupStyle.get(lead.group)?.label}`
                    : `${groupStyle.get(lead.group)?.label} ${share}% · ${r.byGroup.length} groups`
                } },
            ]}
          />
        )}

        {tab === 'topics' && openTopic && (
          <div style={{ padding: '4px 18px 18px', borderTop: '1px solid var(--line)' }}>
            {(() => {
              const topic = t.topics.find((x) => x.key === openTopic)
              if (!topic) return null
              return (
                <>
                  <h3 style={{ margin: '14px 0 4px' }}>{topic.label} — what members actually said</h3>
                  <p className="muted" style={{ marginBottom: 10 }}>
                    {fmtFull(topic.messages)} messages from {fmtFull(topic.people)} people across {topic.groups} group(s),
                    {' '}{fmtLong(topic.first)} → {fmtLong(topic.last)}. {fmtNum(topic.questionRate, 'pct')} were questions.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                    {topic.examples.map((ex, i) => (
                      <div className="quote" key={i}>
                        <div>
                          <span className="who">{maskIdentity(ex.author)}</span>{' '}
                          <span className="when">· {ex.group} · {fmtLong(ex.date)}</span>{' '}
                          {ex.question && <span className="badge quiet">question</span>}
                        </div>
                        {ex.text}
                      </div>
                    ))}
                    {!topic.examples.length && <p className="muted">No message long enough to quote.</p>}
                  </div>
                </>
              )
            })()}
          </div>
        )}

        {tab === 'people' && (
          <DataTable
            rows={people}
            initialSort={{ key: 'messages', dir: 'desc' }}
            columns={[
              { key: 'label', label: 'Member', render: (r) => maskIdentity(r.label), sub: (r) => r.groupList.join(', ') },
              { key: 'messages', label: 'Messages', bar: true },
              { key: 'activeDays', label: 'Active days' },
              { key: 'groups', label: 'Groups' },
              { key: 'questions', label: 'Asked' },
              { key: 'answers', label: 'Replied' },
              { key: 'avgWords', label: 'Avg words', format: 'dec' },
              { key: 'sentiment', label: 'Tone', render: (r) => (
                <span style={{ color: sentimentColor(r.sentiment), fontWeight: 700 }}>{r.sentiment > 0 ? '+' : ''}{r.sentiment.toFixed(2)}</span>
              ) },
              { key: 'helpfulness', label: 'Helper score', bar: true, color: 'var(--s4)', format: 'dec' },
            ]}
          />
        )}

        {tab === 'keywords' && (
          <div style={{ padding: '16px 18px 18px' }} className="grid-2">
            <div>
              <h3 style={{ marginBottom: 8 }}>Words</h3>
              <p className="muted" style={{ marginBottom: 10 }}>Ranked by how many distinct people used them; stop-words and common Hindi transliterations removed.</p>
              <BarList items={t.keywords.words.slice(0, 14).map((w) => ({ label: w.term, value: w.people }))} limit={14} unit="people" showPct={false} />
            </div>
            <div>
              <h3 style={{ marginBottom: 8 }}>Phrases</h3>
              <p className="muted" style={{ marginBottom: 10 }}>Two-word phrases — these surface the intents the taxonomy has no name for yet.</p>
              <BarList items={t.keywords.phrases.slice(0, 14).map((w) => ({ label: w.term, value: w.people, color: 'var(--s2)' }))} limit={14} unit="people" showPct={false} />
            </div>
          </div>
        )}

        {tab === 'timing' && (
          <div style={{ padding: '16px 18px 18px' }}>
            <h3 style={{ marginBottom: 4 }}>When the community talks</h3>
            <p className="muted" style={{ marginBottom: 14 }}>Message volume by weekday and hour — use it to schedule announcements and staff moderation.</p>
            <Heatmap grid={heat.grid} max={heat.max} />
          </div>
        )}
      </section>
    </>
  )
}

function Row({ k, v }) {
  return <div className="stat-row"><span className="k">{k}</span><span className="v">{v}</span></div>
}

/* A topic's messages split across the country groups, drawn in the same form
   as the sentiment bar. Segment widths are shares of that topic's messages;
   hover a segment for its count. */
function GroupSplitBar({ parts, total, styles }) {
  if (!total) return <span className="muted">—</span>
  return (
    <div className="sent-bar" style={{ minWidth: 150 }} role="img"
         aria-label={parts.map((p) => `${styles.get(p.group)?.label}: ${p.messages}`).join(', ')}>
      {parts.map((p) => {
        const st = styles.get(p.group) || { color: 'var(--neu)', label: p.group }
        const pct = (p.messages / total) * 100
        return (
          <i key={p.group}
             title={`${st.label} — ${p.messages} message${p.messages === 1 ? '' : 's'} (${Math.round(pct)}%)`}
             style={{ width: `${pct}%`, background: st.color }} />
        )
      })}
    </div>
  )
}
