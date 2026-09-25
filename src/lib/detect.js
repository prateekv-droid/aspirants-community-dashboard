/* ── Source auto-detection ─────────────────────────────────────────────────
   Files are identified by *structure*, not by filename, because operators
   rename exports constantly. Each detector returns a confidence score and
   the evidence it matched on, so the upload dialog can show its reasoning
   and the operator can override it.
   ------------------------------------------------------------------------ */
import { unzip } from './unzip.js'
import { readXLSX } from './xlsx.js'
import { parseCSV } from './csv.js'
import { parseGA } from './parseGA.js'
import { parseShortIo } from './parseShortIo.js'
import { parseWhatsAppChat, groupLabelFromPath, countryFromLabel } from './parseWhatsApp.js'
import { inferMapping, buildLeads } from './parseLeads.js'

export const SOURCES = {
  whatsapp: { label: 'WhatsApp community export', icon: '💬', hint: 'zip of group chats' },
  ga:       { label: 'Google Analytics snapshot', icon: '📈', hint: 'attribution & audience' },
  shortio:  { label: 'short.io click analytics',  icon: '🔗', hint: 'link clicks & UTMs' },
  leads:    { label: 'Leads sheet',               icon: '🎯', hint: 'lead records' },
}

const dec = (b) => new TextDecoder('utf-8').decode(b instanceof Uint8Array ? b : new Uint8Array(b))
const isZip = (u8) => u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b && (u8[2] === 3 || u8[2] === 5 || u8[2] === 7)

const SHORTIO_SHEETS = ['general statistic', 'click statistics', 'utm source', 'utm medium', 'utm campaign', 'top links']

/**
 * Inspect a file and return what it is plus its parsed payload.
 * @param {{name:string, buffer:ArrayBuffer}} file
 * @returns {Promise<{source:string, confidence:number, evidence:string[], payload:object, warnings:string[]}>}
 */
