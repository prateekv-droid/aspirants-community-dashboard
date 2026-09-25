import { fmtFull } from '../lib/format.js'

/* Ranked horizontal bars — the readable default for a dimension breakdown. */
export default function BarList({ items, limit = 8, color = 'var(--accent)', showPct = true, total, unit }) {
  const list = (items || []).slice(0, limit)
  const max = Math.max(1, ...list.map((i) => i.value))
  const sum = total ?? (items || []).reduce((s, i) => s + i.value, 0)
  if (!list.length) return <p className="muted" style={{ margin: '6px 0' }}>No data in this range.</p>
  return (
    <div className="barlist">
      {/* keyed by position as well as label: callers can legitimately pass
          repeated labels (the same country group in two communities), and a
          list component should not depend on the caller for uniqueness */}
      {list.map((i, n) => (
        <div className="barlist-row" key={i.id ?? `${i.label}#${n}`} style={{ '--c': i.color || color }}>
          <span className="lab" title={i.label}>
            {i.icon && <b aria-hidden>{i.icon}</b>}
            <span>{i.label}</span>
          </span>
          <span className="track"><i style={{ width: `${(i.value / max) * 100}%` }} /></span>
          <span className="val">
            {fmtFull(i.value)}
            {unit ? <span className="muted"> {i.value === 1 ? unit.replace(/s$/, '') : unit}</span> : null}
          </span>
          {showPct && <span className="pct">{sum ? `${((i.value / sum) * 100).toFixed(0)}%` : '—'}</span>}
        </div>
      ))}
    </div>
  )
}
