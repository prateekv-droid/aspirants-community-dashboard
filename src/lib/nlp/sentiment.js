/* ── Sentiment scoring ─────────────────────────────────────────────────────
   A lexicon + rules model (VADER-shaped) rather than a black box, so a
   score can always be explained back to the operator and tuned. Tuned for
   this corpus specifically: aspirant chat is short, emoji-heavy, code-mixed
   Hindi/English, and full of domain words whose polarity is not generic
   ("rejected", "refused", "granted", "unconditional", "deposit lost").
   Scores are in [-1, 1].
   ------------------------------------------------------------------------ */

const POS = Object.assign(Object.create(null), {
  // generic
  good: 1.4, great: 2, awesome: 2.4, amazing: 2.4, excellent: 2.4, perfect: 2.2,
  love: 2.2, loved: 2, nice: 1.4, best: 1.8, better: 1, happy: 1.9, glad: 1.6,
  thanks: 1.6, thank: 1.6, thankyou: 1.8, thankewww: 1.8, ty: 1, welcome: 0.9,
  helpful: 1.8, help: 0.5, helped: 1.4, useful: 1.5, clear: 0.8, easy: 1.2,
  congrats: 2.4, congratulations: 2.6, congratulation: 2.4, wow: 1.5, yay: 2,
  cool: 1.2, fantastic: 2.3, wonderful: 2.3, brilliant: 2.2, superb: 2.2,
  sure: 0.6, yes: 0.5, hope: 0.8, hopefully: 0.7, excited: 2, exciting: 1.8,
  blessed: 2, grateful: 2, appreciate: 1.7, kind: 1.1, sweet: 1.2, lucky: 1.5,
  proud: 1.8, relief: 1.6, relieved: 1.8, finally: 0.9, worth: 1.1, safe: 1,
  recommend: 1.5, legit: 1.2, genuine: 1.3, trusted: 1.5, reliable: 1.5,
  // domain wins
  approved: 2.2, granted: 2.2, accepted: 2.1, admitted: 2.1, selected: 1.9,
  offer: 1.5, offers: 1.5, admit: 1.6, unconditional: 2, scholarship: 1.4,
  funded: 1.8, waiver: 1.5, discount: 1.2, cashback: 1.2, refund: 0.8,
  cas: 0.6, i20: 0.6, visa: 0.2, stamped: 2, cleared: 1.9, passed: 1.8,
  received: 1.1, got: 0.6, secured: 1.8, confirmed: 1.5, booked: 1.2,
  enrolled: 1.6, joined: 0.6, flying: 1.2, landed: 1.4, settled: 1.4,
})

const NEG = Object.assign(Object.create(null), {
  // generic
  bad: -1.5, worse: -1.8, worst: -2.4, terrible: -2.4, awful: -2.3, poor: -1.6,
  hate: -2.2, sad: -1.8, angry: -2, annoyed: -1.7, annoying: -1.8, upset: -1.8,
  frustrated: -2, frustrating: -2, disappointed: -2.1, disappointing: -2,
  confused: -1.4, confusing: -1.5, unclear: -1.2, difficult: -1.3, hard: -1,
  problem: -1.4, problems: -1.4, issue: -1.3, issues: -1.3, error: -1.4,
  worried: -1.7, worry: -1.5, anxious: -1.7, anxiety: -1.7, stress: -1.7,
  stressed: -1.8, panic: -2, afraid: -1.6, scared: -1.7, tension: -1.6,
  useless: -2.2, waste: -2, wasted: -2, pathetic: -2.4, ridiculous: -2,
  never: -0.7, nothing: -0.7, cant: -0.8, unable: -1.2, impossible: -1.6,
  slow: -1.1, late: -1.1, delay: -1.5, delayed: -1.6, stuck: -1.7, pending: -1,
  expensive: -1.5, costly: -1.4, overpriced: -1.8, unaffordable: -1.9,
  // domain losses
  rejected: -2.4, rejection: -2.3, refused: -2.4, refusal: -2.3, denied: -2.3,
  declined: -2, withdrawn: -1.8, cancelled: -1.9, canceled: -1.9, deferred: -1.3,
  scam: -2.6, scammer: -2.6, fraud: -2.6, fake: -2.2, cheated: -2.5, cheat: -2.3,
  spam: -1.6, blacklisted: -2.2, banned: -2, blocked: -1.6, ghosted: -1.8,
  gap: -0.6, backlog: -1.2, backlogs: -1.2, unconditionally: 0,
  homesick: -1.7, lonely: -1.7, broke: -1.6, debt: -1.5, loan: -0.5,
})

