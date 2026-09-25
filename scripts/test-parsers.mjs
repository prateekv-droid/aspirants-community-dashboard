/* ── Parser regression suite ───────────────────────────────────────────────
   Runs the real detection pipeline over the bundled sample exports and
   asserts the numbers the dashboard depends on. No test framework — this is
   meant to be run with `npm test` and read as output.
     node scripts/test-parsers.mjs
   ------------------------------------------------------------------------ */
import fs from 'node:fs'
import path from 'node:path'
import { detectAndParse } from '../src/lib/detect.js'
import { parseWhatsAppChat, extractLinks, shortLabel, countryFromLabel } from '../src/lib/parseWhatsApp.js'
import { parseCSV } from '../src/lib/csv.js'
import { inferMapping, buildLeads, toISODate } from '../src/lib/parseLeads.js'
import { emptyState, ensureCommunity, mergeWhatsApp, addSnapshot, mergeGA, mergeShortIo, planMigration, PARSER_VERSION } from '../src/lib/store.js'
import { enrichEvents, eventsFor, memberSeries, conversationSeries, contributors, topicsFor, responsiveness, attribution, comparability, acquisitionSources, groupActivity } from '../src/lib/metrics.js'
import { scoreSentiment, isQuestion } from '../src/lib/nlp/sentiment.js'

