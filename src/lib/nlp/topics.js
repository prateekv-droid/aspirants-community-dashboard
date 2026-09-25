/* ── Topic model ───────────────────────────────────────────────────────────
   A curated taxonomy beats unsupervised clustering here: the questions in
   an aspirant community fall into a small, stable set of intents, and the
   operator needs the label to be actionable ("Visa & immigration", not
   "cluster 7"). Each topic matches on regexes; a message can carry several.
   Popularity is ranked on people, not just volume, so one prolific member
   cannot invent a trend.
   ------------------------------------------------------------------------ */

export const TOPICS = [
  { key: 'visa', label: 'Visa & immigration', color: '#ed3a56', patterns: [
    /\bvisas?\b/i, /\bvfs\b/i, /\bbiometric/i, /\bembassy\b/i, /\bconsulate\b/i,
    /\bappointment\b/i, /\binterview\b/i, /\bcas\b/i, /\bi-?20\b/i, /\bds-?160\b/i,
    /\bsevis\b/i, /\bstudy permit\b/i, /\bgte\b/i, /\bcoe\b/i, /\bblocked account\b/i,
    /\bproof of funds\b/i, /\brefus(al|ed)\b/i, /\bimmigration\b/i, /\bwork permit\b/i,
    /\bpr\b(?!o)/i, /\bpost.?study work\b/i, /\bgraduate route\b/i, /\bopt\b/i, /\bstamp(ed|ing)?\b/i,
  ] },
  { key: 'accommodation', label: 'Accommodation & housing', color: '#ff9539', patterns: [
    /\baccommodation\b/i, /\bhousing\b/i, /\bhostel\b/i, /\bdorm(itory)?\b/i,
    /\bflat(mate)?s?\b/i, /\broom(mate|s)?\b/i, /\brent(al|s)?\b/i, /\blease\b/i,
    /\bstudio\b/i, /\bensuite\b/i, /\bshared (room|house)\b/i, /\bdeposit\b/i,
    /\btenan(t|cy)\b/i, /\blandlord\b/i, /\bamberstudent\b/i, /\bunilodge\b/i,
    /\biq student\b/i, /\bhomestay\b/i, /\bpg\b/i, /\bbills? included\b/i,
  ] },
  { key: 'university', label: 'Universities & offers', color: '#8b5cf6', patterns: [
    /\buniversit(y|ies)\b/i, /\bcollege\b/i, /\buni\b/i, /\boffer( letter)?s?\b/i,
    /\badmission\b/i, /\bapplication\b/i, /\bapply(ing)?\b/i, /\bconditional\b/i,
    /\bunconditional\b/i, /\bdeadline\b/i, /\bucas\b/i, /\bcommon ?app\b/i,
    /\branking?s?\b/i, /\bqs\b/i, /\brussell group\b/i, /\bwaitlist(ed)?\b/i,
    /\bcourse\b/i, /\bprogram(me)?\b/i, /\bmasters?\b/i, /\bbachelors?\b/i,
    /\bmsc\b/i, /\bma\b(?!\w)/i, /\bmba\b/i, /\bphd\b/i, /\bsop\b/i, /\blor\b/i,
    /\btranscript/i, /\bcredential/i, /\bwes\b/i,
  ] },
  { key: 'money', label: 'Fees, funding & scholarships', color: '#10b981', patterns: [
    /\bscholarship?s?\b/i, /\bfunding\b/i, /\bfunded\b/i, /\bfees?\b/i, /\btuition\b/i,
    /\bloan\b/i, /\bbank\b/i, /\bforex\b/i, /\bremit(tance)?\b/i, /\bwise\b/i,
    /\bbursar(y|ies)\b/i, /\bwaiver\b/i, /\bgrant\b/i, /\bstipend\b/i, /\bassistantship\b/i,
    /\bafford\b/i, /\bexpensive\b/i, /\bbudget\b/i, /\bcost of living\b/i,
    /\bcurrency\b/i, /\bpay(ment|ing)?\b/i, /\binstal?ment\b/i, /\bsponsor\b/i,
  ] },
  { key: 'tests', label: 'Tests & English proficiency', color: '#0ea5e9', patterns: [
    /\bielts\b/i, /\btoefl\b/i, /\bpte\b/i, /\bduolingo\b/i, /\bgre\b/i, /\bgmat\b/i,
    /\bsat\b/i, /\bact\b/i, /\benglish (test|proficiency)\b/i, /\bband\s?(score)?\b/i,
    /\bmock (test|exam)\b/i, /\bwaiver of (ielts|english)\b/i, /\bmoi\b/i,
    /\bexam\b/i, /\bretak(e|ing)\b/i, /\bscore(s|card)?\b/i,
  ] },
  { key: 'travel', label: 'Flights & travel', color: '#f59e0b', patterns: [
    /\bflight?s?\b/i, /\bticket?s?\b/i, /\bairline\b/i, /\bairport\b/i, /\bbaggage\b/i,
    /\bluggage\b/i, /\bpack(ing|ed)?\b/i, /\blayover\b/i, /\btransit\b/i,
    /\bemirates\b/i, /\bqatar\b/i, /\bindigo\b/i, /\bvistara\b/i, /\bstudent (fare|discount)\b/i,
    /\bport of entry\b/i, /\bimmigration (desk|counter)\b/i, /\btravel(ling|ing)?\b/i,
  ] },
  { key: 'arrival', label: 'Arrival & settling in', color: '#14b8a6', patterns: [
    /\bsim card\b/i, /\bsim\b/i, /\bbank account\b/i, /\bnin\b/i, /\bssn\b/i, /\btfn\b/i,
    /\bnhs\b/i, /\bgp\b/i, /\binsurance\b/i, /\bohip\b/i, /\bmedicare\b/i, /\boshc\b/i,
    /\bgrocer(y|ies)\b/i, /\btransport\b/i, /\boyster\b/i, /\bmetro card\b/i,
    /\bopening (a )?bank\b/i, /\bregist(er|ration)\b/i, /\banmeldung\b/i, /\bresidence permit\b/i,
    /\bfirst week\b/i, /\bsettl(e|ing)\b/i, /\bweather\b/i, /\bwinter\b/i, /\bclothes\b/i,
  ] },
  { key: 'jobs', label: 'Part-time work & careers', color: '#6366f1', patterns: [
    /\bpart.?time\b/i, /\bjob?s?\b/i, /\bwork(ing)? hours\b/i, /\b20 hours\b/i,
    /\bintern(ship)?\b/i, /\bplacement\b/i, /\bcv\b/i, /\bresume\b/i, /\blinkedin\b/i,
    /\bsalary\b/i, /\bwage\b/i, /\bminimum wage\b/i, /\bhir(e|ing)\b/i, /\brecruit/i,
    /\bcareer\b/i, /\bemployer\b/i, /\bsponsorship\b/i, /\bside hustle\b/i,
  ] },
  { key: 'agents', label: 'Consultants & agents', color: '#a855f7', patterns: [
    /\bconsultan(t|cy)\b/i, /\bagent?s?\b/i, /\bagenc(y|ies)\b/i, /\boverseas education\b/i,
    /\bcounsel(l)?or\b/i, /\bstudy abroad (agent|consultant)\b/i, /\bcommission\b/i,
    /\bwithout (an )?agent\b/i, /\bon my own\b/i, /\bdiy\b/i,
  ] },
  { key: 'safety', label: 'Scams & trust concerns', color: '#dc2626', patterns: [
    /\bscam(mer|med)?\b/i, /\bfraud\b/i, /\bfake\b/i, /\bcheat(ed|ing)?\b/i,
    /\bspam\b/i, /\bbeware\b/i, /\bblacklist(ed)?\b/i, /\bdon'?t trust\b/i,
    /\breport(ed)? (him|her|them|this)\b/i, /\bphish/i, /\bfishy\b/i, /\bsuspicious\b/i,
  ] },
  { key: 'community', label: 'Community & connections', color: '#64748b', patterns: [
    /\banyone (from|going|here|else)\b/i, /\bany(one|body) (going|from)\b/i,
    /\bconnect\b/i, /\bgroup\b/i, /\bdm\b/i, /\bwhats?app group\b/i, /\bjoin\b/i,
    /\bbatch\b/i, /\bintake\b/i, /\bsept(ember)? 20\d\d\b/i, /\bjan(uary)? 20\d\d\b/i,
    /\bfellow\b/i, /\bsenior\b/i, /\bjunior\b/i, /\bmeet ?up\b/i, /\bwebinar\b/i,
  ] },
]

