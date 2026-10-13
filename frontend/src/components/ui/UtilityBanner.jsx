import { Group, Text, Title } from '@mantine/core'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const KOLAM_PATTERN = '/illustrations/kolam.svg'

/**
 * Panchanga-style page head for the Utilities screens: gopuram mark + title, then the maroon/gold banner with a big
 * heading, up to two live facts and an optional emblem. `actions` sit top-right (like Panchanga's month switcher).
 */
export default function UtilityBanner({ title, subtitle, heading, sub, facts = [], emblem, actions }) {
  return (
    <>
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
          <div>
            <Title order={2}>{title}</Title>
            {subtitle && (
              <Text size="sm" c="dimmed">
                {subtitle}
              </Text>
            )}
          </div>
        </Group>
        {actions && <Group gap="xs">{actions}</Group>}
      </Group>

      <div className="vt-ub">
        <div>
          <div className="vt-ub-heading">{heading || title}</div>
          {sub && <div className="vt-ub-sub">{sub}</div>}
        </div>
        <div className="vt-ub-facts">
          {facts.map((f, i) => (
            <div key={f.label} className="vt-ub-fact">
              {i > 0 && <div className="vt-ub-sep" aria-hidden />}
              <div style={{ minWidth: 0 }}>
                <div className={f.text ? 'vt-ub-next' : 'vt-ub-n vt-num'}>{f.value}</div>
                <div className="vt-ub-l">{f.label}</div>
              </div>
            </div>
          ))}
        </div>
        {emblem && (
          <div className="vt-ub-emblem" aria-hidden>
            {emblem}
          </div>
        )}
      </div>
      <style>{CSS}</style>
    </>
  )
}

const CSS = `
.vt-ub { position: relative; overflow: hidden; display: flex; align-items: center; gap: 28px; padding: 20px 28px; border-radius: var(--mantine-radius-lg);
  background: linear-gradient(120deg, var(--vt-g1) 0%, var(--vt-g2d) 70%, var(--vt-g3) 100%); border: 1px solid rgba(244,225,166,.3); color: #FBF6EC; }
.vt-ub::before { content: ''; position: absolute; inset: 0; background: url(${KOLAM_PATTERN}) center/150px 150px; opacity: .07; pointer-events: none; }
.vt-ub > * { position: relative; }
.vt-ub-heading { font-family: Marcellus, Georgia, serif; font-size: clamp(26px, 3.4vw, 38px); line-height: 1.05; color: #F4E1A6; }
.vt-ub-sub { margin-top: 4px; letter-spacing: .22em; font-size: 12px; text-transform: uppercase; color: #E9D2B8; }
.vt-ub-facts { display: flex; align-items: center; gap: 20px; flex: 1; min-width: 0; }
.vt-ub-fact { display: flex; align-items: center; gap: 20px; min-width: 0; }
.vt-ub-sep { width: 1px; align-self: stretch; min-height: 38px; background: rgba(244,225,166,.3); }
.vt-ub-n { font-family: Marcellus, Georgia, serif; font-size: 32px; line-height: 1; color: #F4E1A6; }
.vt-ub-l { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #E9D2B8; margin-top: 3px; }
.vt-ub-next { font-family: Marcellus, Georgia, serif; font-size: 20px; color: #FBF6EC; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vt-ub-emblem { flex: 0 0 auto; filter: drop-shadow(0 0 18px rgba(244,225,166,.45)); }
@media (max-width: 700px) { .vt-ub { flex-wrap: wrap; gap: 14px; padding: 16px; } .vt-ub-emblem { display: none; } .vt-ub-facts { flex-basis: 100%; flex-wrap: wrap; } }
`
