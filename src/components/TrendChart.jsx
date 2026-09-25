import { useMemo, useRef, useState } from 'react'
import { fmtShort, fmtLong } from '../lib/dates.js'
import { fmtNum } from '../lib/format.js'

/* ── Multi-series trend line ───────────────────────────────────────────────
   Hand-rolled SVG rather than a chart library, for the two behaviours the
   Search Console pattern depends on: each series keeps its own y-scale (so
   toggling "members" next to "left" doesn't flatten the small series), and
   the previous period is drawn dashed against the same x-axis.
   ------------------------------------------------------------------------ */

const PAD = { t: 12, r: 16, b: 26, l: 46 }

function niceMax(v) {
  if (v <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / mag
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * mag
}

function path(points) {
  if (!points.length) return ''
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')
}

export default function TrendChart({
  series,           // [{ key, label, color, values:[{date,value}], prev?:[{date,value}], format? }]
  height = 268,
  showArea = true,
  yTicks = 4,
  /* Independent per-series scales are right when the series measure different
     things (the Search Console metric picker) and wrong when they measure the
     same thing — five country groups' membership must share one axis or the
     chart lies about their relative size. */
  shared = false,
}) {
  const [hover, setHover] = useState(null)
  const wrapRef = useRef(null)
  const [w, setW] = useState(900)

  const measure = (el) => {
    if (!el) return
    wrapRef.current = el
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, e.contentRect.width)))
    ro.observe(el)
  }

  const active = series.filter((s) => s.values?.length)
  const n = active[0]?.values.length || 0

  const geom = useMemo(() => {
    const iw = Math.max(60, w - PAD.l - PAD.r)
    const ih = Math.max(60, height - PAD.t - PAD.b)
    const xAt = (i) => PAD.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
    const scaleOf = (list) => {
      const vals = list.flatMap((s) => [...s.values.map((v) => v.value), ...(s.prev || []).map((v) => v.value)])
      const max = niceMax(Math.max(...vals, 0))
      const min = Math.min(0, ...vals)
      const lo = min < 0 ? -niceMax(-min) : 0
      return { max, lo, span: max - lo || 1 }
    }
    const scales = shared
      ? active.map(() => scaleOf(active))
      : active.map((s) => scaleOf([s]))
    const yAt = (si, v) => {
      const sc = scales[si]
      return PAD.t + ih - ((v - sc.lo) / sc.span) * ih
    }
    return { iw, ih, xAt, yAt, scales }
  }, [w, height, n, active, shared])

  if (!active.length || !n) {
    return <div className="chart" style={{ height, display: 'grid', placeItems: 'center' }}>
      <span className="muted">No data in this range.</span>
    </div>
  }

  const dates = active[0].values.map((v) => v.date)
  // x labels: about one per 90px, always including both ends
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(geom.iw / 88))))
  const xLabels = dates.map((d, i) => ({ d, i })).filter(({ i }) => i % every === 0 || i === n - 1)

  const primary = geom.scales[0]
  const yLabels = Array.from({ length: yTicks + 1 }, (_, k) => {
    const v = primary.lo + ((primary.max - primary.lo) * k) / yTicks
    return { v, y: geom.yAt(0, v) }
  })

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - box.left
    const rel = (x - PAD.l) / Math.max(1, geom.iw)
    const i = Math.round(rel * (n - 1))
    if (i < 0 || i >= n) { setHover(null); return }
    setHover(i)
  }

  const tipLeft = hover === null ? 0 : geom.xAt(hover)
  const flip = tipLeft > w - 130

  return (
    <div className="chart" ref={measure} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${w} ${height}`} height={height} onMouseMove={onMove} role="img"
           aria-label={`Trend of ${active.map((s) => s.label).join(', ')}`}>
        {/* horizontal grid + y axis (scaled to the first selected series) */}
        {yLabels.map(({ v, y }, k) => (
          <g key={k}>
            <line className="grid-line" x1={PAD.l} x2={w - PAD.r} y1={y} y2={y}
                  opacity={v === 0 ? 0.9 : 0.5} />
            <text className="axis-text" x={PAD.l - 8} y={y + 3.5} textAnchor="end">
              {fmtNum(v, active[0].format)}
            </text>
          </g>
        ))}

        {/* previous period, dashed */}
        {active.map((s, si) =>
          s.prev?.length === n ? (
            <path key={`p${s.key}`} className="series-line prev" stroke={s.color}
                  d={path(s.prev.map((v, i) => ({ x: geom.xAt(i), y: geom.yAt(si, v.value) })))} />
          ) : null
        )}

        {/* current period */}
        {active.map((s, si) => {
          const pts = s.values.map((v, i) => ({ x: geom.xAt(i), y: geom.yAt(si, v.value) }))
          const base = geom.yAt(si, Math.max(0, geom.scales[si].lo))
          return (
            <g key={s.key}>
              {showArea && active.length === 1 && (
                <>
                  <defs>
                    <linearGradient id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
                      <stop offset="100%" stopColor={s.color} stopOpacity="0.01" />
                    </linearGradient>
                  </defs>
                  <path className="series-area" fill={`url(#g-${s.key})`}
                        d={`${path(pts)} L${pts[pts.length - 1].x.toFixed(2)} ${base} L${pts[0].x.toFixed(2)} ${base} Z`} />
                </>
              )}
              <path className="series-line" stroke={s.color} d={path(pts)} />
              {n <= 45 && pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={hover === i ? 4 : 0}
                        className="chart-dot" fill={s.color} />
              ))}
            </g>
          )
        })}

        {/* x axis */}
        {xLabels.map(({ d, i }) => (
          <text key={i} className="axis-text" x={geom.xAt(i)} y={height - 8}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
            {fmtShort(d)}
          </text>
        ))}

        {hover !== null && (
          <line className="cursor-line" x1={geom.xAt(hover)} x2={geom.xAt(hover)}
                y1={PAD.t} y2={height - PAD.b} />
        )}
      </svg>

      {hover !== null && (
        <div className="tip" style={{
          left: flip ? tipLeft - 12 : tipLeft,
          top: PAD.t + 4,
          transform: flip ? 'translate(-100%, 0)' : 'translate(-50%, 0)',
        }}>
          <div className="tip-date">{fmtLong(dates[hover])}</div>
          {active.map((s) => (
            <div className="tip-row" key={s.key}>
              <i className="sw" style={{ background: s.color }} />
              <span className="k">{s.label}</span>
              <span className="v">{fmtNum(s.values[hover].value, s.format)}</span>
            </div>
          ))}
          {active.some((s) => s.prev?.length === n) && (
            <>
              <div style={{ borderTop: '1px solid var(--line)', margin: '5px 0' }} />
              {active.map((s) => s.prev?.length === n ? (
                <div className="tip-row prev" key={`p${s.key}`}>
                  <i className="sw" style={{ background: s.color, opacity: 0.45 }} />
                  <span className="k">{fmtShort(s.prev[hover].date)}</span>
                  <span className="v">{fmtNum(s.prev[hover].value, s.format)}</span>
                </div>
              ) : null)}
            </>
          )}
        </div>
      )}
    </div>
  )
}
