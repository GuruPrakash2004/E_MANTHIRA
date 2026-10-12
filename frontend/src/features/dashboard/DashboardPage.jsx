import { Badge, Button, Card, Grid, Group, SimpleGrid, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { CalendarCheck, Gift, Hand, IndianRupee, Landmark, Plus, Banknote, Receipt } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { Link } from 'react-router-dom'
import * as sevaApi from '../../api/endpoints/seva'
import * as donationApi from '../../api/endpoints/donation'
import * as hallApi from '../../api/endpoints/hall'
import { useAuth } from '../../hooks/useAuth'
import HeroVisual from '../../components/HeroVisual'
import StatCard from '../../components/ui/StatCard'
import ActivityCard from '../../components/ui/ActivityCard'
import { formatINR } from '../../utils/format'

const KOLAM_PATTERN = '/illustrations/kolam.svg'

const QUICK_ACTIONS = [
  { label: 'New Seva Entry', hint: 'Book a seva for a devotee', to: '/sevas', icon: Hand },
  { label: 'New Donation', hint: 'Record a donation receipt', to: '/donations', icon: Gift },
  { label: 'Hall Booking', hint: 'Reserve a hall or kalyana mantapa', to: '/halls', icon: Landmark },
  { label: 'Reports', hint: 'Collection and subsidiary reports', to: '/reports', icon: Banknote },
]

function greeting() {
  const h = dayjs().hour()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function DashboardPage() {
  const { user } = useAuth()
  const today = dayjs().format('YYYY-MM-DD')

  const { data: sevas, isLoading: sevasLoading, isError: sevasError } = useQuery({ queryKey: ['dashboard', 'sevas'], queryFn: () => sevaApi.listSevas({ top: 50 }) })
  const { data: donations, isLoading: donLoading, isError: donError } = useQuery({ queryKey: ['dashboard', 'donations'], queryFn: () => donationApi.listDonations({ top: 50 }) })
  const { data: bookings, isLoading: bookLoading } = useQuery({ queryKey: ['dashboard', 'hall-bookings'], queryFn: () => hallApi.listBookings({ top: 50 }) })

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
    <Stack gap="xl" className="vt-rise">
      {/* Hero: greeting + primary action on the left, glowing gopuram on the right (hidden on phones). */}
      <Card
        p={0}
        style={{
          background: 'linear-gradient(135deg, #2B0909 0%, #5A1414 55%, #2B0909 100%)',
          border: '1px solid rgba(244,225,166,0.25)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          aria-hidden
          style={{ position: 'absolute', inset: 0, backgroundImage: `url(${KOLAM_PATTERN})`, backgroundSize: '120px 120px', opacity: 0.06, pointerEvents: 'none' }}
        />
        <Group justify="space-between" align="center" wrap="nowrap" px={{ base: 'md', sm: 'xl' }} style={{ position: 'relative' }}>
          <Stack gap="sm" py="xl" style={{ minWidth: 0 }}>
            <Badge size="lg" variant="outline" color="gold" c="#F4E1A6" style={{ alignSelf: 'flex-start', borderColor: 'rgba(244,225,166,0.4)' }}>
              {dayjs().format('dddd, DD MMMM YYYY')}
            </Badge>
            <Title order={1} c="#FBF6EC" style={{ fontSize: 'clamp(26px,3.4vw,40px)', letterSpacing: -0.5, lineHeight: 1.1 }}>
              {greeting()}, {user?.user_name || user?.user_code || 'Administrator'}
            </Title>
            <Text size="sm" c="#E9D2B8" maw={460}>
              Today's sevas, donations and hall bookings at a glance.
            </Text>
            <Group gap="xs" mt={4}>
              <Button component={Link} to="/sevas" color="gold" c="#2B0909" size="md" leftSection={<Plus size={16} />}>
                New Seva Entry
              </Button>
              <Button component={Link} to="/donations" variant="outline" color="gold" size="md" styles={{ root: { color: '#F4E1A6', borderColor: 'rgba(244,225,166,0.5)' } }}>
                New Donation
              </Button>
            </Group>
          </Stack>
          <div className="vt-dash-hero-art" style={{ width: 'min(340px, 34%)', height: 220, flexShrink: 0 }}>
            <HeroVisual showChips={false} />
          </div>
        </Group>
        <style>{`@media (max-width: 700px) { .vt-dash-hero-art { display: none; } }`}</style>
      </Card>

      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md">
        <StatCard tone="dark" label="Today's Seva Bookings" value={todaySevas.length} icon={Hand} footer="Not cancelled" loading={sevasLoading} />
        <StatCard label="Today's Collection" value={formatINR(todayCollection)} icon={IndianRupee} footer="Seva + donation receipts" loading={sevasLoading || donLoading} />
        <StatCard label="Today's Donations" value={todayDonations.length} icon={Gift} footer="Donation receipts recorded" loading={donLoading} />
        <StatCard label="Active Hall Bookings" value={activeHallBookings.length} icon={CalendarCheck} footer="Not cancelled" loading={bookLoading} />
      </SimpleGrid>

      <div>
        <Title order={3} mb="sm" style={{ fontSize: 20, letterSpacing: -0.3 }}>
          Quick Actions
        </Title>
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="sm">
          {QUICK_ACTIONS.map((a) => (
            <UnstyledButton
              key={a.label}
              component={Link}
              to={a.to}
              className="vt-lift"
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', minHeight: 64, background: '#fff', border: '1px solid var(--vt-line)', borderRadius: 16 }}
            >
              <div
                aria-hidden
                style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--mantine-color-gold-0)', color: 'var(--mantine-color-kumkum-7)', display: 'grid', placeItems: 'center', flexShrink: 0 }}
              >
                <a.icon size={18} />
              </div>
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={700}>
                  {a.label}
                </Text>
                <Text size="xs" c="dimmed" truncate>
                  {a.hint}
                </Text>
              </div>
            </UnstyledButton>
          ))}
        </SimpleGrid>
      </div>

      <Grid gutter="md" align="start">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <ActivityCard
            title="Recent Seva Transactions"
            subtitle="Latest bookings and billing activity"
            to="/sevas"
            rows={sevaRows}
            loading={sevasLoading}
            error={sevasError}
            limit={6}
            empty={{ icon: Hand, title: 'No seva transactions yet', hint: 'New bookings will show up here as soon as they are saved.' }}
            renderRow={(s) => (
              <Group justify="space-between" px="lg" py="sm" wrap="nowrap">
                <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                  <div
                    aria-hidden
                    style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--mantine-color-kumkum-0)', color: 'var(--mantine-color-kumkum-7)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}
                  >
                    {(s.KNAME || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={600} truncate>
                      {s.KNAME}
                    </Text>
                    <Text size="xs" c="dimmed" className="vt-num">
                      {s.PrintSEVANO}
                    </Text>
                  </div>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" fw={600} className="vt-num">
                    {formatINR(s.TotalAmt)}
                  </Text>
                  <Badge size="sm" variant="light" color={s.Cancelled === 'Y' ? 'red' : 'teal'}>
                    {s.Cancelled === 'Y' ? 'Cancelled' : 'Paid'}
                  </Badge>
                </Group>
              </Group>
            )}
          />
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 5 }}>
          <ActivityCard
            title="Recent Donations"
            subtitle="Latest donation receipts"
            to="/donations"
            rows={donationRows}
            loading={donLoading}
            error={donError}
            empty={{ icon: Receipt, title: 'No donation receipts yet', hint: 'Receipts appear here once a donation is recorded.' }}
            renderRow={(d) => (
              <Group justify="space-between" px="lg" py="sm" wrap="nowrap">
                <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                  <Receipt size={18} color="var(--mantine-color-kumkum-6)" aria-hidden />
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={600} truncate>
                      {d.DONOR}
                    </Text>
                    <Text size="xs" c="dimmed" className="vt-num">
                      {d.PrintDONRECNO}
                    </Text>
                  </div>
                </Group>
                <Text size="sm" fw={700} c="kumkum.7" className="vt-num">
                  {formatINR(d.TOTAMT)}
                </Text>
              </Group>
            )}
          />
        </Grid.Col>
      </Grid>

      <Text size="xs" c="dimmed" ta="center" pb="md">
        © {dayjs().year()} vTemple, e-Mandira Pranali
      </Text>
    </Stack>
  )
}
