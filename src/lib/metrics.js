/* ── Aggregation engine ────────────────────────────────────────────────────
   One pure function per surface, all taking (dataset, filter). The filter is
   { from, to, groups } — every number in the UI is derived here so the date
   picker genuinely governs the whole dashboard rather than each chart
   re-deriving its own idea of the window.
   ------------------------------------------------------------------------ */
import { eachDay, addDays, daysBetween, previousRange } from './dates.js'
import { scoreSentiment, isQuestion } from './nlp/sentiment.js'
import { topicsOf, rankTopics, mineKeywords } from './nlp/topics.js'
import { shortLabel, JOIN_SOURCES, LEAVE_REASONS } from './parseWhatsApp.js'

const inRange = (d, from, to) => d >= from && d <= to

/* ── enrichment ───────────────────────────────────────────────────────────
   Sentiment and topic tagging is the expensive pass, so it runs once per
   import and the results ride along on the event. */
export function enrichEvents(events) {
  for (const e of events) {
    if (e.type !== 'message' && e.type !== 'attachment') continue
    if (e._sentiment !== undefined) continue
    const s = scoreSentiment(e.text)
    e._sentiment = s.score
    e._sentLabel = s.label
    e._question = isQuestion(e.text)
    e._topics = topicsOf(e.text)
    e._words = e.text ? e.text.trim().split(/\s+/).length : 0
  }
  return events
}

/** Every WhatsApp event across the selected groups, already enriched. */
export function eventsFor(community, groups) {
  const pick = groups && groups.length ? new Set(groups) : null
  const out = []
  for (const g of community?.groups || []) {
    if (pick && !pick.has(g.group)) continue
    out.push(...g.events)
  }
  return out
}

/* ── member growth ─────────────────────────────────────────────────────── */

/**
 * Daily joins / leaves / requests plus a running total.
 * `baseline` is the membership carried in from before `from`, so the
 * "Total members" line is correct for any window, not just full history.
 */
export function memberSeries(events, { from, to }) {
  const day = new Map()
  let baseline = 0
  for (const e of events) {
    const delta = e.type === 'join' ? 1 : e.type === 'leave' ? -1 : 0
    if (e.date < from) { baseline += delta; continue }
    if (e.date > to) continue
    let d = day.get(e.date)
    if (!d) day.set(e.date, (d = { date: e.date, joined: 0, left: 0, requests: 0 }))
    if (e.type === 'join') d.joined++
    else if (e.type === 'leave') d.left++
    else if (e.type === 'request') d.requests++
  }
  let running = baseline
  const series = eachDay(from, to).map((date) => {
    const d = day.get(date) || { date, joined: 0, left: 0, requests: 0 }
    running += d.joined - d.left
    return { ...d, net: d.joined - d.left, members: running }
  })
  const joined = series.reduce((s, d) => s + d.joined, 0)
  const left = series.reduce((s, d) => s + d.left, 0)
  const requests = series.reduce((s, d) => s + d.requests, 0)
  return {
    series,
    baseline,
    totals: {
      members: running,
      joined,
      left,
      net: joined - left,
      requests,
      churnRate: baseline + joined > 0 ? left / (baseline + joined) : 0,
      retention: baseline + joined > 0 ? 1 - left / (baseline + joined) : 0,
    },
  }
}

/** Per-group growth, for the breakdown table. */
export function memberByGroup(community, { from, to, groups }) {
  const pick = groups && groups.length ? new Set(groups) : null
  return (community?.groups || [])
    .filter((g) => !pick || pick.has(g.group))
    .map((g) => {
      const m = memberSeries(g.events, { from, to })
      const msgs = g.events.filter((e) => (e.type === 'message' || e.type === 'attachment') && inRange(e.date, from, to))
      const people = new Set(msgs.map((e) => e.author))
      return {
        label: g.group,
        short: shortLabel(g.rawGroup || g.group),
        community: g.communityName || null,
        country: g.country,
        members: m.totals.members,
        joined: m.totals.joined,
        left: m.totals.left,
        net: m.totals.net,
        requests: m.totals.requests,
        messages: msgs.length,
        contributors: people.size,
        churnRate: m.totals.churnRate,
        // share of members who said anything in the window
        engagement: m.totals.members > 0 ? people.size / m.totals.members : 0,
        sentiment: msgs.length ? +(msgs.reduce((s, e) => s + (e._sentiment || 0), 0) / msgs.length).toFixed(3) : 0,
      }
    })
    .sort((a, b) => b.members - a.members)
}

