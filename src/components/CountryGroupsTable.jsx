import { fmtFull, sentimentColor } from '../lib/format.js'
import DataTable from './DataTable.jsx'
import { Card } from './ui.jsx'

/* The per-country table — members, joins, exits, net, and how much each group
   talks. Rows come from groupActivity(). Clicking a row filters every section
   to that group when the caller passes onRowClick. */
export default function CountryGroupsTable({ rows, onRowClick, filtered = [] }) {
  return (
    <Card title="Country groups" sub="Ranked by activity. Joins and exits are counted from each group's own notices." pad={false}>
      <DataTable
        rows={rows}
        initialSort={{ key: 'messages', dir: 'desc' }}
        rowKey={(r) => r.key}
        onRowClick={onRowClick}
        columns={[
          { key: 'label', label: 'Group', render: (r) => (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              {filtered.includes(r.key) && <span className="badge soft">filtered</span>}
              {r.label}
            </span>
          ), sub: (r) => r.full },
          { key: 'members', label: 'Members', bar: true, color: 'var(--s1)' },
          { key: 'joined', label: 'New joins', bar: true, color: 'var(--s4)' },
          { key: 'left', label: 'Left', bar: true, color: 'var(--s2)' },
          { key: 'net', label: 'Net', render: (r) => (
            <span style={{ color: r.net >= 0 ? 'var(--pos)' : 'var(--neg)', fontWeight: 700 }}>
              {r.net >= 0 ? '+' : '−'}{fmtFull(Math.abs(r.net))}
            </span>
          ) },
          { key: 'messages', label: 'Messages', bar: true, color: 'var(--s3)' },
          { key: 'perDay', label: 'Per active day', format: 'dec' },
          { key: 'contributors', label: 'Contributors' },
          { key: 'sentiment', label: 'Tone', render: (r) => (
            <span style={{ color: sentimentColor(r.sentiment), fontWeight: 700 }}>
              {r.sentiment > 0 ? '+' : ''}{r.sentiment.toFixed(2)}
            </span>
          ) },
        ]}
      />
    </Card>
  )
}
