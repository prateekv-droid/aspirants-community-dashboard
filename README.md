# Aspirants Community Dashboard

Analytics for amber's WhatsApp study-abroad aspirant communities — member growth, UTM
attribution and conversation intelligence across the per-country groups inside each
community. UI inherited from **amber Studio** (light-first, brand as accent); the
interaction model follows **Google Search Console** — clickable metric tiles driving one
shared trend chart, with a date range and comparison that govern every number on the page.

## Structure

Two levels of tabs, no sidebar. The community is the top-level selection, and every
analysis lives inside it:

```
Overview │ Community #1 │ Community #2 …                  ← which community
─────────────────────────────────────────────────────
Overview  Member growth  Conversations  Groups           ← sections, scoped to the tab above
                              🌍 All 5 groups   🗓 Last 28 days
```

The first primary tab, **Overview**, rolls up every community; the rest scope to one.
Its own Overview section answers different questions depending on where you are:

| | Overview tab (all communities) | A community's tab |
|---|---|---|
| Headline | Total members, new joins, left, **net change** | same, for that community |
| Split | Membership trend + how members joined / left, then the Sources tiles | same, for that community |
| Then | Daily conversations by country group, then by community; members by community (with more than one); a card per group with its themes | daily conversations by country group; a card per group with its themes |

The **Country groups** table — members, new joins, left, net, messages, per active day,
contributors, tone — lives on the **Groups** tab; click a row to filter every section to that
group.

**Member growth** runs: the metric tiles and their shared chart, then the **Sources** row,
then the per-group table, then the balance / quality / notable-days cards.

Uploads, community management, the import history and **Clear all data** all live in the
**Add data** dialog rather than in tabs.

### Sources

"Source" means the marketing channel, and each tile reads the feed that carries it:

| Tile | Feed | What is counted |
|---|---|---|
| **IG** | UTM links, via GA | first-touch users with `utm_source=ig` |
| **Scholarship** | short.io report | clicks on the `/scholarship-*` links, split by team |
| **Organic** | UTM links, via GA | first-touch users with medium `organic` |

Each tile shows the channel and its number only. The unit stays (users or clicks) because GA
counts users and short.io counts clicks, which is also why the row has no total. Both feeds
report over their own export window, so a narrower date range is scaled to its share of daily
volume. The mapping lives in `ACQUISITION_SOURCES` in `src/lib/metrics.js` — adding a channel
is one row there.

The dashboard is light-only.

The row appears on both the Overview and Member growth tabs. The Overview tab also keeps a
**How members entered the groups** card — the route WhatsApp recorded for each join
(community directory, invite link, added by an admin). It is counted from the join notices,
so it is exact, but it answers a different question from the marketing source, which is why
it is titled differently.

The Overview tab folds every community into one view so the same sections work
unchanged. Where two communities run a group for the same country — which is the norm —
the labels are qualified (`🇬🇧 UK #nospam 17 · Community #2`) and so are the events behind
them, so reply times and per-group counts never bleed across communities. That tab also
gains a **Communities** comparison table on its Overview; click a row to jump to that
community's own tab.

The group filter and date range sit with the section tabs because they scope every section,
and the group filter resets when you switch community — one community's groups mean nothing
in another.

```bash
npm install
npm run dev        # http://localhost:5180
```

First run imports the sample exports in `public/samples/`, through the exact same pipeline a
manual upload uses, so the dashboard opens populated.

**The WhatsApp sample is not in this repository.** It is a real community export — members'
phone numbers and messages — so `.gitignore` keeps `public/samples/*.zip` and any
`_chat.txt` out of git. The GA and short.io samples are aggregate analytics and are
included. On a fresh clone the dashboard therefore opens with attribution data but no
community groups; either import a WhatsApp export through **Add data**, or place one at
`public/samples/WA community 1.zip` to have it seeded on first run. `npm test` runs every
suite that doesn't need the export and lists the ones it skipped.

```bash
npm test           # 85 checks with the WhatsApp sample present, 32 without
npm run build      # static bundle in dist/
```

---

## The four data feeds

Nothing is labelled on the way in. Each file is identified by **structure**, because
operators rename exports constantly.

| Source | Signature the detector matches | What the dashboard gets |
|---|---|---|
| 💬 **WhatsApp** | a zip containing `_chat.txt`, or a zip of per-group zips named `WhatsApp Chat - …` | per-group timelines: joins, exits, join requests, messages, media, and the links posted in chat |
| 📈 **Google Analytics** | CSV whose comment lines carry `Reports snapshot`, `Property:` and per-block `Start date:` | each report card matched by its own header row — first-user source/medium, sessions, pages, cities, daily new vs returning |
| 🔗 **short.io** | an `.xlsx` whose tabs include `General statistic`, `Click statistics` and the `UTM …` sheets | daily clicks plus every UTM, geo, device and top-link breakdown |
| 🎯 **Leads** | any flat table whose columns score against the lead-field aliases *and* the shape of their values | lead records with an auto-built, reviewable column mapping |

