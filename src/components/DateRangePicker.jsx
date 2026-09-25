import { useEffect, useRef, useState } from 'react'
import { PRESETS, resolveRange, previousRange, fmtLong, daysBetween } from '../lib/dates.js'

/* Search-Console-shaped range control: presets, a custom range, and a
   compare-to-previous-period switch that every chart honours. */
export default function DateRangePicker({ value, onChange, extent }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const [draft, setDraft] = useState({ from: value.range.from, to: value.range.to })

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [])

  useEffect(() => setDraft({ from: value.range.from, to: value.range.to }), [value.range.from, value.range.to])

  const days = daysBetween(value.range.from, value.range.to) + 1
  const label = value.preset === 'custom'
    ? `${fmtLong(value.range.from)} – ${fmtLong(value.range.to)}`
    : PRESETS.find((p) => p.key === value.preset)?.label ?? 'Range'

  const pick = (key) => {
    const range = resolveRange(key, extent?.from, extent?.to)
    onChange({ ...value, preset: key, range })
    setOpen(false)
  }

  const applyCustom = () => {
    if (!draft.from || !draft.to) return
    const from = draft.from <= draft.to ? draft.from : draft.to
    const to = draft.from <= draft.to ? draft.to : draft.from
    onChange({ ...value, preset: 'custom', range: { from, to } })
    setOpen(false)
  }

  const prev = previousRange(value.range)

  return (
    <div className="pop-anchor" ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog"
              aria-label={`Date range — ${label}, ${days} days`} title="Change the date range">
        <span aria-hidden>🗓</span>
        <span>{label}</span>
        <span className="muted num" style={{ fontWeight: 600 }}>{days}d</span>
        <span aria-hidden style={{ opacity: 0.5, fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div className="pop" role="dialog" aria-label="Date range">
          {PRESETS.map((p) => {
            const r = resolveRange(p.key, extent?.from, extent?.to)
            return (
              <button key={p.key} className={`opt${value.preset === p.key ? ' active' : ''}`} onClick={() => pick(p.key)}>
                {p.label}
                <span className="rng">{daysBetween(r.from, r.to) + 1}d</span>
              </button>
            )
          })}
          <hr />
          <div className="cmp">
            <span>Compare to previous period</span>
            <button className={`switch${value.compare ? ' on' : ''}`} onClick={() => onChange({ ...value, compare: !value.compare })}
                    aria-pressed={value.compare} aria-label="Compare to previous period"><i /></button>
          </div>
          {value.compare && (
            <p className="muted" style={{ padding: '0 11px 4px' }}>
              vs {fmtLong(prev.from)} – {fmtLong(prev.to)}
            </p>
          )}
          <hr />
          <div style={{ padding: '2px 11px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Custom range</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <label className="field" style={{ flex: 1 }}>
                <span>From</span>
                <input type="date" value={draft.from} min={extent?.from} max={extent?.to}
                       onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span>To</span>
                <input type="date" value={draft.to} min={extent?.from} max={extent?.to}
                       onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
              </label>
            </div>
            <button className="btn primary tiny" onClick={applyCustom} style={{ alignSelf: 'flex-start' }}>Apply</button>
            {extent && <p className="muted">Data available {fmtLong(extent.from)} – {fmtLong(extent.to)}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
