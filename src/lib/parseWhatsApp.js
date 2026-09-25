/* ── WhatsApp export parser ────────────────────────────────────────────────
   Handles the iOS "Export Chat" text format found in amber's aspirant
   community zips:

     [16/06/26, 2:46:48 PM] ~ Gunjan: ‎~ Gunjan joined from the community
     [17/06/26, 1:31:46 PM] ~ Rk: Hi everyone,⏎Anyone for Birmingham?

   Records are separated by CRLF; a bare LF inside a record is a soft line
   break in a multi-line message. Names and phone numbers are wrapped in
   bidi control characters (U+200E LRM, U+202A/U+202C embedding, U+202F
   narrow no-break space, U+00A0), all of which are stripped before use.
   Android exports (`16/06/2026, 14:46 - Sender: text`) are also accepted.

   Two details of the format do real work here:

   * WhatsApp writes U+200E immediately before the body of anything it
     rendered itself — membership notices, admin actions, attachments, polls.
     Member-typed text never carries it. That marker, not the wording, is what
     tells a join notice apart from a member writing "I've been removed from
     the group", so membership classification keys off it wherever the export
     uses it (iOS does; older Android exports do not, hence the fallback).
   * A display name may contain a colon — emoticons like `~ Alex :)` or verse
     references like `John 3:16` — so splitting on the first colon mangles it and
     silently drops their joins and exits. The marker gives an exact split for
     system notices, and the names it yields build a roster used to split the
     ambiguous message lines.
   ------------------------------------------------------------------------ */

const BIDI = /[‎‏‪‫‬‭‮⁦⁧⁨⁩]/g
const LEAD_BIDI = /^[\u200e\u200f\u202a-\u202e\u2066-\u2069]+/
/* WhatsApp appends this to any message the author later edited. */
const EDITED = /\s*<This message was edited>\s*/gi

/** Strip bidi marks and normalise the exotic spaces WhatsApp injects. */
export function clean(s) {
  return (s || '')
    .replace(BIDI, '')
    .replace(/[  ]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

// [dd/mm/yy, h:mm:ss AM] Sender:   ← iOS
const IOS = /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?\]\s*([^:]{1,120}?):\s?([\s\S]*)$/
// dd/mm/yy, hh:mm - Sender:        ← Android
const AND = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?\s*-\s*([^:]{1,120}?):\s?([\s\S]*)$/
// A dateline with no "Sender:" part — pure system notice
const IOS_SYS = /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?\]\s*([\s\S]*)$/

/* ── event classification ─────────────────────────────────────────────── */

/* Media arrives two ways: `<attached: 00000084-PHOTO-….jpg>` when the export
   included files, or `image omitted` when it did not. Either can carry a
   caption, which we keep for topic/sentiment analysis. */
const ATTACHED = /\s*<attached:\s*([^>]+)>\s*/i
const OMITTED = /\b(image|sticker|audio|video|document|GIF|Contact card|photo)\s+omitted\b/i
/* iOS prefixes a document share with "name.pdf • 13 pages" — drop that. */
const DOC_PREAMBLE = /^\s*\S[^\n]*?\.(?:pdf|xlsx?|docx?|pptx?|csv|zip|txt)\s*(?:•\s*\d+\s*pages?)?\s*/i

/** Bucket an attachment filename into a media kind. */
function mediaKind(fileName) {
  const f = (fileName || '').toLowerCase()
  if (/-photo-|\.(jpe?g|png|heic|webp)$/.test(f) && !/-sticker-/.test(f)) return 'image'
  if (/-sticker-|\.was$/.test(f)) return 'sticker'
  if (/-audio-|\.(opus|mp3|m4a|ogg|wav)$/.test(f)) return 'audio'
  if (/-video-|\.(mp4|mov|3gp|webm)$/.test(f)) return 'video'
  if (/\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip)$/.test(f)) return 'document'
  if (/vcf|contact/.test(f)) return 'contact'
  return 'file'
}

