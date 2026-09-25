/* ── short.io analytics workbook parser ────────────────────────────────────
   A short.io export is one workbook of many two-column sheets
   (dimension, Clicks) plus a "General statistic" key/value sheet and a
   "Click statistics" daily series. Sheets are matched by name so an export
   with extra or missing tabs still parses.
   ------------------------------------------------------------------------ */

const num = (v) => {
  if (typeof v === 'number') return v
  const n = Number(String(v ?? '').replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

const SHEET_KEYS = {
  'os': 'os',
  'operating system': 'os',
  'browser': 'browser',
  'country': 'countries',
  'city': 'cities',
  'social': 'social',
  'referrer': 'referrers',
  'utm medium': 'utmMedium',
  'utm source': 'utmSource',
  'utm campaign': 'utmCampaign',
  'utm term': 'utmTerm',
  'utm content': 'utmContent',
  'top links': 'links',
  'device': 'devices',
  'language': 'languages',
}

/** "25 July 2026 — 25 August 2026" → { from, to } ISO. */
function parseRangeLabel(s) {
  const parts = String(s || '').split(/[—–\-]{1,2}|\bto\b/).map((x) => x.trim()).filter(Boolean)
  const one = (t) => {
    const d = new Date(t + ' UTC')
    return isNaN(d) ? null : d.toISOString().slice(0, 10)
  }
  if (parts.length >= 2) return { from: one(parts[0]), to: one(parts[1]) }
  return { from: null, to: null }
}

export function parseShortIo(sheets) {
  const out = {
    range: { from: null, to: null },
    totals: { links: 0, clicks: 0 },
    dims: {},
    daily: [],
    unknown: [],
  }

  for (const sheet of sheets) {
    const name = String(sheet.name || '').trim()
    const key = name.toLowerCase()
    const rows = sheet.rows.filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
    if (!rows.length) continue
    const body = rows.slice(1)

    if (key === 'general statistic') {
      for (const [k, v] of body) {
        const kk = String(k).toLowerCase()
        if (kk.includes('date range')) out.range = parseRangeLabel(v)
        else if (kk.includes('shorturls created')) out.totals.links = num(v)
        else if (kk.includes('total clicks')) out.totals.clicks = num(v)
        else if (kk.includes('unique clicks')) out.totals.unique = num(v)
        else out.totals[String(k).trim()] = num(v)
      }
      continue
    }

    if (key === 'click statistics' || key.includes('click statistic')) {
      for (const [d, c] of body) {
        const iso = String(d).slice(0, 10)
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) out.daily.push({ date: iso, clicks: num(c) })
      }
      out.daily.sort((a, b) => (a.date < b.date ? -1 : 1))
      continue
    }

    const dim = SHEET_KEYS[key]
    if (!dim) { out.unknown.push(name); continue }

    // short.io writes an empty label for "unknown"; keep it, named honestly.
    out.dims[dim] = body
      .map(([label, clicks]) => ({
        label: String(label ?? '').trim() || '(not set)',
        value: num(clicks),
      }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
  }

  if (!out.totals.clicks && out.daily.length) {
    out.totals.clicks = out.daily.reduce((s, d) => s + d.clicks, 0)
  }
  if (!out.range.from && out.daily.length) {
    out.range = { from: out.daily[0].date, to: out.daily[out.daily.length - 1].date }
  }
  return out
}