const SAMPLES = path.join(import.meta.dirname, '..', 'public', 'samples')
let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n${t}`)

const read = (f) => {
  const b = fs.readFileSync(path.join(SAMPLES, f))
  return { name: f, buffer: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
}

/* The WhatsApp sample is real member data — phone numbers and messages — so
   it is kept out of git. Without it the suites that need it are skipped and
   say so; everything that runs on GA, short.io or synthetic input still runs. */
const HAVE_WA = fs.existsSync(path.join(SAMPLES, 'WA community 1.zip'))
let skipped = 0

/* date windows shared by several suites */
const full = { from: '2026-04-14', to: '2026-08-24' }
const win = { from: '2026-07-28', to: '2026-08-24' }

/* ── source detection ─────────────────────────────────────────────────── */
section('Source auto-detection')
const ga = await detectAndParse(read('GA Data.csv'))
ok('GA snapshot detected', ga.source === 'ga')
ok('every GA report card recognised', ga.payload.unknown.length === 0, `${Object.keys(ga.payload.blocks).length} blocks, 0 unknown`)
ok('GA daily series reconstructed from "Nth day"', ga.payload.daily.length === 28,
   `${ga.payload.daily[0]?.date} → ${ga.payload.daily.at(-1)?.date}`)
ok('GA totals read', ga.payload.blocks.summary['Active users'] === 382)

const si = await detectAndParse(read('Short io click data.xlsx'))
ok('short.io workbook detected', si.source === 'shortio')
ok('no unrecognised short.io tabs', si.payload.unknown.length === 0, `${Object.keys(si.payload.dims).length} dimensions`)
ok('short.io totals read', si.payload.totals.clicks === 2258, `${si.payload.totals.clicks} clicks / ${si.payload.totals.links} links`)

/* ── attribution honesty ──────────────────────────────────────────────── */
section('Attribution')
const attrib = attribution(ga.payload, si.payload, win)
ok('GA source/medium pairs preserved', attrib.some((r) => r.source === 'ig' && r.medium === 'social'))
ok('short.io joins onto GA only on an unambiguous source',
   attrib.find((r) => r.source === 'whatsapp')?.from.join('+') === 'ga+shortio')
ok('untagged clicks reported separately, not as a source',
   attrib.untagged.clicks > 0 && !attrib.some((r) => /not set|unknown/i.test(r.source)),
   `${attrib.untagged.clicks} untagged`)
const cmp = comparability(si.payload.range, { from: '2026-07-01', to: '2026-07-27' })
ok('comparison suppressed outside the export window', !cmp.comparable, `${(cmp.coverage * 100) | 0}% covered`)

/* ── source tiles ─────────────────────────────────────────────────────
   Each tile must read the feed that actually carries its channel. Over GA's
   own export window no scaling applies, so IG and Organic must equal GA's
   reported first-user figures exactly. */
section('Source tiles')
const gaWin = { from: ga.payload.range.from, to: ga.payload.range.to }
const gaPrevWin = { from: '2026-06-30', to: '2026-07-27' }
const tiles = Object.fromEntries(acquisitionSources(ga.payload, si.payload, gaWin, gaPrevWin).map((t) => [t.key, t]))
ok('tile row is IG, Scholarship, Organic in that order',
   acquisitionSources(ga.payload, si.payload, gaWin, gaPrevWin).map((t) => t.label).join(',') === 'IG,Scholarship,Organic')
ok('IG reads GA utm_source=ig first-user users, unscaled over GA window',
   tiles.ig.value === 262 && tiles.ig.unit === 'users' && !tiles.ig.estimated, `${tiles.ig.value} users`)
ok('Organic reads GA medium=organic first-user users',
   tiles.organic.value === 10 && tiles.organic.unit === 'users', `${tiles.organic.value} users`)
const siWin = { from: si.payload.range.from, to: si.payload.range.to }
const siTiles = Object.fromEntries(acquisitionSources(ga.payload, si.payload, siWin, gaPrevWin).map((t) => [t.key, t]))
ok('Scholarship reads short.io /scholarship links — all three teams',
   siTiles.scholarship.value === 2058 && siTiles.scholarship.unit === 'clicks' && siTiles.scholarship.parts.length === 3,
   `${siTiles.scholarship.value} clicks · ${siTiles.scholarship.parts.map((p) => `${p.label} ${p.value}`).join(', ')}`)
ok('Scholarship excludes non-scholarship links (/traveldeals)',
   siTiles.scholarship.value < si.payload.totals.clicks)
ok('no delta invented for a previous period the feeds do not cover',
   tiles.ig.prev === null && tiles.scholarship.prev === null)
const inside = acquisitionSources(ga.payload, si.payload, { from: '2026-08-12', to: '2026-08-24' }, { from: '2026-07-30', to: '2026-08-11' })
ok('delta available when the previous period sits inside both exports',
   inside.every((t) => typeof t.prev === 'number'))
ok('narrower window is scaled and flagged as an estimate',
   inside.every((t) => t.estimated) && inside.find((t) => t.key === 'ig').value < 262)
const noFeeds = acquisitionSources(null, null, gaWin, gaPrevWin)
ok('missing feeds render as unavailable rather than zero',
   noFeeds.every((t) => t.available === false && t.value === undefined))

/* ── migrating data parsed by an older parser ─────────────────────────── */
section('Parser-version migration')
const samples = ['WA community 1.zip', 'GA Data.csv', 'Short io click data.xlsx']
const v1 = (imports) => ({
  communities: [
    { id: 'community-1', name: 'Community #1', groups: [{ group: 'UK', events: [{}] }] },
    { id: 'community-2', name: 'Community #2', groups: [{ group: 'UK', events: [{}] }] },
    { id: 'community-3', name: 'Community #3', groups: [] },
  ],
  imports,
})
const plan = planMigration(v1([
  { source: 'whatsapp', communityId: 'community-1', fileName: 'WA community 1.zip' },
  { source: 'ga', communityId: 'community-1', fileName: 'GA Data.csv' },
  { source: 'whatsapp', communityId: 'community-2', fileName: 'WA community 2.zip' },
]), samples)
ok('sample-seeded community is re-parsed automatically', plan.reparse.join() === 'community-1')
ok('operator-uploaded community is flagged for re-upload', plan.stale.join() === 'community-2')
ok('community without WhatsApp data is left alone',
   !plan.reparse.includes('community-3') && !plan.stale.includes('community-3'))
const mixed = planMigration(v1([
  { source: 'whatsapp', communityId: 'community-1', fileName: 'WA community 1.zip' },
  { source: 'whatsapp', communityId: 'community-1', fileName: 'my later export.zip' },
]), samples)
ok('a sample topped up with an upload is not silently re-parsed', mixed.stale.includes('community-1'))
ok('current-version data needs no migration',
   planMigration({ ...v1([]), parserVersion: PARSER_VERSION }, samples).reparse.length === 0)
ok('fresh state is stamped with the current parser version', emptyState().parserVersion === PARSER_VERSION)

/* ── leads mapping ────────────────────────────────────────────────────── */
section('Leads sheet mapping')
const leadCsv = path.join(import.meta.dirname, '..', 'public', 'leads-sample.csv')
if (fs.existsSync(leadCsv)) {
  const rows = parseCSV(fs.readFileSync(leadCsv, 'utf8'))
  const map = inferMapping(rows[0], rows.slice(1))
  const built = buildLeads(rows[0], rows.slice(1), map)
  ok('awkward column names still map', map['WhatsApp Number'] === 'phone' && map['Study Destination'] === 'country' && map['Submission Date'] === 'date')
  ok('unmapped columns are preserved', built.leads[0].extra && 'Internal Notes' in built.leads[0].extra)
  ok('all rows become records', built.leads.length === rows.length - 1, `${built.leads.length} leads`)
} else {
  console.log('  – leads-sample.csv absent, skipping')
}
ok('day-first dates parse day-first', toISODate('5/7/2026') === '2026-07-05')
ok('unambiguous month-first still parses', toISODate('12/25/2026') === '2026-12-25')
ok('ISO dates pass through', toISODate('2026-08-24') === '2026-08-24')

/* ── everything below needs the WhatsApp sample ────────────────────── */
if (HAVE_WA) {
  section('WhatsApp community detection')
  const wa = await detectAndParse(read('WA community 1.zip'))
  ok('WhatsApp community zip detected', wa.source === 'whatsapp', `${(wa.confidence * 100) | 0}% confidence`)
  ok('all five country groups found', wa.payload.groups.length === 5, wa.payload.groups.map((g) => shortLabel(g.group)).join(', '))
  ok('community name inferred', wa.payload.communityName === 'Community #1', wa.payload.communityName)

  /* ── WhatsApp transcript details ──────────────────────────────────────── */
  section('WhatsApp transcript parsing')
  const all = wa.payload.groups.flatMap((g) => g.events)
  const count = (t) => all.filter((e) => e.type === t).length
  /* 694, not 697: two member messages that merely contain the word "removed"
     no longer count as exits, and one genuine removal whose subject's display
     name contains a colon now parses and does. */
  ok('membership events extracted', count('join') === 1975 && count('leave') === 694, `${count('join')} joins / ${count('leave')} leaves`)
  ok('join requests separated from joins', count('request') === 2274, `${count('request')} requests`)
  ok('messages extracted', count('message') > 3300, `${count('message')} messages`)
  ok('attachments recognised', count('attachment') === 41, `${count('attachment')} media messages`)
  ok('no event carries a NaN timestamp', all.every((e) => Number.isFinite(e.ts)))
  ok('"3 exams are left" stays a message, not a leave event',
     all.some((e) => e.type === 'message' && /exams are left/i.test(e.text)))
  ok('edit markers stripped from message text', !all.some((e) => /This message was edited/i.test(e.text || '')))
  /* Display names containing a colon used to split at the wrong character,
     mangling the name and silently dropping that member's joins and exits. The
     old split could never produce an author containing a colon at all, so the
     count alone is the regression check — no member needs naming here. */
  const colonNames = [...new Set(all.map((e) => e.author).filter((a) => a && a.includes(':')))]
  ok('display names containing a colon survive the sender split',
     colonNames.length === 5 &&
       colonNames.some((n) => /:-?\)$/.test(n)) &&        // emoticon style
       colonNames.some((n) => /\d:\d/.test(n)),            // verse / ratio style
     `${colonNames.length} names`)
  ok('no message body starts with a stranded name fragment',
     !all.some((e) => /^[-)]\):/.test(e.text || '')))
  ok('a poll stays a message even though WhatsApp renders it',
     all.some((e) => e.type === 'message' && /^POLL:/i.test(e.text || '')))

  /* Every join notice states how the member arrived; that split is the
     acquisition number the community team can actually act on. */
  const joins = all.filter((e) => e.type === 'join')
  const via = (k) => joins.filter((e) => e.via === k).length
  ok('join source recorded on every join', joins.every((e) => e.via),
     `community=${via('community')} added=${via('added')} link=${via('link')}`)
  ok('join sources sum to the join total',
     via('community') + via('added') + via('link') + via('unknown') === joins.length)
  const exits = all.filter((e) => e.type === 'leave')
  ok('exit reason recorded on every exit', exits.every((e) => e.via),
     `left=${exits.filter((e) => e.via === 'left').length} removed=${exits.filter((e) => e.via === 'removed').length}`)

  ok('username notices classified as admin noise',
     !all.some((e) => e.type === 'message' && /created the username/i.test(e.text || '')))

  const links = all.flatMap((e) => e.links || [])
  ok('UTM-tagged links found inside the chat', links.some((l) => l.utm_source === 'community' && l.utm_medium === 'WA'),
     `${links.length} links, ${links.filter((l) => l.utm_source).length} tagged`)
  ok('group label shortened for axes', shortLabel('🇬🇧 UK #nospam 17') === '🇬🇧 UK')
  ok('country pulled from group label', countryFromLabel('🇩🇪 Germany #nospam 12') === 'Germany')

  /* Android-format export must parse too */
  const android = parseWhatsAppChat(
    '16/06/2026, 14:46 - Priya: Anyone going to Monash?\r\n16/06/2026, 14:47 - Raj: Yes! DM me\r\n',
    'Test'
  )
  ok('Android export format parses', android.events.length === 2 && android.events[0].author === 'Priya')

  /* ── sentiment & topics ───────────────────────────────────────────────── */
  section('Conversation intelligence')
  ok('"constructor" does not inherit from Object.prototype', !Number.isNaN(scoreSentiment('Constructor University, Germany').score))
  ok('visa refusal reads negative', scoreSentiment('My visa got refused, so disappointed').score < -0.2)
  ok('offer news reads positive', scoreSentiment('I got my unconditional offer! So happy 🎉').score > 0.4)
  ok('negation is handled', scoreSentiment('this is not good').score < 0)
  ok('question without a mark is detected', isQuestion('Anyone going to University of Bristol'))
  ok('statement is not a question', !isQuestion('I got my visa today'))

  for (const g of wa.payload.groups) enrichEvents(g.events)
  const events = eventsFor(wa.payload)
  const t = topicsFor(events, full)
  ok('topics ranked with no NaN score', t.topics.every((x) => Number.isFinite(x.score)), t.topics.slice(0, 3).map((x) => x.label).join(' > '))
  ok('scam talk scores negative', (t.topics.find((x) => x.key === 'safety')?.sentiment ?? 0) < 0)
  ok('accommodation is mostly questions', (t.topics.find((x) => x.key === 'accommodation')?.questionRate ?? 0) > 0.4)
  const acc = t.topics.find((x) => x.key === 'accommodation')
  ok('topic examples come from distinct authors',
     new Set(acc.examples.map((e) => e.author)).size === acc.examples.length,
     acc.examples.map((e) => e.author).join(', '))

  /* ── aggregation ──────────────────────────────────────────────────────── */
  section('Aggregation & date filtering')
  const mFull = memberSeries(events, full)
  const mWin = memberSeries(events, win)
  ok('full-history membership equals joins minus leaves', mFull.totals.members === mFull.totals.joined - mFull.totals.left,
     `${mFull.totals.members} members`)
  ok('windowed membership carries a baseline', mWin.baseline > 0 && mWin.totals.members === mFull.totals.members,
     `baseline ${mWin.baseline}, end ${mWin.totals.members}`)
  ok('narrower window yields fewer joins', mWin.totals.joined < mFull.totals.joined)
  const cWin = conversationSeries(events, win)
  ok('sentiment split sums to message count', cWin.totals.pos + cWin.totals.neu + cWin.totals.neg === cWin.totals.messages)
  ok('daily series length matches the window', cWin.series.length === 28)
  const resp = responsiveness(events, full)
  ok('answer rate is a proportion', resp.answerRate > 0 && resp.answerRate <= 1, `${(resp.answerRate * 100) | 0}% answered`)
  const top = contributors(events, full)
  ok('contributors ranked by volume', top.length > 100 && top[0].messages >= top[1].messages, `${top.length} contributors`)

  /* ── topic × country split ────────────────────────────────────────────── */
  section('Topic country split')
  const splitTopics = topicsFor(events, full).topics
  ok('every topic carries a per-group split', splitTopics.every((t) => Array.isArray(t.byGroup) && t.byGroup.length > 0))
  ok('each split sums to the topic\'s message count',
     splitTopics.every((t) => t.byGroup.reduce((n, b) => n + b.messages, 0) === t.messages))
  ok('split is ordered largest group first',
     splitTopics.every((t) => t.byGroup.every((b, i, a) => i === 0 || a[i - 1].messages >= b.messages)))
  ok('split group count matches the topic\'s groups', splitTopics.every((t) => t.byGroup.length === t.groups))

  /* ── Country groups table ─────────────────────────────────────────────── */
  section('Country groups table')
  const community = { groups: wa.payload.groups }
  const gRows = groupActivity(community, full)
  ok('one row per country group', gRows.length === wa.payload.groups.length, `${gRows.length} groups`)
  ok('ranked by messages, busiest first', gRows.every((r, i, a) => i === 0 || a[i - 1].messages >= r.messages))
  ok('group joins and exits add up to the community totals',
     gRows.reduce((n, r) => n + r.joined, 0) === memberSeries(events, full).totals.joined &&
     gRows.reduce((n, r) => n + r.left, 0) === memberSeries(events, full).totals.left)
  ok('net is joins minus exits on every row', gRows.every((r) => r.net === r.joined - r.left))
  ok('label is flag and country, full name kept alongside',
     gRows.some((r) => r.label === '🇬🇧 UK' && r.full === '🇬🇧 UK #nospam 17'))

  /* ── merge / idempotency ──────────────────────────────────────────────── */
  section('Re-import behaviour')
  const st = emptyState()
  const c = ensureCommunity(st, 'Community #1')
  const first = mergeWhatsApp(c, (await detectAndParse(read('WA community 1.zip'))).payload.groups)
  const total1 = c.groups.reduce((s, g) => s + g.events.length, 0)
  const second = mergeWhatsApp(c, (await detectAndParse(read('WA community 1.zip'))).payload.groups)
  const total2 = c.groups.reduce((s, g) => s + g.events.length, 0)
  ok('first import drops nothing', first.duplicates === 0, `${first.eventsAdded} events added`)
  ok('re-import adds nothing', second.eventsAdded === 0 && total1 === total2, `${total2} events either way`)

  const groups3 = (await detectAndParse(read('WA community 1.zip'))).payload.groups
  groups3[0].events.push({ ts: Date.UTC(2026, 8, 1, 10), date: '2026-09-01', time: '10:00:00', hour: 10, dow: 2,
    group: groups3[0].group, author: 'New Person', type: 'join', subject: 'New Person', text: '' })
  const third = mergeWhatsApp(c, groups3)
  ok('a later export contributes only its new events', third.eventsAdded === 1)

  addSnapshot(c.gaSnapshots, { ...ga.payload, importedAt: '2026-08-25T10:00:00Z' })
  addSnapshot(c.gaSnapshots, { ...ga.payload, importedAt: '2026-08-25T11:00:00Z' })
  ok('re-importing the same GA window replaces rather than doubles', c.gaSnapshots.length === 1)
  ok('merged GA view still reads', mergeGA(c.gaSnapshots, win)?.blocks.summary['Active users'] === 382)
  addSnapshot(c.shortioSnapshots, { ...si.payload, importedAt: '2026-08-25T10:00:00Z' })
  ok('merged short.io view still reads', mergeShortIo(c.shortioSnapshots, win)?.totals.clicks === 2258)

} else {
  const suites = ['WhatsApp community detection', 'WhatsApp transcript parsing', 'Conversation intelligence',
    'Aggregation & date filtering', 'Topic country split', 'Country groups table', 'Re-import behaviour']
  skipped = suites.length
  section('Skipped — no WhatsApp sample')
  console.log('  public/samples/WA community 1.zip is not in the repo because it holds members\' phone')
  console.log('  numbers and messages. Put an export there to run these suites:')
  for (const s of suites) console.log(`  – ${s}`)
}

console.log(`\n${fail === 0 ? '✓ all green' : '✗ FAILURES'} — ${pass} passed, ${fail} failed` +
  (skipped ? `, ${skipped} suites skipped (no WhatsApp sample)` : '') + '\n')
process.exit(fail === 0 ? 0 : 1)
