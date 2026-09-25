import { useMemo, useState } from 'react'
import { fmtNum, fmtFull } from '../lib/format.js'

/* Dense sortable table with optional in-cell proportional bars.
   columns: [{ key, label, format?, align?, bar?, width?, render?(row), sub?(row) }] */
export default function DataTable({
  columns, rows, initialSort, pageSize = 15, empty = 'Nothing in this range.',
  onRowClick, rowKey = (r, i) => r.label ?? i, dense,
}) {
  const [sort, setSort] = useState(initialSort || { key: columns[1]?.key || columns[0].key, dir: 'desc' })
  const [limit, setLimit] = useState(pageSize)
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    if (!q.trim()) return rows
    const s = q.trim().toLowerCase()
    return rows.filter((r) => String(r.label ?? '').toLowerCase().includes(s) ||
      columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(s)))
  }, [rows, q, columns])

  const sorted = useMemo(() => {
    const out = [...filtered]
    const { key, dir } = sort
    out.sort((a, b) => {
      const x = a[key], y = b[key]
      if (typeof x === 'number' && typeof y === 'number') return dir === 'asc' ? x - y : y - x
      const r = String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true })
      return dir === 'asc' ? r : -r
    })
    return out
  }, [filtered, sort])

  const barMax = useMemo(() => {
    const m = {}
    for (const c of columns) if (c.bar) m[c.key] = Math.max(1, ...rows.map((r) => Math.abs(+r[c.key] || 0)))
    return m
  }, [columns, rows])

  const shown = sorted.slice(0, limit)
  const click = (k) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: k, dir: 'desc' }))

  return (
    <>
      {rows.length > pageSize && (
        <div style={{ padding: '10px 14px 0' }}>
          <input type="search" placeholder="Filter rows…" value={q}
                 onChange={(e) => { setQ(e.target.value); setLimit(pageSize) }}
                 style={{ maxWidth: 260 }} aria-label="Filter table rows" />
        </div>
      )}
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`sortable${c.align === 'right' || c.format || c.bar ? ' n' : ''}`}
                    style={{ width: c.width }} onClick={() => click(c.key)}
                    aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {c.label}
                  {sort.key === c.key && <span className="sort-arrow">{sort.dir === 'desc' ? '▼' : '▲'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={rowKey(r, i)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}>
                {columns.map((c) => {
                  const raw = r[c.key]
                  const cell = c.render ? c.render(r) : c.format ? fmtNum(raw, c.format) : typeof raw === 'number' ? fmtFull(raw) : (raw ?? '—')
                  // an explicit align wins; otherwise numbers sit right
                  const isNum = c.align ? c.align === 'right' : (!!c.format || !!c.bar || typeof raw === 'number')
                  if (c.bar) {
                    const pct = Math.min(100, (Math.abs(+raw || 0) / barMax[c.key]) * 100)
                    return (
                      <td key={c.key} className="n bar-cell" style={{ '--c': c.color || 'var(--accent)' }}>
                        <i className="fill" style={{ width: `${pct}%` }} />
                        <span className="txt">{cell}</span>
                      </td>
                    )
                  }
                  return (
                    <td key={c.key} className={isNum ? 'n' : ''} style={{ padding: dense ? '6px 14px' : undefined }}>
                      <div className={c.key === columns[0].key ? 'cell-main' : ''}>{cell}</div>
                      {c.sub && <div className="cell-sub">{c.sub(r)}</div>}
                    </td>
                  )
                })}
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={columns.length} style={{ textAlign: 'center', padding: '28px 14px', color: 'var(--text-3)' }}>{empty}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {(sorted.length > limit || limit > pageSize) && (
        <div className="table-foot">
          <span>Showing {shown.length.toLocaleString()} of {sorted.length.toLocaleString()}{q ? ` (filtered from ${rows.length.toLocaleString()})` : ''}</span>
          <span className="spacer" />
          {sorted.length > limit && <button className="btn tiny" onClick={() => setLimit((l) => l + pageSize * 2)}>Show more</button>}
          {limit > pageSize && <button className="btn tiny ghost" onClick={() => setLimit(pageSize)}>Collapse</button>}
        </div>
      )}
    </>
  )
}
