/* ── Leads sync ────────────────────────────────────────────────────────────
   The leads sheet is the one source that must stay live, so instead of a
   re-upload we point the tool at a URL and let it re-pull. Because the
   dashboard is backend-free the fetch happens from the browser, which means
   the URL has to be CORS-readable — in practice a Google Sheet that is
   link-shared or published to the web. We normalise whatever the operator
   pastes into an endpoint that actually satisfies that, rather than letting
   them discover it as an opaque network error.
   ------------------------------------------------------------------------ */
import { parseCSV } from './csv.js'
import { readXLSX } from './xlsx.js'
import { buildLeads, inferMapping } from './parseLeads.js'

export const INTERVALS = [
  { key: 'manual', label: 'Manual only', ms: 0 },
  { key: '15m', label: 'Every 15 minutes', ms: 15 * 60_000 },
  { key: '1h', label: 'Hourly', ms: 3_600_000 },
  { key: '6h', label: 'Every 6 hours', ms: 6 * 3_600_000 },
  { key: '24h', label: 'Daily', ms: 24 * 3_600_000 },
]

/**
 * Work out how to read the pasted location.
 * @returns {{kind:'gsheet'|'csv'|'xlsx', fetchUrl:string, docId?:string, gid?:string,
 *            note:string, requirement?:string}}
 */
export function normalizeSyncUrl(input) {
  const raw = String(input || '').trim()
  if (!raw) throw new Error('Paste the URL of the leads sheet first.')
  let u
  try { u = new URL(raw) } catch { throw new Error('That is not a valid URL. It should start with https://') }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost') {
    throw new Error('Use an https:// URL — the browser will refuse to read the sheet over plain http.')
  }

  // ── Google Sheets, in all the shapes people paste
  if (/(^|\.)docs\.google\.com$/.test(u.hostname) && u.pathname.includes('/spreadsheets/')) {
    // already a published-to-web CSV — leave it alone, it is CORS-clean
    if (/\/pub\b/.test(u.pathname) && /output=csv/.test(u.search)) {
      return { kind: 'gsheet', fetchUrl: u.toString(), note: 'Published-to-web CSV', requirement: null }
    }
    const idMatch = /\/spreadsheets\/d\/(?:e\/)?([a-zA-Z0-9_-]+)/.exec(u.pathname)
    if (!idMatch) throw new Error('Could not find the spreadsheet ID in that Google Sheets URL.')
    const docId = idMatch[1]
    const gid = u.hash.match(/gid=(\d+)/)?.[1] || u.searchParams.get('gid') || '0'
    // gviz is the endpoint that returns CORS headers for a link-shared sheet
    const fetchUrl = `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq?tqx=out:csv&gid=${gid}`
    return {
      kind: 'gsheet', fetchUrl, docId, gid,
      note: 'Google Sheet — read as CSV',
      requirement: 'The sheet must be shared as “Anyone with the link → Viewer”, or published to the web. A private sheet cannot be read from the browser.',
    }
  }

  if (/\.xlsx?(\?|$)/i.test(u.pathname)) {
    return { kind: 'xlsx', fetchUrl: u.toString(), note: 'Excel workbook over HTTPS', requirement: 'The host must allow cross-origin reads (send Access-Control-Allow-Origin).' }
  }
  return {
    kind: 'csv', fetchUrl: u.toString(), note: 'CSV / TSV over HTTPS',
    requirement: 'The host must allow cross-origin reads (send Access-Control-Allow-Origin).',
  }
}

/**
 * Pull the sheet and turn it into lead records.
 * @param {{url:string, mapping?:object, sheetName?:string}} cfg
 */
export async function runSync(cfg) {
  const target = normalizeSyncUrl(cfg.url)
  const startedAt = new Date().toISOString()
  let res
  try {
    res = await fetch(target.fetchUrl, { redirect: 'follow', cache: 'no-store' })
  } catch (e) {
    throw new Error(
      `Could not reach the sheet. This is almost always a permissions or CORS problem rather than a bad URL — ${target.requirement || 'the host must allow cross-origin reads.'}`
    )
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`The sheet refused the request (HTTP ${res.status}). ${target.requirement || ''}`)
    }
    if (res.status === 404) throw new Error('Nothing found at that URL (HTTP 404). Check the sheet ID and tab.')
    throw new Error(`The sheet returned HTTP ${res.status}.`)
  }

  let header, rows, sheetName = cfg.sheetName || null
  if (target.kind === 'xlsx') {
    const buf = await res.arrayBuffer()
    const sheets = await readXLSX(buf)
    const wanted = sheetName ? sheets.find((s) => s.name === sheetName) : null
    // pick the widest populated sheet when none is named
    const sheet = wanted || sheets.map((s) => ({ s, n: s.rows.filter((r) => r.some((c) => String(c ?? '').trim() !== '')).length }))
      .sort((a, b) => b.n - a.n)[0]?.s
    if (!sheet) throw new Error('That workbook has no readable sheet.')
    sheetName = sheet.name
    const live = sheet.rows.filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
    header = (live[0] || []).map((h) => String(h).trim())
    rows = live.slice(1)
  } else {
    const text = await res.text()
    if (/^\s*</.test(text)) {
      throw new Error('The URL returned a web page, not data. For a Google Sheet use File → Share → “Anyone with the link”, then paste the normal sheet URL.')
    }
    const matrix = parseCSV(text)
    if (matrix.length < 2) throw new Error('The sheet appears to be empty.')
    header = matrix[0].map((h) => String(h).trim())
    rows = matrix.slice(1)
  }

  const mapping = cfg.mapping && Object.keys(cfg.mapping).length ? cfg.mapping : inferMapping(header, rows)
  const built = buildLeads(header, rows, mapping)
  return {
    ...built,
    header,
    sheet: sheetName,
    kind: target.kind,
    fetchUrl: target.fetchUrl,
    fetchedAt: new Date().toISOString(),
    startedAt,
    rowCount: rows.length,
  }
}

export function isStale(sync) {
  if (!sync?.url || !sync.interval || sync.interval === 'manual') return false
  const ms = INTERVALS.find((i) => i.key === sync.interval)?.ms || 0
  if (!ms || !sync.lastRun) return true
  return Date.now() - new Date(sync.lastRun).getTime() > ms
}

export function nextRunLabel(sync) {
  if (!sync?.url) return 'Not configured'
  if (!sync.interval || sync.interval === 'manual') return 'Manual only'
  const ms = INTERVALS.find((i) => i.key === sync.interval)?.ms || 0
  if (!sync.lastRun) return 'On next load'
  const due = new Date(sync.lastRun).getTime() + ms
  const left = due - Date.now()
  if (left <= 0) return 'Due now'
  const m = Math.round(left / 60000)
  return m < 60 ? `in ${m} min` : `in ${Math.round(m / 60)} h`
}
