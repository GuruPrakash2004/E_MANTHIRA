import { Card, Group, Skeleton, Text } from '@mantine/core'

// KPI tile. `tone="dark"` is the single emphasised tile per row (maroon, gold text).
export default function StatCard({ label, value, icon: Icon, footer, tone = 'light', loading = false }) {
  const dark = tone === 'dark'
  return (
    <Card
      className="vt-lift"
      withBorder={!dark}
      p="lg"
      style={{
        background: dark ? 'linear-gradient(160deg, var(--vt-g2) 0%, var(--vt-g3) 100%)' : 'var(--vt-surface)',
        color: dark ? '#FBF6EC' : undefined,
        border: dark ? '1px solid rgba(244,225,166,0.25)' : undefined,
        minHeight: 138,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
        <Text size="sm" fw={500} c={dark ? '#E9D2B8' : 'dimmed'}>
          {label}
        </Text>
        {Icon && (
          <div
            aria-hidden
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              background: dark ? 'rgba(244,225,166,0.16)' : 'var(--vt-gold-chip)',
              color: dark ? '#F4E1A6' : 'var(--vt-accent)',
            }}
          >
            <Icon size={18} />
          </div>
        )}
      </Group>
      <div>
        {loading ? (
          <Skeleton height={34} width="60%" radius="sm" />
        ) : (
          <Text
            className="vt-num"
            style={{ fontFamily: 'Marcellus, Georgia, serif', fontSize: 'clamp(26px,2.6vw,36px)', fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.1 }}
          >
            {value}
          </Text>
        )}
        {footer && (
          <Text size="xs" mt={6} c={dark ? '#D9B9A3' : 'dimmed'}>
            {footer}
          </Text>
        )}
      </div>
    </Card>
  )
}
