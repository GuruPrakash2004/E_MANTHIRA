import { useEffect, useRef, useState } from 'react'
import { AppShell, Burger, Collapse, Group, NavLink, Text, Menu, Avatar, Badge, Stack, ActionIcon, Tooltip, UnstyledButton } from '@mantine/core'
import { SlidersHorizontal, Calculator, ChevronDown, Database, FileText, FlaskConical, LayoutDashboard, LogOut, Package, Receipt, Search, Star, Wallet, Wrench, X } from 'lucide-react'
import { useDisclosure, useMediaQuery } from '@mantine/hooks'
import useFavourites from '../hooks/useFavourites'
import { Suspense } from 'react'
import { Loader, Center } from '@mantine/core'
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { getMenu } from '../api/endpoints/meta'
import { useAuth } from '../hooks/useAuth'
import useAutoFocusFirstField from '../hooks/useAutoFocusFirstField'
import DevotionalBackdrop from './DevotionalBackdrop'
import PaletteSwitch from './PaletteSwitch'
import ShineLogo from './ShineLogo'
import ThemeToggle from './ThemeToggle'
import GlobalSearch from './GlobalSearch'
import { isDemoMode } from '../lib/demoMode'
import { useConfirm } from './ui/ConfirmProvider'
import { AnimatePresence, motion } from 'framer-motion'
import { lazy } from 'react'
const WelcomeSplash = lazy(() => import('./WelcomeSplash'))
import { enterDemoMode, exitDemoMode } from '../lib/demoAuth'

// Transparent cutouts of the official logo (logo/primary-logo@2x.png), made with Pillow:
// lockup-horizontal (header), lockup-transparent (vertical), lockup-light (vertical, for dark
// panels), mark (badge only), plus public/favicon.png.
const BRAND_LOCKUP = '/brand/lockup-horizontal.png' // badge + "e-Mandira PRANALI" wordmark, side by side

