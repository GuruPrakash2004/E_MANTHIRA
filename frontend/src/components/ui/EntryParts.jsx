import { ActionIcon, Button, Card, Divider, Group, Kbd, Skeleton, Stack, Text, Title } from '@mantine/core'
import { Printer } from 'lucide-react'
import EmptyState from './EmptyState'
import amountInWords from '../../utils/amountInWords'

// Building blocks shared by the money-entry screens (Seva, Donation, Hall, Vouchers):
// section cards on the left, a sticky summary / saved panel / recent list on the right.

export function SectionCard({ title, hint, action, children }) {
  return (
    <Card withBorder p="lg">
      <Group justify="space-between" align="flex-end" mb="md" wrap="wrap" gap="xs">
        <div>
          <Title order={4} mb={hint ? 2 : 0}>
            {title}
          </Title>
          {hint && (
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          )}
        </div>
        {action}
      </Group>
      {children}
    </Card>
  )
}

// Two-column entry layout built on CSS grid (Mantine's Grid wrapper made position:sticky unreliable).
// >= 1200px: form on the left, a side panel pinned to the viewport on the right that always shows the
// summary and the recent list (the list takes the remaining height and scrolls inside itself).
// Below that: one column, side panel under the form.
export function EntryLayout({ main, side }) {
  return (
    <>
      <div className="vt-entry-layout">
        <div className="vt-entry-main">{main}</div>
        <aside className="vt-entry-side" aria-label="Summary and recent entries">
          {side}
        </aside>
      </div>
      <style>{`
        .vt-entry-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--mantine-spacing-lg); align-items: start; }
        .vt-entry-main { min-width: 0; }
        .vt-entry-side { display: flex; flex-direction: column; gap: var(--mantine-spacing-md); min-width: 0; }
        .vt-entry-side .vt-recent-list { max-height: 320px; }
        @media (min-width: 1200px) {
          .vt-entry-layout { grid-template-columns: minmax(0, 1fr) 360px; }
          .vt-entry-side { position: sticky; top: 96px; height: calc(100dvh - 112px); }
          .vt-entry-side > * { flex: 0 0 auto; }
          .vt-entry-side > .vt-recent-card { flex: 1 1 0; min-height: 150px; }
          .vt-entry-side .vt-recent-list { max-height: none; }
        }
      `}</style>
    </>
  )
}

export function SummaryCard({ rows = [], totalLabel = 'Total', total, words, warning, saveLabel = 'Save & Print', saveIcon: SaveIcon = Printer, saving, onSave }) {
  return (
    <Card p="lg" style={{ background: 'linear-gradient(160deg, #6B1A1A 0%, #2B0909 100%)', border: '1px solid rgba(244,225,166,0.3)', color: '#FBF6EC' }}>
      <Text size="xs" fw={700} tt="uppercase" c="#F4E1A6" style={{ letterSpacing: 1 }}>
        Summary
      </Text>
      <Stack gap={6} mt="sm">
        {rows.map((r) => (
          <Group key={r.label} justify="space-between" wrap="nowrap">
            <Text size="sm" c="#E9D2B8">
              {r.label}
            </Text>
            <Text size="sm" className="vt-num">
              {r.value}
            </Text>
          </Group>
        ))}
      </Stack>
      <Divider my="md" color="rgba(244,225,166,0.25)" />
      <Text size="xs" c="#E9D2B8">
        {totalLabel}
      </Text>
      <Text className="vt-num" c="#F4E1A6" style={{ fontFamily: 'Marcellus, Georgia, serif', fontSize: 'clamp(30px,3vw,40px)', fontWeight: 700, lineHeight: 1.15 }}>
        {total}
      </Text>
      {amountInWords(words) && (
        <Text size="xs" c="#E9D2B8" mt={4} style={{ fontStyle: 'italic' }} aria-label="Amount in words">
          {amountInWords(words)}
        </Text>
      )}
      {warning && (
        <Text size="xs" c="#F4E1A6" mt={6} role="status">
          {warning}
        </Text>
      )}
      <Button fullWidth size="lg" mt="md" color="gold" c="#2B0909" leftSection={<SaveIcon size={18} />} loading={saving} onClick={onSave}>
        {saveLabel}
      </Button>
      <Group gap={6} justify="center" mt="xs">
        <Kbd size="xs">Alt+S</Kbd>
        <Text size="xs" c="#D9B9A3">
          to save
        </Text>
      </Group>
    </Card>
  )
}

