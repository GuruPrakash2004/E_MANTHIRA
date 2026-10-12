// Slow devotional motion behind every page (mounted once in the app shell and on the login form): two counter-turning mandalas, a breathing halo and rising diya sparks.
// Pure SVG/CSS, only transform and opacity, hidden for reduced-motion users (they get the still mandalas).
const SPARKS = Array.from({ length: 16 }, (_, i) => ({ left: `${(i * 37 + 7) % 100}%`, size: 3 + (i % 4), delay: -((i * 1.7) % 18), dur: 14 + (i % 5) * 3 }))
function Mandala({ petals = 16 }) {
  const rot = (n) => Array.from({ length: n }, (_, i) => (360 / n) * i)
  return (
    <svg viewBox="-100 -100 200 200" fill="none" stroke="currentColor" strokeWidth="0.6">
      {[96, 78, 46, 22].map((r) => <circle key={r} r={r} strokeDasharray={r === 78 ? '1.5 3' : undefined} />)}
      {rot(petals).map((a) => <path key={a} transform={`rotate(${a})`} d="M0 -46 C 9 -62 9 -76 0 -90 C -9 -76 -9 -62 0 -46 Z" />)}
      {rot(petals).map((a) => <path key={`i${a}`} transform={`rotate(${a + 180 / petals})`} d="M0 -22 C 5 -30 5 -38 0 -46 C -5 -38 -5 -30 0 -22 Z" />)}
      {rot(petals / 2).map((a) => <circle key={`d${a}`} transform={`rotate(${a})`} cx="0" cy="-87" r="1.6" fill="currentColor" stroke="none" />)}
    </svg>
  )
}
export default function DevotionalBackdrop() {
  return (
    <div className="vt-dvbg" aria-hidden>
      <div className="vt-dvbg-halo" />
      <div className="vt-dvbg-m vt-dvbg-m1"><Mandala petals={16} /></div>
      <div className="vt-dvbg-m vt-dvbg-m2"><Mandala petals={12} /></div>
      {SPARKS.map((s, i) => (
        <span key={i} className="vt-dvbg-spark" style={{ left: s.left, width: s.size, height: s.size, animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }} />
      ))}
    </div>
  )
}

