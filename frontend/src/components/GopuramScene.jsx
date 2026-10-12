// Original animated temple scene, drawn from scratch as inline SVG (no image file).
// A seven-tier Dravidian gopuram at dusk: carved niches with deity figures that light up in a wave,
// barrel-vault crown with seven kalashas, studded doors that swing open on a glowing sanctum,
// marigold garlands, swinging bells, deepa-stambha lamp towers, a turning rangoli, and the whole
// temple mirrored in a tank with floating diyas, ripples and lotuses. CSS only (transform/opacity),
// all motion is switched off for prefers-reduced-motion.

const TIERS = [
  // bottom-up: top y, bottom y, half width at top, half width at bottom, niche pitch
  { yt: 560, yb: 700, hwT: 232, hwB: 240, pitch: 46, base: true },
  { yt: 496, yb: 560, hwT: 205, hwB: 220, pitch: 42 },
  { yt: 438, yb: 496, hwT: 185, hwB: 200, pitch: 38 },
  { yt: 386, yb: 438, hwT: 165, hwB: 180, pitch: 34 },
  { yt: 340, yb: 386, hwT: 146, hwB: 160, pitch: 30 },
  { yt: 298, yb: 340, hwT: 128, hwB: 141, pitch: 27 },
  { yt: 260, yb: 298, hwT: 110, hwB: 122, pitch: 24 },
  { yt: 226, yb: 260, hwT: 92, hwB: 103, pitch: 21 },
]
const DOOR = { x1: 244, x2: 396 }
const WATER_Y = 776
const MIRROR = WATER_Y * 2

const RAYS = Array.from({ length: 24 }, (_, i) => i)
const STARS = [[80, 90], [140, 160], [60, 220], [570, 100], [510, 170], [580, 230], [200, 60], [440, 60], [110, 300], [540, 300], [330, 40], [260, 120], [30, 150], [610, 160]]
const PETALS = [
  { x: 70, d: 11, dl: 0, c: '#E07B16', s: 1 }, { x: 150, d: 14, dl: 3, c: '#F4B942', s: 0.8 },
  { x: 240, d: 12, dl: 6, c: '#E07B16', s: 1.1 }, { x: 410, d: 13, dl: 1.5, c: '#F4B942', s: 0.9 },
  { x: 500, d: 15, dl: 4.5, c: '#E07B16', s: 1 }, { x: 575, d: 12, dl: 8, c: '#F4B942', s: 0.8 },
]
const EMBERS = [
  { x: 40, d: 0, t: 6 }, { x: 52, d: 2.2, t: 5.5 }, { x: 588, d: 1, t: 6 }, { x: 600, d: 3.1, t: 5.5 },
  { x: 312, d: 0.6, t: 5 }, { x: 328, d: 2.8, t: 5.6 },
]

const f = (n) => Math.round(n * 100) / 100

function Flame({ x = 0, y = 0, s = 1, delay = 0 }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <g className="vt-gp-flame" style={{ animationDelay: `${delay}s` }}>
        <path d="M 0,0 Q -4.5,-9 0,-19 Q 4.5,-9 0,0 Z" fill="#E07B16" />
        <path d="M 0,-1 Q -2,-8 0,-13 Q 2,-8 0,-1 Z" fill="#FFE9A8" />
      </g>
    </g>
  )
}

// a small standing deity: halo arch, crown, head, body
function Figure({ s = 1, glow }) {
  return (
    <g transform={`scale(${s})`}>
      <path d="M -7,0 L -7,-14 Q 0,-26 7,-14 L 7,0" fill="none" stroke="#F4C95A" strokeWidth="1" opacity="0.8" />
      <path d="M -5,0 L -4,-11 Q 0,-14 4,-11 L 5,0 Z" fill={glow ? '#FFE08A' : '#E9B949'} />
      <circle cx="0" cy="-16.5" r="3.1" fill={glow ? '#FFE9A8' : '#F0C45A'} />
      <path d="M -2.6,-18.5 L 0,-24 L 2.6,-18.5 Z" fill="#D4A437" />
    </g>
  )
}

