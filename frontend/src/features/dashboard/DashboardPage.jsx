import { Badge, Button, Card, Divider, Grid, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import {
  ArrowUpRight,
  Landmark,
  CalendarCheck,
  IndianRupee,
  Gift,
  Hand,
  Plus,
  Receipt,
  Banknote,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { Link } from 'react-router-dom'
import * as sevaApi from '../../api/endpoints/seva'
import * as donationApi from '../../api/endpoints/donation'
import * as hallApi from '../../api/endpoints/hall'
import { useAuth } from '../../hooks/useAuth'

const KOLAM_PATTERN = '/illustrations/kolam.svg'

const QUICK_ACTIONS = [
  { label: 'New Seva Entry', hint: 'Book a seva for a devotee', to: '/sevas', icon: Hand },
  { label: 'New Donation', hint: 'Record a donation receipt', to: '/donations', icon: Gift },
  { label: 'Hall Booking', hint: 'Reserve a hall or kalyana mantapa', to: '/halls', icon: Landmark },
  { label: 'Reports', hint: 'Collection and subsidiary reports', to: '/reports', icon: Banknote },
]

function StatCard({ label, value, icon: Icon, dark, footer }) {
  return (
    <Card
      withBorder={!dark}
      radius="lg"
      p="lg"
      style={{
        background: dark ? 'linear-gradient(160deg, #2A211C 0%, #1A1512 100%)' : '#fff',
        color: dark ? '#fff' : undefined,
        minHeight: 150,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Text size="sm" c={dark ? '#C5CAD6' : 'dimmed'}>
          {label}
        </Text>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: dark ? 'rgba(255,255,255,0.12)' : 'var(--mantine-color-gold-0)',
            color: dark ? '#fff' : 'var(--mantine-color-kumkum-7)',
            flexShrink: 0,
          }}
        >
          <Icon size={18} />
        </div>
      </Group>
      <div>
        <Text style={{ fontFamily: 'Marcellus, Georgia, serif', fontSize: 'clamp(26px,3vw,38px)', fontWeight: 700, letterSpacing: -0.5, lineHeight: 1 }}>
          {value}
        </Text>
        {footer && (
          <Text size="xs" c={dark ? '#C5CAD6' : 'dimmed'} mt={6}>
            {footer}
          </Text>
        )}
      </div>
    </Card>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const today = dayjs().format('YYYY-MM-DD')

  const { data: sevas } = useQuery({ queryKey: ['dashboard', 'sevas'], queryFn: () => sevaApi.listSevas({ top: 50 }) })
  const { data: donations } = useQuery({ queryKey: ['dashboard', 'donations'], queryFn: () => donationApi.listDonations({ top: 50 }) })
  const { data: bookings } = useQuery({ queryKey: ['dashboard', 'hall-bookings'], queryFn: () => hallApi.listBookings({ top: 50 }) })

  const sevaRows = sevas || []
  const donationRows = donations || []
  const bookingRows = bookings || []

  const todaySevas = sevaRows.filter((s) => s.SEVADate?.slice(0, 10) === today && s.Cancelled !== 'Y')
  const todayDonations = donationRows.filter((d) => d.DONRECDate?.slice(0, 10) === today && d.Cancelled !== 'Y')
  const todayCollection =
    todaySevas.reduce((sum, s) => sum + (Number(s.TotalAmt) || 0), 0) +
    todayDonations.reduce((sum, d) => sum + (Number(d.TOTAMT) || 0), 0)
  const activeHallBookings = bookingRows.filter((b) => b.Cancelled !== 'Y')

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
        <div>
          <Title order={1} style={{ fontFamily: 'Marcellus, Georgia, serif', fontSize: 'clamp(30px,4vw,44px)', letterSpacing: -1 }}>
            Namaskara, {user?.user_name || user?.user_code || 'Administrator'}
          </Title>
          <Text c="dimmed" mt={6}>
            Manage daily sevas, donations, hall bookings and collections.
          </Text>
        </div>
        <Group gap="xs">
          <Badge size="lg" radius="xl" variant="light" color="gold">
            {dayjs().format('DD MMMM YYYY')}
          </Badge>
          <Button component={Link} to="/sevas" color="kumkum" leftSection={<Plus size={16} />}>
            New Seva Entry
          </Button>
        </Group>
      </Group>

      <Card
        radius="lg"
        p="lg"
        style={{ background: 'var(--mantine-color-kumkum-0)', border: '1px solid var(--mantine-color-kumkum-1)', position: 'relative', overflow: 'hidden' }}
      >
        <div
          aria-hidden
          style={{ position: 'absolute', inset: 0, backgroundImage: `url(${KOLAM_PATTERN})`, backgroundSize: '120px 120px', opacity: 0.04, pointerEvents: 'none' }}
        />
        <Group justify="space-between" wrap="wrap" style={{ position: 'relative' }}>
          <div>
            <Text fw={700} c="kumkum.8">
              Welcome to vTemple, e-Mandira Pranali
            </Text>
            <Text size="sm" c="kumkum.7" mt={2} opacity={0.85}>
              A simpler way to manage temple seva, donation and hall operations.
            </Text>
          </div>
        </Group>
      </Card>

      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md">
        <StatCard label="Today's Seva Bookings" value={todaySevas.length} icon={Hand} dark footer="vs recent activity" />
        <StatCard
          label="Today's Collection"
          value={`₹${todayCollection.toLocaleString('en-IN')}`}
          icon={IndianRupee}
          footer="Seva + donation receipts"
        />
        <StatCard label="Today's Donations" value={todayDonations.length} icon={Gift} footer="Donation receipts recorded" />
        <StatCard label="Active Hall Bookings" value={activeHallBookings.length} icon={CalendarCheck} footer="Not cancelled" />
      </SimpleGrid>

      <div>
        <Title order={3} mb="sm" style={{ fontSize: 20, letterSpacing: -0.3 }}>
          Quick Actions
        </Title>
        <Group gap="sm" wrap="wrap">
          {QUICK_ACTIONS.map((a) => (
            <Button
              key={a.label}
              component={Link}
              to={a.to}
              variant="default"
              radius="xl"
              size="lg"
              h={54}
              px="lg"
              leftSection={
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--mantine-color-gold-0)', color: 'var(--mantine-color-kumkum-7)', display: 'grid', placeItems: 'center' }}>
                  <a.icon size={18} />
                </div>
              }
              styles={{ label: { textAlign: 'left' } }}
            >
              <div>
                <Text size="sm" fw={700}>
                  {a.label}
                </Text>
                <Text size="xs" c="dimmed">
                  {a.hint}
                </Text>
              </div>
            </Button>
          ))}
        </Group>
      </div>

      <Grid gutter="md" align="start">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Card withBorder radius="lg" p={0} style={{ overflow: 'hidden' }}>
            <Group justify="space-between" p="lg" pb="sm">
              <div>
                <Title order={4} style={{ fontSize: 18 }}>
                  Recent Seva Transactions
                </Title>
                <Text size="xs" c="dimmed">
                  Latest bookings and billing activity
                </Text>
              </div>
              <Button component={Link} to="/sevas" variant="subtle" color="kumkum" size="xs">
                View all
              </Button>
            </Group>
            <Stack gap={0}>
              {sevaRows.slice(0, 6).map((s, i) => (
                <div key={s.SEVAID}>
                  {i > 0 && <Divider />}
                  <Group justify="space-between" px="lg" py="sm" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap">
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          background: 'var(--mantine-color-gray-1)',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: 11,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {(s.KNAME || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={600} truncate>
                          {s.KNAME}
                        </Text>
                        <Text size="xs" c="dimmed" ff="monospace">
                          {s.PrintSEVANO}
                        </Text>
                      </div>
                    </Group>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm" ff="monospace" fw={600}>
                        ₹{Number(s.TotalAmt || 0).toLocaleString('en-IN')}
                      </Text>
                      <Badge size="sm" radius="xl" color={s.Cancelled === 'Y' ? 'red' : 'teal'} variant="light">
                        {s.Cancelled === 'Y' ? 'Cancelled' : 'Paid'}
                      </Badge>
                    </Group>
                  </Group>
                </div>
              ))}
              {sevaRows.length === 0 && (
                <Text c="dimmed" size="sm" p="lg">
                  No seva transactions yet.
                </Text>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Card withBorder radius="lg" p={0} style={{ overflow: 'hidden' }}>
            <Group justify="space-between" p="lg" pb="sm">
              <div>
                <Title order={4} style={{ fontSize: 18 }}>
                  Recent Donations
                </Title>
                <Text size="xs" c="dimmed">
                  Latest donation receipts
                </Text>
              </div>
              <Button component={Link} to="/donations" variant="subtle" color="kumkum" size="xs">
                View all
              </Button>
            </Group>
            <Stack gap={0}>
              {donationRows.slice(0, 5).map((d, i) => (
                <div key={d.DONRECID}>
                  {i > 0 && <Divider />}
                  <Group justify="space-between" px="lg" py="sm" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap">
                      <Receipt size={18} color="var(--mantine-color-kumkum-6)" />
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={600} truncate>
                          {d.DONOR}
                        </Text>
                        <Text size="xs" c="dimmed" ff="monospace">
                          {d.PrintDONRECNO}
                        </Text>
                      </div>
                    </Group>
                    <Text size="sm" ff="monospace" fw={700} c="kumkum.7">
                      ₹{Number(d.TOTAMT || 0).toLocaleString('en-IN')}
                    </Text>
                  </Group>
                </div>
              ))}
              {donationRows.length === 0 && (
                <Text c="dimmed" size="sm" p="lg">
                  No donation receipts yet.
                </Text>
              )}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      <Group justify="space-between" pt="md" pb="lg" c="dimmed" style={{ fontSize: 12.5 }}>
        <Text size="xs">© {dayjs().year()} vTemple · e-Mandira Pranali</Text>
        <Text size="xs" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          Designed with devotion <ArrowUpRight size={12} />
        </Text>
      </Group>
    </Stack>
  )
}
