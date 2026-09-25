/* ── Google Analytics 4 "Reports snapshot" CSV parser ──────────────────────
   A GA export is not one table — it is a stack of blocks, each preceded by
   `#` comment lines carrying the block's own date range, then a header row,
   then data. We identify each block by its header signature rather than by
   position, so a snapshot with cards added, removed or reordered still
   parses.
   ------------------------------------------------------------------------ */
import { parseCSV } from './csv.js'

const norm = (s) => String(s || '').trim().toLowerCase()

/* header signature → { key, dims, metrics } */
const BLOCKS = [
  { key: 'summary',      match: ['active users', 'new users'], kind: 'kv-row' },
  { key: 'pages',        match: ['page title and screen class'] },
  { key: 'firstUser',    match: ['first user source / medium'] },
  { key: 'firstUserSrc', match: ['first user source'] },
  { key: 'sessions',     match: ['session source / medium'] },
  { key: 'sessionsSrc',  match: ['session source'] },
  { key: 'campaigns',    match: ['session campaign'] },
  { key: 'nthDay',       match: ['nth day'] },
  { key: 'platform',     match: ['platform'] },
  { key: 'cities',       match: ['city'] },
  { key: 'countries',    match: ['country'] },
  { key: 'devices',      match: ['device category'] },
  { key: 'audiences',    match: ['audience name'] },
  { key: 'events',       match: ['event name'] },
  { key: 'landing',      match: ['landing page'] },
]

function ymd(s) {
  const t = String(s || '').trim()
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(t)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  return d ? d[0] : null
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

const num = (v) => {
  const n = Number(String(v).replace(/[,%\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * @param {string} text raw GA snapshot CSV
 * @returns {{property:string, account:string, range:{from:string,to:string},
 *            blocks:Object, daily:Array, meta:Object}}
 */
export function parseGA(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const out = {
    account: null, property: null,
    range: { from: null, to: null },
    blocks: {}, daily: [], unknown: [],
  }

  // group lines into blocks: a run of comments + a run of data
  const chunks = []
  let cur = null
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('#')) {
      const body = line.replace(/^#+\s?/, '').trim()
      if (!cur || cur.data.length) chunks.push((cur = { comments: [], data: [] }))
      cur.comments.push(body)
    } else if (line === '') {
      if (cur && cur.data.length) cur = null
    } else {
      if (!cur) chunks.push((cur = { comments: [], data: [] }))
      cur.data.push(raw)
    }
  }

  for (const ch of chunks) {
    let from = null, to = null, title = null
    for (const c of ch.comments) {
      let m
      if ((m = /^Account:\s*(.+)$/i.exec(c))) out.account = m[1].trim()
      else if ((m = /^Property:\s*(.+)$/i.exec(c))) out.property = m[1].trim()
      else if ((m = /^Start date:\s*(.+)$/i.exec(c))) from = ymd(m[1])
      else if ((m = /^End date:\s*(.+)$/i.exec(c))) to = ymd(m[1])
      else if (c && !/^-+$/.test(c) && c !== 'Reports snapshot') title = c
    }
    if (from && (!out.range.from || from < out.range.from)) out.range.from = from
    if (to && (!out.range.to || to > out.range.to)) out.range.to = to
    if (!ch.data.length) continue

    const rows = parseCSV(ch.data.join('\n'))
    if (!rows.length) continue
    const header = rows[0].map(norm)
    const body = rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''))

    const spec = BLOCKS.find((b) => b.match.every((mm) => header.includes(mm)))
    if (!spec) {
      out.unknown.push({ title, header: rows[0] })
      continue
    }

    if (spec.kind === 'kv-row') {
      // one header row + one totals row
      const rec = {}
      rows[0].forEach((h, i) => { rec[h.trim()] = num(body[0]?.[i]) })
      out.blocks.summary = { from, to, ...rec }
      continue
    }

    if (spec.key === 'nthDay') {
      // "Nth day" is an offset from this block's own start date
      const iN = header.indexOf('nth day')
      const cols = rows[0].map((h) => h.trim()).filter((_, i) => i !== iN)
      for (const r of body) {
        const n = parseInt(String(r[iN]).replace(/^0+(?=\d)/, ''), 10)
        if (!Number.isFinite(n) || !from) continue
        const rec = { date: addDays(from, n) }
        rows[0].forEach((h, i) => { if (i !== iN) rec[h.trim()] = num(r[i]) })
        out.daily.push(rec)
      }
      out.blocks.nthDay = { from, to, cols }
      continue
    }

    // generic dimension × metrics table
    const dimKey = rows[0][0].trim()
    const metricKeys = rows[0].slice(1).map((h) => h.trim())
    const items = body.map((r) => {
      const rec = { label: String(r[0] ?? '').trim() || '(not set)' }
      metricKeys.forEach((k, i) => { rec[k] = num(r[i + 1]) })
      rec.value = rec[metricKeys[0]] ?? 0
      return rec
    })
    out.blocks[spec.key] = { from, to, title, dimension: dimKey, metrics: metricKeys, items }
  }

  out.daily.sort((a, b) => (a.date < b.date ? -1 : 1))
  return out
}

/** Split "ig / social" into a source/medium pair. */
export function splitSourceMedium(label) {
  const [s, m] = String(label).split('/').map((x) => x.trim())
  const clean = (v) => (!v || v === '(none)' || v === '(not set)' ? null : v.replace(/^\(|\)$/g, ''))
  return { source: clean(s) || 'direct', medium: clean(m) || 'none' }
}
