import { Stack, Text } from '@mantine/core'

export default function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <Stack align="center" gap={6} py="xl" px="md" ta="center">
      {Icon && (
        <div
          aria-hidden
          style={{ width: 44, height: 44, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--vt-gold-chip)', color: 'var(--vt-accent)' }}
        >
          <Icon size={20} />
        </div>
      )}
      <Text fw={600} size="sm">
        {title}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed" maw={280}>
          {hint}
        </Text>
      )}
      {action}
    </Stack>
  )
}
