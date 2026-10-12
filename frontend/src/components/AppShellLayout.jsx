import { useEffect, useRef, useState } from 'react'
import { AppShell, Burger, Collapse, Group, NavLink, Text, Menu, Avatar, Badge, Stack, Kbd, ActionIcon, UnstyledButton } from '@mantine/core'
import { SlidersHorizontal, BarChart3, ChevronDown, FlaskConical, LayoutDashboard, Search } from 'lucide-react'
import { useDisclosure } from '@mantine/hooks'
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { getMenu } from '../api/endpoints/meta'
import { useAuth } from '../hooks/useAuth'
import useAutoFocusFirstField from '../hooks/useAutoFocusFirstField'
import GlobalSearch from './GlobalSearch'
import { TOKENS } from '../theme/theme'
import { isDemoMode } from '../lib/demoMode'
import { enterDemoMode, exitDemoMode } from '../lib/demoAuth'

// True cutouts (alpha channel, not a cropped/color-matched JPEG) generated
// from the source brand files in logo/ via Pillow chroma-keying their flat
// backgrounds out — see public/brand/README for the one-off script. Render
// on any surface, any color, no box.
const BRAND_LOCKUP = '/brand/lockup-transparent.png' // icon + "e-Mandira Pranali" wordmark
const BRAND_MARK = '/brand/mark.png' // icon only, square — for the sidebar's white circle badge

const TYPE_ORDER = ['Transactions', 'Vouchers', 'Masters', 'Reports', 'Ac-Reports', 'Utilities']
// A handful of docs have a dedicated, purpose-built screen; everything else
// that's a simple master (has a DocShForm short-form in UtlTransactions) is
// served by the generic MasterPage, keyed off the menu item's own DocID —
// same metadata-driven approach as the legacy frmMstGeneral (CLAUDE.md rule 5).
const CAPTION_ROUTE = {
  'Seva Entry': '/sevas',
  'Hall Booking': '/halls',
  'Hall Booking Entry': '/halls/entry',
  'Donation Reciept Entry': '/donations',
  'Payment Voucher': '/vouchers/payment',
  'Receipt Voucher': '/vouchers/receipt',
  'Panchanga': '/panchanga',
  'Hall Status': '/halls/status',
  'Purchase Voucher': '/inventory/purchase-voucher',
  // These two are tabs inside the Reports launcher (ReportsPage.jsx), not
  // dedicated screens — point the legacy MstMenu entries at the matching
  // tab instead of leaving them as dead (disabled) sidebar links.
  'Customised Reports...': '/reports?tab=custom',
  'Hall Booking With Voucher Detail Report': '/reports?tab=hall-voucher',
  'Subsidiary Reports': '/reports?tab=catalog',
  // Newly-built screens (see ReportsPage.jsx's PdfGeneratorPage, the
  // Inventory module's CurrentStockBalancePage/ItemReferencerPage, and
  // AuditTrailPage) — exact MstMenu captions confirmed against the DB.
  'PDF Generator': '/reports/pdf-generator',
  'Item Referencer': '/inventory/item-referencer',
  'Current Stock Balance': '/inventory/stock-balance',
  'Stock Balance Report': '/inventory/stock-balance-report',
  'Stock Ledger Report': '/inventory/stock-ledger-report',
  'Audit Trail': '/audit-trail',
  // Already-built screens whose exact MstMenu caption was never added here —
  // confirmed against the live DB (MenuItemID 1, 809, 1287, 1728, 1405).
  'Display in Browser': '/display',
  'Import from Excel': '/settings/import-excel',
  'Global Settings...': '/settings/admin-master',
  'Security': '/settings/admin-master', // DocID 18 = Role (CLAUDE.md §6) -> Roles & Rights tab
  'Bulk Master Update': '/settings/admin-master',
  'General Ledger': '/reports?tab=general-ledger',
}

function routeFor(item) {
  if (CAPTION_ROUTE[item.caption]) return CAPTION_ROUTE[item.caption]
  if (item.type === 'Masters' && item.doc_id) return `/masters/${item.doc_id}`
  return null
}

