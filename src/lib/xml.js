/* ── Tiny XML reader ───────────────────────────────────────────────────────
   Just enough of an XML parser for OOXML parts: elements, attributes, text.
   Written by hand so the xlsx reader runs identically in the browser and in
   Node (the seed builder), with no DOMParser and no dependency.
   ------------------------------------------------------------------------ */

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
    if (g[0] === '#') {
      const cp = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m
    }
    return ENT[g] ?? m
  })
}

/** @typedef {{name:string, attrs:Object<string,string>, children:Node[], text:string}} Node */

/** Parse an XML document into a lightweight tree. */
export function parseXML(xml) {
  const root = { name: '#document', attrs: {}, children: [], text: '' }
  const stack = [root]
  const re = /<([!?/]?)([^\s/>!?][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[!?][^>]*>/g
  let last = 0
  let m
  while ((m = re.exec(xml))) {
    const textChunk = xml.slice(last, m.index)
    if (textChunk) stack[stack.length - 1].text += decodeEntities(textChunk)
    last = re.lastIndex

    if (m[5] !== undefined) { // CDATA
      stack[stack.length - 1].text += m[5]
      continue
    }
    if (m[2] === undefined) continue // comment / PI / doctype

    const [, prefix, name, attrStr, selfClose] = m
    if (prefix === '/') {
      if (stack.length > 1) stack.pop()
      continue
    }
    if (prefix === '!' || prefix === '?') continue

    const attrs = {}
    if (attrStr) {
      const ar = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g
      let a
      while ((a = ar.exec(attrStr))) attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? '')
    }
    const node = { name, attrs, children: [], text: '' }
    stack[stack.length - 1].children.push(node)
    if (!selfClose) stack.push(node)
  }
  return root
}

const local = (n) => n.slice(n.indexOf(':') + 1)

/** Direct children whose local name matches. */
export function kids(node, name) {
  return node.children.filter((c) => local(c.name) === name)
}

/** All descendants whose local name matches, depth-first. */
export function descendants(node, name, out = []) {
  for (const c of node.children) {
    if (local(c.name) === name) out.push(c)
    descendants(c, name, out)
  }
  return out
}

/** Concatenated text of a node and everything beneath it. */
export function deepText(node) {
  let s = node.text
  for (const c of node.children) s += deepText(c)
  return s
}

/** First descendant with the given local name, or null. */
export function first(node, name) {
  const d = descendants(node, name)
  return d.length ? d[0] : null
}