/**
 * The same breakdown as memberByGroup, one row per community. Only meaningful
 * in the all-communities scope, where it answers the question that scope
 * exists for: which community is actually growing.
 */
export function byCommunity(communities, { from, to }) {
  return (communities || []).map((c) => {
    const events = c.groups.flatMap((g) => g.events)
    const m = memberSeries(events, { from, to })
    const msgs = events.filter((e) => (e.type === 'message' || e.type === 'attachment') && inRange(e.date, from, to))
    const people = new Set(msgs.map((e) => e.author))
    return {
      id: c.id,
      label: c.name,
      groups: c.groups.length,
      members: m.totals.members,
      joined: m.totals.joined,
      left: m.totals.left,
      net: m.totals.net,
      requests: m.totals.requests,
      churnRate: m.totals.churnRate,
      messages: msgs.length,
      contributors: people.size,
      engagement: m.totals.members > 0 ? people.size / m.totals.members : 0,
      sentiment: msgs.length ? +(msgs.reduce((s, e) => s + (e._sentiment || 0), 0) / msgs.length).toFixed(3) : 0,
      leads: c.leads?.leads?.length || 0,
      series: m.series,
    }
  }).sort((a, b) => b.members - a.members)
}

/**
 * How new members arrived, straight from the join notices. This is the one
 * acquisition number that is exact rather than modelled — GA and short.io
 * describe traffic to the landing pages, which is a different (earlier) step
 * and cannot be joined to an individual join event.
 */
export function joinSources(events, { from, to }) {
  const acc = new Map()
  for (const e of events) {
    if (e.type !== 'join' || !inRange(e.date, from, to)) continue
    const key = e.via || 'unknown'
    let a = acc.get(key)
    if (!a) acc.set(key, (a = { key, joins: 0, groups: new Set() }))
    a.joins++
    a.groups.add(e.group)
  }
  const total = [...acc.values()].reduce((s2, a) => s2 + a.joins, 0)
  return JOIN_SOURCES
    .map(({ key, label }) => {
      const a = acc.get(key)
      return {
        key, label,
        value: a ? a.joins : 0,
        groups: a ? a.groups.size : 0,
        share: total ? (a ? a.joins : 0) / total : 0,
      }
    })
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
}

