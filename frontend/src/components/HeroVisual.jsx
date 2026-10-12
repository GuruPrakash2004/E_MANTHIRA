import { useRef } from 'react'
import { Gift, Hand, Landmark } from 'lucide-react'

// Dark maroon + gold "glowing temple" hero visual (reference: templemanagementsoftware.com
// hero, vasy.ai floating-card illustration). Layers: breathing gold glow, rotating
// ray ring, the gopuram artwork, drifting sparkles, floating glass chips. The artwork
// parallax-tilts toward the pointer. All motion is off under prefers-reduced-motion.
const GOPURAM_HERO = '/illustrations/gopuram-hero.svg'

const CHIPS = [
  { label: 'Seva Entry', icon: Hand, pos: { top: '14%', left: '2%' }, delay: '0s' },
  { label: 'Donations', icon: Gift, pos: { top: '46%', right: '0%' }, delay: '1.2s' },
  { label: 'Hall Booking', icon: Landmark, pos: { bottom: '12%', left: '6%' }, delay: '2.4s' },
]

const SPARKS = [
  { left: '18%', top: '30%', d: '0s', s: 5 },
  { left: '78%', top: '22%', d: '1.1s', s: 4 },
  { left: '66%', top: '70%', d: '2.0s', s: 6 },
  { left: '30%', top: '78%', d: '0.6s', s: 4 },
  { left: '50%', top: '10%', d: '1.7s', s: 5 },
]

export default function HeroVisual({ style, showChips = true }) {
  const art = useRef(null)

  function onMove(e) {
    const el = art.current
    if (!el) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    el.style.transform = `translate3d(${x * 14}px, ${y * 10}px, 0) rotateY(${x * 5}deg) rotateX(${-y * 4}deg)`
  }
  function onLeave() {
    if (art.current) art.current.style.transform = ''
  }

  return (
    <div className="vt-hero" onMouseMove={onMove} onMouseLeave={onLeave} style={style}>
      <div className="vt-hero-glow" aria-hidden />
      <div className="vt-hero-rays" aria-hidden />
      <div className="vt-hero-art" ref={art}>
        <img
          src={GOPURAM_HERO}
          alt="Illustration of a South Indian temple gopuram glowing at dusk, with diyas and a flagpole"
        />
        <div className="vt-hero-shimmer" aria-hidden />
      </div>
      {SPARKS.map((p, i) => (
        <span
          key={i}
          aria-hidden
          className="vt-hero-spark"
          style={{ left: p.left, top: p.top, width: p.s, height: p.s, animationDelay: p.d }}
        />
      ))}
      {showChips &&
        CHIPS.map((c) => (
          <div key={c.label} className="vt-hero-chip" style={{ ...c.pos, animationDelay: c.delay }} aria-hidden>
            <c.icon size={14} />
            <span>{c.label}</span>
          </div>
        ))}

      <style>{`
        .vt-hero { position: relative; width: 100%; height: 100%; min-height: 0; perspective: 900px; }
        .vt-hero-glow {
          position: absolute; left: 50%; top: 52%; width: 82%; aspect-ratio: 1; transform: translate(-50%, -50%);
          border-radius: 50%;
          background: radial-gradient(circle, rgba(244,200,100,0.55) 0%, rgba(224,123,22,0.28) 34%, rgba(224,123,22,0) 68%);
          filter: blur(18px); animation: vt-hero-breathe 5s ease-in-out infinite;
        }
        .vt-hero-rays {
          position: absolute; left: 50%; top: 52%; width: 96%; aspect-ratio: 1; transform: translate(-50%, -50%);
          border-radius: 50%; opacity: 0.22;
          background: repeating-conic-gradient(from 0deg, rgba(244,225,166,0.9) 0deg 3deg, transparent 3deg 15deg);
          -webkit-mask-image: radial-gradient(circle, transparent 30%, #000 48%, transparent 70%);
                  mask-image: radial-gradient(circle, transparent 30%, #000 48%, transparent 70%);
          animation: vt-hero-spin 90s linear infinite;
        }
        .vt-hero-art {
          position: relative; width: 100%; height: 100%; display: flex; justify-content: center;
          transition: transform 0.25s ease-out; will-change: transform;
        }
        .vt-hero-art img {
          height: 100%; width: auto; max-width: 100%; aspect-ratio: 640 / 860; object-fit: contain; display: block;
          /* Box matches the artwork (viewBox 640x860), so the rounded top corners hit the drawing itself. */
          border-radius: var(--mantine-radius-lg) var(--mantine-radius-lg) 0 0;
          filter: drop-shadow(0 0 28px rgba(244,200,100,0.35)) drop-shadow(0 20px 40px rgba(0,0,0,0.45));
          animation: vt-hero-float 7s ease-in-out infinite;
        }
        .vt-hero-shimmer {
          position: absolute; inset: 0; pointer-events: none; overflow: hidden; mix-blend-mode: soft-light;
          background: linear-gradient(105deg, transparent 40%, rgba(255,240,200,0.55) 50%, transparent 60%);
          background-size: 250% 100%; animation: vt-hero-sweep 6s ease-in-out infinite;
        }
        .vt-hero-spark {
          position: absolute; border-radius: 50%; background: #F4E1A6; box-shadow: 0 0 10px 3px rgba(244,200,100,0.8);
          opacity: 0; animation: vt-hero-twinkle 4s ease-in-out infinite;
        }
        .vt-hero-chip {
          position: absolute; display: flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px;
          font-size: 12px; font-weight: 600; color: #F4E1A6; white-space: nowrap;
          background: rgba(43,9,9,0.55); border: 1px solid rgba(244,225,166,0.35);
          -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.3), 0 0 14px rgba(244,200,100,0.15);
          animation: vt-hero-bob 6s ease-in-out infinite;
        }
        @keyframes vt-hero-breathe { 0%,100% { opacity: 0.75; transform: translate(-50%,-50%) scale(0.96); } 50% { opacity: 1; transform: translate(-50%,-50%) scale(1.05); } }
        @keyframes vt-hero-spin { to { transform: translate(-50%,-50%) rotate(360deg); } }
        @keyframes vt-hero-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes vt-hero-sweep { 0%,55% { background-position: 150% 0; } 100% { background-position: -50% 0; } }
        @keyframes vt-hero-twinkle { 0%,100% { opacity: 0; transform: translateY(0) scale(0.6); } 50% { opacity: 1; transform: translateY(-14px) scale(1); } }
        @keyframes vt-hero-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @media (prefers-reduced-motion: reduce) {
          .vt-hero-glow, .vt-hero-rays, .vt-hero-art img, .vt-hero-shimmer, .vt-hero-spark, .vt-hero-chip { animation: none !important; }
          .vt-hero-spark { opacity: 0.8; }
        }
        @media (max-width: 1100px) { .vt-hero-chip { display: none; } }
      `}</style>
    </div>
  )
}