function Kalasha({ x, y, s = 1 }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <path d="M -7,0 Q -9,-10 0,-12 Q 9,-10 7,0 Z" fill="#E9B949" stroke="#5A1414" strokeWidth="0.8" />
      <rect x="-4" y="-14" width="8" height="2.4" rx="1" fill="#D4A437" />
      <path d="M -3,-14 L 3,-14 L 0,-23 Z" fill="#F4C95A" stroke="#5A1414" strokeWidth="0.7" />
      <circle cx="0" cy="-24.5" r="1.7" fill="#FFF3C4" />
    </g>
  )
}

function Tower() {
  const bottomUp = TIERS.length
  return (
    <g>
      {/* tiers, each rising in turn on load */}
      {TIERS.map((t, ti) => {
        const wall = ti % 2 === 0 ? 'url(#gpWallA)' : 'url(#gpWallB)'
        const pts = `${320 - t.hwB},${t.yb} ${320 - t.hwT},${t.yt} ${320 + t.hwT},${t.yt} ${320 + t.hwB},${t.yb}`
        const n = Math.floor((2 * (t.hwT - 12)) / t.pitch)
        const w = t.pitch * 0.52
        const h = t.yb - t.yt - 26
        const top = t.yt + 10
        const s = Math.min(1.5, w / 18)
        let kudu = ''
        const kn = Math.floor((2 * (t.hwB - 8)) / 12)
        for (let k = 0; k < kn; k++) {
          const kx = 320 - (kn - 1) * 6 + k * 12
          kudu += `M ${f(kx - 4)},${t.yb - 7} a 4,4 0 0 1 8,0 Z `
        }
        let pil = ''
        const niches = []
        for (let i = 0; i < n; i++) {
          const cx = 320 + (i - (n - 1) / 2) * t.pitch
          if (t.base && cx > DOOR.x1 - w / 2 && cx < DOOR.x2 + w / 2) continue
          niches.push(cx)
          if (i < n - 1) pil += `M ${f(cx + t.pitch / 2)},${top} L ${f(cx + t.pitch / 2)},${t.yb - 10} `
        }
        const fromBottom = ti
        return (
          <g key={ti} className="vt-gp-tier" style={{ animationDelay: `${0.15 + (bottomUp - 1 - ti) * 0.1}s` }}>
            <polygon points={pts} fill={wall} stroke="#5A1414" strokeWidth="2" />
            <path d={pil} stroke="#D4A437" strokeWidth="0.9" opacity="0.55" fill="none" />
            {niches.map((cx, i) => {
              const bx = cx - w / 2
              const by = top + h
              const d = `M ${f(bx)},${f(by)} L ${f(bx)},${f(top + w / 2)} Q ${f(bx)},${top} ${f(cx)},${top} Q ${f(bx + w)},${top} ${f(bx + w)},${f(top + w / 2)} L ${f(bx + w)},${f(by)} Z`
              return (
                <g key={i}>
                  <path d={d} fill="#2B0909" stroke="#D4A437" strokeWidth="0.9" />
                  <path className="vt-gp-lit" d={d} fill="#FF9F2E" style={{ animationDelay: `${fromBottom * 0.45 + i * 0.1}s` }} />
                  <g transform={`translate(${f(cx)},${f(by)})`}>
                    <Figure s={s * 0.78} />
                  </g>
                </g>
              )
            })}
            {/* cornice with a row of small gold kudu arches */}
            <rect x={320 - t.hwB - 5} y={t.yb - 7} width={2 * t.hwB + 10} height="7" fill="#D4A437" stroke="#5A1414" strokeWidth="1" />
            <path d={kudu} fill="#F4C95A" stroke="#5A1414" strokeWidth="0.5" />
          </g>
        )
      })}

      {/* barrel-vault crown with a gold medallion and ribs */}
      <g className="vt-gp-tier" style={{ animationDelay: '0.05s' }}>
        <path d="M 226,226 L 226,214 Q 320,166 414,214 L 414,226 Z" fill="url(#gpWallB)" stroke="#5A1414" strokeWidth="2" />
        <path d="M 252,226 Q 252,200 320,178 M 288,226 Q 292,196 320,176 M 352,226 Q 348,196 320,176 M 388,226 Q 388,200 320,178" stroke="#D4A437" strokeWidth="1" fill="none" opacity="0.7" />
        <circle cx="320" cy="205" r="10" fill="#E9B949" stroke="#5A1414" strokeWidth="1.2" />
        <circle cx="320" cy="205" r="5.5" fill="#E07B16" stroke="#5A1414" strokeWidth="0.8" />
        <circle cx="320" cy="205" r="2" fill="#FFF3C4" />
        <rect x="222" y="224" width="196" height="6" fill="#D4A437" stroke="#5A1414" strokeWidth="1" />
        {[-3, -2, -1, 1, 2, 3].map((k) => {
          const x = 320 + k * 30
          const t = (x - 226) / 188
          return <Kalasha key={k} x={x} y={214 - 92 * t * (1 - t) + 2} s={0.95} />
        })}
      </g>
      <g className="vt-gp-crown">
        {Array.from({ length: 8 }, (_, i) => (
          <path key={i} d="M 320,150 L 316,118 L 324,118 Z" fill="#F4E1A6" opacity="0.85" transform={`rotate(${i * 45} 320 150)`} />
        ))}
      </g>
      <circle className="vt-gp-halo" cx="320" cy="150" r="40" fill="url(#gpFlameGlow)" />
      <Kalasha x={320} y={177} s={1.9} />

      {/* pennants on poles at the crown's ends */}
      {[[232, 1], [408, -1]].map(([x, dir]) => (
        <g key={x}>
          <rect x={x - 1.5} y="176" width="3" height="48" fill="#5A1414" />
          <circle cx={x} cy="176" r="3.2" fill="#F4E1A6" />
          <path className="vt-gp-flag" style={{ transformOrigin: `${x}px 182px`, transformBox: 'view-box' }} d={`M ${x},180 L ${x + dir * 22},187 L ${x},194 Z`} fill="#E07B16" />
        </g>
      ))}

      {/* doorway: carved frame, sanctum glow, a deity, and doors that swing open */}
      <g>
        <path d="M 250,700 L 250,640 Q 250,586 320,580 Q 390,586 390,640 L 390,700 Z" fill="#E9B949" stroke="#5A1414" strokeWidth="2" />
        <path d="M 262,700 L 262,640 Q 262,598 320,592 Q 378,598 378,640 L 378,700 Z" fill="url(#gpSanctum)" />
        <g clipPath="url(#gpDoorClip)">
          <circle className="vt-gp-halo" cx="320" cy="660" r="46" fill="url(#gpFlameGlow)" />
          <g transform="translate(320,694)">
            <Figure s={3.3} glow />
          </g>
          <Flame x={296} y={694} s={1.1} delay={0.3} />
          <Flame x={344} y={694} s={1.1} delay={0.9} />
          <g className="vt-gp-leaf vt-gp-leaf-l" style={{ transformOrigin: '262px 0' }}>
            <rect x="262" y="590" width="58" height="112" fill="url(#gpDoor)" stroke="#5A1414" strokeWidth="1.5" />
            {[610, 640, 670].flatMap((y) => [276, 300].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="2.6" fill="#F4C95A" />))}
          </g>
          <g className="vt-gp-leaf vt-gp-leaf-r" style={{ transformOrigin: '378px 0' }}>
            <rect x="320" y="590" width="58" height="112" fill="url(#gpDoor)" stroke="#5A1414" strokeWidth="1.5" />
            {[610, 640, 670].flatMap((y) => [340, 364].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="2.6" fill="#F4C95A" />))}
          </g>
        </g>
        <path d="M 250,640 Q 250,586 320,580 Q 390,586 390,640" fill="none" stroke="#F4E1A6" strokeWidth="1.4" opacity="0.8" />
        {/* makara torana: gold arch, gold medallion and a string of lamps */}
        <path d="M 236,646 Q 236,568 320,560 Q 404,568 404,646" fill="none" stroke="#D4A437" strokeWidth="5" strokeLinecap="round" />
        <circle cx="320" cy="560" r="12" fill="#F4C95A" stroke="#5A1414" strokeWidth="1.5" />
        <circle cx="320" cy="560" r="6.5" fill="#E07B16" stroke="#5A1414" strokeWidth="1" />
        <circle cx="320" cy="560" r="2.4" fill="#FFF3C4" />
        {[-70, -48, -26, 26, 48, 70].map((dx, i) => {
          const x = 320 + dx
          const y = 560 + (1 - Math.cos((dx / 84) * 1.1)) * 70
          return <circle key={i} className="vt-gp-bulb" cx={x} cy={y} r="3" fill="#FFD27A" style={{ animationDelay: `${i * 0.3}s` }} />
        })}
      </g>

      {/* garlands of marigold swaying across the base */}
      {[['M 98,566 Q 170,596 242,566', 0], ['M 398,566 Q 470,596 542,566', 0.7], ['M 100,504 Q 200,532 300,504', 1.4], ['M 340,504 Q 440,532 540,504', 2.1]].map(([d, dl], i) => (
        <g key={i} className="vt-gp-garland" style={{ animationDelay: `${dl}s` }}>
          <path d={d} fill="none" stroke="#E07B16" strokeWidth="6" strokeDasharray="6 2.5" strokeLinecap="round" />
          <path d={d} fill="none" stroke="#FFD27A" strokeWidth="2" strokeDasharray="2 6.5" strokeLinecap="round" />
        </g>
      ))}

      {/* bells swinging from the tier corners */}
      {TIERS.slice(1, 7).flatMap((t, i) =>
        [-1, 1].map((dir) => {
          const x = 320 + dir * t.hwB
          const y = t.yb
          return (
            <g key={`${i}${dir}`} className="vt-gp-bell" style={{ animationDelay: `${(i * 0.45 + (dir > 0 ? 0.9 : 0)) % 3.6}s`, transformOrigin: `${x}px ${y}px` }}>
              <line x1={x} y1={y} x2={x} y2={y + 8} stroke="#D4A437" strokeWidth="1.2" />
              <path d={`M ${x - 4.5},${y + 17} Q ${x - 4.5},${y + 8} ${x},${y + 8} Q ${x + 4.5},${y + 8} ${x + 4.5},${y + 17} Z`} fill="#F4C95A" stroke="#5A1414" strokeWidth="0.9" />
              <circle cx={x} cy={y + 18.5} r="1.6" fill="#D4A437" />
            </g>
          )
        }),
      )}

      {/* three steps up to the doorway */}
      <path d="M 238,700 L 402,700 L 410,709 L 230,709 Z" fill="#D4A437" stroke="#5A1414" strokeWidth="1.2" />
      <path d="M 230,709 L 410,709 L 418,718 L 222,718 Z" fill="#C79A3D" stroke="#5A1414" strokeWidth="1.2" />
      <path d="M 222,718 L 418,718 L 426,727 L 214,727 Z" fill="#B58630" stroke="#5A1414" strokeWidth="1.2" />
    </g>
  )
}