export async function detectAndParse(file) {
  const u8 = new Uint8Array(file.buffer)
  const name = file.name || 'file'
  const warnings = []

  /* ── zip: WhatsApp community export, or an .xlsx ─────────────────────── */
  if (isZip(u8)) {
    const entries = await unzip(u8)
    const names = entries.map((e) => e.name)

    // .xlsx / .xlsm are zips too — recognised by their OOXML parts
    if (names.some((n) => n === 'xl/workbook.xml')) {
      return classifyWorkbook(await readXLSX(u8), name, warnings)
    }

    const chats = entries.filter((e) => !e.dir && /(^|\/)_chat\.txt$/i.test(e.name))
    const nested = entries.filter((e) => !e.dir && /\.zip$/i.test(e.name) && !e.name.includes('__MACOSX'))
    const looksWA = chats.length > 0 || nested.some((e) => /whatsapp chat/i.test(e.name))

    if (looksWA) {
      const evidence = []
      const groups = []

      // Case A — a community export: one outer zip of per-group zips
      for (const z of nested) {
        if (!/whatsapp chat/i.test(z.name) && !/\.zip$/i.test(z.name)) continue
        let inner
        try { inner = await unzip(await z.bytes()) } catch { warnings.push(`Could not open "${z.name}".`); continue }
        const chat = inner.find((e) => /(^|\/)_chat\.txt$/i.test(e.name)) || inner.find((e) => /\.txt$/i.test(e.name))
        if (!chat) { warnings.push(`"${z.name}" has no chat transcript — skipped.`); continue }
        const label = groupLabelFromPath(z.name)
        const media = inner.filter((e) => !e.dir && !/\.txt$/i.test(e.name)).length
        groups.push({ ...parseWhatsAppChat(await chat.text(), label), media, country: countryFromLabel(label) })
      }

      // Case B — a single group export dropped directly
      for (const c of chats) {
        const label = groupLabelFromPath(c.name.replace(/\/_chat\.txt$/i, '')) || groupLabelFromPath(name)
        const lbl = /^chat$/i.test(label) ? groupLabelFromPath(name) : label
        const media = entries.filter((e) => !e.dir && !/\.txt$/i.test(e.name) && !e.name.includes('__MACOSX')).length
        groups.push({ ...parseWhatsAppChat(await c.text(), lbl), media, country: countryFromLabel(lbl) })
      }

      if (!groups.length) {
        return { source: null, confidence: 0, evidence: ['Zip contained no readable WhatsApp transcript.'], payload: null, warnings }
      }
      evidence.push(`${groups.length} group transcript${groups.length > 1 ? 's' : ''} found`)
      evidence.push(`${groups.reduce((s, g) => s + g.events.length, 0).toLocaleString()} timeline events parsed`)
      const dates = groups.flatMap((g) => [g.first, g.last]).filter(Boolean).sort()
      if (dates.length) evidence.push(`covers ${dates[0]} → ${dates[dates.length - 1]}`)

      return {
        source: 'whatsapp',
        confidence: 0.97,
        evidence,
        warnings,
        payload: {
          communityName: guessCommunityName(name),
          groups,
          range: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
        },
      }
    }
    return { source: null, confidence: 0, evidence: ['Zip did not match any known export shape.'], payload: null, warnings }
  }

  /* ── bare .txt: a single WhatsApp transcript ─────────────────────────── */
  const head = dec(u8.subarray(0, 4096))
  if (/\.txt$/i.test(name) || /^﻿?[‎‏]?\[\d{1,2}\/\d{1,2}\/\d{2,4},/.test(head)) {
    const text = dec(u8)
    const label = groupLabelFromPath(name)
    const parsed = parseWhatsAppChat(text, label)
    if (parsed.events.length) {
      return {
        source: 'whatsapp',
        confidence: 0.9,
        evidence: [`single transcript "${label}"`, `${parsed.events.length.toLocaleString()} events`],
        warnings,
        payload: {
          communityName: guessCommunityName(name),
          groups: [{ ...parsed, media: 0, country: countryFromLabel(label) }],
          range: { from: parsed.first, to: parsed.last },
        },
      }
    }
  }

  /* ── csv / tsv: GA snapshot or a leads export ───────────────────────── */
  const text = dec(u8)
  const gaMarkers = /(^|\n)#\s*(Reports snapshot|Start date:|Property:|Account:|Nth day)/i.test(text)
  if (gaMarkers) {
    const ga = parseGA(text)
    const evidence = [
      ga.property ? `property "${ga.property}"` : 'GA snapshot markers found',
      `${Object.keys(ga.blocks).length} report cards recognised`,
    ]
    if (ga.range.from) evidence.push(`${ga.range.from} → ${ga.range.to}`)
    if (ga.unknown.length) warnings.push(`${ga.unknown.length} unrecognised report card(s) ignored.`)
    return { source: 'ga', confidence: 0.98, evidence, payload: ga, warnings }
  }

  const rows = parseCSV(text)
  if (rows.length > 1) {
    const header = rows[0].map((h) => String(h).trim())
    const body = rows.slice(1)
    const shortIoLike = header.length === 2 && /clicks/i.test(header[1] || '')
    if (shortIoLike) {
      const parsed = parseShortIo([{ name: header[0], rows }])
      return {
        source: 'shortio', confidence: 0.6,
        evidence: [`two-column click table "${header[0]}"`],
        warnings: [...warnings, 'Single-sheet CSV — a full short.io .xlsx export gives every dimension.'],
        payload: parsed,
      }
    }
    const mapping = inferMapping(header, body)
    const mapped = Object.values(mapping).filter(Boolean)
    if (mapped.length >= 2) {
      const built = buildLeads(header, body, mapping)
      return {
        source: 'leads',
        confidence: Math.min(0.95, 0.5 + mapped.length * 0.08),
        evidence: [`${built.leads.length.toLocaleString()} rows`, `mapped ${mapped.length} of ${header.length} columns: ${mapped.join(', ')}`],
        warnings: built.skipped ? [...warnings, `${built.skipped} row(s) had no name, phone or email and were skipped.`] : warnings,
        payload: { ...built, header, rows: body, sheet: 'CSV' },
      }
    }
    return {
      source: null, confidence: 0.2,
      evidence: [`table with ${header.length} columns, none recognised`],
      payload: { header, rows: body }, warnings,
    }
  }

  return { source: null, confidence: 0, evidence: ['Unrecognised file format.'], payload: null, warnings }
}

/** An .xlsx could be a short.io export or a leads sheet. */
function classifyWorkbook(sheets, name, warnings) {
  const names = sheets.map((s) => String(s.name).toLowerCase())
  const hits = SHORTIO_SHEETS.filter((s) => names.includes(s))
  if (hits.length >= 3) {
    const parsed = parseShortIo(sheets)
    const evidence = [
      `workbook of ${sheets.length} analytics tabs`,
      `matched short.io tabs: ${hits.join(', ')}`,
      `${parsed.totals.clicks.toLocaleString()} clicks on ${parsed.totals.links} short links`,
    ]
    if (parsed.range.from) evidence.push(`${parsed.range.from} → ${parsed.range.to}`)
    if (parsed.unknown.length) warnings.push(`Unrecognised tab(s) ignored: ${parsed.unknown.join(', ')}.`)
    return { source: 'shortio', confidence: 0.97, evidence, payload: parsed, warnings }
  }

  // otherwise: the widest sheet that looks like a record table = leads
  let best = null
  for (const s of sheets) {
    const rows = s.rows.filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
    if (rows.length < 2) continue
    const header = rows[0].map((h) => String(h).trim())
    const mapping = inferMapping(header, rows.slice(1))
    const mapped = Object.values(mapping).filter(Boolean).length
    if (!best || mapped > best.mapped || (mapped === best.mapped && rows.length > best.rows.length)) {
      best = { sheet: s.name, header, rows: rows.slice(1), mapping, mapped }
    }
  }
  if (best && best.mapped >= 2) {
    const built = buildLeads(best.header, best.rows, best.mapping)
    const mappedNames = Object.values(best.mapping).filter(Boolean)
    return {
      source: 'leads',
      confidence: Math.min(0.95, 0.5 + best.mapped * 0.08),
      evidence: [
        `sheet "${best.sheet}" with ${built.leads.length.toLocaleString()} records`,
        `mapped ${best.mapped} of ${best.header.length} columns: ${mappedNames.join(', ')}`,
      ],
      warnings: built.skipped ? [...warnings, `${built.skipped} row(s) skipped (no name, phone or email).`] : warnings,
      payload: { ...built, header: best.header, rows: best.rows, sheet: best.sheet },
    }
  }
  return {
    source: null, confidence: 0.2,
    evidence: [`workbook with ${sheets.length} sheet(s); no known structure matched`],
    payload: { sheets }, warnings,
  }
}

/** "WA communty #1.zip" → "Community #1" */
function guessCommunityName(fileName) {
  const base = String(fileName).replace(/\.(zip|txt)$/i, '').trim()
  const m = /(?:community|communty|comm)\s*#?\s*(\d+)/i.exec(base)
  if (m) return `Community #${m[1]}`
  const n = /#\s*(\d+)/.exec(base)
  if (n) return `Community #${n[1]}`
  return base.replace(/^WA\s*/i, '').trim() || 'Community #1'
}