/** The mirror of joinSources: left of their own accord, or removed. */
export function leaveReasons(events, { from, to }) {
  const acc = new Map()
  for (const e of events) {
    if (e.type !== 'leave' || !inRange(e.date, from, to)) continue
    const key = e.via || 'unknown'
    acc.set(key, (acc.get(key) || 0) + 1)
  }
  const total = [...acc.values()].reduce((s2, n) => s2 + n, 0)
  return LEAVE_REASONS
    .map(({ key, label }) => ({ key, label, value: acc.get(key) || 0, share: total ? (acc.get(key) || 0) / total : 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
}

/** Daily message volume per community — one series each, shared x-axis. */
export function dailyByCommunity(communities, { from, to }) {
  return (communities || []).map((c) => {
    const events = c.groups.flatMap((g) => g.events)
    const conv = conversationSeries(events, { from, to })
    return {
      id: c.id,
      label: c.name,
      series: conv.series,
      totals: conv.totals,
    }
  })
}

/**
 * One row per country group: membership movement plus conversation activity,
 * ranked by messages. Feeds the Country groups table (Groups tab) and the
 * per-group chart and theme cards (Overview). `label` is the flag + country;
 * in the all-communities fold it names the community too, since every
 * community has its own UK group.
 */
export function groupActivity(community, { from, to }) {
  return (community?.groups || []).map((g) => {
    const conv = conversationSeries(g.events, { from, to })
    const mem = memberSeries(g.events, { from, to })
    const base = shortLabel(g.rawGroup || g.group)
    return {
      key: g.group,
      label: g.communityName ? `${base} · ${g.communityName}` : base,
      full: g.rawGroup || g.group,
      community: g.communityName || null,
      members: mem.totals.members,
      joined: mem.totals.joined,
      left: mem.totals.left,
      net: mem.totals.net,
      messages: conv.totals.messages,
      perDay: conv.totals.msgsPerDay,
      contributors: conv.totals.contributors,
      questions: conv.totals.questions,
      sentiment: conv.totals.sentiment,
      series: conv.series,
    }
  }).sort((a, b) => b.messages - a.messages)
}

/* ── conversations ─────────────────────────────────────────────────────── */

export function conversationSeries(events, { from, to }) {
  const day = new Map()
  for (const e of events) {
    if (e.type !== 'message' && e.type !== 'attachment') continue
    if (!inRange(e.date, from, to)) continue
    let d = day.get(e.date)
    if (!d) day.set(e.date, (d = { date: e.date, messages: 0, people: new Set(), questions: 0, sent: 0, pos: 0, neg: 0, neu: 0, media: 0, words: 0 }))
    d.messages++
    d.people.add(e.author)
    if (e._question) d.questions++
    if (e.type === 'attachment') d.media++
    d.words += e._words || 0
    d.sent += e._sentiment || 0
    if (e._sentLabel === 'positive') d.pos++
    else if (e._sentLabel === 'negative') d.neg++
    else d.neu++
  }
  const series = eachDay(from, to).map((date) => {
    const d = day.get(date)
    if (!d) return { date, messages: 0, contributors: 0, questions: 0, sentiment: 0, pos: 0, neg: 0, neu: 0, media: 0, words: 0 }
    return {
      date, messages: d.messages, contributors: d.people.size, questions: d.questions,
      sentiment: +(d.sent / d.messages).toFixed(4), pos: d.pos, neg: d.neg, neu: d.neu,
      media: d.media, words: d.words,
    }
  })
  const msgs = series.reduce((s, d) => s + d.messages, 0)
  const allPeople = new Set()
  for (const e of events) {
    if ((e.type === 'message' || e.type === 'attachment') && inRange(e.date, from, to)) allPeople.add(e.author)
  }
  const sentSum = series.reduce((s, d) => s + d.sentiment * d.messages, 0)
  const activeDays = series.filter((d) => d.messages > 0).length
  return {
    series,
    totals: {
      messages: msgs,
      contributors: allPeople.size,
      questions: series.reduce((s, d) => s + d.questions, 0),
      media: series.reduce((s, d) => s + d.media, 0),
      sentiment: msgs ? +(sentSum / msgs).toFixed(4) : 0,
      pos: series.reduce((s, d) => s + d.pos, 0),
      neg: series.reduce((s, d) => s + d.neg, 0),
      neu: series.reduce((s, d) => s + d.neu, 0),
      msgsPerDay: activeDays ? +(msgs / activeDays).toFixed(1) : 0,
      activeDays,
    },
  }
}

/** Top contributors, with the signals that separate helpers from noise. */
export function contributors(events, { from, to }) {
  const acc = new Map()
  for (const e of events) {
    if (e.type !== 'message' && e.type !== 'attachment') continue
    if (!inRange(e.date, from, to)) continue
    let a = acc.get(e.author)
    if (!a) acc.set(e.author, (a = { label: e.author, messages: 0, words: 0, questions: 0, answers: 0, sent: 0, days: new Set(), groups: new Set(), topics: new Map(), media: 0, first: e.date, last: e.date }))
    a.messages++
    a.words += e._words || 0
    if (e._question) a.questions++
    else a.answers++
    if (e.type === 'attachment') a.media++
    a.sent += e._sentiment || 0
    a.days.add(e.date)
    a.groups.add(e.group)
    for (const t of e._topics || []) a.topics.set(t.key, (a.topics.get(t.key) || 0) + 1)
    if (e.date < a.first) a.first = e.date
    if (e.date > a.last) a.last = e.date
  }
  return [...acc.values()]
    .map((a) => ({
      label: a.label,
      messages: a.messages,
      words: a.words,
      avgWords: a.messages ? +(a.words / a.messages).toFixed(1) : 0,
      questions: a.questions,
      answers: a.answers,
      media: a.media,
      activeDays: a.days.size,
      groups: a.groups.size,
      groupList: [...a.groups],
      sentiment: a.messages ? +(a.sent / a.messages).toFixed(3) : 0,
      topTopic: [...a.topics.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || null,
      first: a.first,
      last: a.last,
      // helper score: answering, at length, on many days, across groups
      helpfulness: +(a.answers * 1 + a.days.size * 2 + (a.groups.size - 1) * 3 + Math.min(a.words / 40, 25)).toFixed(1),
    }))
    .sort((a, b) => b.messages - a.messages)
}

/** Reply latency, measured on gap-delimited bursts of conversation. */
export function responsiveness(events, { from, to }, idleMinutes = 45) {
  const msgs = events
    .filter((e) => (e.type === 'message' || e.type === 'attachment') && inRange(e.date, from, to))
    .sort((a, b) => a.ts - b.ts)
  const byGroup = new Map()
  for (const m of msgs) {
    if (!byGroup.has(m.group)) byGroup.set(m.group, [])
    byGroup.get(m.group).push(m)
  }
  const gapMs = idleMinutes * 60000
  let threads = 0, answered = 0, latencies = []
  for (const list of byGroup.values()) {
    let openQuestion = null
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (openQuestion && m.ts - openQuestion.ts > gapMs) openQuestion = null
      if (openQuestion && m.author !== openQuestion.author) {
        answered++
        latencies.push((m.ts - openQuestion.ts) / 60000)
        openQuestion = null
      }
      if (!openQuestion && m._question) { openQuestion = m; threads++ }
    }
  }
  latencies.sort((a, b) => a - b)
  const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : null
  return {
    questions: threads,
    answered,
    answerRate: threads ? answered / threads : 0,
    medianMinutes: median === null ? null : +median.toFixed(1),
    p90Minutes: latencies.length ? +latencies[Math.floor(latencies.length * 0.9)].toFixed(1) : null,
  }
}

/** hour × weekday activity grid. */
export function activityHeatmap(events, { from, to }) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0))
  let max = 0
  for (const e of events) {
    if (e.type !== 'message' && e.type !== 'attachment') continue
    if (!inRange(e.date, from, to)) continue
    const v = ++grid[e.dow][e.hour]
    if (v > max) max = v
  }
  return { grid, max }
}