const EVENTS = [
  // membership — the numbers that drive member growth
  { type: 'join',    re: /\bjoined (?:from the community|using (?:this|a) group(?:'s)? invite link|using a group link)\b/i },
  { type: 'join',    re: /\bwas added\b/i },
  { type: 'join',    re: /^(?:You|.{1,60}?)\s+added\s+\S/i },
  { type: 'leave',   re: /\bleft\b\s*$/i },
  { type: 'leave',   re: /\b(?:removed|was removed)\b/i },
  { type: 'request', re: /\brequested to join\b/i },
  // moderation / housekeeping — noise, excluded from conversation metrics
  { type: 'admin',   re: /\b(?:is |are )?now an admin\b/i },
  { type: 'admin',   re: /\bno longer an admin\b/i },
  { type: 'admin',   re: /\bturned (?:on|off) (?:admin approval|disappearing messages)\b/i },
  { type: 'admin',   re: /\bchanged the settings\b/i },
  { type: 'admin',   re: /\bcreated (?:the |this )?group\b/i },
  { type: 'admin',   re: /\bchanged (?:the )?(?:group |subject|icon|description|their phone number|their username)/i },
  { type: 'admin',   re: /\bcreated the username\b/i },
  { type: 'admin',   re: /\bjoined this group from the community\b/i, },
  { type: 'admin',   re: /\bpinned a message\b/i },
  { type: 'admin',   re: /\badded (?:the )?group description\b/i },
  { type: 'deleted', re: /\b(?:This message was deleted|You deleted this message|deleted this message as admin|message was deleted by admin)\b/i },
  { type: 'system',  re: /\bMessages and calls are end-to-end encrypted\b/i },
  { type: 'system',  re: /\bmessages and calls are end-to-end encrypted\b/i },
  { type: 'system',  re: /\bWaiting for this message\b/i },
  { type: 'system',  re: /\bmissed (?:voice|video) call\b/i },
  { type: 'system',  re: /\bsecurity code changed\b/i },
]

/* How a member arrived, and how they went. WhatsApp words these notices
   consistently, and the distinction is the one the community team can act on:
   directory joins come from the parent Community, link joins come from
   whatever campaign carried the invite, and "added" is manual recruitment. */
const JOIN_VIA = [
  { key: 'community', label: 'Community directory', re: /\bjoined (?:from|this) (?:the )?community\b/i },
  { key: 'link',      label: 'Invite link',         re: /\bjoined using (?:this|a) group(?:'s)? (?:invite )?link\b/i },
  { key: 'added',     label: 'Added by an admin',   re: /\b(?:was added|added)\b/i },
]
const LEAVE_VIA = [
  { key: 'left',    label: 'Left voluntarily', re: /\bleft\b\s*$/i },
  { key: 'removed', label: 'Removed by admin', re: /\b(?:removed|was removed)\b/i },
]

export const JOIN_SOURCES = [
  ...JOIN_VIA.map(({ key, label }) => ({ key, label })),
  { key: 'unknown', label: 'Not stated' },
]
export const LEAVE_REASONS = [
  ...LEAVE_VIA.map(({ key, label }) => ({ key, label })),
  { key: 'unknown', label: 'Not stated' },
]

const viaOf = (table, body) => (table.find((v) => v.re.test(body)) || { key: 'unknown' }).key

/** Who a membership event is *about* (may differ from the line's author). */
function subjectOf(body, author) {
  let m = body.match(/^(.*?)\s+(?:joined|left|requested to join|was added|was removed)\b/i)
  if (m && m[1]) return clean(m[1])
  m = body.match(/\b(?:added|removed)\s+(.+?)\s*$/i)   // "You added +91…", "A added B"
  if (m && m[1]) return clean(m[1])
  return author
}

function classify(body, systemRendered) {
  if (!body) return { type: 'message' }
  if (ATTACHED.test(body) || OMITTED.test(body)) return { type: 'attachment' }
  // A poll is system-rendered but is authored content, so it stays a message.
  if (systemRendered && !/^POLL:/i.test(body)) {
    for (const e of EVENTS) if (e.re.test(body)) return { type: e.type }
  }
  return { type: 'message' }
}

/* ── link / UTM extraction ─────────────────────────────────────────────────
   amber's own campaign posts land in these groups carrying UTM-tagged
   amberstudent.com links and short.io slugs, so the chat itself is an
   attribution source we can cross-reference against GA and short.io. */
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi

export function extractLinks(text) {
  const out = []
  for (const raw of (text || '').match(URL_RE) || []) {
    const url = raw.replace(/[.,;:!?)\]]+$/, '')
    let host = '', params = {}
    try {
      const u = new URL(url)
      host = u.hostname.replace(/^www\./, '')
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
        const v = u.searchParams.get(k)
        if (v) params[k] = v
      }
      out.push({ url, host, path: u.pathname, ...params })
    } catch {
      out.push({ url, host, path: '' })
    }
  }
  return out
}

/* ── date handling ─────────────────────────────────────────────────────── */

/* WhatsApp writes the locale's own order. Indian/UK exports (amber's case)
   are day-first. We detect the order from the whole file: if any first
   component exceeds 12 the file is day-first; if any second component
   exceeds 12 it is month-first; otherwise day-first (the export locale). */
function detectDateOrder(pairs) {
  let dayFirst = false, monthFirst = false
  for (const [a, b] of pairs) {
    if (a > 12) dayFirst = true
    if (b > 12) monthFirst = true
  }
  if (monthFirst && !dayFirst) return 'MDY'
  return 'DMY'
}

function toISO(a, b, y, hh, mm, ss, ap, order) {
  let day = order === 'DMY' ? a : b
  let mon = order === 'DMY' ? b : a
  let year = y < 100 ? 2000 + y : y
  let h = hh
  if (ap) {
    const pm = /p/i.test(ap)
    if (pm && h < 12) h += 12
    if (!pm && h === 12) h = 0
  }
  const p = (n) => String(n).padStart(2, '0')
  return {
    date: `${year}-${p(mon)}-${p(day)}`,
    time: `${p(h)}:${p(mm)}:${p(ss || 0)}`,
    hour: h,
    dow: new Date(Date.UTC(year, mon - 1, day)).getUTCDay(),
    ts: Date.UTC(year, mon - 1, day, h, mm, ss || 0),
  }
}

/* ── main ──────────────────────────────────────────────────────────────── */

/* `": " + U+200E` — the exact boundary between sender and a system-rendered
   body. Everything before it on the line is the sender, colons and all. */
const SYS_SEP = /^(\[[^\]]+\]\s*)([\s\S]*?):\s?\u200e([\s\S]*)$/
const AND_SYS_SEP = /^(\d{1,2}\/\d{1,2}\/\d{2,4},[^-]*-\s*)([\s\S]*?):\s?\u200e([\s\S]*)$/

/** Longest known sender that this line starts with, or null. */
function senderFromRoster(afterStamp, roster) {
  let best = null
  for (const name of roster) {
    if (afterStamp.length > name.length &&
        afterStamp.startsWith(name) &&
        afterStamp[name.length] === ':' &&
        (best === null || name.length > best.length)) best = name
  }
  return best
}

/**
 * Parse one `_chat.txt`.
 * @param {string} text  raw file contents (CRLF preserved)
 * @param {string} group group label, e.g. "🇬🇧 UK #nospam 17"
 * @returns {{group:string, events:Array, senders:number, first:string, last:string}}
 */
export function parseWhatsAppChat(text, group) {
  // Split on the newline that *precedes a dateline*, so soft line breaks
  // inside a message stay attached to it.
  const raw = text.replace(/^﻿/, '')
  const records = raw
    .split(/\r\n|\r(?=\[)|\n(?=\[\d{1,2}\/\d{1,2}\/\d{2,4},)/)
    .filter((r) => r.trim())

  // first pass: settle DMY vs MDY, and learn the exact sender names from the
  // records WhatsApp marked as its own — including names containing colons
  const pairs = []
  const roster = new Set()
  let markedRecords = 0
  for (const r0 of records) {
    const r = r0.replace(LEAD_BIDI, '')
    const m = r.match(IOS) || r.match(AND) || r.match(IOS_SYS)
    if (m) pairs.push([+m[1], +m[2]])
    const sys = r.match(SYS_SEP) || r.match(AND_SYS_SEP)
    if (sys) { markedRecords++; if (sys[2].trim()) roster.add(sys[2]) }
  }
  const order = detectDateOrder(pairs)
  // An export that never uses the marker (older Android) has to fall back to
  // matching on wording alone.
  const usesMarker = markedRecords > 0

  const events = []
  const senders = new Set()
  let carry = null // last real message, for continuation lines

  for (const rec0 of records) {
    // Attachment and system records are prefixed with U+200E before the
    // opening bracket — strip leading bidi marks before matching.
    const rec = rec0.replace(LEAD_BIDI, '')

    /* Prefer the exact split: everything before `": " + U+200E` is the
       sender, however many colons the display name contains. */
    const sys = rec.match(SYS_SEP) || rec.match(AND_SYS_SEP)
    let m = null
    let systemRendered = false
    if (sys) {
      const stamp = sys[1].match(IOS_SYS) || `${sys[1]}x`.match(AND)
      m = (`${sys[1]}${sys[2]}: ${sys[3]}`).match(IOS) || (`${sys[1]}${sys[2]}: ${sys[3]}`).match(AND)
      if (m) {
        // the regex above can still split the name early; overwrite with the
        // exact one the marker gave us
        m = [...m]
        m[8] = sys[2]
        m[9] = sys[3]
        systemRendered = true
      }
    }
    if (!m) m = rec.match(IOS)
    if (!m) m = rec.match(AND)
    if (m && !systemRendered) {
      // ambiguous line — correct the sender against the roster of exact names
      const afterStamp = rec.replace(/^\[[^\]]+\]\s*/, '').replace(/^\d{1,2}\/\d{1,2}\/\d{2,4},[^-]*-\s*/, '')
      const exact = senderFromRoster(afterStamp, roster)
      if (exact && exact !== m[8]) {
        m = [...m]
        m[8] = exact
        m[9] = afterStamp.slice(exact.length + 1).replace(/^\s/, '')
      }
    }
    if (!m) {
      const s = rec.match(IOS_SYS)
      if (s) {
        // dateline without a sender → group-level system notice
        const t = toISO(+s[1], +s[2], +s[3], +s[4], +s[5], +s[6], s[7], order)
        events.push({ ...t, group, author: null, type: 'system', text: clean(s[8]) })
        carry = null
        continue
      }
      // a soft-wrapped continuation of the previous message
      if (carry && rec.trim()) {
        carry.text += '\n' + clean(rec)
        const links = extractLinks(carry.text)
        if (links.length) carry.links = links
      }
      continue
    }

    const t = toISO(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], m[7], order)
    const author = clean(m[8]).replace(/^~\s*/, '')
    let body = clean(m[9])
    const edited = EDITED.test(body)
    if (edited) body = clean(body.replace(EDITED, ' '))
    // Membership and admin notices are only ever system-rendered. Keying on
    // the marker rather than the wording is what keeps a member's "I've been
    // removed from the group" out of the exit count.
    const { type } = classify(body, usesMarker ? systemRendered : true)

    const ev = { ...t, group, author, type, text: body }
    if (edited) ev.edited = true

    if (type === 'join' || type === 'leave' || type === 'request') {
      ev.subject = subjectOf(body, author).replace(/^~\s*/, '')
      if (type === 'join') ev.via = viaOf(JOIN_VIA, body)
      if (type === 'leave') ev.via = viaOf(LEAVE_VIA, body)
      ev.text = ''
    }
    if (type === 'attachment') {
      const at = body.match(ATTACHED)
      if (at) {
        ev.file = clean(at[1])
        ev.media = mediaKind(ev.file)
        ev.text = clean(body.replace(ATTACHED, ' ').replace(DOC_PREAMBLE, ''))
      } else {
        ev.media = (body.match(OMITTED) || [, 'file'])[1].toLowerCase()
        ev.text = clean(body.replace(OMITTED, ' '))
      }
    }
    if (type === 'message' || type === 'attachment') {
      senders.add(author)
      const links = extractLinks(ev.text)
      if (links.length) ev.links = links
      carry = ev
    } else {
      carry = null
    }
    events.push(ev)
  }

  events.sort((a, b) => a.ts - b.ts)
  return {
    group,
    events,
    senders: senders.size,
    first: events.length ? events[0].date : null,
    last: events.length ? events[events.length - 1].date : null,
  }
}

/** Pull a human group label out of a zip entry / folder name. */
export function groupLabelFromPath(path) {
  const base = path.split('/').filter(Boolean).pop() || path
  return base
    .replace(/\.zip$/i, '')
    .replace(/\.txt$/i, '')
    .replace(/^WhatsApp Chat (?:-|with)\s*/i, '')
    .replace(/^_chat$/i, 'Chat')
    .trim()
}

/** Flag + country, for axis labels and legends ("🇬🇧 UK #nospam 17" → "🇬🇧 UK"). */
export function shortLabel(label) {
  const l = clean(label)
  const flag = (l.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u) || [''])[0]
  const country = countryFromLabel(l)
  return `${flag} ${country}`.trim()
}

/** Best-effort country from a group label ("🇬🇧 UK #nospam 17" → UK). */
export function countryFromLabel(label) {
  const l = clean(label).replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '').trim()
  const m = l.match(/^([A-Za-z][A-Za-z .'-]*?)\s*(?:#|\d|$)/)
  return (m ? m[1] : l).trim() || label
}