The upload dialog shows the evidence behind each match and its confidence, so a
misdetection is visible rather than silent. Re-importing is safe: WhatsApp events
de-duplicate against what is already stored, and a GA or short.io snapshot covering the
same window replaces its predecessor instead of double-counting.

Everything stays in the browser, in IndexedDB under `amber-aspirants-dashboard`. The
transcripts contain members' phone numbers, so nothing is uploaded anywhere and phone
numbers and emails are masked in every table and chart. The tool makes no network
requests of its own.

---

## Layout

```
src/
├── lib/
│   ├── detect.js          source auto-detection + confidence/evidence
│   ├── unzip.js           zip reader (native DecompressionStream, handles nested zips)
│   ├── xlsx.js            xlsx reader, built on unzip + xml
│   ├── xml.js             tiny XML parser (same code in browser and Node)
│   ├── csv.js             RFC-4180 splitter
│   ├── parseWhatsApp.js   iOS/Android transcript parser, event classification,
│   │                      join-source detection, link extraction
│   ├── parseGA.js         GA snapshot — blocks matched by header signature
│   ├── parseShortIo.js    short.io workbook
│   ├── parseLeads.js      lead-column inference and record building
│   ├── nlp/sentiment.js   lexicon + negation/intensifier/emoji rules
│   ├── nlp/topics.js      curated taxonomy, reach-weighted ranking, keyword miner
│   ├── metrics.js         every aggregation, all taking (events, {from,to})
│   ├── store.js           IndexedDB persistence, snapshot merging, re-import
│   │                      de-duplication, all-communities folding
│   ├── sync.js            leads sync engine (no longer wired to the UI)
│   └── dates.js           ISO/UTC date helpers, presets, previous-period
├── components/            chart, tiles, table, bar list, range picker, upload dialog
└── views/                 Overview, MemberGrowth, Conversations, Groups
                           (Sources, Leads, Settings are unrouted and kept for reinstating)
```

No runtime dependencies beyond React — the zip, xlsx, XML, CSV, charting and NLP are all
in-tree, which is what lets a 6 MB WhatsApp export be parsed client-side with nothing
leaving the machine.

## How membership is counted

Joins and exits are reconstructed from the notices WhatsApp writes into the transcript,
which makes two details of the format load-bearing:

* **WhatsApp marks its own lines.** A U+200E immediately before the body appears on
  everything WhatsApp rendered — membership notices, admin actions, attachments, polls —
  and never on member-typed text. Membership classification keys off that marker rather
  than the wording, which is what keeps a member writing *"I've been removed from the
  group"* out of the exit count. Exports that predate the marker fall back to wording.
* **Display names can contain colons.** Members use names like `~ Alex :)`, `~ Sam:)` or
  `John 3:16` — five such members appear in the sample export. Splitting the line on its
  first colon mangles their name and silently drops their joins and exits, so the marker is
  used for an exact split, and the exact names it yields build a roster that repairs the
  ambiguous lines.

Each join carries the route the notice stated — community directory, invite link, or added
by an admin — and each exit carries whether the member left or was removed.

### When the parser changes

Saved data records the parser version it was read with (`PARSER_VERSION` in
`src/lib/store.js`). The raw transcript is not kept after import, so on load a community
whose WhatsApp data came entirely from the bundled sample is re-parsed automatically, and
anything uploaded is flagged with a banner asking for a re-upload. That re-upload replaces
the community's groups instead of merging: events read by different parser versions do not
share fingerprints, so a merge would count the same join twice. Bump the version whenever a
parser change would alter what an already-imported export produces.

## Communities

Communities are created and edited in **Add data → Communities**: create one by name,
rename it, or delete it. Deleting says exactly what goes (country groups, WhatsApp events,
GA and short.io snapshots) and keeps the import history. Names are unique ignoring case and
punctuation, so "community 2" is refused when "Community #2" exists.

Every uploaded file then gets a **Community** dropdown on the right of its card, listing
those communities plus **+ New community…**. Nothing is assigned by guesswork:

1. a WhatsApp export whose file name names an existing community is pre-selected for it
2. otherwise the community tab you had open
3. otherwise the only community, if there is just one
4. otherwise nothing — **Import** stays disabled until you choose

A WhatsApp file named for a community that doesn't exist yet (`WA community 3.zip`) offers
a one-click **+ Create "Community #3" from the file name**.

The dropdown selects by **id**, which is fixed when a community is created; only the name
is editable. Renaming "Community #2" to "UK cohort" therefore can't split it in two — later
uploads chosen from the dropdown still land in it, and a new "Community #2" gets its own id.

Feeds belong to a community, not to the tool: a GA snapshot imported into Community #1
counts toward Community #1 and the Overview roll-up, and Community #2's tab reports it as not
loaded. Groups are matched by name within a community, so a fresh export of one country
group updates just that group.
