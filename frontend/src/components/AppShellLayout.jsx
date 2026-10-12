import { useEffect, useRef, useState } from 'react'
import { AppShell, Burger, Collapse, Group, NavLink, Text, Menu, Avatar, Badge, Stack, ActionIcon, Tooltip, UnstyledButton } from '@mantine/core'
import { SlidersHorizontal, Calculator, ChevronDown, Database, FileText, FlaskConical, LayoutDashboard, LogOut, Package, Receipt, Search, Star, Wallet, Wrench, X } from 'lucide-react'
import { useDisclosure, useMediaQuery } from '@mantine/hooks'
import useFavourites from '../hooks/useFavourites'
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { getMenu } from '../api/endpoints/meta'
import { useAuth } from '../hooks/useAuth'
import useAutoFocusFirstField from '../hooks/useAutoFocusFirstField'
import GlobalSearch from './GlobalSearch'
import { TOKENS } from '../theme/theme'
import { isDemoMode } from '../lib/demoMode'
import { useConfirm } from './ui/ConfirmProvider'
import WelcomeSplash from './WelcomeSplash'
import { enterDemoMode, exitDemoMode } from '../lib/demoAuth'

// Transparent cutouts of the official logo (logo/primary-logo@2x.png), made with Pillow:
// lockup-horizontal (header), lockup-transparent (vertical), lockup-light (vertical, for dark
// panels), mark (badge only), plus public/favicon.png.
const BRAND_LOCKUP = '/brand/lockup-horizontal.png' // badge + "e-Mandira PRANALI" wordmark, side by side