export function topicsFor(events, { from, to }) {
  const msgs = events.filter((e) => (e.type === 'message' || e.type === 'attachment') && inRange(e.date, from, to) && e.text)
  return { topics: rankTopics(msgs), keywords: mineKeywords(msgs), sampled: msgs.length }
}

/** Daily volume for one topic — powers the topic trend sparkline. */
export function topicSeries(events, { from, to }, key) {
  const day = new Map()
  for (const e of events) {
    if (e.type !== 'message' && e.type !== 'attachment') continue
    if (!inRange(e.date, from, to)) continue
    if (!(e._topics || []).some((t) => t.key === key)) continue
    day.set(e.date, (day.get(e.date) || 0) + 1)
  }
  return eachDay(from, to).map((date) => ({ date, value: day.get(date) || 0 }))
}

/** UTM-tagged links posted inside the chat itself. */
export function chatLinks(events, { from, to }) {
  const acc = new Map()
  for (const e of events) {
    if (!e.links || !inRange(e.date, from, to)) continue
    for (const l of e.links) {
      const key = `${l.host}${l.path}|${l.utm_source || ''}|${l.utm_medium || ''}|${l.utm_campaign || ''}`
      let a = acc.get(key)
      if (!a) acc.set(key, (a = { host: l.host, path: l.path, utm_source: l.utm_source, utm_medium: l.utm_medium, utm_campaign: l.utm_campaign, utm_content: l.utm_content, posts: 0, groups: new Set(), posters: new Set(), first: e.date, last: e.date }))
      a.posts++
      a.groups.add(e.group)
      a.posters.add(e.author)
      if (e.date < a.first) a.first = e.date
      if (e.date > a.last) a.last = e.date
    }
  }
  return [...acc.values()]
    .map((a) => ({ ...a, groups: a.groups.size, posters: a.posters.size, tagged: !!a.utm_source }))
    .sort((a, b) => b.posts - a.posts)
}