function Stambha({ x }) {
  return (
    <g>
      <circle className="vt-gp-halo" cx={x} cy="690" r="46" fill="url(#gpFlameGlow)" />
      <rect x={x - 2.5} y="650" width="5" height="112" fill="#D4A437" stroke="#5A1414" strokeWidth="1" />
      <rect x={x - 11} y="754" width="22" height="10" rx="2" fill="#B58630" stroke="#5A1414" strokeWidth="1" />
      {[[664, 20], [688, 15], [712, 10]].map(([y, hw], r) => (
        <g key={y}>
          <rect x={x - hw} y={y} width={hw * 2} height="3" rx="1.5" fill="#D4A437" stroke="#5A1414" strokeWidth="0.8" />
          {[-hw, 0, hw].map((dx, i) => (
            <g key={dx}>
              <rect x={x + dx - 3.5} y={y - 3} width="7" height="3" rx="1" fill="#C79A3D" />
              <Flame x={x + dx} y={y - 3} s={0.55} delay={r * 0.35 + i * 0.22} />
            </g>
          ))}
        </g>
      ))}
      <circle cx={x} cy="646" r="4" fill="#F4E1A6" />
    </g>
  )
}

function Lotus({ x, y, s = 1, delay = 0 }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <g className="vt-gp-lotus" style={{ animationDelay: `${delay}s` }}>
        {[-62, -31, 0, 31, 62].map((a) => (
          <path key={a} d="M 0,0 Q -8,-12 0,-26 Q 8,-12 0,0 Z" fill={a % 2 ? '#F4C95A' : '#F5B56F'} stroke="#7A1F1F" strokeWidth="0.8" transform={`rotate(${a})`} />
        ))}
        <circle cx="0" cy="-3" r="3" fill="#E07B16" />
      </g>
      <ellipse cx="0" cy="3" rx="22" ry="5" fill="#5A1414" opacity="0.5" />
    </g>
  )
}

