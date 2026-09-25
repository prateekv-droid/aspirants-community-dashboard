/* ── Leads sheet parser ────────────────────────────────────────────────────
   The leads source is a human-maintained sheet, so column names drift
   ("Phone", "Mobile No.", "WhatsApp Number"). Rather than hard-coding a
   schema we score each column against a set of aliases plus a value-shape
   test, and expose the resulting mapping so it can be corrected in the UI.
   ------------------------------------------------------------------------ */

const FIELDS = [
  { key: 'name',      label: 'Name',        aliases: ['name', 'full name', 'student name', 'lead name', 'first name', 'contact name'] },
  { key: 'phone',     label: 'Phone',       aliases: ['phone', 'mobile', 'mobile no', 'contact', 'whatsapp', 'whatsapp number', 'number', 'msisdn'] },
  { key: 'email',     label: 'Email',       aliases: ['email', 'e-mail', 'email id', 'mail'] },
  { key: 'country',   label: 'Destination', aliases: ['country', 'destination', 'destination country', 'study destination', 'target country', 'geo'] },
  { key: 'city',      label: 'City',        aliases: ['city', 'town', 'location'] },
  { key: 'date',      label: 'Created at',  aliases: ['date', 'created', 'created at', 'created on', 'timestamp', 'submitted', 'submission date', 'joined', 'signup date', 'lead date'] },
  { key: 'source',    label: 'Source',      aliases: ['source', 'utm source', 'utm_source', 'channel', 'lead source', 'referrer'] },
  { key: 'medium',    label: 'Medium',      aliases: ['medium', 'utm medium', 'utm_medium'] },
  { key: 'campaign',  label: 'Campaign',    aliases: ['campaign', 'utm campaign', 'utm_campaign', 'utm content', 'utm_content'] },
  { key: 'community', label: 'Community',   aliases: ['community', 'community name', 'group', 'group name', 'wa group'] },
  { key: 'stage',     label: 'Stage',       aliases: ['stage', 'status', 'lead status', 'funnel stage', 'disposition'] },
  { key: 'university',label: 'University',  aliases: ['university', 'uni', 'college', 'institution', 'school'] },
  { key: 'intake',    label: 'Intake',      aliases: ['intake', 'session', 'term', 'semester'] },
  { key: 'owner',     label: 'Owner',       aliases: ['owner', 'assigned to', 'agent', 'counsellor', 'counselor', 'rep'] },
]

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

const SHAPE = {
  email: (v) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(v).trim()),
  phone: (v) => /^[+()\d][\d\s\-().]{6,}$/.test(String(v).trim()),
  date: (v) => isDate(v),
}

function isDate(v) {
  const s = String(v ?? '').trim()
  if (!s) return false
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(s)) return true
  if (/^\d{1,2}\s+\w{3,}\s+\d{4}/.test(s)) return true
  return !isNaN(new Date(s)) && /\d{4}/.test(s)
}

/** Normalise many written date forms to ISO, preferring day-first. */
export function toISODate(v) {
  const s = String(v ?? '').trim()
  if (!s) return null
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s)
  if (m) {
    let [, a, b, y] = m
    let day = +a, mon = +b
    if (day > 12 && mon <= 12) { /* day-first, as written */ }
    else if (mon > 12) { day = +b; mon = +a }               // clearly month-first
    const year = +y < 100 ? 2000 + +y : +y
    const p = (n) => String(n).padStart(2, '0')
    return `${year}-${p(mon)}-${p(day)}`
  }
  const d = new Date(s)
  return isNaN(d) ? null : d.toISOString().slice(0, 10)
}

/**
 * Score every column against every field and pick the best non-conflicting
 * assignment. Returns { header: fieldKey|null }.
 */
export function inferMapping(header, rows) {
  const sample = rows.slice(0, 60)
  const scores = []
  header.forEach((h, i) => {
    const hn = norm(h)
    if (!hn) return
    const vals = sample.map((r) => r[i]).filter((v) => String(v ?? '').trim() !== '')
    for (const f of FIELDS) {
      let s = 0
      if (f.aliases.includes(hn)) s += 100
      else if (f.aliases.some((a) => hn === a.replace(/\s/g, ''))) s += 90
      else if (f.aliases.some((a) => hn.includes(a))) s += 55
      else if (f.aliases.some((a) => a.includes(hn) && hn.length > 3)) s += 30
      const shape = SHAPE[f.key]
      if (shape && vals.length) {
        const hit = vals.filter(shape).length / vals.length
        if (hit > 0.6) s += 45
        else if (s === 0) s = 0
      }
      if (s > 0) scores.push({ col: i, field: f.key, s })
    }
  })
  scores.sort((a, b) => b.s - a.s)
  const mapping = {}
  const usedCol = new Set(), usedField = new Set()
  for (const { col, field, s } of scores) {
    if (s < 25 || usedCol.has(col) || usedField.has(field)) continue
    mapping[header[col]] = field
    usedCol.add(col); usedField.add(field)
  }
  for (const h of header) if (h && !(h in mapping)) mapping[h] = null
  return mapping
}

/**
 * Turn a header + matrix into lead records using a mapping.
 * @returns {{leads:Array, mapping:Object, fields:Array, skipped:number}}
 */
export function buildLeads(header, rows, mapping) {
  const map = mapping || inferMapping(header, rows)
  const idx = {}
  header.forEach((h, i) => { const f = map[h]; if (f && !(f in idx)) idx[f] = i })

  const leads = []
  let skipped = 0
  rows.forEach((r, n) => {
    if (!r.some((c) => String(c ?? '').trim() !== '')) return
    const lead = { _row: n + 2, extra: {} }
    for (const [f, i] of Object.entries(idx)) {
      const v = r[i]
      lead[f] = f === 'date' ? toISODate(v) : String(v ?? '').trim()
    }
    header.forEach((h, i) => { if (h && !map[h] && String(r[i] ?? '').trim() !== '') lead.extra[h] = r[i] })
    lead.id = lead.phone || lead.email || `${lead.name || 'lead'}#${lead._row}`
    if (!lead.name && !lead.phone && !lead.email) { skipped++; return }
    leads.push(lead)
  })
  return { leads, mapping: map, fields: FIELDS, skipped }
}

export const LEAD_FIELDS = FIELDS