/** Stop-words for the keyword miner (English + common Hindi transliteration). */
const STOP = new Set(`a about above after again against all am an and any are aren't as at be because been before being below between both but by can cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he her here hers herself him himself his how i i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she should shouldn't so some such than that the their theirs them themselves then there these they this those through to too under until up very was wasn't we were weren't what when where which while who whom why with won't would wouldn't you your yours yourself yourselves
u ur pls plz thanks thank ok okay okk yes yeah yep nope hey hi hello guys guy bro bhai sir mam maam ma'am madam anyone anybody someone something anything get got getting also just like know need want going go went one two three know tell told say said give given take taken make made see seen come came still even much many lot really actually maybe pretty sure right well nothing everything please help thing things time day days
hai hain h ka ki ke ko ka kya kyu kyun kaise kaisa kab kahan koi kuch nahi nai na to bhi hi se me mein mera meri mujhe aap aapko tum tumhe hum humko wo woh yeh ye is us ab tab bas sab log accha theek thik acha bhut bahut bohot toh ho hu hun huaa hua kar karo karna kiya raha rahe rahi tha thi the ja jao jaana liye wala wali abhi phir agar lekin par aur ya matlab yaar arre okk`.split(/\s+/).filter(Boolean))

const tokenize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && w.length < 24 && !STOP.has(w) && !/^\d+$/.test(w))

