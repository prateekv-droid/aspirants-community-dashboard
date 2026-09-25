import { fmtFull } from '../lib/format.js'

/* ── Source tiles ──────────────────────────────────────────────────────────
   Channel and number, nothing else. The unit stays because the tiles count
   different things — GA reports users, short.io reports clicks — and the
   figures would read as comparable without it. Where each number comes from
   is documented on ACQUISITION_SOURCES in lib/metrics.js. ------------------ */
export default function AcquisitionTiles({ tiles }) {
  return (
    <section className="glass">
      <div className="sec-head"><h2>Sources</h2></div>
      <div className="src-tiles">
        {tiles.map((t) => (
          <div className={`src-tile${t.available ? '' : ' off'}`} key={t.key}>
            <span className="src-label">{t.label}</span>
            {t.available ? (
              <span className="src-value">
                {fmtFull(t.value)}
                <span className="src-unit">{t.value === 1 ? t.unit.replace(/s$/, '') : t.unit}</span>
              </span>
            ) : (
              <span className="src-value" style={{ color: 'var(--text-3)' }} title="Not imported yet">—</span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
