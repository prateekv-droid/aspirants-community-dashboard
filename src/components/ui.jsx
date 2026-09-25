import { useEffect } from 'react'
import { fmtFull, fmtNum, fmtDelta, sentimentColor } from '../lib/format.js'

export function Card({ title, sub, right, children, pad = true, badge, style }) {
  return (
    <section className="glass" style={style}>
      {(title || right) && (
        <div className="sec-head">
          <div style={{ minWidth: 0 }}>
            {title && <h2>{title}{badge && <span className={`badge ${badge.tone || 'quiet'}`}>{badge.text}</span>}</h2>}
            {sub && <p className="sub" style={{ marginTop: 3 }}>{sub}</p>}
          </div>
          <span className="spacer" />
          {right}
        </div>
      )}
      <div style={pad ? { padding: '14px 18px 16px' } : undefined}>{children}</div>
    </section>
  )
}

export function Stat({ k, v, format, hint }) {
  return (
    <div className="stat-row" title={hint}>
      <span className="k">{k}</span>
      <span className="v">{format ? fmtNum(v, format) : fmtFull(v)}</span>
    </div>
  )
}

export function Delta({ value, invert }) {
  const d = fmtDelta(value)
  const cls = invert ? (d.cls === 'up' ? 'inv-up' : d.cls === 'down' ? 'inv-down' : d.cls) : d.cls
  return <span className={`trend ${cls}`}>{d.text}</span>
}

/** Positive / neutral / negative composition bar. */
export function SentimentBar({ pos, neu, neg, showLegend = true }) {
  const t = pos + neu + neg || 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="sent-bar" role="img" aria-label={`${pos} positive, ${neu} neutral, ${neg} negative messages`}>
        <i style={{ width: `${(pos / t) * 100}%`, background: 'var(--pos)' }} />
        <i style={{ width: `${(neu / t) * 100}%`, background: 'var(--neu)' }} />
        <i style={{ width: `${(neg / t) * 100}%`, background: 'var(--neg)' }} />
      </div>
      {showLegend && (
        <div className="sent-legend">
          <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--pos)', marginRight: 5 }} />Positive <b>{fmtFull(pos)}</b> · {((pos / t) * 100).toFixed(0)}%</span>
          <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--neu)', marginRight: 5 }} />Neutral <b>{fmtFull(neu)}</b> · {((neu / t) * 100).toFixed(0)}%</span>
          <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--neg)', marginRight: 5 }} />Negative <b>{fmtFull(neg)}</b> · {((neg / t) * 100).toFixed(0)}%</span>
        </div>
      )}
    </div>
  )
}

export function SentimentScore({ value, size = 34 }) {
  return (
    <span style={{ fontSize: size, fontWeight: 800, letterSpacing: '-0.02em', color: sentimentColor(value), fontVariantNumeric: 'tabular-nums' }}>
      {value > 0 ? '+' : ''}{value.toFixed(2)}
    </span>
  )
}

/* hour × weekday grid */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function Heatmap({ grid, max }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <div className="heat">
        <span />
        {Array.from({ length: 24 }, (_, h) => <span className="hcol" key={h}>{h % 3 === 0 ? h : ''}</span>)}
        {grid.map((row, d) => (
          <>
            <span className="hlab" key={`l${d}`}>{DOW[d]}</span>
            {row.map((v, h) => (
              <i key={`${d}-${h}`} title={`${DOW[d]} ${String(h).padStart(2, '0')}:00 — ${v} message${v === 1 ? '' : 's'}`}
                 style={{ opacity: max ? 0.07 + (v / max) * 0.93 : 0.07 }} />
            ))}
          </>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 8 }}>Times are as recorded in the export (device local time). Peak cell: {max} messages.</p>
    </div>
  )
}

export function Sparkline({ values, color = 'var(--accent)', w = 108, h = 26 }) {
  if (!values?.length) return null
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? w / (values.length - 1) : w
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(h - (v / max) * (h - 3) - 1.5).toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function Empty({ icon = '📊', title, sub, action }) {
  return (
    <div className="glass empty">
      <span className="big-ico" aria-hidden>{icon}</span>
      <h2>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
      {action}
    </div>
  )
}

export function Toasts({ items, onDismiss }) {
  useEffect(() => {
    if (!items.length) return
    const t = setTimeout(() => onDismiss(items[0].id), items[0].sticky ? 12000 : 5200)
    return () => clearTimeout(t)
  }, [items, onDismiss])
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div className={`toast ${t.tone || 'info'}`} key={t.id}>
          <span aria-hidden>{t.tone === 'good' ? '✓' : t.tone === 'bad' ? '⚠' : 'ℹ'}</span>
          <span style={{ flex: 1 }}>{t.text}</span>
          <button className="btn tiny ghost" onClick={() => onDismiss(t.id)} aria-label="Dismiss">✕</button>
        </div>
      ))}
    </div>
  )
}

/** Legend row + the scale caveat, shared by every metric-picker chart. */
export function ChartLegend({ series, compare, prevLabel }) {
  return (
    <div className="legend">
      {series.map((s) => (
        <span className="legend-item" key={s.key}>
          <i className="sw" style={{ background: s.color }} />{s.label}
        </span>
      ))}
      {compare && series.length > 0 && (
        <span className="legend-item" style={{ color: 'var(--text-3)' }}>
          <i className="sw dash" style={{ color: 'var(--text-3)' }} />
          {prevLabel || 'Previous period'}
        </span>
      )}
      {series.length > 1 && (
        <span className="legend-item" style={{ color: 'var(--text-3)' }} title="Each metric is drawn against its own maximum so a small series stays readable next to a large one. The left-hand axis belongs to the first selected metric.">
          ⓘ each metric on its own scale
        </span>
      )}
    </div>
  )
}

/** Small helper for panels whose numbers are scaled estimates. */
export function EstimateNote({ coverage, source }) {
  if (coverage === undefined || coverage >= 0.999) return null
  return (
    <p className="muted" style={{ marginTop: 10 }}>
      {source} reports these breakdowns pre-aggregated over its own export window, so values are
      scaled to the {Math.round(coverage * 100)}% of that window inside your date range. Daily totals above are exact.
    </p>
  )
}
