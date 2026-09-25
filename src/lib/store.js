/* ── Persistence ───────────────────────────────────────────────────────────
   Everything lives in IndexedDB in the browser: the datasets are far too
   large for localStorage (a single community is ~8.5k timeline events) and
   the tool is deliberately backend-free so an operator can run it locally
   against exports that contain member phone numbers.
   ------------------------------------------------------------------------ */

const DB = 'amber-aspirants-dashboard'
const VERSION = 1
const STORE = 'state'
const KEY = 'root'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadState() {
  try {
    const db = await open()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const r = tx.objectStore(STORE).get(KEY)
      r.onsuccess = () => resolve(r.result || null)
      r.onerror = () => reject(r.error)
    })
  } catch (e) {
    console.warn('Could not read saved data:', e)
    return null
  }
}

export async function saveState(state) {
  try {
    const db = await open()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(state, KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    return true
  } catch (e) {
    console.warn('Could not save data:', e)
    return false
  }
}

export async function clearState() {
  const db = await open()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/* ── shape ─────────────────────────────────────────────────────────────── */

/* Bump whenever a parser change alters what an already-imported export would
   produce. Saved data records the version it was parsed with, and
   planMigration() decides what can be re-parsed on load. History:
     1 — original parser
     2 — sender split tolerates colons in display names; membership notices
         keyed off WhatsApp's system marker; joins record their route */
export const PARSER_VERSION = 2

export const emptyState = () => ({
  version: 1,
  parserVersion: PARSER_VERSION,
  communities: [],      // { id, name, groups[], gaSnapshots[], shortioSnapshots[], leads }
  imports: [],          // audit trail
  sync: null,           // leads sync configuration
  seeded: false,
})

export const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'community'

/**
 * The community with this name, created if absent. Matches on the *current*
 * name, not the id: ids are frozen at creation, so after a rename the old
 * name's slug still equals the id and would otherwise be matched.
 */
export function ensureCommunity(state, name) {
  let c = state.communities.find((x) => nameKey(x.name) === nameKey(name))
  if (!c) {
    c = { id: freshId(state, name), name, createdAt: new Date().toISOString(), groups: [], gaSnapshots: [], shortioSnapshots: [], leads: null }
    state.communities.push(c)
  }
  return c
}

/* ── managing communities ────────────────────────────────────────────────
   A community's id is fixed when it is created and never changes; its name is
   free to edit. Everything that points at a community — the upload dropdown,
   the open tab, the import history — goes by id, so renaming "Community #2"
   to "UK cohort" cannot split it into two. Names are unique ignoring case and
   punctuation, the same rule ensureCommunity() matches on.               */

const nameKey = (name) => slug(String(name || '').trim())

export function validateCommunityName(state, name, exceptId = null) {
  const n = String(name || '').trim()
  if (!n) return 'Give the community a name.'
  if (n.length > 60) return 'Keep the name under 60 characters.'
  const clash = state.communities.find((c) => c.id !== exceptId && nameKey(c.name) === nameKey(n))
  if (clash) return `“${clash.name}” already exists.`
  return null
}

/** A fresh id: the name's slug, suffixed if a (possibly renamed) community holds it. */
function freshId(state, name) {
  const base = slug(name)
  let id = base, n = 2
  while (state.communities.some((c) => c.id === id)) id = `${base}-${n++}`
  return id
}

export function createCommunity(state, name) {
  const error = validateCommunityName(state, name)
  if (error) return { error }
  const c = {
    id: freshId(state, name), name: String(name).trim(), createdAt: new Date().toISOString(),
    groups: [], gaSnapshots: [], shortioSnapshots: [], leads: null,
  }
  state.communities.push(c)
  return { community: c }
}

export function renameCommunity(state, id, name) {
  const c = state.communities.find((x) => x.id === id)
  if (!c) return { error: 'That community no longer exists.' }
  const error = validateCommunityName(state, name, id)
  if (error) return { error }
  const before = c.name
  c.name = String(name).trim()
  // history and the stale-parser banner record names, so carry them over
  for (const im of state.imports || []) if (im.communityId === id) im.communityName = c.name
  if (state.staleWhatsApp) state.staleWhatsApp = state.staleWhatsApp.map((n) => (n === before ? c.name : n))
  return { community: c }
}

/** Removes a community and everything imported into it. History is kept. */
export function deleteCommunity(state, id) {
  const c = state.communities.find((x) => x.id === id)
  if (!c) return { error: 'That community no longer exists.' }
  state.communities = state.communities.filter((x) => x.id !== id)
  if (state.staleWhatsApp) state.staleWhatsApp = state.staleWhatsApp.filter((n) => n !== c.name)
  return { removed: c }
}

/** What would go if this community were deleted — for the confirmation. */
export function communityContents(c) {
  const events = (c.groups || []).reduce((n, g) => n + (g.events?.length || 0), 0)
  return {
    groups: c.groups?.length || 0,
    events,
    ga: c.gaSnapshots?.length || 0,
    shortio: c.shortioSnapshots?.length || 0,
    leads: c.leads?.leads?.length || 0,
    empty: !events && !c.gaSnapshots?.length && !c.shortioSnapshots?.length && !c.leads?.leads?.length,
  }
}

/**
 * Where an import lands: the chosen community by id when there is one,
 * otherwise by name — the path the bundled samples take on first run.
 */
export function resolveCommunity(state, { communityId, name }) {
  if (communityId) {
    const c = state.communities.find((x) => x.id === communityId)
    if (c) return c
  }
  return ensureCommunity(state, name || state.communities[0]?.name || 'Community #1')
}

/* ── merging repeat imports ────────────────────────────────────────────── */

const evKey = (e) =>
  `${e.ts}|${e.type}|${e.author || ''}|${e.file || ''}|${(e.text || '').slice(0, 80)}|${e.subject || ''}`

/**
 * Merge a freshly parsed WhatsApp export into a community. Groups match on
 * name; events are de-duplicated so re-uploading an overlapping export
 * (the normal operator habit) does not double-count growth.
 *
 * De-duplication is multiset-based, not set-based: two stickers sent in the
 * same second, or the same person's join notice appearing twice, are real
 * distinct events that share a fingerprint. So we skip an incoming event only
 * once the number of matching events already stored has been accounted for —
 * a re-import of the same export contributes nothing, while genuine repeats
 * still land.
 */
export function mergeWhatsApp(community, groups) {
  const stats = { groupsAdded: 0, groupsUpdated: 0, eventsAdded: 0, duplicates: 0 }
  for (const g of groups) {
    let existing = community.groups.find((x) => x.group === g.group)
    if (!existing) {
      existing = { group: g.group, country: g.country, events: [], senders: 0, media: 0, first: null, last: null }
      community.groups.push(existing)
      stats.groupsAdded++
    } else stats.groupsUpdated++

    const have = new Map()
    for (const e of existing.events) {
      const k = evKey(e)
      have.set(k, (have.get(k) || 0) + 1)
    }
    for (const e of g.events) {
      const k = evKey(e)
      const left = have.get(k) || 0
      if (left > 0) { have.set(k, left - 1); stats.duplicates++; continue }
      existing.events.push(e)
      stats.eventsAdded++
    }
    existing.events.sort((a, b) => a.ts - b.ts)
    existing.media = Math.max(existing.media || 0, g.media || 0)
    existing.senders = new Set(existing.events.filter((e) => e.type === 'message' || e.type === 'attachment').map((e) => e.author)).size
    existing.first = existing.events.length ? existing.events[0].date : null
    existing.last = existing.events.length ? existing.events[existing.events.length - 1].date : null
    existing.country = existing.country || g.country
  }
  return stats
}

/** Push a GA / short.io snapshot, replacing one that covers the same window. */
export function addSnapshot(list, snap) {
  const same = list.findIndex(
    (s) => s.range?.from === snap.range?.from && s.range?.to === snap.range?.to
  )
  if (same >= 0) { list[same] = snap; return 'replaced' }
  list.push(snap)
  list.sort((a, b) => String(a.range?.from).localeCompare(String(b.range?.from)))
  return 'added'
}

/**
 * Collapse GA snapshots into one view for a window. Snapshots fully covered
 * by a newer snapshot are dropped, then daily series are merged by date
 * (newest import wins) and dimension tables summed across the remainder.
 */
export function mergeGA(snapshots, range) {
  const live = pickSnapshots(snapshots, range)
  if (!live.length) return null
  const daily = new Map()
  const blocks = {}
  let property = null, account = null
  for (const s of live) {
    property = property || s.property
    account = account || s.account
    for (const d of s.daily || []) daily.set(d.date, d)
    for (const [key, b] of Object.entries(s.blocks || {})) {
      if (key === 'summary') {
        blocks.summary = blocks.summary || {}
        for (const [k, v] of Object.entries(b)) {
          if (k === 'from' || k === 'to') continue
          if (/average|rate|per /i.test(k)) blocks.summary[k] = v            // can't sum a mean
          else blocks.summary[k] = (blocks.summary[k] || 0) + v
        }
        continue
      }
      if (key === 'nthDay') continue
      if (!blocks[key]) blocks[key] = { ...b, items: [] }
      const acc = new Map(blocks[key].items.map((i) => [i.label, { ...i }]))
      for (const i of b.items || []) {
        const prev = acc.get(i.label)
        if (!prev) acc.set(i.label, { ...i })
        else for (const [k, v] of Object.entries(i)) {
          if (k === 'label') continue
          prev[k] = typeof v === 'number' ? (prev[k] || 0) + v : v
        }
      }
      blocks[key].items = [...acc.values()].sort((a, b2) => (b2.value || 0) - (a.value || 0))
    }
  }
  return {
    property, account, blocks,
    daily: [...daily.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    range: { from: live[0].range?.from, to: live[live.length - 1].range?.to },
    snapshots: live.length,
  }
}

/** Same collapse for short.io workbooks. */
export function mergeShortIo(snapshots, range) {
  const live = pickSnapshots(snapshots, range)
  if (!live.length) return null
  const daily = new Map()
  const dims = {}
  const totals = { links: 0, clicks: 0 }
  for (const s of live) {
    for (const d of s.daily || []) daily.set(d.date, d)
    totals.links = Math.max(totals.links, s.totals?.links || 0)
    totals.clicks += s.totals?.clicks || 0
    for (const [k, items] of Object.entries(s.dims || {})) {
      const acc = new Map((dims[k] || []).map((i) => [i.label, { ...i }]))
      for (const i of items) {
        const prev = acc.get(i.label)
        if (prev) prev.value += i.value
        else acc.set(i.label, { ...i })
      }
      dims[k] = [...acc.values()].sort((a, b) => b.value - a.value)
    }
  }
  return {
    dims, totals,
    daily: [...daily.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    range: { from: live[0].range?.from, to: live[live.length - 1].range?.to },
    snapshots: live.length,
  }
}

/**
 * Drop snapshots whose window a later import of the *same feed* fully
 * contains. `__scope` tags which community a snapshot came from, so in the
 * all-communities view one community's export cannot suppress another's
 * covering the same dates — those are different data and must both count.
 */
function pickSnapshots(snapshots, range) {
  const list = (snapshots || []).filter((s) => s?.range?.from)
  const kept = []
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    const covered = list.some((b, j) => {
      if (i === j) return false
      if ((b.__scope || '') !== (a.__scope || '')) return false
      const bNewer = (b.importedAt || '') > (a.importedAt || '')
      return bNewer && b.range.from <= a.range.from && b.range.to >= a.range.to
    })
    if (!covered) kept.push(a)
  }
  if (!range) return kept
  // keep only what intersects the selected window
  const hit = kept.filter((s) => s.range.from <= range.to && s.range.to >= range.from)
  return hit.length ? hit : kept
}

/**
 * Fold every community into one pseudo-community so the all-communities tab
 * can reuse the same views unchanged.
 *
 * Group labels usually collide (every community has a UK group), and a label
 * is both a React key and the group-filter's identity, so colliding labels are
 * qualified with their community. The events carry the label too — reply-time
 * bucketing and per-group counts read `e.group` — so those are remapped as
 * well; without that, two communities' UK groups would be treated as one
 * conversation. Only colliding labels pay the copy.
 */
export function aggregateCommunities(communities) {
  const list = communities || []
  if (!list.length) return null

  // A single community needs no folding, but it still answers to the
  // Overview tab, so it takes that tab's name rather than its own.
  if (list.length === 1) {
    return { ...list[0], id: '__all__', name: 'Overview', isAggregate: true, memberCommunities: list }
  }

  const labelCount = new Map()
  for (const c of list) for (const g of c.groups) labelCount.set(g.group, (labelCount.get(g.group) || 0) + 1)

  const groups = []
  for (const c of list) {
    for (const g of c.groups) {
      const collides = (labelCount.get(g.group) || 0) > 1
      const label = collides ? `${g.group} · ${c.name}` : g.group
      groups.push({
        ...g,
        group: label,          // unique — used as key, filter identity and on events
        rawGroup: g.group,     // as the operator knows it, for display
        communityId: c.id,
        communityName: c.name,
        events: collides ? g.events.map((e) => ({ ...e, group: label })) : g.events,
      })
    }
  }

  const tag = (snaps, c) => (snaps || []).map((s) => ({ ...s, __scope: c.id }))
  const gaSnapshots = list.flatMap((c) => tag(c.gaSnapshots, c))
  const shortioSnapshots = list.flatMap((c) => tag(c.shortioSnapshots, c))

  const withLeads = list.filter((c) => c.leads?.leads?.length)
  const leads = withLeads.length
    ? {
        leads: withLeads.flatMap((c) => c.leads.leads.map((l) => ({ ...l, _community: c.name }))),
        mapping: Object.assign({}, ...withLeads.map((c) => c.leads.mapping || {})),
        header: [...new Set(withLeads.flatMap((c) => c.leads.header || []))],
        sheet: withLeads.length === 1 ? withLeads[0].leads.sheet : null,
        updatedAt: withLeads.map((c) => c.leads.updatedAt).filter(Boolean).sort().at(-1) || null,
        origin: withLeads.length === 1 ? withLeads[0].leads.origin : 'aggregate',
        fromCommunities: withLeads.map((c) => c.name),
      }
    : null

  return {
    id: '__all__',
    name: 'Overview',
    isAggregate: true,
    memberCommunities: list,
    groups,
    gaSnapshots,
    shortioSnapshots,
    leads,
  }
}

/**
 * Decide what to do with WhatsApp data parsed by an older parser.
 *
 * The raw transcript is not kept after import, so stale events cannot be
 * re-classified in place. A community whose WhatsApp data came entirely from
 * a bundled sample can simply be re-parsed from that sample; anything the
 * operator uploaded has to be re-uploaded, and until then it is flagged.
 * Re-uploading such a community *replaces* its groups rather than merging —
 * events parsed by different versions do not share fingerprints, so a merge
 * would count the same join twice.
 *
 * @returns {{reparse:string[], stale:string[]}} community ids
 */
export function planMigration(saved, sampleNames) {
  const plan = { reparse: [], stale: [] }
  if (!saved?.communities?.length) return plan
  if ((saved.parserVersion || 1) >= PARSER_VERSION) return plan
  for (const c of saved.communities) {
    if (!c.groups?.length) continue
    const wa = (saved.imports || []).filter(
      (i) => i.source === 'whatsapp' && (i.communityId === c.id || i.communityName === c.name)
    )
    const fromSamples = wa.length > 0 && wa.every((i) => sampleNames.includes(i.fileName))
    ;(fromSamples ? plan.reparse : plan.stale).push(c.id)
  }
  return plan
}

/** Full extent of every dataset in a community — bounds the date picker. */
export function communityExtent(community) {
  const dates = []
  for (const g of community?.groups || []) { if (g.first) dates.push(g.first); if (g.last) dates.push(g.last) }
  for (const s of community?.gaSnapshots || []) { if (s.range?.from) dates.push(s.range.from, s.range.to) }
  for (const s of community?.shortioSnapshots || []) { if (s.range?.from) dates.push(s.range.from, s.range.to) }
  for (const l of community?.leads?.leads || []) if (l.date) dates.push(l.date)
  if (!dates.length) return null
  dates.sort()
  return { from: dates[0], to: dates[dates.length - 1] }
}
