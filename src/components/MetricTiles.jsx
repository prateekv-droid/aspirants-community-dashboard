import { fmtFull, fmtNum, fmtDelta } from '../lib/format.js'

/* Search-Console-style tiles: each is a toggle that adds or removes its
   series from the chart below. At least one must stay selected. */
export default function MetricTiles({ metrics, selected, onToggle, max = 4 }) {
  return (
    <div className="tiles framed" role="group" aria-label="Metrics">
      {metrics.map((m) => {
        const on = selected.includes(m.key)
        const d = m.delta === undefined ? null : fmtDelta(m.delta)
        // for "left" / "churn" a rise is bad — invert the colour, not the arrow
        const cls = d && m.invert ? (d.cls === 'up' ? 'inv-up' : d.cls === 'down' ? 'inv-down' : 'flat') : d?.cls
        const atLimit = !on && selected.length >= max
        return (
          <button
            key={m.key}
            className={`tile${on ? ' on' : ''}`}
            style={{ '--c': m.color }}
            onClick={() => onToggle(m.key)}
            disabled={atLimit || (on && selected.length === 1)}
            aria-pressed={on}
            title={atLimit ? `Deselect a metric first (max ${max} at once)` : m.hint || m.label}
          >
            <span className="t-label"><i className="dot" />{m.label}</span>
            <span className="t-value">{m.display ?? (m.format ? fmtNum(m.value, m.format) : fmtFull(m.value))}</span>
            <span className="t-foot">
              {d && <span className={`trend ${cls}`}>{d.text}</span>}
              {m.foot && <span>{m.foot}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