/* ── attribution (GA + short.io) ───────────────────────────────────────── */

/**
 * How much of a window a feed actually covers. GA and short.io exports start
 * when someone first ran them, so a previous-period comparison can land on
 * days the feed knows nothing about — and printing "▲3350%" against that is
 * worse than printing nothing. Callers suppress the delta below `min`.
 */
export function comparability(feedRange, window, min = 0.9) {
  if (!feedRange?.from || !window?.from) return { coverage: 0, comparable: false }
  const from = feedRange.from > window.from ? feedRange.from : window.from
  const to = feedRange.to < window.to ? feedRange.to : window.to
  const overlap = from > to ? 0 : daysBetween(from, to) + 1
  const len = daysBetween(window.from, window.to) + 1
  const coverage = len > 0 ? overlap / len : 0
  return { coverage, comparable: coverage >= min, days: overlap, of: len }
}

/** Clip a stored daily series to the window. */
export const clip = (series, { from, to }, dateKey = 'date') =>
  (series || []).filter((r) => inRange(r[dateKey], from, to))

/**
 * GA and short.io ship pre-aggregated dimension tables covering their own
 * export window. When the dashboard window is narrower we cannot re-slice
 * them, so we scale each dimension by the share of daily volume that falls
 * inside the window and label the result as estimated.
 */
export function scaleDimensions(dims, daily, range, valueKey = 'value') {
  const total = (daily || []).reduce((s, d) => s + (d.clicks ?? d.value ?? 0), 0)
  const inWin = clip(daily, range).reduce((s, d) => s + (d.clicks ?? d.value ?? 0), 0)
  const factor = total > 0 ? inWin / total : 1
  const estimated = factor < 0.999
  const out = {}
  for (const [k, items] of Object.entries(dims || {})) {
    out[k] = (items || []).map((i) => ({ ...i, [valueKey]: Math.round(i[valueKey] * factor) })).filter((i) => i[valueKey] > 0)
  }
  return { dims: out, factor, estimated, coverage: total ? inWin / total : 0 }
}

/**
 * One attribution table from two feeds that describe different halves of the
 * journey. GA reports genuine source/medium pairs, so those are the rows.
 * short.io reports each UTM dimension as its own ranked list, which cannot be
 * re-paired without inventing combinations — so its clicks are joined onto a
 * GA row only when the utm_source unambiguously names it, and otherwise stand
 * as their own rows. Untagged clicks are reported separately rather than
 * being dressed up as a source.
 */