export function SavedPanel({ lines, onPrint, printLabel = 'Print receipt' }) {
  return (
    <Card withBorder p="md" style={{ borderColor: 'var(--mantine-color-gold-4)', background: 'var(--mantine-color-gold-0)' }} role="status">
      <Group gap={8} wrap="nowrap" align="flex-start">
        <Diya />
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={700}>
            Saved successfully
          </Text>
          {lines.map((l) => (
            <Text key={l} size="xs" c="dimmed" className="vt-num">
              {l}
            </Text>
          ))}
        </div>
      </Group>
      {onPrint && (
        <Button fullWidth mt="sm" variant="light" color="kumkum" leftSection={<Printer size={16} />} onClick={onPrint}>
          {printLabel}
        </Button>
      )}
    </Card>
  )
}

// rows: array; renderRow(row) => { key, title, subtitle, onPrint? (omit for no print button), printLabel, extra? (node shown before the print button) }
export function RecentCard({ title, icon: Icon, loading, rows, renderRow, emptyTitle, emptyHint }) {
  return (
    <Card withBorder p="md" className="vt-recent-card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Group gap={8} mb="xs" style={{ flex: '0 0 auto' }}>
        <Icon size={18} color="var(--mantine-color-kumkum-7)" aria-hidden />
        <Title order={5}>{title}</Title>
      </Group>
      {loading ? (
        <Stack gap="xs">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={38} radius="md" />
          ))}
        </Stack>
      ) : rows.length === 0 ? (
        <EmptyState icon={Icon} title={emptyTitle} hint={emptyHint} />
      ) : (
        <Stack gap={0} className="vt-recent-list" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
          {rows.map((row, i) => {
            const r = renderRow(row)
            return (
              <div key={r.key}>
                {i > 0 && <Divider my={6} />}
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={600} className="vt-num">
                      {r.title}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {r.subtitle}
                    </Text>
                  </div>
                  <Group gap={4} wrap="nowrap">
                    {r.extra}
                    {r.onPrint && (
                      <ActionIcon variant="light" color="kumkum" size={36} aria-label={r.printLabel} onClick={r.onPrint}>
                        <Printer size={16} />
                      </ActionIcon>
                    )}
                  </Group>
                </Group>
              </div>
            )
          })}
        </Stack>
      )}
    </Card>
  )
}


// A small clay lamp that lights up when a document is saved: the flame flickers, a gold ring ripples once.
// Pure CSS (no images), motion is switched off for prefers-reduced-motion.
function Diya() {
  return (
    <div className="vt-diya" aria-hidden>
      <span className="vt-diya-ring" />
      <span className="vt-diya-flame" />
      <span className="vt-diya-bowl" />
      <style>{`
        .vt-diya { position: relative; width: 34px; height: 34px; flex-shrink: 0; }
        .vt-diya-bowl { position: absolute; left: 4px; right: 4px; bottom: 4px; height: 11px; border-radius: 0 0 20px 20px; background: linear-gradient(180deg, #D4A63F, #A97F32); }
        .vt-diya-flame { position: absolute; left: 50%; bottom: 14px; width: 10px; height: 16px; margin-left: -5px; border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%; background: radial-gradient(circle at 50% 70%, #FFF3C4 0%, #F5B040 45%, #E07B16 100%); transform-origin: 50% 90%; box-shadow: 0 0 12px 3px rgba(245,176,64,0.55); animation: vt-flicker 1.6s ease-in-out infinite; }
        .vt-diya-ring { position: absolute; inset: 0; border-radius: 50%; border: 2px solid #D4A63F; opacity: 0; animation: vt-ripple 1.2s ease-out 1; }
        @keyframes vt-flicker { 0%,100% { transform: scale(1) rotate(-2deg); } 35% { transform: scale(1.08, 1.14) rotate(2deg); } 70% { transform: scale(0.96, 1.02) rotate(-1deg); } }
        @keyframes vt-ripple { 0% { opacity: 0.8; transform: scale(0.5); } 100% { opacity: 0; transform: scale(1.5); } }
        @media (prefers-reduced-motion: reduce) { .vt-diya-flame, .vt-diya-ring { animation: none; } }
      `}</style>
    </div>
  )
}

/** Page title row used by entry screens: gopuram mark, title, subtitle and the keyboard-shortcut hints. */
export function PageHeader({ title, subtitle, shortcuts = [{ keys: 'Alt+S', label: 'Save' }] }) {
  return (
    <Group justify="space-between" align="center" wrap="wrap" gap="md">
      <Group gap="sm" wrap="nowrap">
        <img src="/illustrations/gopuram-mark.svg" alt="" aria-hidden style={{ height: 40, width: 40 }} />
        <div>
          <Title order={2}>{title}</Title>
          {subtitle && (
            <Text size="sm" c="dimmed">
              {subtitle}
            </Text>
          )}
        </div>
      </Group>
      <Group gap="md" visibleFrom="sm" c="dimmed">
        {shortcuts.map((k) => (
          <Group gap={6} key={k.keys}>
            <Kbd size="xs">{k.keys}</Kbd>
            <Text size="xs">{k.label}</Text>
          </Group>
        ))}
      </Group>
    </Group>
  )
}