// One icon per sidebar group so the list can be scanned without reading every heading.
const GROUP_ICON = { Transactions: Receipt, Vouchers: Wallet, Masters: Database, Reports: FileText, 'Ac-Reports': Calculator, Accounting: Calculator, Utilities: Wrench, Inventory: Package, Administration: SlidersHorizontal }

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
  'Expense Entry': '/expenses',
  'Journal Voucher': '/vouchers/journal',
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
  'Global Settings...': '/settings/admin-master?tab=global-settings',
  'Security': '/settings/admin-master?tab=users', // DocID 18 = User Master (legacy FRMUSERRIGHTS)
  'Bulk Master Update': '/settings/admin-master?tab=bulk-update',
  'General Ledger': '/reports?tab=general-ledger',
  'Stock Level Report': '/reports/stock-level',
  'Stock Ageing Report': '/reports/stock-ageing',
  'Stock Ageing': '/reports/stock-ageing',
  'Customer Wise Outstanding': '/reports/party-outstanding?party=C',
  'Audit Log': '/audit-log',
  'Database Connectivity': '/settings/admin-master?tab=database',
  'Daily Sales Report': '/reports/daily-sales',
  'Product Sales Summary Report': '/reports/product-sales',
  'Profit Margin': '/not-in-web?c=Profit%20Margin',
  'Label Printing': '/not-in-web?c=Label%20Printing',
  'Authorise Documents': '/utilities/authorise',
  'ShortClosedFields': '/not-in-web?c=ShortClosedFields',
  'ShortClose Documents': '/utilities/shortclose',
  'Screen Docs': '/utilities/screen-docs',
  'Post Doc Entry': '/not-in-web?c=Post%20Doc%20Entry',
  'Shared Documents': '/not-in-web?c=Shared%20Documents',
  'Reminder Alert': '/not-in-web?c=Reminder%20Alert',
  'Barcode Layout Format': '/not-in-web?c=Barcode%20Layout%20Format',
  'Barcode Ammendment': '/not-in-web?c=Barcode%20Ammendment',
  'Voice Command Alternatives': '/not-in-web?c=Voice%20Command%20Alternatives',
  'Import Legacy Data': '/not-in-web?c=Import%20Legacy%20Data',
  'DOWNLOAD LATEST EXE': '/not-in-web?c=DOWNLOAD%20LATEST%20EXE',
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
// Everything the header search can open, on top of the metadata menu: report tabs, every Admin Master tab, the
// inventory screens and the utility pages. `keywords` lets people find a screen by what it does, not only its name.
// Entries whose route the menu already provides are skipped (see searchItems).
const EXTRA_SEARCH_LINKS = [
  { caption: 'Dashboard', to: '/', group: 'Home', keywords: 'home overview today summary' },
  { caption: 'Seva Entry', to: '/sevas', group: 'Transactions', keywords: 'book seva devotee receipt' },
  { caption: 'Donation Receipt Entry', to: '/donations', group: 'Transactions', keywords: 'kanike donor' },
  { caption: 'Hall Booking', to: '/halls', group: 'Transactions', keywords: 'kalyana mantapa reserve' },
  { caption: 'Hall Booking Entry', to: '/halls/entry', group: 'Transactions', keywords: 'hall bill advance' },
  { caption: 'Expense Entry', to: '/expenses', group: 'Transactions', keywords: 'expenditure spend cost payment' },
  { caption: 'Hall Status', to: '/halls/status', group: 'Transactions', keywords: 'availability calendar occupancy' },
  { caption: 'Payment Voucher', to: '/vouchers/payment', group: 'Vouchers', keywords: 'expense pay' },
  { caption: 'Receipt Voucher', to: '/vouchers/receipt', group: 'Vouchers', keywords: 'income receive' },
  { caption: 'Journal Voucher', to: '/vouchers/journal', group: 'Vouchers', keywords: 'adjustment transfer non-cash' },
  { caption: 'Panchanga', to: '/panchanga', group: 'Utilities', keywords: 'calendar tithi festival amavasya ekadashi' },
  { alias: true, caption: 'Display Board', to: '/display', group: 'Utilities', keywords: 'display in browser screen tv' },
  { caption: 'Reports', to: '/reports', group: 'Reports', keywords: 'report launcher' },
  { alias: true, caption: 'Complete Day Report', to: '/reports', group: 'Reports', keywords: 'daily day collection' },
  { caption: 'Detailed Collection Report', to: '/reports?tab=collection', group: 'Reports', keywords: 'collection' },
  { caption: 'Seva Issue / Schedule Report', to: '/reports?tab=seva-issue', group: 'Reports', keywords: 'seva schedule issue' },
  { caption: 'Kanike / Donation Report', to: '/reports?tab=donations', group: 'Reports', keywords: 'kanike donation' },
  { caption: 'General Ledger', to: '/reports?tab=general-ledger', group: 'Reports', keywords: 'ledger account statement' },
  { caption: 'Customised Reports', to: '/reports?tab=custom', group: 'Reports', keywords: 'custom report builder' },
  { caption: 'Hall Booking with Voucher Detail Report', to: '/reports?tab=hall-voucher', group: 'Reports', keywords: 'hall voucher' },
  { caption: 'Subsidiary Reports', to: '/reports?tab=catalog', group: 'Reports', keywords: 'catalog subsidiary' },
  { caption: 'PDF Generator', to: '/reports/pdf-generator', group: 'Reports', keywords: 'pdf bulk receipts print' },
  { caption: 'Audit Trail', to: '/audit-trail', group: 'Administration', adminOnly: true, keywords: 'log history who changed' },
  { caption: 'Import from Excel', to: '/settings/import-excel', group: 'Administration', adminOnly: true, keywords: 'upload xlsx bulk import' },
  { alias: true, caption: 'Admin Master', to: '/settings/admin-master', group: 'Administration', adminOnly: true, keywords: 'settings administration' },
  { alias: true, caption: 'Users', to: '/settings/admin-master', group: 'Admin Master', adminOnly: true, keywords: 'user accounts password reset add staff' },
  { caption: 'Roles & Rights', to: '/settings/admin-master?tab=roles', group: 'Admin Master', adminOnly: true, keywords: 'permissions security access role' },
  { caption: 'Customise Menu', to: '/settings/admin-master?tab=menu', group: 'Admin Master', adminOnly: true, keywords: 'menu show hide sidebar' },
  { caption: 'Global Settings', to: '/settings/admin-master?tab=global-settings', group: 'Admin Master', adminOnly: true, keywords: 'welcome video options configuration' },
  { caption: 'Bulk Master Update', to: '/settings/admin-master?tab=bulk-update', group: 'Admin Master', adminOnly: true, keywords: 'bulk update masters' },
  { caption: 'Database Settings', to: '/settings/admin-master?tab=database', group: 'Admin Master', adminOnly: true, keywords: 'server connection sql' },
  { caption: 'Email (SMTP) Settings', to: '/settings/admin-master?tab=email', group: 'Admin Master', adminOnly: true, keywords: 'mail smtp password host port approval email' },
  { caption: 'Print Options', to: '/settings/admin-master?tab=print-options', group: 'Admin Master', adminOnly: true, keywords: 'receipt format printer' },
  { caption: 'Print Settings', to: '/settings/admin-master?tab=print-settings', group: 'Admin Master', adminOnly: true, keywords: 'local printer print agent' },
  { caption: 'Stock Adjustment Entry', to: '/inventory/stock-adjustment', group: 'Inventory', adminOnly: true, keywords: 'stock' },
  { caption: 'Store Issue Note', to: '/inventory/store-issue', group: 'Inventory', adminOnly: true, keywords: 'store issue' },
  { caption: 'Purchase Bill', to: '/inventory/purchase-bill', group: 'Inventory', adminOnly: true, keywords: 'purchase supplier' },
  { caption: 'Purchase Voucher', to: '/inventory/purchase-voucher', group: 'Inventory', adminOnly: true, keywords: 'purchase supplier' },
  { caption: 'Bill of Material', to: '/inventory/bom', group: 'Inventory', adminOnly: true, keywords: 'bom components' },
  { caption: 'Current Stock Balance', to: '/inventory/stock-balance', group: 'Inventory', adminOnly: true, keywords: 'stock balance' },
  { caption: 'Stock Balance Report', to: '/inventory/stock-balance-report', group: 'Inventory', adminOnly: true, keywords: 'stock report' },
  { caption: 'Stock Ledger Report', to: '/inventory/stock-ledger-report', group: 'Inventory', adminOnly: true, keywords: 'stock ledger' },
  { caption: 'Item Referencer', to: '/inventory/item-referencer', group: 'Inventory', adminOnly: true, keywords: 'item lookup where used' },
]