function FloatingDiya({ x, y, delay, dur }) {
  return (
    <g className="vt-gp-drift" style={{ animationDelay: `${delay}s`, animationDuration: `${dur}s` }}>
      <g transform={`translate(${x},${y})`}>
        <ellipse cx="0" cy="3" rx="16" ry="4" fill="#FFB84D" opacity="0.25" />
        <circle className="vt-gp-halo" cx="0" cy="-6" r="16" fill="url(#gpFlameGlow)" />
        <path d="M -9,-2 Q -9,5 0,6 Q 9,5 9,-2 Z" fill="#D4A437" stroke="#5A1414" strokeWidth="1" />
        <Flame x={0} y={-2} s={0.7} delay={delay} />
      </g>
    </g>
  )
}

export default function GopuramScene() {
  return (
    <svg
      className="vt-gp"
      viewBox="0 0 640 860"
      role="img"
      aria-label="Illustration of a South Indian temple gateway at dusk with carved deities, lit lamps, swaying garlands and its reflection in the temple tank"
    >
      <defs>
        <radialGradient id="gpSkyGlow" cx="50%" cy="34%" r="62%">
          <stop offset="0%" stopColor="#F4E1A6" stopOpacity="0.95" />
          <stop offset="42%" stopColor="#E07B16" stopOpacity="0.38" />
          <stop offset="100%" stopColor="#5A1414" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gpSkyBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3A0D0D" />
          <stop offset="48%" stopColor="#7A1F1F" />
          <stop offset="82%" stopColor="#B4531C" />
          <stop offset="100%" stopColor="#5A1414" />
        </linearGradient>
        <linearGradient id="gpWallA" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8E2626" />
          <stop offset="100%" stopColor="#651717" />
        </linearGradient>
        <linearGradient id="gpWallB" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#EE9532" />
          <stop offset="100%" stopColor="#CB6A18" />
        </linearGradient>
        <linearGradient id="gpDoor" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8E2626" />
          <stop offset="100%" stopColor="#5A1414" />
        </linearGradient>
        <radialGradient id="gpSanctum" cx="50%" cy="70%" r="70%">
          <stop offset="0%" stopColor="#FFC25C" />
          <stop offset="55%" stopColor="#B4531C" />
          <stop offset="100%" stopColor="#3A0D0D" />
        </radialGradient>
        <radialGradient id="gpFlameGlow">
          <stop offset="0%" stopColor="#FFD27A" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#E07B16" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gpGround" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6A1717" />
          <stop offset="100%" stopColor="#3A0D0D" />
        </linearGradient>
        <linearGradient id="gpWater" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4A1010" />
          <stop offset="100%" stopColor="#1E0505" />
        </linearGradient>
        <linearGradient id="gpFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="gpFadeMask">
          <rect x="0" y={WATER_Y} width="640" height={860 - WATER_Y} fill="url(#gpFade)" />
        </mask>
        <clipPath id="gpDoorClip">
          <path d="M 262,700 L 262,640 Q 262,598 320,592 Q 378,598 378,640 L 378,700 Z" />
        </clipPath>
        <g id="gp-tower">
          <Tower />
        </g>
      </defs>

      <rect width="640" height="860" fill="url(#gpSkyBg)" />
      <circle className="vt-gp-halo-big" cx="320" cy="300" r="360" fill="url(#gpSkyGlow)" />

      {/* sun mandala: slow lotus ring behind the tower */}
      <g className="vt-gp-mandala">
        {Array.from({ length: 16 }, (_, i) => (
          <ellipse key={i} cx="320" cy="170" rx="9" ry="30" fill="none" stroke="#F4E1A6" strokeWidth="1.2" opacity="0.35" transform={`rotate(${i * 22.5} 320 300)`} />
        ))}
        <circle cx="320" cy="300" r="140" fill="none" stroke="#F4E1A6" strokeWidth="1" opacity="0.25" strokeDasharray="2 6" />
      </g>

      <g className="vt-gp-fan">
        {RAYS.map((i) => (
          <path key={i} className={i % 2 ? 'vt-gp-ray vt-gp-ray-b' : 'vt-gp-ray vt-gp-ray-a'} d="M 510,310 L 660,300 L 510,290 Z" fill="#F4E1A6" transform={`rotate(${i * 15} 320 300)`} />
        ))}
      </g>

      <g fill="#F4E1A6">
        {STARS.map(([x, y], i) => (
          <circle key={i} className="vt-gp-star" cx={x} cy={y} r={i % 3 ? 1.5 : 2} style={{ animationDelay: `${(i * 0.7) % 4}s` }} />
        ))}
      </g>

      {/* temple pigeons drifting across */}
      <g className="vt-gp-birds" fill="none" stroke="#F4E1A6" strokeWidth="1.6" strokeLinecap="round" opacity="0.75">
        {[[0, 0, 0], [26, 10, 0.4], [-24, 14, 0.8]].map(([dx, dy, dl], i) => (
          <g key={i} transform={`translate(${dx},${dy})`}>
            <path className="vt-gp-bird" style={{ animationDelay: `-${dl}s` }} d="M 0,0 q 5,-5 10,0 q 5,-5 10,0" />
          </g>
        ))}
      </g>

      {/* far temple wall silhouette either side */}
      <g fill="#3A0D0D" opacity="0.85">
        <rect x="0" y="650" width="92" height="80" /><rect x="548" y="650" width="92" height="80" />
        {[10, 34, 58, 82, 558, 582, 606, 630].map((x) => (
          <path key={x} d={`M ${x - 7},650 Q ${x - 7},636 ${x},632 Q ${x + 7},636 ${x + 7},650 Z`} />
        ))}
      </g>

      <Tower />

      {/* platform */}
      <rect x="0" y="727" width={640} height={WATER_Y - 727} fill="url(#gpGround)" />
      <rect x="0" y="727" width="640" height="3" fill="#D4A437" opacity="0.8" />
      <g transform="translate(320,752) scale(1.5,0.36)">
        <g className="vt-gp-kolam">
          {Array.from({ length: 12 }, (_, i) => (
            <g key={i} transform={`rotate(${i * 30})`}>
              <ellipse className="vt-gp-petal" cx="0" cy="-34" rx="9" ry="16" fill="#D4A437" style={{ animationDelay: `${i * 0.25}s` }} />
            </g>
          ))}
          {Array.from({ length: 24 }, (_, i) => (
            <circle key={i} cx={f(60 * Math.sin((i * 15 * Math.PI) / 180))} cy={f(-60 * Math.cos((i * 15 * Math.PI) / 180))} r="2.4" fill="#F4E1A6" opacity="0.9" />
          ))}
          <circle cx="0" cy="0" r="48" fill="none" stroke="#D4A437" strokeWidth="1.5" opacity="0.8" />
        </g>
        <circle className="vt-gp-jewel" cx="0" cy="0" r="10" fill="#E07B16" />
        <circle cx="0" cy="0" r="4" fill="#F4E1A6" />
      </g>

      <Stambha x={40} />
      <Stambha x={600} />

      {/* the tank: mirrored temple, shimmer, ripples, lotuses and floating diyas */}
      <rect x="0" y={WATER_Y} width="640" height={860 - WATER_Y} fill="url(#gpWater)" />
      <g mask="url(#gpFadeMask)">
        <g className="vt-gp-mirror">
          <g transform={`translate(0,${MIRROR}) scale(1,-1)`}>
            <use href="#gp-tower" />
          </g>
        </g>
      </g>
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} className="vt-gp-glint" x={60 + i * 140} y={WATER_Y + 12 + (i % 2) * 22} width="70" height="1.6" rx="0.8" fill="#F4E1A6" style={{ animationDelay: `${i * 1.1}s` }} />
      ))}
      {[[180, 820, 0], [470, 812, 1.8]].map(([x, y, dl], i) => (
        <ellipse key={i} className="vt-gp-ripple" cx={x} cy={y} rx="28" ry="6" fill="none" stroke="#F4E1A6" strokeWidth="1.2" style={{ animationDelay: `${dl}s` }} />
      ))}
      <Lotus x={64} y={832} s={1} />
      <Lotus x={580} y={826} s={0.9} delay={1.2} />
      <FloatingDiya x={230} y={822} delay={0} dur={14} />
      <FloatingDiya x={400} y={834} delay={-5} dur={17} />
      <FloatingDiya x={320} y={810} delay={-9} dur={19} />

      {EMBERS.map((e, i) => (
        <circle key={i} className="vt-gp-ember" cx={e.x} cy="650" r="2" fill="#FFD27A" style={{ animationDelay: `${e.d}s`, animationDuration: `${e.t}s` }} />
      ))}
      {PETALS.map((p, i) => (
        <g key={i} className="vt-gp-fall" style={{ '--x': `${p.x}px`, animationDuration: `${p.d}s`, animationDelay: `${p.dl}s` }}>
          <ellipse cx="0" cy="0" rx={5 * p.s} ry={2.6 * p.s} fill={p.c} opacity="0.9" />
        </g>
      ))}
    </svg>
  )
}