/** Which curated topics does this message touch? */
export function topicsOf(text) {
  const t = String(text || '')
  if (!t) return []
  const out = []
  for (const topic of TOPICS) {
    let hits = 0
    for (const re of topic.patterns) if (re.test(t)) hits++
    if (hits) out.push({ key: topic.key, hits })
  }
  // A message tagged with everything is tagged with nothing useful — keep the
  // three strongest signals.
  return out.sort((a, b) => b.hits - a.hits).slice(0, 3)
}

/**
 * Rank the curated topics. Popularity = message volume weighted by how many
 * distinct people raised it, so a single heavy poster cannot fake a trend.
 */
export function rankTopics(messages) {
  const acc = new Map()
  for (const m of messages) {
    for (const { key, hits } of m._topics || topicsOf(m.text)) {
      let a = acc.get(key)
      if (!a) acc.set(key, (a = { key, messages: 0, people: new Set(), groups: new Set(), byGroup: new Map(), sent: 0, questions: 0, hits: 0, first: null, last: null, candidates: [] }))
      a.messages++
      a.byGroup.set(m.group, (a.byGroup.get(m.group) || 0) + 1)
      a.hits += hits
      a.people.add(m.author)
      a.groups.add(m.group)
      a.sent += m._sentiment ?? 0
      if (m._question) a.questions++
      if (!a.first || m.date < a.first) a.first = m.date
      if (!a.last || m.date > a.last) a.last = m.date
      if (m.text.length > 25) a.candidates.push(m)
    }
  }
  const meta = Object.fromEntries(TOPICS.map((t) => [t.key, t]))
  return [...acc.values()]
    .map((a) => ({
      key: a.key,
      label: meta[a.key]?.label ?? a.key,
      color: meta[a.key]?.color ?? '#94a3b8',
      messages: a.messages,
      people: a.people.size,
      groups: a.groups.size,
      // where this topic's messages were posted, largest first — sums to `messages`
      byGroup: [...a.byGroup.entries()]
        .map(([group, messages]) => ({ group, messages }))
        .sort((x, y) => y.messages - x.messages),
      questions: a.questions,
      questionRate: a.messages ? a.questions / a.messages : 0,
      sentiment: a.messages ? +(a.sent / a.messages).toFixed(3) : 0,
      first: a.first, last: a.last,
      examples: pickExamples(a.candidates),
      // popularity blends reach and volume — reach weighted higher
      score: +(a.people.size * 2 + a.messages).toFixed(1),
    }))
    .sort((a, b) => b.score - a.score)
}

/* A broadcast posted into every country group would otherwise fill all four
   example slots with the same text. Pick distinct voices and distinct wording,
   and prefer the questions members actually asked over announcements. */
function fingerprint(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, '').split(/\s+/).slice(0, 12).join(' ')
}

function pickExamples(candidates, limit = 4) {
  const scored = [...candidates].sort((a, b) => {
    const q = (b._question ? 1 : 0) - (a._question ? 1 : 0)
    if (q) return q
    return Math.min(b.text.length, 220) - Math.min(a.text.length, 220)
  })
  const out = []
  const authors = new Set(), prints = new Set()
  for (const pass of [0, 1]) {
    for (const m of scored) {
      if (out.length >= limit) break
      const fp = fingerprint(m.text)
      if (prints.has(fp)) continue
      // first pass takes one message per author, second pass fills any gap
      if (pass === 0 && authors.has(m.author)) continue
      authors.add(m.author)
      prints.add(fp)
      out.push({ text: m.text.slice(0, 240), author: m.author, date: m.date, group: m.group, question: !!m._question })
    }
  }
  return out
}

/** Free-form keyword/bigram miner — surfaces what the taxonomy has no name for. */
export function mineKeywords(messages, limit = 40) {
  const uni = new Map(), bi = new Map()
  const bump = (m, k, author) => {
    let e = m.get(k)
    if (!e) m.set(k, (e = { term: k, n: 0, people: new Set() }))
    e.n++; e.people.add(author)
  }
  for (const m of messages) {
    const w = tokenize(m.text)
    const seen = new Set()
    for (let i = 0; i < w.length; i++) {
      if (!seen.has(w[i])) { bump(uni, w[i], m.author); seen.add(w[i]) }
      if (i + 1 < w.length) {
        const b = `${w[i]} ${w[i + 1]}`
        if (!seen.has(b)) { bump(bi, b, m.author); seen.add(b) }
      }
    }
  }
  const rank = (m, minPeople) =>
    [...m.values()]
      .filter((e) => e.people.size >= minPeople)
      .map((e) => ({ term: e.term, messages: e.n, people: e.people.size, score: e.people.size * 2 + e.n }))
      .sort((a, b) => b.score - a.score)
  return { words: rank(uni, 3).slice(0, limit), phrases: rank(bi, 3).slice(0, limit) }
}
