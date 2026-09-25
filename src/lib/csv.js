/* RFC-4180 CSV/TSV splitter — quotes, escaped quotes, embedded newlines. */
export function parseCSV(text, delim) {
  const src = text.replace(/^﻿/, '')
  const d = delim || (src.split('\n')[0].includes('\t') ? '\t' : ',')
  const rows = []
  let row = [], field = '', q = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else q = false
      } else field += c
    } else if (c === '"') q = true
    else if (c === d) { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c === '\r') { /* skip */ }
    else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

/** Rows → objects keyed by the header row. */
export function toObjects(rows) {
  if (!rows.length) return []
  const head = rows[0].map((h) => h.trim())
  return rows.slice(1)
    .filter((r) => r.some((c) => String(c).trim() !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}