export const GOPURAM_SCENE_CSS = `
  .vt-gp { display: block; width: 100%; height: 100%; overflow: hidden; border-radius: var(--mantine-radius-lg) var(--mantine-radius-lg) 0 0;
    filter: drop-shadow(0 0 28px rgba(244,200,100,0.35)) drop-shadow(0 20px 40px rgba(0,0,0,0.45)); }
  .vt-gp * { transform-box: fill-box; }
  .vt-gp-fan, .vt-gp-mandala, .vt-gp-crown, .vt-gp-fall { transform-box: view-box; }
  .vt-gp-fan, .vt-gp-mandala { transform-origin: 320px 300px; }
  .vt-gp-fan { animation: vt-gp-turn 140s linear infinite; }
  .vt-gp-mandala { animation: vt-gp-turn 90s linear infinite reverse; }
  .vt-gp-crown { transform-origin: 320px 150px; animation: vt-gp-turn 24s linear infinite; }
  .vt-gp-kolam { transform-origin: center; animation: vt-gp-turn 70s linear infinite reverse; }
  .vt-gp-ray { opacity: 0.22; }
  .vt-gp-ray-a { animation: vt-gp-ray 5s ease-in-out infinite; }
  .vt-gp-ray-b { animation: vt-gp-ray 5s ease-in-out -2.5s infinite; }
  .vt-gp-halo-big, .vt-gp-halo, .vt-gp-jewel, .vt-gp-bird, .vt-gp-petal, .vt-gp-lotus { transform-origin: center; }
  .vt-gp-halo-big { animation: vt-gp-breathe 6s ease-in-out infinite; }
  .vt-gp-halo { animation: vt-gp-breathe 3.4s ease-in-out infinite; }
  .vt-gp-jewel { animation: vt-gp-breathe 2.6s ease-in-out infinite; }
  .vt-gp-star { animation: vt-gp-twinkle 4s ease-in-out infinite; }
  .vt-gp-birds { animation: vt-gp-fly 38s linear infinite; }
  .vt-gp-bird { animation: vt-gp-flap 0.9s ease-in-out infinite; }
  .vt-gp-tier { animation: vt-gp-rise 0.9s cubic-bezier(.2,.7,.2,1) both; }
  .vt-gp-lit { opacity: 0; animation: vt-gp-lit 7s ease-in-out infinite; }
  .vt-gp-bulb { animation: vt-gp-twinkle 2.4s ease-in-out infinite; }
  .vt-gp-bell { animation: vt-gp-swing 3.6s ease-in-out infinite; transform-box: view-box; }
  .vt-gp-flame { transform-origin: 50% 100%; animation: vt-gp-flicker 1.5s ease-in-out infinite; }
  .vt-gp-flag { animation: vt-gp-wave 2.2s ease-in-out infinite; }
  .vt-gp-leaf { transform-box: view-box; }
  .vt-gp-leaf-l { animation: vt-gp-open-l 12s ease-in-out infinite; }
  .vt-gp-leaf-r { animation: vt-gp-open-r 12s ease-in-out infinite; }
  .vt-gp-garland { transform-origin: 50% 0; animation: vt-gp-sway 4.4s ease-in-out infinite; }
  .vt-gp-petal { animation: vt-gp-bloom 3s ease-in-out infinite; }
  .vt-gp-lotus { transform-origin: 50% 100%; animation: vt-gp-bloom 4.5s ease-in-out infinite; }
  .vt-gp-mirror { transform-origin: 320px 800px; transform-box: view-box; animation: vt-gp-wobble 5s ease-in-out infinite; }
  .vt-gp-glint { opacity: 0; animation: vt-gp-glint 5s ease-in-out infinite; }
  .vt-gp-ripple { transform-origin: center; opacity: 0; animation: vt-gp-ripple 4.5s ease-out infinite; }
  .vt-gp-drift { animation: vt-gp-drift 16s ease-in-out infinite alternate; }
  .vt-gp-ember { opacity: 0; animation: vt-gp-ember 5.5s ease-out infinite; }
  .vt-gp-fall { opacity: 0; animation: vt-gp-fall 12s linear infinite; }
  @keyframes vt-gp-turn { to { transform: rotate(360deg); } }
  @keyframes vt-gp-ray { 0%,100% { opacity: 0.1; } 50% { opacity: 0.34; } }
  @keyframes vt-gp-breathe { 0%,100% { opacity: 0.7; transform: scale(0.96); } 50% { opacity: 1; transform: scale(1.05); } }
  @keyframes vt-gp-twinkle { 0%,100% { opacity: 0.2; } 50% { opacity: 1; } }
  @keyframes vt-gp-fly { 0% { transform: translate(700px, 70px); } 100% { transform: translate(-120px, 40px); } }
  @keyframes vt-gp-flap { 0%,100% { transform: scaleY(1); } 50% { transform: scaleY(-0.5); } }
  @keyframes vt-gp-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
  @keyframes vt-gp-lit { 0%,100% { opacity: 0; } 12% { opacity: 0.8; } 30% { opacity: 0; } }
  @keyframes vt-gp-swing { 0%,100% { transform: rotate(-9deg); } 50% { transform: rotate(9deg); } }
  @keyframes vt-gp-flicker { 0%,100% { transform: scale(1) rotate(-2deg); } 30% { transform: scale(1.08, 1.16) rotate(2deg); } 65% { transform: scale(0.95, 1.02) rotate(-1deg); } }
  @keyframes vt-gp-wave { 0%,100% { transform: skewY(-7deg) scaleX(1); } 50% { transform: skewY(7deg) scaleX(0.88); } }
  @keyframes vt-gp-open-l { 0%,12% { transform: scaleX(1); } 26%,68% { transform: scaleX(0.18); } 82%,100% { transform: scaleX(1); } }
  @keyframes vt-gp-open-r { 0%,12% { transform: scaleX(1); } 26%,68% { transform: scaleX(0.18); } 82%,100% { transform: scaleX(1); } }
  @keyframes vt-gp-sway { 0%,100% { transform: rotate(-1.4deg); } 50% { transform: rotate(1.4deg); } }
  @keyframes vt-gp-bloom { 0%,100% { transform: scale(0.92); opacity: 0.75; } 50% { transform: scale(1.1); opacity: 1; } }
  @keyframes vt-gp-wobble { 0%,100% { transform: skewX(-0.6deg) scaleX(1); } 50% { transform: skewX(0.6deg) scaleX(1.006); } }
  @keyframes vt-gp-glint { 0%,100% { opacity: 0; transform: translateX(-14px); } 50% { opacity: 0.55; transform: translateX(14px); } }
  @keyframes vt-gp-ripple { 0% { opacity: 0.7; transform: scale(0.3); } 100% { opacity: 0; transform: scale(1.6); } }
  @keyframes vt-gp-drift { from { transform: translateX(-34px) translateY(0); } 50% { transform: translateX(0) translateY(2px); } to { transform: translateX(34px) translateY(-1px); } }
  @keyframes vt-gp-ember { 0% { opacity: 0; transform: translate(0, 0); } 15% { opacity: 0.95; } 100% { opacity: 0; transform: translate(10px, -140px); } }
  @keyframes vt-gp-fall {
    0% { opacity: 0; transform: translate(var(--x), -20px) rotate(0deg); }
    8% { opacity: 0.9; }
    50% { transform: translate(calc(var(--x) + 26px), 380px) rotate(200deg); }
    92% { opacity: 0.9; }
    100% { opacity: 0; transform: translate(calc(var(--x) - 10px), 760px) rotate(420deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .vt-gp * { animation: none !important; }
    .vt-gp-lit, .vt-gp-ember, .vt-gp-fall, .vt-gp-ripple, .vt-gp-glint { opacity: 0 !important; }
    .vt-gp-leaf-l, .vt-gp-leaf-r { transform: scaleX(0.3) !important; }
  }
`
