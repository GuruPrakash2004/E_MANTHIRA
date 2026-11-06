import { useId } from 'react'

/**
 * The Alertify logo: a violet gradient rounded square with a white lightning bolt, and the wordmark "Alert" in dark navy with
 * "ify" in teal (drawn to match Alertify's own popup). It deliberately keeps Alertify's own colours - the one place the
 * temple's maroon / gold rule does not apply (explicit request) - and the wordmark ink follows the theme in dark mode.
 *   <AlertifyLogo />                       the mark with the wordmark
 *   <AlertifyLogo mark size={18} />        only the square, e.g. on a button
 *   <AlertifyLogo tagline="..." />         adds the small grey line under the wordmark
 */
export function AlertifyMark({ size = 36 }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Alertify" style={{ flex: '0 0 auto', display: 'block' }}>
      <defs>
        <linearGradient id={`al-g-${id}`} x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#5B3FD8" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill={`url(#al-g-${id})`} />
      <path d="M27.2 8.5 13.5 26.3a1 1 0 0 0 .8 1.6h7.2l-1.6 11.7a.6.6 0 0 0 1.1.4L34.7 21.7a1 1 0 0 0-.8-1.6h-7.2l1.6-10.9a.6.6 0 0 0-1.1-.7Z" fill="#fff" />
    </svg>
  )
}

export default function AlertifyLogo({ mark = false, size = 36, tagline = '' }) {
  if (mark) return <AlertifyMark size={size} />
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.3) }}>
      <AlertifyMark size={size} />
      <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.1 }}>
        <span style={{ fontWeight: 800, fontSize: Math.round(size * 0.56), letterSpacing: -0.4, fontFamily: 'Inter, system-ui, sans-serif' }}>
          <span style={{ color: 'var(--al-ink, #141B34)' }}>Alert</span>
          <span style={{ color: '#14B8A6' }}>ify</span>
        </span>
        {tagline ? <span style={{ fontSize: Math.max(11, Math.round(size * 0.3)), color: 'var(--al-sub, #5B6478)' }}>{tagline}</span> : null}
      </span>
    </span>
  )
}
