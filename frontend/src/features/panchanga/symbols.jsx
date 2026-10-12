// Small hand-drawn temple symbols for Panchanga days, chosen from the event name. Maroon / gold / ivory only,
// so they sit inside the logo palette. Each symbol is a 48x48 SVG; `size` scales it. Decorative (aria-hidden):
// the event name is always available as text.
const GOLD = '#C79A3D'
const GOLD_LIGHT = '#F4E1A6'
const MAROON = '#7A1F1F'
const MAROON_DEEP = '#2B0909'

function Svg({ size = 28, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden focusable="false" style={{ display: 'block' }}>
      {children}
    </svg>
  )
}

function NewMoon({ size }) {
  return (
    <Svg size={size}>
      <circle cx="24" cy="24" r="15" fill={MAROON_DEEP} stroke={GOLD} strokeWidth="2" />
      <circle cx="24" cy="24" r="19.5" fill="none" stroke={GOLD_LIGHT} strokeWidth="1" strokeDasharray="2 4" opacity=".8" />
      <circle cx="36" cy="10" r="1.6" fill={GOLD_LIGHT} />
      <circle cx="9" cy="14" r="1.2" fill={GOLD_LIGHT} />
      <circle cx="39" cy="34" r="1.2" fill={GOLD_LIGHT} />
    </Svg>
  )
}

function FullMoon({ size }) {
  return (
    <Svg size={size}>
      <circle cx="24" cy="24" r="19" fill="none" stroke={GOLD_LIGHT} strokeWidth="1.5" opacity=".7" />
      <circle cx="24" cy="24" r="15" fill={GOLD_LIGHT} stroke={GOLD} strokeWidth="2" />
      <circle cx="19" cy="20" r="3" fill={GOLD} opacity=".35" />
      <circle cx="29" cy="28" r="4" fill={GOLD} opacity=".3" />
      <circle cx="27" cy="17" r="1.8" fill={GOLD} opacity=".3" />
    </Svg>
  )
}

function Lotus({ size }) {
  const petal = (angle, h = 17, fill = GOLD_LIGHT) => (
    <ellipse key={angle} cx="24" cy={34 - h / 2} rx="5.2" ry={h / 2} fill={fill} stroke={MAROON} strokeWidth="1.3" transform={`rotate(${angle} 24 34)`} />
  )
  return (
    <Svg size={size}>
      {petal(-62, 14)}
      {petal(62, 14)}
      {petal(-32, 17)}
      {petal(32, 17)}
      {petal(0, 19, '#fff')}
      <path d="M8 38 Q24 44 40 38" fill="none" stroke={GOLD} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  )
}

function Chakra({ size }) {
  const spokes = Array.from({ length: 8 }, (_, i) => i * 45)
  return (
    <Svg size={size}>
      <circle cx="24" cy="24" r="18" fill="none" stroke={MAROON} strokeWidth="3" />
      <circle cx="24" cy="24" r="14" fill="none" stroke={GOLD} strokeWidth="1.5" />
      {spokes.map((a) => (
        <line key={a} x1="24" y1="24" x2="24" y2="8" stroke={MAROON} strokeWidth="2" strokeLinecap="round" transform={`rotate(${a} 24 24)`} />
      ))}
      {spokes.map((a) => (
        <circle key={`d${a}`} cx="24" cy="5.5" r="1.7" fill={GOLD} transform={`rotate(${a + 22.5} 24 24)`} />
      ))}
      <circle cx="24" cy="24" r="4.2" fill={GOLD} stroke={MAROON} strokeWidth="1.5" />
    </Svg>
  )
}

function Diya({ size }) {
  return (
    <Svg size={size}>
      <path d="M24 5 C30 13 31 18 24 23 C17 18 18 13 24 5 Z" fill="#F5B040" stroke={MAROON} strokeWidth="1.3" />
      <path d="M24 12 C27 16 27 19 24 21 C21 19 21 16 24 12 Z" fill="#FFF3C4" />
      <path d="M7 27 H41 C41 36 34 41 24 41 C14 41 7 36 7 27 Z" fill={GOLD} stroke={MAROON} strokeWidth="1.5" />
      <path d="M12 31 H36" stroke={GOLD_LIGHT} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M17 41 H31" stroke={MAROON} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  )
}

function Star({ size }) {
  const rays = Array.from({ length: 8 }, (_, i) => i * 45)
  return (
    <Svg size={size}>
      {rays.map((a) => (
        <path key={a} d="M24 4 L27 18 L24 22 L21 18 Z" fill={a % 90 === 0 ? GOLD : GOLD_LIGHT} stroke={MAROON} strokeWidth="1" transform={`rotate(${a} 24 24)`} />
      ))}
      <circle cx="24" cy="24" r="6" fill={MAROON} stroke={GOLD} strokeWidth="2" />
    </Svg>
  )
}

function Kalasha({ size }) {
  return (
    <Svg size={size}>
      <path d="M17 12 C9 11 8 5 14 4 C18 4 21 8 24 12 C27 8 30 4 34 4 C40 5 39 11 31 12" fill={MAROON} opacity=".85" />
      <ellipse cx="24" cy="12.5" rx="9" ry="3.2" fill={GOLD} stroke={MAROON} strokeWidth="1.3" />
      <circle cx="24" cy="8" r="5" fill={GOLD_LIGHT} stroke={MAROON} strokeWidth="1.3" />
      <path d="M15 15 H33 C40 22 38 38 32 42 H16 C10 38 8 22 15 15 Z" fill={GOLD} stroke={MAROON} strokeWidth="1.6" />
      <path d="M12 24 H36" stroke={MAROON} strokeWidth="1.6" />
      <path d="M12.5 31 H35.5" stroke={MAROON} strokeWidth="1.6" />
      <circle cx="24" cy="27.5" r="2" fill={MAROON} />
    </Svg>
  )
}

const RULES = [
  { key: 'newmoon', label: 'New moon', test: /amavasya|amavasye|amavase|amavas|new moon/i, Icon: NewMoon },
  { key: 'fullmoon', label: 'Full moon', test: /poornima|purnima|pournami|pournima|hunnime|full moon/i, Icon: FullMoon },
  { key: 'ekadashi', label: 'Ekadashi', test: /ekadashi|ekadasi|ekadashi/i, Icon: Lotus },
  { key: 'ratha', label: 'Rathothsava / festival procession', test: /ratha|rathothsava|rathotsava|rathotsav|rath\b|jatra|brahmotsava|brahmothsava|utsava|uthsava|teppotsava|teppothsava/i, Icon: Chakra },
  { key: 'deepa', label: 'Aradhane / lamp festival', test: /aradhana|aradhane|vardhanti|punya|deepavali|diwali|deepotsava|dipotsava|karthika|kartika|deepam/i, Icon: Diya },
  { key: 'jayanti', label: 'Jayanti', test: /jayanti|jayanthi|janmashtami|janmastami|janma/i, Icon: Star },
]
const FALLBACK = { key: 'special', label: 'Other special day', Icon: Kalasha }

/** { key, label, Icon } for an event name. */
export function symbolFor(name) {
  return RULES.find((r) => r.test.test(name || '')) || FALLBACK
}

export function PanchangaSymbol({ name, size = 28 }) {
  const { Icon } = symbolFor(name)
  return <Icon size={size} />
}
