import { fmtFull, fmtDelta } from '../lib/format.js'
import { Card } from './ui.jsx'

/* ── How members arrived, and how they went ───────────────────────────────
   Both halves are counted from the join and exit notices in the transcripts,
   so unlike the GA/short.io channels these are exact. Shared by the Overview
   and Member growth tabs so the two cannot drift; `columns` picks between a
   narrow stacked card and a full-width pair. ------------------------------ */

function Rows({ rows, prevRows, compare, unit, fallbackColor }) {
  if (!rows.length) return <p className="muted" style={{ margin: '6px 0' }}>Nothing in this range.</p>
  const max = Math.max(1, ...rows.map((r) => r.value))
  /* joinSources drops zero rows, so a source missing from the previous period
     genuinely had none — that is "new", not "unknown". */
  const prevOf = (key) => (prevRows ? prevRows.find((p) => p.key === key)?.value ?? 0 : undefined)

  return (
    <div className="barlist">
      {rows.map((r, i) => {
        const before = compare ? prevOf(r.key) : undefined
        const d = before === undefined ? null : fmtDelta(before === 0 ? (r.value === 0 ? 0 : null) : (r.value - before) / before)
        return (
          <div className="barlist-row" key={r.key} style={{ '--c': r.color || fallbackColor }}>
            <span className="lab" title={r.label}><span>{r.label}</span></span>
            <span className="track"><i style={{ width: `${(r.value / max) * 100}%` }} /></span>
            <span className="val">
              {fmtFull(r.value)}
              <span className="muted"> {r.value === 1 ? unit.replace(/s$/, '') : unit}</span>
            </span>
            <span className="pct">{(r.share * 100).toFixed(0)}%</span>
            {compare && (
              <span className="pct" style={{ minWidth: 62 }}>
                {d ? <span className={`trend ${d.cls}`}>{d.text}</span> : <span className="muted">—</span>}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function SourceSplit({
  sources, prevSources, exits, prevExits, compare, columns = 1, note = true,
}) {
  const joinTotal = sources.reduce((s, r) => s + r.value, 0)
  const exitTotal = exits.reduce((s, r) => s + r.value, 0)

  const joined = (
    <Rows rows={sources.map((r, i) => ({ ...r, color: `var(--s${(i % 10) + 1})` }))}
          prevRows={prevSources} compare={compare} unit="joins" />
  )
  const left = (
    <Rows rows={exits.map((r) => ({ ...r, color: r.key === 'removed' ? 'var(--neg)' : 'var(--neu)' }))}
          prevRows={prevExits} compare={compare} unit="exits" />
  )
  const provenance = note && (
    <p className="muted" style={{ marginTop: 12 }}>
      Read from the join and exit notices in each transcript. For the channel that brought people in —
      IG, Scholarship, Organic — see Sources.
    </p>
  )

  /* full width: two cards side by side */
  if (columns === 2) {
    return (
      <div className="grid-2">
        <Card title="How members entered the groups"
              sub={joinTotal ? `${fmtFull(joinTotal)} joins, by the route WhatsApp recorded — not the marketing source` : 'No joins in this range'}>
          {joined}
          {provenance}
        </Card>
        <Card title="How members left"
              sub={exitTotal ? `${fmtFull(exitTotal)} exits in this range` : 'No exits in this range'}>
          {left}
          {exitTotal > 0 && (
            <p className="muted" style={{ marginTop: 12 }}>
              “Removed by admin” is a moderation action; everything else is a member choosing to go.
            </p>
          )}
        </Card>
      </div>
    )
  }

  /* narrow: one card, stacked */
  return (
    <Card title="How members entered the groups"
          sub={joinTotal ? `${fmtFull(joinTotal)} joins, by the route WhatsApp recorded — not the marketing source` : 'No joins in this range'}>
      {joined}
      {exits.length > 0 && (
        <>
          <h3 style={{ margin: '18px 0 8px' }}>How members left</h3>
          {left}
        </>
      )}
      {provenance}
    </Card>
  )
}
