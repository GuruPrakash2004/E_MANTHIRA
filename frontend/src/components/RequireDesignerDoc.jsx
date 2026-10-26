import { Card, Skeleton, Stack, Text, Title } from '@mantine/core'
import { FileQuestion } from 'lucide-react'
import useDocFields from '../hooks/useDocFields'

/**
 * Guards an entry screen: it needs this temple's Doc Designer rows (UtlDocDsgrFlds) for its document. When the
 * database has none (e.g. Hall Booking, or Bill of Material, in a temple that never set them up) the screen is
 * not usable, so say so instead of showing a form that can't save.
 */
export default function RequireDesignerDoc({ docId, name, children }) {
  const { fields, isLoading } = useDocFields(docId)
  if (isLoading) return <Skeleton height={240} radius="md" />
  if (!fields.length) {
    return (
      <Card withBorder p="xl" maw={560} mx="auto" mt="xl">
        <Stack align="center" gap="xs">
          <FileQuestion size={36} aria-hidden />
          <Title order={3}>{name} is not set up</Title>
          <Text size="sm" c="dimmed" ta="center">
            This temple's database has no Doc Designer fields for {name}, so there is nothing to enter here. Add the document in the
            Doc Designer, or hide it from the menu in Admin Master.
          </Text>
        </Stack>
      </Card>
    )
  }
  return children
}
