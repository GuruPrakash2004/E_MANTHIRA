import { Alert, Button, Card, Divider, Group, Skeleton, Stack, Text, Title } from '@mantine/core'
import { AlertCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import EmptyState from './EmptyState'

// Card with title, "View all" link and a list body that handles loading / error / empty.
export default function ActivityCard({ title, subtitle, to, rows, loading, error, empty, renderRow, limit = 5 }) {
  return (
    <Card withBorder p={0} style={{ overflow: 'hidden' }}>
      <Group justify="space-between" p="lg" pb="sm" wrap="nowrap">
        <div>
          <Title order={4} style={{ fontSize: 18 }}>
            {title}
          </Title>
          {subtitle && (
            <Text size="xs" c="dimmed">
              {subtitle}
            </Text>
          )}
        </div>
        {to && (
          <Button component={Link} to={to} variant="subtle" color="kumkum" size="compact-sm">
            View all
          </Button>
        )}
      </Group>
      {loading ? (
        <Stack gap="sm" p="lg" pt={0}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={40} radius="md" />
          ))}
        </Stack>
      ) : error ? (
        <Alert m="lg" mt={0} color="red" variant="light" icon={<AlertCircle size={16} />}>
          Could not load this list. Check the server connection and try again.
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState {...empty} />
      ) : (
        <Stack gap={0}>
          {rows.slice(0, limit).map((r, i) => (
            <div key={i}>
              {i > 0 && <Divider />}
              {renderRow(r)}
            </div>
          ))}
        </Stack>
      )}
    </Card>
  )
}
