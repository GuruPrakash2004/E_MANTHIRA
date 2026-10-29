import { Stack, Text, Title } from '@mantine/core'
import HallStatusBoard from './HallStatusBoard'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

/** Hall Status screen (legacy frmRptRoomStatus): the board, with the page title. */
export default function HallStatusPage() {
  return (
    <Stack gap="lg" className="vt-rise">
      <HallStatusBoard
        headerLeft={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
            <div>
              <Title order={2}>Hall Status</Title>
              <Text size="sm" c="dimmed">
                Which halls are booked on which days
              </Text>
            </div>
          </div>
        }
      />
    </Stack>
  )
}