// One icon per sidebar group so the list can be scanned without reading every heading.
const GROUP_ICON = { Transactions: Receipt, Vouchers: Wallet, Masters: Database, Reports: FileText, 'Ac-Reports': Calculator, Utilities: Wrench, Inventory: Package, Administration: SlidersHorizontal }

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
  if (item._route) return item._route
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
  // Phones/tablets (< 768px): nav starts closed and closes after every navigation, so it never covers the page.
  const isNarrow = () => typeof window !== 'undefined' && window.innerWidth < 768
  const [opened, { toggle, close }] = useDisclosure(!isNarrow())
  // Desktop: the burger shrinks the sidebar to an icon rail (remembered in this browser). Phones: it opens/closes the drawer.
  const narrow = useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false })
  const [railPref, setRailPref] = useState(() => localStorage.getItem('vt-rail') === '1')
  const rail = railPref && !narrow
  function toggleNav() {
    if (narrow) return toggle()
    setRailPref((v) => {
      localStorage.setItem('vt-rail', v ? '0' : '1')
      return !v
    })
  }
  const [menu, setMenu] = useState([])
  // Search lives in the header. On phones it is collapsed to an icon and expands over the header bar.
  const [mobileSearch, setMobileSearch] = useState(false)
  const searchRef = useRef(null)
  // Accordion: only one group is open at a time, so a long Masters list never pushes the rest off-screen.
  // The effect below opens whichever group holds the current route.
  const [openGroups, setOpenGroups] = useState(() => new Set())
  const { user, logout } = useAuth()
  const confirm = useConfirm()
  // Cinematic welcome, once per sign-in. LoginPage sets the flag; it is cleared in an effect (not in the
  // state initialiser, which React StrictMode runs twice). Skipped entirely for reduced-motion users.
  const [welcome, setWelcome] = useState(
    () => sessionStorage.getItem('vt-welcome') === '1' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    sessionStorage.removeItem('vt-welcome')
  }, [])
  const navigate = useNavigate()
  const location = useLocation()
  const mainRef = useRef(null)

  // Every screen starts with the cursor already in its first field — no
  // page has to wire this itself, see useAutoFocusFirstField.js.
  useAutoFocusFirstField(mainRef, [location.pathname])
  const isAdmin = user?.user_code?.toUpperCase() === 'ADMIN'

  useEffect(() => {
    if (isNarrow()) close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  useEffect(() => {
    getMenu()
      .then(setMenu)
      .catch(() => setMenu([]))
  }, [])

  // "/" jumps to the header search, unless the user is actually typing somewhere (a real
  // input/textarea/contenteditable): never hijacks normal form entry.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== '/') return
      const tag = document.activeElement?.tagName
      const editable = document.activeElement?.isContentEditable
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) return
      e.preventDefault()
      if (isNarrow()) setMobileSearch(true)
      else searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Several legacy Reports menu rows (Subsidiary, Customised, Hall Booking With Voucher Detail) are just tabs of the
  // Reports page. In the sidebar they collapse into one "Reports" entry; search and the menu data still know them all.
  const isReportTab = (item) => (routeFor(item) || '').startsWith('/reports?')
  function sidebarItems(items) {
    const first = items.findIndex(isReportTab)
    if (first < 0) return items
    const out = items.filter((i) => !isReportTab(i))
    out.splice(first, 0, { menu_item_id: 'reports-all', caption: 'Reports', type: items[0].type, _route: '/reports' })
    return out
  }
  const grouped = TYPE_ORDER.map((type) => ({ type, items: type === 'Reports' ? sidebarItems(menu.filter((m) => m.type === type)) : menu.filter((m) => m.type === type) })).filter(
    (g) => g.items.length
  )

  // Open the group that holds the active route (landing on a screen via bookmark/search/favourite).
  useEffect(() => {
    let activeType = grouped.find((g) => g.items.some((item) => isCurrentPath(routeFor(item))))?.type
    if (!activeType && isCurrentPath('/inventory')) activeType = 'Inventory'
    if (!activeType && isCurrentPath('/settings')) activeType = 'Administration'
    if (activeType) setOpenGroups((prev) => (prev.has(activeType) && prev.size === 1 ? prev : new Set([activeType])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, menu])

  function toggleGroup(type) {
    setOpenGroups((prev) => (prev.has(type) ? new Set() : new Set([type])))
  }

  const searchItems = [
    ...menu
      .map((item) => ({ caption: item.caption, to: routeFor(item), group: item.type }))
      .filter((it) => it.to),
    ...EXTRA_SEARCH_LINKS.filter((l) => !l.adminOnly || isAdmin),
  ]

  const { favs, isPinned, toggle: togglePin } = useFavourites(user?.user_code)
  // Drop favourites that are no longer reachable (menu changed, rights changed).
  const validFavs = favs.filter((f) => searchItems.some((it) => it.to === f.to))

  // Sidebar row: the link plus a star to pin/unpin it as a favourite.
  function renderItem(to, caption, { pinnable = true } = {}) {
    return (
      <SideItem key={`${to || ''}|${caption}`} to={to} caption={caption} active={isActiveItem(to, caption)} pinned={isPinned(to)} canPin={pinnable && Boolean(to)} onPin={() => togglePin({ to, caption })} />
    )
  }

  // Signing out asks first; a demo session also drops the demo flag (otherwise a real login right
  // after would still have every request intercepted as fake).
  async function onSignOut() {
    const ok = await confirm({ title: 'Sign out?', message: 'You will need to sign in again to continue.', confirmLabel: 'Sign out' })
    if (!ok) return
    if (isDemoMode()) return exitDemoMode()
    logout()
    navigate('/login')
  }

  // A route is current when it matches the path and no other menu route matches more specifically
  // (so /halls/entry lights up only Hall Booking Entry, not Hall Booking too).
  function isCurrentPath(to) {
    const matches = (r) => r && (location.pathname === r || location.pathname.startsWith(`${r}/`))
    if (!matches(to)) return false
    return !menu.some((m) => {
      const other = routeFor(m)
      return other && other !== to && other.length > to.length && matches(other)
    })
  }

  // Several menu captions can share one screen (Global Settings, Security and Bulk Master Update all open Admin Master):
  // light up only the first of them, not all three.
  function isActiveItem(to, caption) {
    if (!isCurrentPath(to)) return false
    const first = menu.find((m) => routeFor(m) === to)
    return !first || first.caption === caption
  }

  return (
    <AppShell
      header={{ height: 80 }}
      navbar={{ width: rail ? 72 : 224, breakpoint: 'sm', collapsed: { mobile: !opened, desktop: false } }}
      padding={{ base: 'sm', sm: 'md' }}
    >
      {/* Header: ivory bar, 80px (was 108px). Brand left, search centre, status + account right. */}
      <AppShell.Header style={{ background: '#FFFDF8', borderBottom: '1px solid var(--vt-line)', boxShadow: '0 1px 0 rgba(199,154,61,0.25)' }}>
        {mobileSearch && (
          <Group h="100%" px="xs" wrap="nowrap" gap="xs" hiddenFrom="sm">
            <GlobalSearch items={searchItems} autoFocus inputRef={searchRef} onDone={() => setMobileSearch(false)} />
            <ActionIcon variant="subtle" color="kumkum" size={44} aria-label="Close search" onClick={() => setMobileSearch(false)}>
              <X size={20} />
            </ActionIcon>
          </Group>
        )}
        <Group h="100%" px={{ base: 'xs', sm: 'md' }} justify="space-between" wrap="nowrap" gap="sm" display={mobileSearch ? { base: 'none', sm: 'flex' } : undefined}>
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <Burger opened={narrow ? opened : !rail} onClick={toggleNav} color="var(--mantine-color-kumkum-7)" size="md" aria-label={(narrow ? opened : !rail) ? 'Collapse navigation' : 'Expand navigation'} />
            <Link to="/" aria-label="e-Mandira Pranali, go to dashboard" style={{ display: 'flex' }}>
              <img className="vt-brand-logo" src={BRAND_LOCKUP} alt="" />
            </Link>
          </Group>

          {/* Inline search from tablet up (type right in the header, results drop down under it). */}
          <Group visibleFrom="sm" style={{ flex: 1, maxWidth: 460, marginInline: 'auto' }} wrap="nowrap">
            <GlobalSearch items={searchItems} inputRef={searchRef} />
          </Group>

          <Group gap="xs" wrap="nowrap">
            <ActionIcon hiddenFrom="sm" variant="subtle" color="kumkum" size={44} aria-label="Search screens" onClick={() => setMobileSearch(true)}>
              <Search size={20} />
            </ActionIcon>
            {/* Developer-only data-source switch: never saves while on Demo Data (src/lib/demoAuth.js + api.js). */}
            <Menu position="bottom-end" withArrow>
              <Menu.Target>
                <Badge
                  component="button"
                  type="button"
                  color={isDemoMode() ? 'gold' : 'kumkum'}
                  variant={isDemoMode() ? 'filled' : 'light'}
                  size="lg"
                  c={isDemoMode() ? '#3A2A0A' : undefined}
                  leftSection={<FlaskConical size={12} />}
                  visibleFrom="sm"
                  style={{ cursor: 'pointer', border: 'none' }}
                  aria-label="Data source"
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
            <Badge color="gold" variant="light" size="lg" c="#876428" visibleFrom="xs">
              FY 2026-27
            </Badge>
            <Tooltip label={user?.user_name || user?.user_code} withArrow>
              <Avatar radius="xl" color="kumkum" variant="filled" size={40} aria-label={`Signed in as ${user?.user_name || user?.user_code}`}>
                {(user?.user_code || '?').slice(0, 2).toUpperCase()}
              </Avatar>
            </Tooltip>
            <Tooltip label="Sign out" withArrow>
              <ActionIcon variant="light" color="kumkum" size={40} aria-label="Sign out" onClick={onSignOut}>
                <LogOut size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      {/* Sidebar: deep maroon (logo colour). Brand lives in the header. Expanded (264px) or icon rail (76px). */}
      <AppShell.Navbar
        className="vt-side"
        aria-label="Main navigation"
        style={{ background: 'linear-gradient(180deg, #6B1A1A 0%, #3E0E0E 100%)', display: 'flex', flexDirection: 'column', border: 'none' }}
      >
        {rail ? (
          <div className="vt-side-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0.75rem 0.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <RailLink to="/" label="Dashboard" icon={LayoutDashboard} active={location.pathname === '/'} />
            <div className="vt-rail-sep" />
            <RailGroup label="Favourites" icon={Star} active={validFavs.some((f) => isCurrentPath(f.to))}>
              {validFavs.length === 0 && <Menu.Label>Pin screens from the full menu</Menu.Label>}
              {validFavs.map((f) => (
                <Menu.Item key={f.to} component={Link} to={f.to}>
                  {f.caption}
                </Menu.Item>
              ))}
            </RailGroup>
            {grouped.map((g) => (
              <RailGroup key={g.type} label={g.type} icon={GROUP_ICON[g.type]} active={g.items.some((item) => isCurrentPath(routeFor(item)))}>
                {g.items.map((item) => {
                  const to = routeFor(item)
                  return (
                    <Menu.Item key={item.menu_item_id} component={Link} to={to || '#'} disabled={!to}>
                      {item.caption}
                    </Menu.Item>
                  )
                })}
              </RailGroup>
            ))}
            {isAdmin && (
              <RailGroup label="Inventory" icon={Package} active={isCurrentPath('/inventory')}>
                <Menu.Item component={Link} to="/inventory/stock-adjustment">Stock Adjustment Entry</Menu.Item>
                <Menu.Item component={Link} to="/inventory/store-issue">Store Issue Note</Menu.Item>
                <Menu.Item component={Link} to="/inventory/purchase-bill">Purchase Bill</Menu.Item>
                <Menu.Item component={Link} to="/inventory/bom">Bill of Material</Menu.Item>
              </RailGroup>
            )}
            {isAdmin && (
              <RailGroup label="Administration" icon={SlidersHorizontal} active={isCurrentPath('/settings')}>
                <Menu.Item component={Link} to="/settings/admin-master">Admin Master</Menu.Item>
              </RailGroup>
            )}
          </div>
        ) : (
          <div className="vt-side-scroll" style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 0.5rem 0.5rem' }}>
            {/* Dashboard isn't a MstMenu row in the legacy app, so it sits outside the metadata tree (Reports is a normal menu group below). */}
            <div style={{ marginBottom: 8 }}>
              <NavLink component={Link} to="/" label="Dashboard" active={location.pathname === '/'} leftSection={<LayoutDashboard size={17} />} />
            </div>

            {/* Favourites: screens the user pinned with the star on any row below (saved per user, in this browser). */}
            <div style={{ marginBottom: 8 }}>
              <Group gap={10} wrap="nowrap" px="xs" h={32}>
                <Star size={15} color="#F4E1A6" aria-hidden />
                <Text size="sm" fw={700} c="#F4E1A6" style={{ letterSpacing: 0.3 }}>
                  Favourites
                </Text>
              </Group>
              {validFavs.length === 0 ? (
                <Text size="xs" c="#D9B9A3" px="xs" pb={4}>
                  Tap the star next to a screen to pin it here.
                </Text>
              ) : (
                <div className="vt-side-sub">{validFavs.map((f) => renderItem(f.to, f.caption))}</div>
              )}
            </div>

            {grouped.map((g) => (
              <div key={g.type} style={{ marginBottom: 6 }}>
                <GroupHeader
                  label={g.type}
                  open={openGroups.has(g.type)}
                  active={g.items.some((item) => isCurrentPath(routeFor(item)))}
                  onToggle={() => toggleGroup(g.type)}
                />
                <Collapse in={openGroups.has(g.type)}>
                  <div className="vt-side-sub">{g.items.map((item) => renderItem(routeFor(item), item.caption))}</div>
                </Collapse>
              </div>
            ))}

            {isAdmin && (
              <div style={{ marginBottom: 6 }}>
                {/* Stock Adjustment / Store Issue / Purchase Bill / BOM are MenuShow='N' in the legacy app
                    (hidden, zero real usage): built on request, ADMIN-only here so daily staff aren't cluttered. */}
                <GroupHeader label="Inventory" open={openGroups.has('Inventory')} active={isCurrentPath('/inventory')} onToggle={() => toggleGroup('Inventory')} />
                <Collapse in={openGroups.has('Inventory')}>
                  <div className="vt-side-sub">
                    {renderItem('/inventory/stock-adjustment', 'Stock Adjustment Entry')}
                    {renderItem('/inventory/store-issue', 'Store Issue Note')}
                    {renderItem('/inventory/purchase-bill', 'Purchase Bill')}
                    {renderItem('/inventory/bom', 'Bill of Material')}
                  </div>
                </Collapse>
              </div>
            )}
            {isAdmin && (
              <div style={{ marginBottom: 6 }}>
                <GroupHeader label="Administration" open={openGroups.has('Administration')} active={isCurrentPath('/settings')} onToggle={() => toggleGroup('Administration')} />
                <Collapse in={openGroups.has('Administration')}>
                  <div className="vt-side-sub">{renderItem('/settings/admin-master', 'Admin Master')}</div>
                </Collapse>
              </div>
            )}
          </div>
        )}

        {/* Account card: who is signed in. Role names aren't in the session, so ADMIN is the only role shown by name. */}
        <Group
          gap="sm"
          wrap="nowrap"
          justify={rail ? 'center' : 'flex-start'}
          py="xs"
          px={rail ? 0 : 'sm'}
          mx="xs"
          mb={6}
          style={{ borderRadius: 16, background: 'rgba(244,225,166,0.08)', border: '1px solid rgba(244,225,166,0.18)' }}
        >
          <Avatar radius="xl" size={36} color="gold" variant="filled" c="#2B0909" aria-label={`Signed in as ${user?.user_name || user?.user_code}`}>
            {(user?.user_code || '?').slice(0, 2).toUpperCase()}
          </Avatar>
          {!rail && (
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} c="#FBF6EC" truncate>
                {user?.user_name || user?.user_code}
              </Text>
              <Text size="xs" c="#D9B9A3" truncate>
                {isAdmin ? 'Administrator' : `User ${user?.user_code}`}
              </Text>
            </div>
          )}
        </Group>

        {/* Credit card: gold + silver Softvent mark straight on the maroon, no white box. */}
        {!rail && (
          <Stack gap={8} align="center" py="sm" px={4} mx="xs" mb="xs" style={{ borderRadius: 16, background: 'rgba(244,225,166,0.08)', border: '1px solid rgba(244,225,166,0.18)' }}>
            {/* One line (nowrap, tight tracking so it fits the 224px sidebar), logo centred beneath. */}
            <Text fw={600} c="#D9B9A3" tt="uppercase" ta="center" style={{ fontSize: 11, letterSpacing: 0.7, whiteSpace: 'nowrap' }}>
              Designed &amp; developed by
            </Text>
            <img src="/softvent-logo-dark.png" alt="Softvent" style={{ height: 30, width: 'auto', objectFit: 'contain', display: 'block' }} />
          </Stack>
        )}
      </AppShell.Navbar>

      {welcome && <WelcomeSplash name={user?.user_name || user?.user_code} onDone={() => setWelcome(false)} />}
      <AppShell.Main ref={mainRef} style={{ background: TOKENS.sandal }}>
        <Outlet />
      </AppShell.Main>
      <style>{`
        .vt-side .mantine-NavLink-root {
          border-radius: 999px;
          min-height: 40px;
          color: rgba(251,246,236,0.92);
          font-weight: 500;
          margin-bottom: 2px;
          transition: background .15s, color .15s;
        }
        .vt-side .mantine-NavLink-root:hover { background: rgba(244,225,166,0.12); }
        .vt-side .mantine-NavLink-root[data-active] { background: rgba(244,225,166,0.10); color: #F4E1A6; font-weight: 700; box-shadow: inset 3px 0 0 #F4E1A6; }
        .vt-side .mantine-NavLink-root[data-active]:hover { background: rgba(244,225,166,0.16); }
        .vt-side .mantine-NavLink-section { color: inherit; }
        .vt-side .mantine-NavLink-root[data-disabled] { color: rgba(251,246,236,0.38); }
        .vt-side :where(a, button):focus-visible { outline: 2px solid #F4E1A6; outline-offset: 2px; }
        .vt-brand-logo { height: 60px; width: auto; object-fit: contain; display: block; }
        @media (max-width: 600px) { .vt-brand-logo { height: 44px; } }
        .vt-side-scroll { scrollbar-width: thin; scrollbar-color: rgba(244,225,166,0.3) transparent; }
        .vt-side-head { border-radius: 10px; min-height: 40px; transition: background .15s; }
        .vt-side-head[data-active] { background: rgba(244,225,166,0.10); box-shadow: inset 3px 0 0 #F4E1A6; }
        .vt-side-item { position: relative; }
        .vt-side-item .mantine-NavLink-root { padding-right: 34px; padding-left: 10px; font-size: 14px; }
        .vt-pin { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 50%; background: transparent; color: #F4E1A6; cursor: pointer; opacity: 0; transition: opacity .15s, background .15s; }
        .vt-side-item:hover .vt-pin, .vt-side-item:focus-within .vt-pin, .vt-pin[data-pinned] { opacity: 1; }
        .vt-pin:hover { background: rgba(244,225,166,0.2); }
                @media (hover: none) { .vt-pin { opacity: 0.75; } }
        .vt-rail-btn { width: 48px; height: 48px; flex-shrink: 0; display: grid; place-items: center; border-radius: 14px; color: #FBF6EC; transition: background .15s, color .15s; }
        .vt-rail-btn:hover { background: rgba(244,225,166,0.14); }
        .vt-rail-btn[data-active] { background: rgba(244,225,166,0.10); color: #F4E1A6; box-shadow: inset 3px 0 0 #F4E1A6; }
        .vt-rail-sep { width: 28px; height: 1px; background: rgba(244,225,166,0.25); margin: 4px 0; }
        .vt-side-sub { margin: 2px 0 6px 14px; padding-left: 6px; border-left: 1px solid rgba(244,225,166,0.25); }
        .vt-side-head:hover { background: rgba(244,225,166,0.08); }
      `}</style>
    </AppShell>
  )
}

// Collapsible group heading for the sidebar (a real button with aria-expanded, >= 36px tall).
// `active` = the current screen lives inside this group, so it stays visibly marked even when collapsed.
function GroupHeader({ label, open, active, onToggle }) {
  const Icon = GROUP_ICON[label]
  return (
    <UnstyledButton className="vt-side-head" data-active={active || undefined} onClick={onToggle} w="100%" px="xs" aria-expanded={open}>
      <Group justify="space-between" wrap="nowrap" gap={4} h={40}>
        <Group gap={10} wrap="nowrap">
          {Icon && <Icon size={16} color="#F4E1A6" aria-hidden style={{ opacity: active ? 1 : 0.75 }} />}
          <Text size="sm" fw={700} c="#F4E1A6" style={{ letterSpacing: 0.3, opacity: active ? 1 : 0.9 }}>
            {label}
          </Text>
        </Group>
        <ChevronDown size={14} color="#F4E1A6" style={{ opacity: 0.7, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} aria-hidden />
      </Group>
    </UnstyledButton>
  )
}

// Sidebar row: NavLink + a star button (a sibling, not nested in the link) to pin it as a favourite.
function SideItem({ to, caption, active, pinned, canPin, onPin }) {
  return (
    <div className="vt-side-item">
      <NavLink component={Link} to={to || '#'} label={caption} disabled={!to} active={active} />
      {canPin && (
        <button
          type="button"
          className="vt-pin"
          data-pinned={pinned || undefined}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${caption} from favourites` : `Pin ${caption} to favourites`}
          onClick={onPin}
        >
          <Star size={15} fill={pinned ? 'currentColor' : 'none'} aria-hidden />
        </button>
      )}
    </div>
  )
}

// Icon-rail entries: a plain link with a tooltip, and a group that opens its screens in a flyout (hover, click or keyboard).
function RailLink({ to, label, icon: Icon, active }) {
  return (
    <Tooltip label={label} position="right" withArrow>
      <UnstyledButton component={Link} to={to} className="vt-rail-btn" data-active={active || undefined} aria-label={label}>
        <Icon size={20} aria-hidden />
      </UnstyledButton>
    </Tooltip>
  )
}

function RailGroup({ label, icon: Icon, active, children }) {
  return (
    <Menu trigger="click-hover" openDelay={60} closeDelay={160} position="right-start" offset={10} withinPortal shadow="md" width={250}>
      <Menu.Target>
        <UnstyledButton className="vt-rail-btn" data-active={active || undefined} aria-label={label}>
          <Icon size={20} aria-hidden />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{label}</Menu.Label>
        {children}
      </Menu.Dropdown>
    </Menu>
  )
}
