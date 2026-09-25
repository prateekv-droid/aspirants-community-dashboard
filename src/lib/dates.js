/* Date helpers. Everything in the dashboard is keyed on ISO yyyy-mm-dd
   strings in UTC — no local-timezone drift between chart, table and filter. */

export const iso = (d) => d.toISOString().slice(0, 10)
export const parseISO = (s) => new Date(`${s}T00:00:00Z`)

export function addDays(s, n) {
  const d = parseISO(s)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

export function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000)
}

export function eachDay(from, to) {
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

export const today = () => iso(new Date())

/** GSC-style presets, all inclusive of both ends. */
export const PRESETS = [
  { key: '7d',   label: 'Last 7 days',    days: 7 },
  { key: '28d',  label: 'Last 28 days',   days: 28 },
  { key: '3m',   label: 'Last 3 months',  days: 90 },
  { key: '6m',   label: 'Last 6 months',  days: 180 },
  { key: '12m',  label: 'Last 12 months', days: 365 },
  { key: 'all',  label: 'Full history',   days: null },
]

/** Resolve a preset against the data's own extent (never past the last day of data). */
export function resolveRange(preset, dataFrom, dataTo, custom) {
  const anchor = dataTo || today()
  if (preset === 'custom' && custom?.from && custom?.to) {
    return { from: custom.from, to: custom.to }
  }
  const p = PRESETS.find((x) => x.key === preset) || PRESETS[1]
  if (!p.days) return { from: dataFrom || anchor, to: anchor }
  const from = addDays(anchor, -(p.days - 1))
  return { from: dataFrom && from < dataFrom ? dataFrom : from, to: anchor }
}

/** The immediately-preceding window of the same length, for comparison. */
export function previousRange({ from, to }) {
  const len = daysBetween(from, to) + 1
  return { from: addDays(from, -len), to: addDays(from, -1) }
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
export function fmtShort(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${+d} ${MONTHS[+m - 1]}`
}
export function fmtLong(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${+d} ${MONTHS[+m - 1]} ${y}`
}