function PageFallback() {
  return (
    <Center mih={240} role="status" aria-label="Loading page">
      <Loader color="kumkum" />
    </Center>
  )
}

export default function AppShellLayout() {
  // Phones/tablets (< 768px): nav starts closed and closes after every navigation, so it never covers the page.
  const isNarrow = () => typeof window !== 'undefined' && window.innerWidth < 768
  const [opened, { toggle, close }] = useDisclosure(!isNarrow())
  // Desktop: the burger shrinks the sidebar to an icon rail (remembered in this browser). Phones: it opens/closes the drawer.
  const narrow = useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false })
  // Tablets / small laptops (768-1199px): the sidebar rests as an icon rail so the page keeps its width; the burger
  // opens the full menu as an overlay on top of the page (backdrop, Esc or navigating closes it).
  const medium = useMediaQuery('(min-width: 768px) and (max-width: 1199px)', false, { getInitialValueInEffect: false })
  const [overlay, setOverlay] = useState(false)
  const [railPref, setRailPref] = useState(() => localStorage.getItem('vt-rail') === '1')
  const rail = !narrow && (medium ? !overlay : railPref)
  function toggleNav() {
    if (narrow) return toggle()
    if (medium) return setOverlay((v) => !v)
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
    setOverlay(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])
  useEffect(() => {
    if (!overlay && !(narrow && opened)) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setOverlay(false)
      if (narrow) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlay, narrow, opened, close])
  useEffect(() => {
    if (!medium) setOverlay(false)
  }, [medium])

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

  // The sidebar is built purely from the menu the backend serves (MstMenu): section, sub-group heading and order all
  // come from the data. A `_heading` entry renders as a sub-group label.
  const grouped = []
  ;[...menu]
    .sort((x, y) => (x.section_order ?? 99) - (y.section_order ?? 99))
    .forEach((m) => {
      const label = m.section || m.type
      let g = grouped.find((x) => x.type === label)
      if (!g) {
        g = { type: label, items: [], sub: null }
        grouped.push(g)
      }
      const sub = m.subgroup || ''
      if (sub && sub !== g.sub) g.items.push({ menu_item_id: `h-${label}-${sub}`, caption: sub, _heading: true })
      g.sub = sub
      g.items.push(m)
    })

  // Open the group that holds the active route (landing on a screen via bookmark/search/favourite).
  useEffect(() => {
    let activeType = grouped.find((g) => g.items.some((item) => isCurrentPath(routeFor(item))))?.type
    if (!activeType && isCurrentPath('/settings')) activeType = 'Administration'
    if (activeType) setOpenGroups((prev) => (prev.has(activeType) && prev.size === 1 ? prev : new Set([activeType])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, menu])

  function toggleGroup(type) {
    setOpenGroups((prev) => (prev.has(type) ? new Set() : new Set([type])))
  }

  const extraKeywords = {}
  EXTRA_SEARCH_LINKS.forEach((l) => {
    extraKeywords[l.to] = `${extraKeywords[l.to] || ''} ${l.caption} ${l.keywords || ''}`
  })
  const menuItems = menu
    .map((item) => {
      const to = routeFor(item)
      return { caption: item.caption, to, group: item.type, keywords: extraKeywords[to] }
    })
    .filter((it) => it.to)
  const haveRoute = new Set(menuItems.map((it) => it.to))
  const searchItems = [
    ...menuItems,
    // extras add what the menu lacks: tabs, hidden screens and keywords. A screen the menu already opens is skipped,
    // unless the extra is an `alias` (another name for the same place, e.g. "Users" for Admin Master)
    ...EXTRA_SEARCH_LINKS.filter((l) => (!l.adminOnly || isAdmin) && (l.alias || !haveRoute.has(l.to))),
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
    // a route may carry ?tab=...: the path must match and, if it names a tab, that tab must be the open one
    const matches = (r) => {
      if (!r) return false
      const [path, qs] = r.split('?')
      if (!(location.pathname === path || location.pathname.startsWith(`${path}/`))) return false
      return !qs || new URLSearchParams(location.search).get('tab') === new URLSearchParams(qs).get('tab')
    }
    if (!matches(to)) return false
    return !menu.some((m) => {
      const other = routeFor(m)
      // Reports tabs have no sidebar row of their own (they fold into "Reports"), so they never take the highlight
      return other && other !== to && !other.startsWith('/reports?') && other.length > to.length && matches(other)
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
      navbar={{ width: medium || rail ? 72 : 224, breakpoint: 'sm', collapsed: { mobile: !opened, desktop: false } }}
      padding={{ base: 'sm', sm: 'md' }}
    >
      {/* Header: ivory bar, 80px (was 108px). Brand left, search centre, status + account right. */}
      <AppShell.Header style={{ background: 'var(--vt-header)', borderBottom: '1px solid var(--vt-line)', boxShadow: '0 1px 0 rgba(199,154,61,0.25)' }}>
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
            <Burger opened={narrow ? opened : !rail} onClick={toggleNav} color="var(--vt-accent)" size="md" aria-label={(narrow ? opened : !rail) ? 'Collapse navigation' : 'Expand navigation'} />
            <Link to="/" aria-label="e-Mandira Pranali, go to dashboard" style={{ display: 'flex' }}>
              <ShineLogo imgClassName="vt-brand-logo" wrapClassName="vt-logo-on-light" src={BRAND_LOCKUP} />
              <ShineLogo imgClassName="vt-brand-logo" wrapClassName="vt-logo-on-dark" src={BRAND_LOCKUP.replace('horizontal', 'horizontal-light')} />
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
            <Group visibleFrom="xs" wrap="nowrap"><PaletteSwitch /></Group>
            <ThemeToggle />
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
                  <span className="vt-hide-md">{isDemoMode() ? 'Demo Data' : 'Real Data'}</span>
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
            <Badge color="gold" variant="light" size="lg" c="var(--vt-badge-ink)" visibleFrom="lg">
              FY 2026-27
            </Badge>
            <Tooltip label={user?.user_name || user?.user_code} withArrow>
              <Avatar visibleFrom="xs" radius="xl" color="kumkum" variant="filled" size={40} aria-label={`Signed in as ${user?.user_name || user?.user_code}`}>
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

      {((medium && overlay) || (narrow && opened)) && (
        <motion.div
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          onClick={() => {
            setOverlay(false)
            if (narrow) close()
          }}
          style={{ position: 'fixed', inset: 0, zIndex: 310, background: 'rgba(20,6,6,0.55)', WebkitBackdropFilter: 'blur(2px)', backdropFilter: 'blur(2px)' }}
        />
      )}

      {/* Sidebar: deep maroon (logo colour). Brand lives in the header. Expanded (264px) or icon rail (76px). */}
      <AppShell.Navbar
        className="vt-side"
        aria-label="Main navigation"
        style={{
          background: 'linear-gradient(180deg, var(--vt-g1) 0%, var(--vt-g2d) 100%)',
          display: 'flex',
          flexDirection: 'column',
          border: 'none',
          // overlay menus (tablet expanded, phone drawer) sit above the page and never wider than the screen
          ...(medium && overlay ? { width: 232, zIndex: 320, boxShadow: '8px 0 32px rgba(0,0,0,0.35)' } : {}),
          ...(narrow ? { width: 'min(300px, 86vw)', zIndex: 320, boxShadow: opened ? '8px 0 32px rgba(0,0,0,0.35)' : 'none' } : {}),
        }}
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
                  if (item._heading) return <Menu.Label key={item.menu_item_id}>{item.caption}</Menu.Label>
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
                  <div className="vt-side-sub">
                    {g.items.map((item) =>
                      item._heading ? (
                        <Text key={item.menu_item_id} size="xs" fw={700} c="#D9B9A3" px="xs" pt={8} pb={2} style={{ letterSpacing: 0.4, textTransform: 'uppercase' }}>
                          {item.caption}
                        </Text>
                      ) : (
                        renderItem(routeFor(item), item.caption)
                      )
                    )}
                  </div>
                </Collapse>
              </div>
            ))}

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

        {narrow && (
          <Group justify="center" mx="xs" mb={6} hiddenFrom="xs">
            <PaletteSwitch />
          </Group>
        )}

        {/* Credit card: gold + silver Softvent mark straight on the maroon, no white box. */}
        {!rail && (
          <Stack gap={8} align="center" py="sm" px={4} mx="xs" mb="xs" style={{ borderRadius: 16, background: 'rgba(244,225,166,0.08)', border: '1px solid rgba(244,225,166,0.18)' }}>
            {/* One line (nowrap, tight tracking so it fits the 224px sidebar), logo centred beneath. */}
            <Text fw={600} c="#D9B9A3" tt="uppercase" ta="center" style={{ fontSize: 11, letterSpacing: 0.7, whiteSpace: 'nowrap' }}>
              Designed &amp; developed by
            </Text>
            <a className="vt-softvent-link" href="https://softvent.com" target="_blank" rel="noopener noreferrer" aria-label="Softvent website, opens in a new tab" style={{ display: 'block' }}>
              <img src="/softvent-logo-dark.png" alt="Softvent" style={{ height: 30, width: 'auto', objectFit: 'contain', display: 'block' }} />
            </a>
          </Stack>
        )}
      </AppShell.Navbar>

      <AnimatePresence>{welcome && (
        <Suspense fallback={null}>
          <WelcomeSplash key="welcome" name={user?.user_name || user?.user_code} onDone={() => setWelcome(false)} />
        </Suspense>
      )}</AnimatePresence>
      <AppShell.Main ref={mainRef} className="vt-app-main" data-vt-stage style={{ background: 'var(--vt-sandal)' }}>
        <DevotionalBackdrop />
        {/* each screen eases in; while the welcome video is up the page waits, then rises as the video dissolves */}
        <motion.div
          key={location.pathname}
          style={{ maxWidth: '100rem', marginInline: 'auto' }}
          initial={{ opacity: 0, y: 14 }}
          animate={welcome ? { opacity: 0, y: 14 } : { opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 0.8, 0.3, 1], delay: welcome ? 0 : 0.15 }}
        >
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </motion.div>
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
        .vt-brand-logo { height: 3.75rem; width: auto; object-fit: contain; display: block; }
        @media (max-width: 600px) { .vt-brand-logo { height: 2.75rem; } }
        @media (max-width: 1199px) { .vt-hide-md { display: none; } }
        .vt-shine { flex-shrink: 0; }
        @media (max-width: 480px) { .vt-brand-logo { height: 2.25rem; } }
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
