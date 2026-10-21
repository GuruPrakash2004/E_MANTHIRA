import { ActionIcon, Button, Card, Divider, Group, Kbd, Skeleton, Text, Title, Stack } from '@mantine/core'
import { Printer, Save } from 'lucide-react'
import useEnterAsTab from '../../hooks/useEnterAsTab'
import { AnimatePresence, motion } from 'framer-motion'
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
export function EntryLayout({ main, side, viewing = false }) {
  const enterAsTab = useEnterAsTab()
  return (
    <>
      <div className="vt-entry-layout">
        <div className="vt-entry-main" onKeyDown={enterAsTab}>{viewing ? <fieldset disabled style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{main}</fieldset> : main}</div>
        <aside className="vt-entry-side" aria-label="Summary and recent entries">
          {side}
        </aside>
      </div>
      <style>{`
        .vt-entry-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--mantine-spacing-lg); align-items: start; }
        .vt-entry-main { min-width: 0; }
        .vt-entry-side { display: flex; flex-direction: column; gap: var(--mantine-spacing-sm); min-width: 0; }
        .vt-entry-side .vt-recent-list { max-height: 360px; }
        @media (min-width: 1200px) {
          .vt-entry-layout { grid-template-columns: minmax(0, 1fr) 380px; }
          /* header is 80px: pin 10px below it, and use all the remaining height so the recent list shows more rows */
          .vt-entry-side { position: sticky; top: 90px; height: calc(100dvh - 102px); }
          .vt-entry-side > * { flex: 0 0 auto; }
          .vt-entry-side > .vt-recent-card { flex: 1 1 0; min-height: 220px; }
          .vt-entry-side .vt-recent-list { max-height: none; }
        }

        /* Recent list: thin themed scrollbar, soft fade at the edges, roomy hover rows */
        .vt-recent-list {
          scrollbar-width: thin;
          scrollbar-color: var(--vt-accent) transparent;
          overscroll-behavior: auto;
          padding: 2px 6px 2px 0;
          -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 10px, #000 calc(100% - 14px), transparent 100%);
          mask-image: linear-gradient(to bottom, transparent 0, #000 10px, #000 calc(100% - 14px), transparent 100%);
        }
        .vt-recent-list::-webkit-scrollbar { width: 6px; }
        .vt-recent-list::-webkit-scrollbar-track { background: transparent; }
        .vt-recent-list::-webkit-scrollbar-thumb { background: var(--vt-accent); border-radius: 999px; opacity: .6; }
        .vt-recent-list::-webkit-scrollbar-thumb:hover { background: var(--mantine-color-gold-5); }
        .vt-recent-row { border-radius: 10px; padding: 8px 10px; transition: background-color .15s ease; }
        .vt-recent-row:hover { background: var(--vt-gold-chip); }
      `}</style>
    </>
  )
}

export function SummaryCard({ rows = [], totalLabel = 'Total', total, words, warning, saveLabel = 'Save & Print', saveIcon: SaveIcon = Printer, saving, saveDisabled = false, onSave, onSavePrint }) {
  return (
    <Card p="md" style={{ background: 'linear-gradient(160deg, var(--vt-g1) 0%, var(--vt-g3) 100%)', border: '1px solid rgba(244,225,166,0.3)', color: '#FBF6EC' }}>
      <Text size="xs" fw={700} tt="uppercase" c="#F4E1A6" style={{ letterSpacing: 1 }}>
        Summary
      </Text>
      <Stack gap={4} mt={6}>
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
      <Divider my="sm" color="rgba(244,225,166,0.25)" />
      <Text size="xs" c="#E9D2B8">
        {totalLabel}
      </Text>
      <Text className="vt-num" c="#F4E1A6" style={{ fontFamily: 'Marcellus, Georgia, serif', fontSize: 'clamp(26px,2.4vw,34px)', fontWeight: 700, lineHeight: 1.15 }}>
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
      {/* Screens that print get two explicit buttons: Alt+S saves only, F10 saves and prints straight away. */}
      {onSavePrint ? (
        <Group gap={8} mt="sm" wrap="nowrap" grow>
          <Button size="sm" px="xs" color="gold" c="#2B0909" leftSection={<Save size={16} />} loading={saving} disabled={saveDisabled} onClick={onSave} aria-keyshortcuts="Alt+S" title="Save only, nothing is printed (Alt+S)">
            <Group gap={6} wrap="nowrap">
              <span>Save</span>
              <Kbd size="xs" style={{ background: 'rgba(43,9,9,0.12)', color: '#2B0909', borderColor: 'rgba(43,9,9,0.25)' }}>Alt+S</Kbd>
            </Group>
          </Button>
          <Button size="sm" px="xs" variant="outline" color="gold" leftSection={<Printer size={16} />} disabled={saving || saveDisabled} onClick={onSavePrint} aria-keyshortcuts="F10" title="Save and print straight away, no dialog (F10)">
            <Group gap={6} wrap="nowrap">
              <span>Save &amp; Print</span>
              <Kbd size="xs" style={{ background: 'rgba(244,225,166,0.15)', color: '#F4E1A6', borderColor: 'rgba(244,225,166,0.4)' }}>F10</Kbd>
            </Group>
          </Button>
        </Group>
      ) : (
      <Button fullWidth size="md" mt="sm" color="gold" c="#2B0909" leftSection={<SaveIcon size={18} />} loading={saving} disabled={saveDisabled} onClick={onSave} aria-keyshortcuts="Alt+S">
        <Group gap={10} wrap="nowrap">
          <span>{saveLabel}</span>
          <Kbd size="xs" style={{ background: 'rgba(43,9,9,0.12)', color: '#2B0909', borderColor: 'rgba(43,9,9,0.25)' }}>
            Alt+S
          </Kbd>
        </Group>
      </Button>
      )}
          </Card>
  )
}

export function SavedPanel({ lines, onPrint, printLabel = 'Print receipt' }) {
  return (
    <Card withBorder p="md" style={{ borderColor: 'var(--mantine-color-gold-4)', background: 'var(--vt-gold-chip)' }} role="status">
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
        <Icon size={18} color="var(--vt-accent)" aria-hidden />
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
        <Stack gap={2} className="vt-recent-list" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
          <AnimatePresence initial={false}>
          {rows.map((row) => {
            const r = renderRow(row)
            return (
              <motion.div key={r.key} layout="position" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: 'easeOut' }}>
                <Group justify="space-between" wrap="nowrap" gap="xs" className="vt-recent-row">
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
              </motion.div>
            )
          })}
          </AnimatePresence>
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

/** Page title row used by entry screens: gopuram mark, title and subtitle. (Keyboard shortcuts still work; the hint chips were removed.) */
export function PageHeader({ title, subtitle }) {
  return (
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
  )
}
