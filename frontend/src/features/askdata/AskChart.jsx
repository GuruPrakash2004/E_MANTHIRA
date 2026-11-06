import { Text } from '@mantine/core'

/**
 * Dependency-free SVG charts (bar / line / pie / KPI) drawn with the theme's CSS variables so they follow
 * the maroon-gold palette in light and dark. Spec comes from the backend (`chart` = kpi|bar|line|pie|table).
 */
const SLICES = ['var(--vt-accent)', 'var(--mantine-color-kumkum-5)', 'var(--vt-gold-chip)', 'var(--mantine-color-kumkum-8)', 'var(--mantine-color-kumkum-3)', 'var(--mantine-color-kumkum-6)']
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(n))

export default function AskChart({ type, columns, rows }) {
  if (!rows?.length || type === 'table') return null
  if (type === 'kpi') return <Text fz={40} fw={700} c="var(--vt-accent)">{fmt(rows[0][0])}</Text>

  const labels = rows.map((r) => String(r[0]))
  const vals = rows.map((r) => Number(r[1]) || 0)
  const max = Math.max(...vals, 1)
  const W = 640, H = 240, P = 36

  if (type === 'pie') {
    const total = vals.reduce((a, b) => a + b, 0) || 1
    let a0 = -Math.PI / 2
    return (
      <svg className="ad-pie" viewBox="0 0 640 220" role="img" aria-label={columns.join(' / ')} style={{ width: '100%', maxHeight: 240 }}>
        {vals.map((v, i) => {
          const a1 = a0 + (v / total) * Math.PI * 2
          const big = a1 - a0 > Math.PI ? 1 : 0
          const d = `M110 110 L${110 + 100 * Math.cos(a0)} ${110 + 100 * Math.sin(a0)} A100 100 0 ${big} 1 ${110 + 100 * Math.cos(a1)} ${110 + 100 * Math.sin(a1)} Z`
          a0 = a1
          return <path key={i} d={d} fill={SLICES[i % SLICES.length]} stroke="var(--vt-surface)" strokeWidth="2" />
        })}
        {labels.map((l, i) => (
          <g key={i} transform={`translate(240 ${24 + i * 28})`}>
            <rect width="14" height="14" rx="3" fill={SLICES[i % SLICES.length]} />
            <text x="22" y="12" fontSize="13" fill="currentColor">{l} - {fmt(vals[i])}</text>
          </g>
        ))}
      </svg>
    )
  }

  const x = (i) => P + (rows.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (rows.length - 1))
  const y = (v) => H - P - (v / max) * (H - 2 * P)
  const step = Math.ceil(rows.length / 10)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={columns.join(' / ')} style={{ width: '100%', maxHeight: 280 }}>
      <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--vt-line)" />
      <text x={P - 6} y={y(max) + 4} fontSize="11" textAnchor="end" fill="currentColor">{fmt(max)}</text>
      {type === 'line' ? (
        <>
          <polyline className="ad-line" pathLength="1" fill="none" stroke="var(--vt-accent)" strokeWidth="2.5" points={vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
          {vals.map((v, i) => <circle className="ad-pt" key={i} cx={x(i)} cy={y(v)} r="3.5" fill="var(--vt-accent)"><title>{`${labels[i]}: ${fmt(v)}`}</title></circle>)}
        </>
      ) : (
        vals.map((v, i) => {
          const bw = Math.min(48, (W - 2 * P) / rows.length - 6)
          const cx = P + ((i + 0.5) * (W - 2 * P)) / rows.length
          return <rect className="ad-bar" style={{ animationDelay: `${i * 60}ms` }} key={i} x={cx - bw / 2} y={y(v)} width={bw} height={H - P - y(v)} rx="3" fill="var(--vt-accent)"><title>{`${labels[i]}: ${fmt(v)}`}</title></rect>
        })
      )}
      {labels.map((l, i) => i % step === 0 && (
        <text key={i} x={type === 'line' ? x(i) : P + ((i + 0.5) * (W - 2 * P)) / rows.length} y={H - P + 16} fontSize="11" textAnchor="middle" fill="currentColor">{l.length > 12 ? `${l.slice(0, 11)}…` : l}</text>
      ))}
    </svg>
  )
}
