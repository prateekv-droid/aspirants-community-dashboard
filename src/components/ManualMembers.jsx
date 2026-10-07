import { useEffect, useState } from 'react'
import { fmtFull } from '../lib/format.js'
import { Card } from './ui.jsx'

/* Operator-entered member counts. Each row shows what the transcript rebuilds
   and takes the real figure beside it; the typed number is what every members
   column then reports. A blank field means "use the calculated count".
   Edits commit on blur or Enter rather than per keystroke — the dashboard
   re-derives every number from state, which is too much work for a keypress. */
export default function ManualMembers({ title, sub, items, onChange }) {
  if (!items.length) return null
  return (
    <Card title={title} sub={sub}>
      <div className="manual-members">
        {items.map((it) => (
          <Row key={it.id} item={it} onChange={(v) => onChange(it, v)} />
        ))}
      </div>
    </Card>
  )
}

function Row({ item, onChange }) {
  const [draft, setDraft] = useState(item.value ?? '')

  // a fresh number from elsewhere (another tab, a reset) wins over a stale draft
  useEffect(() => { setDraft(item.value ?? '') }, [item.value])

  const commit = () => {
    const trimmed = String(draft).trim()
    const next = trimmed === '' ? null : Math.round(Number(trimmed))
    if (trimmed !== '' && (!Number.isFinite(next) || next < 0)) { setDraft(item.value ?? ''); return }
    if (next !== (item.value ?? null)) onChange(next)
  }

  return (
    <label className="manual-row">
      <span className="manual-label">
        <span className="manual-name">{item.label}</span>
        <span className="manual-calc">
          {item.note ? `${item.note} · ` : ''}calculated: {fmtFull(item.calculated)}
        </span>
      </span>
      <input
        type="number" min="0" step="1" inputMode="numeric"
        placeholder={String(item.calculated)}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        aria-label={`Member count for ${item.label}`}
        style={{ width: 120 }}
      />
    </label>
  )
}
