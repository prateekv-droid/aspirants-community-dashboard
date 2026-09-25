/* ── Minimal XLSX reader ───────────────────────────────────────────────────
   An .xlsx is a zip of XML, so it rides on the same unzip() used for the
   WhatsApp exports, and on the tiny parseXML() so it behaves the same in
   the browser and in Node. Returns every sheet as a matrix of primitives
   with serial dates converted to ISO — enough to read both a short.io
   analytics export (14 two-column sheets) and a flat leads sheet.
   ------------------------------------------------------------------------ */
import { unzip } from './unzip.js'
import { parseXML, descendants, kids, deepText } from './xml.js'

function colToIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '')
  if (!m) return 0
  let n = 0
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Excel serial → ISO date (1900 epoch, including the Lotus leap-year bug). */
export function serialToISO(n) {
  const d = new Date(Math.round((n - 25569) * 86400000))
  return isNaN(d) ? String(n) : d.toISOString().slice(0, 10)
}

const BUILTIN_DATE = new Set(['14','15','16','17','18','19','20','21','22','27','30','36','45','46','47','50','57'])
const LOOKS_DATE = /[dmyhs]/i

export async function readXLSX(buf) {
  const entries = await unzip(buf)
  const byName = new Map(entries.map((e) => [e.name.replace(/^\//, ''), e]))
  const text = async (n) => (byName.has(n) ? byName.get(n).text() : null)

  // ── shared strings
  const shared = []
  const ssXml = await text('xl/sharedStrings.xml')
  if (ssXml) for (const si of descendants(parseXML(ssXml), 'si')) shared.push(deepText(si))

  // ── which cell styles render as dates
  const dateStyles = new Set()
  const stylesXml = await text('xl/styles.xml')
  if (stylesXml) {
    const doc = parseXML(stylesXml)
    const custom = new Map()
    for (const nf of descendants(doc, 'numFmt')) custom.set(nf.attrs.numFmtId, nf.attrs.formatCode || '')
    const cellXfs = descendants(doc, 'cellXfs')[0]
    const xfs = cellXfs ? kids(cellXfs, 'xf') : []
    xfs.forEach((xf, i) => {
      const id = xf.attrs.numFmtId
      const code = custom.get(id)
      const codeIsDate = code && LOOKS_DATE.test(code.replace(/"[^"]*"/g, '')) && !/^[#0,.%\s]+$/.test(code)
      if (BUILTIN_DATE.has(id) || codeIsDate) dateStyles.add(i)
    })
  }

  // ── sheet name → sheet part
  const rels = new Map()
  const relXml = await text('xl/_rels/workbook.xml.rels')
  if (relXml) for (const r of descendants(parseXML(relXml), 'Relationship')) rels.set(r.attrs.Id, r.attrs.Target)

  const wbXml = await text('xl/workbook.xml')
  if (!wbXml) throw new Error('Not a valid .xlsx workbook (xl/workbook.xml missing).')
  const sheets = []
  for (const sh of descendants(parseXML(wbXml), 'sheet')) {
    const rid = sh.attrs['r:id'] || sh.attrs.id
    let target = (rels.get(rid) || '').replace(/^\//, '').replace(/^\.\//, '')
    if (target && !target.startsWith('xl/')) target = 'xl/' + target
    sheets.push({ name: sh.attrs.name || `Sheet${sheets.length + 1}`, target })
  }

  const out = []
  for (const s of sheets) {
    const xml = await text(s.target)
    if (!xml) continue
    const rows = []
    for (const row of descendants(parseXML(xml), 'row')) {
      const arr = []
      for (const c of kids(row, 'c')) {
        const idx = colToIndex(c.attrs.r)
        const t = c.attrs.t
        const style = c.attrs.s !== undefined ? +c.attrs.s : -1
        let v
        if (t === 'inlineStr') v = deepText(c)
        else {
          const vEl = kids(c, 'v')[0]
          const raw = vEl ? deepText(vEl) : null
          if (raw == null || raw === '') v = ''
          else if (t === 's') v = shared[+raw] ?? ''
          else if (t === 'b') v = raw === '1'
          else if (t === 'str' || t === 'e') v = raw
          else {
            const n = Number(raw)
            v = Number.isNaN(n) ? raw : dateStyles.has(style) ? serialToISO(n) : n
          }
        }
        arr[idx] = v
      }
      for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = ''
      rows.push(arr)
    }
    out.push({ name: s.name, rows })
  }
  return out
}
