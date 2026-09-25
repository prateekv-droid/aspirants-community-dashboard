/* Number and label formatting shared by every surface. */

export function fmtNum(v, kind) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  switch (kind) {
    case 'pct': return `${(v * 100).toFixed(v !== 0 && Math.abs(v) < 0.1 ? 1 : 0)}%`
    case 'pct1': return `${(v * 100).toFixed(1)}%`
    case 'sent': return v.toFixed(2)
    case 'min': return v < 1 ? `${Math.round(v * 60)}s` : v < 90 ? `${v.toFixed(0)}m` : `${(v / 60).toFixed(1)}h`
    case 'dec': return v.toFixed(1)
    case 'sec': return `${Math.floor(v / 60)}m ${Math.round(v % 60)}s`
    default:
      if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
      if (Math.abs(v) >= 10_000) return `${(v / 1000).toFixed(1)}k`
      return Number.isInteger(v) ? v.toLocaleString('en-US') : (+v.toFixed(1)).toLocaleString('en-US')
  }
}

export const fmtFull = (v) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('en-US')

/** Signed percentage change, ready to render. */
export function fmtDelta(d) {
  if (d === null || d === undefined) return { text: 'new', cls: 'up' }
  if (!Number.isFinite(d)) return { text: '—', cls: 'flat' }
  if (Math.abs(d) < 0.005) return { text: '0%', cls: 'flat' }
  const pct = Math.abs(d) >= 10 ? `${Math.round(Math.abs(d) * 100)}%` : `${(Math.abs(d) * 100).toFixed(1)}%`
  return { text: `${d > 0 ? '▲' : '▼'} ${pct}`, cls: d > 0 ? 'up' : 'down' }
}

export const sentimentLabel = (s) =>
  s >= 0.25 ? 'Very positive' : s >= 0.06 ? 'Positive' : s > -0.06 ? 'Neutral' : s > -0.25 ? 'Negative' : 'Very negative'

export const sentimentColor = (s) =>
  s >= 0.06 ? 'var(--pos)' : s <= -0.06 ? 'var(--neg)' : 'var(--neu)'

/** Phone numbers are members' personal data — show enough to identify, not to contact. */
export function maskIdentity(name) {
  const s = String(name || '').trim()
  if (/^\+?[\d\s\-().]{7,}$/.test(s)) {
    const digits = s.replace(/\D/g, '')
    return `+${digits.slice(0, 2)}•••${digits.slice(-3)}`
  }
  return s
}

export const initials = (s) =>
  String(s || '?').replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '').join('') || '•'