export function attribution(ga, shortio, range) {
  const rows = new Map()
  const key = (s, m) => `${String(s).toLowerCase()}|${String(m).toLowerCase()}`
  const put = (source, medium, patch) => {
    const k = key(source, medium)
    let r = rows.get(k)
    if (!r) rows.set(k, (r = { source, medium, users: 0, sessions: 0, clicks: 0, campaigns: new Set(), from: new Set() }))
    r.users += patch.users || 0
    r.sessions += patch.sessions || 0
    r.clicks += patch.clicks || 0
    if (patch.from) r.from.add(patch.from)
    return r
  }

  let gaScale = 1
  if (ga) {
    gaScale = coverageFactor(ga.daily, range, (d) => (d.new || 0) + (d.returning || 0))
    for (const i of ga.blocks?.firstUser?.items || []) {
      const { source, medium } = splitSM(i.label)
      put(source, medium, { users: Math.round(i.value * gaScale), from: 'ga' })
    }
    for (const i of ga.blocks?.sessions?.items || []) {
      const { source, medium } = splitSM(i.label)
      put(source, medium, { sessions: Math.round(i.value * gaScale), from: 'ga' })
    }
    for (const i of ga.blocks?.campaigns?.items || []) {
      const r = [...rows.values()].find((x) => x.from.has('ga'))
      if (r && i.label && i.label !== '(not set)') r.campaigns.add(i.label)
    }
  }

  const untagged = { clicks: 0, campaigns: [] }
  if (shortio) {
    const sScale = coverageFactor(shortio.daily, range, (d) => d.clicks || 0)
    const campaigns = (shortio.dims?.utmCampaign || [])
      .filter((c) => c.label && c.label !== '(not set)')
      .map((c) => c.label)

    for (const s of shortio.dims?.utmSource || []) {
      const clicks = Math.round(s.value * sScale)
      if (!clicks) continue
      if (!s.label || s.label === '(not set)' || s.label === 'unknown') {
        untagged.clicks += clicks
        continue
      }
      // join onto a GA row only when exactly one GA row carries this source
      const matches = [...rows.values()].filter((r) => r.source.toLowerCase() === s.label.toLowerCase())
      if (matches.length === 1) {
        matches[0].clicks += clicks
        matches[0].from.add('shortio')
        campaigns.forEach((c) => matches[0].campaigns.add(c))
      } else {
        const r = put(s.label, matches.length > 1 ? 'multiple' : '—', { clicks, from: 'shortio' })
        campaigns.forEach((c) => r.campaigns.add(c))
      }
    }
    untagged.campaigns = campaigns
  }

  const list = [...rows.values()]
    .map((r) => ({
      ...r,
      campaigns: [...r.campaigns],
      from: [...r.from],
      total: r.users + r.sessions + r.clicks,
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)

  list.untagged = untagged
  return list
}

/* ── acquisition sources ────────────────────────────────────────────────
   The channels the team reports on, each read from the feed that actually
   carries it. IG and Organic are UTM-tagged traffic, which only GA records
   (short.io sees no utm_source=ig at all); Scholarship is the set of
   /scholarship short links, which only short.io records. Units therefore
   differ per tile — users for the GA sources, clicks for short.io — and each
   tile says which.

   To add a channel, add a row here. `ga` rows match GA's first-user
   source/medium; `shortio` rows match short.io's top-links sheet.        */
export const ACQUISITION_SOURCES = [
  {
    key: 'ig', label: 'IG', feed: 'ga',
    provenance: 'UTM links · utm_source=ig, via GA',
    match: ({ source }) => /^(ig|instagram|insta)$/i.test(source),
  },
  {
    key: 'scholarship', label: 'Scholarship', feed: 'shortio',
    provenance: 'short.io · /scholarship links',
    matchLink: (path) => /scholarship/i.test(path),
    // the link slugs carry the team, which is worth surfacing
    part: (path) => (path.match(/scholarship-?(team\w+)/i)?.[1] || path).replace(/^team/i, 'Team '),
  },
  {
    key: 'organic', label: 'Organic', feed: 'ga',
    provenance: 'UTM links · medium=organic, via GA',
    match: ({ medium }) => /^organic$/i.test(medium),
  },
]

/**
 * One tile per ACQUISITION_SOURCES row, for a window and its predecessor.
 *
 * Both feeds are pre-aggregated over their own export window, so a narrower
 * dashboard window is served by scaling each total by the share of the feed's
 * daily volume that falls inside it — the same method the UTM tab uses, and
 * flagged the same way. A previous period the feed does not cover gets no
 * delta rather than a fabricated one.
 */
export function acquisitionSources(ga, shortio, range, prevRange) {
  const gaPick = (d) => (d.new || 0) + (d.returning || 0)
  const siPick = (d) => d.clicks || 0
  const gaCur = ga ? coverageFactor(ga.daily, range, gaPick) : 0
  const gaPrev = ga ? coverageFactor(ga.daily, prevRange, gaPick) : 0
  const siCur = shortio ? coverageFactor(shortio.daily, range, siPick) : 0
  const siPrev = shortio ? coverageFactor(shortio.daily, prevRange, siPick) : 0
  const gaCmp = comparability(ga?.range, prevRange)
  const siCmp = comparability(shortio?.range, prevRange)

  return ACQUISITION_SOURCES.map((src) => {
    if (src.feed === 'ga') {
      if (!ga) return { ...src, unit: 'users', available: false }
      const users = (ga.blocks?.firstUser?.items || [])
        .filter((i) => src.match(splitSM(i.label))).reduce((n, i) => n + i.value, 0)
      const sessions = (ga.blocks?.sessions?.items || [])
        .filter((i) => src.match(splitSM(i.label))).reduce((n, i) => n + i.value, 0)
      return {
        ...src, unit: 'users', available: true,
        value: Math.round(users * gaCur),
        prev: gaCmp.comparable ? Math.round(users * gaPrev) : null,
        secondary: { label: 'sessions', value: Math.round(sessions * gaCur) },
        estimated: gaCur < 0.999,
        comparable: gaCmp.comparable,
        feedFrom: ga.range?.from,
      }
    }
    // short.io
    if (!shortio) return { ...src, unit: 'clicks', available: false }
    const links = (shortio.dims?.links || []).filter((l) => src.matchLink(l.label))
    const clicks = links.reduce((n, l) => n + l.value, 0)
    return {
      ...src, unit: 'clicks', available: true,
      value: Math.round(clicks * siCur),
      prev: siCmp.comparable ? Math.round(clicks * siPrev) : null,
      parts: src.part
        ? links.map((l) => ({ label: src.part(l.label), value: Math.round(l.value * siCur) }))
            .filter((p) => p.value > 0).sort((a, b) => b.value - a.value)
        : [],
      estimated: siCur < 0.999,
      comparable: siCmp.comparable,
      feedFrom: shortio.range?.from,
    }
  })
}

function coverageFactor(daily, range, pick) {
  const total = (daily || []).reduce((s, d) => s + pick(d), 0)
  if (!total) return 1
  const inWin = clip(daily, range).reduce((s, d) => s + pick(d), 0)
  return inWin / total
}

function splitSM(label) {
  const [s, m] = String(label).split('/').map((x) => (x || '').trim())
  const c = (v) => (!v || v === '(none)' || v === '(not set)' ? null : v.replace(/^\(|\)$/g, ''))
  return { source: c(s) || 'direct', medium: c(m) || 'none' }
}

/* ── leads ─────────────────────────────────────────────────────────────── */

export function leadSeries(leads, { from, to }) {
  const day = new Map()
  let undated = 0
  for (const l of leads || []) {
    if (!l.date) { undated++; continue }
    if (!inRange(l.date, from, to)) continue
    day.set(l.date, (day.get(l.date) || 0) + 1)
  }
  const series = eachDay(from, to).map((date) => ({ date, leads: day.get(date) || 0 }))
  return { series, total: series.reduce((s, d) => s + d.leads, 0), undated }
}

export function leadBreakdown(leads, { from, to }, field) {
  const acc = new Map()
  for (const l of leads || []) {
    if (l.date && !inRange(l.date, from, to)) continue
    const v = (l[field] || '').trim() || '(not set)'
    acc.set(v, (acc.get(v) || 0) + 1)
  }
  return [...acc.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
}

/* ── comparison ────────────────────────────────────────────────────────── */

/** Run a metric fn over the previous equal-length window for deltas. */
export function withComparison(fn, range) {
  const cur = fn(range)
  const prev = fn(previousRange(range))
  return { cur, prev }
}

export const delta = (a, b) => {
  if (b === 0) return a === 0 ? 0 : null   // null → "new", no percentage exists
  return (a - b) / Math.abs(b)
}
