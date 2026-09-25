/* ── Minimal ZIP reader ────────────────────────────────────────────────────
   Reads STORE (0) and DEFLATE (8) entries using the platform's own
   DecompressionStream('deflate-raw'). No third-party dependency, which
   matters because the tool must also open the *nested* zips inside a
   WhatsApp community export.
   ------------------------------------------------------------------------ */

const EOCD = 0x06054b50
const CDH = 0x02014b50
const EOCD64_LOC = 0x07064b50
const EOCD64 = 0x06064b50

function findEOCD(dv, len) {
  const max = Math.min(len, 0xffff + 22)
  for (let i = 22; i <= max; i++) {
    const off = len - i
    if (off < 0) break
    if (dv.getUint32(off, true) === EOCD) return off
  }
  return -1
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    // Node fallback (used by the parser test scripts, never in the browser).
    // The specifier is hidden from the bundler so it is not pulled into the build.
    const nodeZlib = 'node:zlib'
    const { inflateRawSync } = await import(/* @vite-ignore */ nodeZlib)
    return new Uint8Array(inflateRawSync(bytes))
  }
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([bytes]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * List and decompress the entries of a zip.
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {Promise<Array<{name:string, dir:boolean, size:number, bytes:()=>Promise<Uint8Array>, text:()=>Promise<string>}>>}
 */
export async function unzip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const eocd = findEOCD(dv, u8.byteLength)
  if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record).')

  let count = dv.getUint16(eocd + 10, true)
  let cdOff = dv.getUint32(eocd + 16, true)

  // Zip64 — WhatsApp media exports can exceed the 32-bit fields
  if (cdOff === 0xffffffff || count === 0xffff) {
    for (let i = eocd - 20; i >= 0; i--) {
      if (dv.getUint32(i, true) === EOCD64_LOC) {
        const z64 = Number(dv.getBigUint64(i + 8, true))
        if (dv.getUint32(z64, true) === EOCD64) {
          count = Number(dv.getBigUint64(z64 + 32, true))
          cdOff = Number(dv.getBigUint64(z64 + 48, true))
        }
        break
      }
    }
  }

  const dec = new TextDecoder('utf-8')
  const entries = []
  let p = cdOff
  for (let i = 0; i < count && p + 46 <= u8.byteLength; i++) {
    if (dv.getUint32(p, true) !== CDH) break
    const method = dv.getUint16(p + 10, true)
    let csize = dv.getUint32(p + 20, true)
    let usize = dv.getUint32(p + 24, true)
    const nLen = dv.getUint16(p + 28, true)
    const eLen = dv.getUint16(p + 30, true)
    const cLen = dv.getUint16(p + 32, true)
    let lho = dv.getUint32(p + 42, true)
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nLen))

    // zip64 extended information extra field
    if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) {
      let ep = p + 46 + nLen
      const end = ep + eLen
      while (ep + 4 <= end) {
        const id = dv.getUint16(ep, true)
        const sz = dv.getUint16(ep + 2, true)
        if (id === 0x0001) {
          let q = ep + 4
          if (usize === 0xffffffff) { usize = Number(dv.getBigUint64(q, true)); q += 8 }
          if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8 }
          if (lho === 0xffffffff) { lho = Number(dv.getBigUint64(q, true)) }
          break
        }
        ep += 4 + sz
      }
    }
    p += 46 + nLen + eLen + cLen

    const dir = name.endsWith('/')
    const read = async () => {
      const lnLen = dv.getUint16(lho + 26, true)
      const leLen = dv.getUint16(lho + 28, true)
      const start = lho + 30 + lnLen + leLen
      const raw = u8.subarray(start, start + csize)
      if (method === 0) return raw
      if (method === 8) return inflateRaw(raw)
      throw new Error(`Unsupported zip compression method ${method} for "${name}".`)
    }
    entries.push({
      name,
      dir,
      size: usize,
      bytes: read,
      text: async () => new TextDecoder('utf-8').decode(await read()),
    })
  }
  return entries
}