const BOOST = Object.assign(Object.create(null), {
  very: 0.35, really: 0.3, so: 0.25, super: 0.4, extremely: 0.5, absolutely: 0.45,
  totally: 0.35, incredibly: 0.45, highly: 0.3, too: 0.2, much: 0.15,
  bahut: 0.35, bohot: 0.35, bhot: 0.35, kaafi: 0.3, ekdum: 0.35,
  slightly: -0.25, somewhat: -0.2, kinda: -0.2, kind: -0.05, little: -0.2,
  barely: -0.35, hardly: -0.35, bit: -0.2,
})

const NEGATORS = new Set([
  'not', 'no', 'never', 'none', 'cannot', 'cant', "can't", 'dont', "don't",
  'doesnt', "doesn't", 'didnt', "didn't", 'isnt', "isn't", 'wasnt', "wasn't",
  'arent', "aren't", 'wont', "won't", 'without', 'nahi', 'nai', 'nope', 'neither',
])

const EMOJI = [
  [/[\u{1F600}-\u{1F60F}\u{1F617}-\u{1F61D}\u{1F642}\u{1F643}\u{1F970}\u{1F972}]/gu, 1.5],
  [/[\u{2764}\u{1F495}-\u{1F49F}\u{1F60D}\u{1F618}\u{1F929}]/gu, 1.8],
  [/[\u{1F389}\u{1F38A}\u{1F947}\u{1F3C6}\u{1F44F}\u{1F64C}\u{1F44D}\u{1F918}\u{1F91D}]/gu, 1.9],
  [/[\u{1F393}\u{2705}\u{1F49A}\u{1F31F}\u{2728}\u{1F525}]/gu, 1.2],
  [/[\u{1F614}\u{1F61E}-\u{1F623}\u{1F625}\u{1F62B}\u{1F62D}\u{1F630}\u{1F97A}\u{1F626}\u{1F627}]/gu, -1.7],
  [/[\u{1F620}\u{1F621}\u{1F624}\u{1F92C}\u{1F44E}\u{1F494}\u{1F612}\u{1F644}]/gu, -1.9],
  [/[\u{1F644}\u{1F928}\u{1F914}]/gu, -0.4],
]

const tokenize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}'’]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

/**
 * @param {string} text
 * @returns {{score:number, label:'positive'|'neutral'|'negative', hits:Array, magnitude:number}}
 */
export function scoreSentiment(text) {
  const words = tokenize(text)
  const hits = []
  let sum = 0

  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[''’]/g, '')
    const v = POS[w] ?? NEG[w]
    if (typeof v !== 'number') continue

    // intensifier in the two preceding words
    let mult = 1
    for (let d = 1; d <= 2 && i - d >= 0; d++) {
      const b = BOOST[words[i - d]]
      if (typeof b === 'number') mult += b / d
    }
    // negation within three preceding words flips and dampens
    let negated = false
    for (let d = 1; d <= 3 && i - d >= 0; d++) {
      if (NEGATORS.has(words[i - d])) { negated = true; break }
    }
    let val = v * mult
    if (negated) val = -val * 0.72
    sum += val
    hits.push({ word: w, value: +val.toFixed(2), negated })
  }

  for (const [re, v] of EMOJI) {
    const n = (String(text).match(re) || []).length
    if (n) { sum += v * Math.min(n, 3); hits.push({ word: 'emoji', value: +(v * Math.min(n, 3)).toFixed(2) }) }
  }

  // ALL-CAPS shouting and !! amplify whatever polarity is present
  const caps = (String(text).match(/\b[A-Z]{3,}\b/g) || []).length
  const bangs = Math.min((String(text).match(/!/g) || []).length, 4)
  if (sum !== 0) sum *= 1 + caps * 0.05 + bangs * 0.04

  // normalise (VADER-style) so length does not dominate
  const score = sum === 0 ? 0 : sum / Math.sqrt(sum * sum + 14)
  return {
    score: +score.toFixed(4),
    magnitude: +Math.abs(sum).toFixed(2),
    label: score >= 0.06 ? 'positive' : score <= -0.06 ? 'negative' : 'neutral',
    hits,
  }
}

/** Does the message ask something? Drives the answered-rate metric. */
export function isQuestion(text) {
  const t = String(text || '').trim()
  if (!t) return false
  if (/\?/.test(t)) return true
  return /^(who|what|when|where|which|why|how|can|could|do|does|did|is|are|am|will|would|should|any(one|body)|has|have|kya|kaise|kaun|kab|kahan|koi)\b/i.test(t)
}