// Destinations AppShellLayout itself adds outside the metadata-driven menu
// tree (Reports launcher, Admin Master, the 4 hidden/zero-usage Inventory
// screens) — included in the universal search alongside the real menu.
const EXTRA_SEARCH_LINKS = [
  { caption: 'Reports', to: '/reports', group: 'Reports' },
  { caption: 'Admin Master', to: '/settings/admin-master', group: 'Administration', adminOnly: true },
  { caption: 'Stock Adjustment Entry', to: '/inventory/stock-adjustment', group: 'Inventory', adminOnly: true },
  { caption: 'Store Issue Note', to: '/inventory/store-issue', group: 'Inventory', adminOnly: true },
  { caption: 'Purchase Bill', to: '/inventory/purchase-bill', group: 'Inventory', adminOnly: true },
  { caption: 'Bill of Material', to: '/inventory/bom', group: 'Inventory', adminOnly: true },
]

export default function AppShellLayout() {
  const [opened, { toggle }] = useDisclosure(true)
  const [menu, setMenu] = useState([])
  const [searchOpen, setSearchOpen] = useState(false)
  // Each sub-group (Transactions, Vouchers, Masters, ...) collapses on its
  // own so a long Masters list doesn't push every other group off-screen.
  // Starts with nothing expanded; the effect below opens whichever group
  // holds the current route, and the user can open/close others freely —
  // never force-collapsed on navigation.
  const [openGroups, setOpenGroups] = useState(() => new Set())
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const mainRef = useRef(null)

  // Every screen starts with the cursor already in its first field — no
  // page has to wire this itself, see useAutoFocusFirstField.js.
  useAutoFocusFirstField(mainRef, [location.pathname])
  const isAdmin = user?.user_code?.toUpperCase() === 'ADMIN'

  useEffect(() => {
    getMenu()
      .then(setMenu)
      .catch(() => setMenu([]))
  }, [])

  // "/" opens universal search, unless the user is actually typing
  // somewhere (a real input/textarea/contenteditable) — never hijacks
  // normal form entry.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== '/' || searchOpen) return
      const tag = document.activeElement?.tagName
      const editable = document.activeElement?.isContentEditable
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return
      e.preventDefault()
      setSearchOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [searchOpen])

  const grouped = TYPE_ORDER.map((type) => ({ type, items: menu.filter((m) => m.type === type) })).filter(
    (g) => g.items.length
  )

  // Auto-expand whichever group holds the active route (e.g. landing on a
  // Masters screen via a bookmark/search), without collapsing any group the
  // user already opened by hand.
  useEffect(() => {
    const active = grouped.find((g) => g.items.some((item) => isCurrentPath(routeFor(item))))
    if (active) setOpenGroups((prev) => (prev.has(active.type) ? prev : new Set(prev).add(active.type)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, menu])

  function toggleGroup(type) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const searchItems = [
    ...menu
      .map((item) => ({ caption: item.caption, to: routeFor(item), group: item.type }))
      .filter((it) => it.to),
    ...EXTRA_SEARCH_LINKS.filter((l) => !l.adminOnly || isAdmin),
  ]

  function isCurrentPath(to) {
    return to && (location.pathname === to || location.pathname.startsWith(`${to}/`))
  }

  return (
    <AppShell
      header={{ height: 108 }}
      navbar={{ width: 272, breakpoint: 'sm', collapsed: { mobile: !opened, desktop: !opened } }}
      padding="md"
    >
      <AppShell.Header
        style={{
          background: 'var(--mantine-color-kumkum-0)',
          borderBottom: '1px solid var(--mantine-color-kumkum-1)',
        }}
      >
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} color="var(--mantine-color-kumkum-7)" size="sm" />
            <img src={BRAND_LOCKUP} alt="e-Mandira Pranali" style={{ height: 92, width: 'auto', objectFit: 'contain', display: 'block' }} />
          </Group>
          {/* Full search pill from tablet up; icon-only trigger below that so the
              header never forces horizontal scroll on a phone-width viewport
              (burger + logo + FY badge + avatar already claim most of 375px). */}
          <Group gap="sm" wrap="nowrap" visibleFrom="sm" style={{ flex: 1, maxWidth: 420, marginInline: 'auto' }}>
            <Group
              gap="xs"
              wrap="nowrap"
              onClick={() => setSearchOpen(true)}
              style={{
                cursor: 'pointer',
                flex: 1,
                background: '#fff',
                border: '1px solid var(--mantine-color-kumkum-1)',
                borderRadius: 999,
                padding: '8px 14px',
              }}
            >
              <Search size={15} color="var(--mantine-color-kumkum-6)" />
              <Text size="sm" c="dimmed">
                Search screens...
              </Text>
              <Kbd size="xs" ml="auto">
                /
              </Kbd>
            </Group>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <ActionIcon
              hiddenFrom="sm"
              variant="subtle"
              color="kumkum"
              size="lg"
              aria-label="Search screens"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={18} />
            </ActionIcon>
            {/* Developer-only data-source switch — never saves anything while
                on Demo Data, see src/lib/demoAuth.js + api.js. */}
            <Menu position="bottom-end" withArrow>
              <Menu.Target>
                <Badge
                  color={isDemoMode() ? 'gold' : 'teal'}
                  variant={isDemoMode() ? 'filled' : 'light'}
                  radius="xl"
                  c={isDemoMode() ? '#3A2A0A' : undefined}
                  leftSection={<FlaskConical size={11} />}
                  visibleFrom="xs"
                  style={{ cursor: 'pointer' }}
                >
                  {isDemoMode() ? 'Demo Data' : 'Real Data'}
                </Badge>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Data source</Menu.Label>
                {isDemoMode() ? (
                  <Menu.Item onClick={exitDemoMode}>Switch to Real Data (sign in again)</Menu.Item>
                ) : (
                  <Menu.Item onClick={enterDemoMode}>Switch to Demo Data (offline preview)</Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
            <Badge color="gold" variant="light" radius="xl" c="#876428" visibleFrom="xs">
              FY 2026-27
            </Badge>
            <Menu position="bottom-end" withArrow>
              <Menu.Target>
                <Avatar radius="xl" color="kumkum" style={{ cursor: 'pointer' }}>
                  {(user?.user_code || '?').slice(0, 2).toUpperCase()}
                </Avatar>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{user?.user_name}</Menu.Label>
                <Menu.Item
                  onClick={() => {
                    // Signing out of a demo session must also drop the demo-mode
                    // flag — otherwise a real login right after would still have
                    // every request intercepted as fake (api.js checks the flag,
                    // not which session is active).
                    if (isDemoMode()) return exitDemoMode()
                    logout()
                    navigate('/login')
                  }}
                >
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar
        className="vt-side"
        style={{
          background: 'linear-gradient(180deg, #7A1F1F 0%, #6B1A1A 100%)',
          display: 'flex',
          flexDirection: 'column',
          border: 'none',
        }}
      >
        <Group px="md" py="md" wrap="nowrap" gap="sm">
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: '#fff',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            <img src={BRAND_MARK} alt="" aria-hidden style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div>
            <Text fw={700} c="white" size="lg" lh={1.15} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              vTemple
            </Text>
            <Text size="xs" c="kumkum.1">
              e-Mandira Pranali
            </Text>
          </div>
        </Group>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0.65rem' }}>
          <div style={{ marginBottom: 8 }}>
            {/* Dashboard (App.jsx's "/" route) and Reports (the report launcher)
                aren't individual MstMenu rows in the legacy app — not
                metadata-driven like the rest of the tree below. */}
            <NavLink
              component={Link}
              to="/"
              label="Dashboard"
              active={location.pathname === '/'}
              leftSection={<LayoutDashboard size={16} />}
            />
            <NavLink
              component={Link}
              to="/reports"
              label="Reports"
              active={isCurrentPath('/reports')}
              leftSection={<BarChart3 size={16} />}
            />
          </div>
          {grouped.map((g) => {
            const isOpen = openGroups.has(g.type)
            return (
              <div key={g.type} style={{ marginBottom: 8 }}>
                <UnstyledButton onClick={() => toggleGroup(g.type)} w="100%" px="xs" pt="sm" pb={4}>
                  <Group justify="space-between" wrap="nowrap" gap={4}>
                    <Text size="xs" fw={600} c="kumkum.1" tt="uppercase" style={{ letterSpacing: 0.8 }}>
                      {g.type}
                    </Text>
                    <ChevronDown
                      size={12}
                      color="var(--mantine-color-kumkum-1)"
                      style={{ opacity: 0.6, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
                    />
                  </Group>
                </UnstyledButton>
                <Collapse in={isOpen}>
                  {g.items.map((item) => {
                    const to = routeFor(item)
                    return (
                      <NavLink
                        key={item.menu_item_id}
                        component={Link}
                        to={to || '#'}
                        label={item.caption}
                        disabled={!to}
                        active={isCurrentPath(to)}
                      />
                    )
                  })}
                </Collapse>
              </div>
            )
          })}
          {user?.user_code?.toUpperCase() === 'ADMIN' && (
            <div style={{ marginBottom: 8 }}>
              {/* Stock Adjustment / Store Issue / Purchase Bill / BOM are MenuShow='N'
                  in the legacy app (hidden, zero real usage) — built per explicit
                  request but deliberately not injected into the metadata-driven tree
                  above; ADMIN-only here so they don't clutter daily staff use. */}
              <UnstyledButton onClick={() => toggleGroup('Inventory')} w="100%" px="xs" pt="sm" pb={4}>
                <Group justify="space-between" wrap="nowrap" gap={4}>
                  <Text size="xs" fw={600} c="kumkum.1" tt="uppercase" style={{ letterSpacing: 0.8 }}>
                    Inventory
                  </Text>
                  <ChevronDown
                    size={12}
                    color="var(--mantine-color-kumkum-1)"
                    style={{ opacity: 0.6, transform: openGroups.has('Inventory') ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
                  />
                </Group>
              </UnstyledButton>
              <Collapse in={openGroups.has('Inventory')}>
                <NavLink component={Link} to="/inventory/stock-adjustment" label="Stock Adjustment Entry" active={isCurrentPath('/inventory/stock-adjustment')} />
                <NavLink component={Link} to="/inventory/store-issue" label="Store Issue Note" active={isCurrentPath('/inventory/store-issue')} />
                <NavLink component={Link} to="/inventory/purchase-bill" label="Purchase Bill" active={isCurrentPath('/inventory/purchase-bill')} />
                <NavLink component={Link} to="/inventory/bom" label="Bill of Material" active={isCurrentPath('/inventory/bom')} />
              </Collapse>
            </div>
          )}
          {user?.user_code?.toUpperCase() === 'ADMIN' && (
            <div style={{ marginBottom: 8 }}>
              <Text size="xs" fw={600} c="kumkum.1" tt="uppercase" px="xs" pt="sm" style={{ letterSpacing: 0.8 }}>
                Administration
              </Text>
              <NavLink
                component={Link}
                to="/settings/admin-master"
                label="Admin Master"
                active={isCurrentPath('/settings/admin-master')}
                leftSection={<SlidersHorizontal size={16} />}
              />
            </div>
          )}
        </div>

        {/* Softvent brand footer, styled like the reference's translucent "help" card. */}
        <Stack gap={6} align="center" py="md" px="xs" mx="xs" mb="xs" style={{ borderRadius: 16, background: 'rgba(255,255,255,0.1)' }}>
          <Text size="10px" fw={700} c="kumkum.1" tt="uppercase" style={{ letterSpacing: 0.6 }}>
            Designed &amp; Developed by
          </Text>
          <div style={{ background: '#fff', borderRadius: 8, padding: '6px 14px', display: 'inline-flex' }}>
            <img src="/softvent-logo-new.png" alt="Softvent" style={{ height: 22, width: 'auto', objectFit: 'contain', display: 'block' }} />
          </div>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main ref={mainRef} style={{ background: TOKENS.sandal }}>
        <Outlet />
      </AppShell.Main>
      <GlobalSearch opened={searchOpen} onClose={() => setSearchOpen(false)} items={searchItems} />
      <style>{`
        .vt-side .mantine-NavLink-root {
          border-radius: 999px;
          color: rgba(255,255,255,0.92);
          font-weight: 500;
          margin-bottom: 2px;
          transition: background .15s, color .15s;
        }
        .vt-side .mantine-NavLink-root:hover {
          background: rgba(255,255,255,0.12);
        }
        .vt-side .mantine-NavLink-root[data-active] {
          background: #fff;
          color: var(--mantine-color-kumkum-7);
          font-weight: 700;
        }
        .vt-side .mantine-NavLink-root[data-active]:hover {
          background: #fff;
        }
        .vt-side .mantine-NavLink-section {
          color: inherit;
        }
        .vt-side .mantine-NavLink-root[data-disabled] {
          color: rgba(255,255,255,0.35);
        }
      `}</style>
    </AppShell>
  )
}
