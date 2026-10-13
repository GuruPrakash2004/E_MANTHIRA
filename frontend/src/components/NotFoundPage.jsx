import { Button, Card, Stack, Title } from '@mantine/core'
import { Compass } from 'lucide-react'
import { Link } from 'react-router-dom'
import EmptyState from './ui/EmptyState'

/** Shown for any URL that matches no route, inside the app shell so the sidebar stays usable. */
export default function NotFoundPage() {
  return (
    <Stack gap="lg" className="vt-rise">
      <Title order={2}>Page not found</Title>
      <Card withBorder p="lg">
        <EmptyState
          icon={Compass}
          title="This page does not exist"
          hint="The address may be mistyped or the screen may have moved. Use the menu, or go back to the dashboard."
          action={
            <Button component={Link} to="/" color="kumkum" size="xs" mt="xs">
              Go to dashboard
            </Button>
          }
        />
      </Card>
    </Stack>
  )
}
