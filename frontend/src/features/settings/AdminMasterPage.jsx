import { useSearchParams } from 'react-router-dom'
import { Card, Stack, Tabs, Text } from '@mantine/core'
import { SlidersHorizontal, Database, Printer, Monitor, Settings, ShieldLock, Import, Users, Mail } from 'lucide-react'
import BulkUpdateTab from './BulkUpdateTab'
import EmailSettingsTab from './EmailSettingsTab'
import GlobalSettingsTab from './GlobalSettingsTab'
import MenuSettingsPage from './MenuSettingsPage'
import RolesRightsTab from './RolesRightsTab'
import UsersTab from './UsersTab'
import PrintOptionsTab from './PrintOptionsTab'
import UtilityBanner from '../../components/ui/UtilityBanner'
import * as dbSettingsApi from '../../api/endpoints/dbSettings'
import { useQuery } from '@tanstack/react-query'
import DatabaseSettingsPanel from '../../components/DatabaseSettingsPanel'
import LocalPrinterSetting from '../../components/LocalPrinterSetting'
import { PageHeader } from '../../components/ui/EntryParts'

/**
 * Single admin home for Users, Roles & Rights, menu visibility and Global
 * Settings — mirrors the Softvent admin screen layout (Users / Roles &
 * rights tabs under one "Admin Master" page). NOTE: there is no "Doc
 * Designer" concept in vTemple7.exe itself — `UtlDocDsgrFlds` (screen field
 * definitions) is edited by a separate companion tool, `vFactIC
 * Designer.exe`, not by the temple-management app. That tab was removed;
 * the metadata it read is still used read-only to drive real forms (see
 * MasterPage.jsx's extra designer fields), just never exposed here as an
 * editable screen.
 */
const TAB_IDS = ['users', 'roles', 'menu', 'global-settings', 'bulk-update', 'database', 'print-options', 'print-settings', 'email']

export default function AdminMasterPage() {
  // ?tab=<id> deep-links to one tab (used by the header search); no param = Users.
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  const tab = TAB_IDS.includes(requested) ? requested : 'users'
  return (
    <Stack gap="lg" className="vt-rise">
      <PageHeader title="Admin Master" subtitle="Users, roles and permissions, menu, global settings, printing and database." shortcuts={[]} />

      <Tabs value={tab} onChange={(v) => setSearchParams(v === 'users' ? {} : { tab: v }, { replace: true })} color="kumkum" keepMounted={false}>
        <Tabs.List className="vt-admin-tabs" aria-label="Administration sections">
          <Tabs.Tab value="users" leftSection={<Users size={16} />}>
            Users
          </Tabs.Tab>
          <Tabs.Tab value="roles" leftSection={<ShieldLock size={16} />}>
            Roles &amp; Rights
          </Tabs.Tab>
          <Tabs.Tab value="menu" leftSection={<SlidersHorizontal size={16} />}>
            Customise Menu
          </Tabs.Tab>
          <Tabs.Tab value="global-settings" leftSection={<Settings size={16} />}>
            Global Settings
          </Tabs.Tab>
          <Tabs.Tab value="bulk-update" leftSection={<Import size={16} />}>
            Bulk Update
          </Tabs.Tab>
          <Tabs.Tab value="database" leftSection={<Database size={16} />}>
            Database
          </Tabs.Tab>
          <Tabs.Tab value="print-options" leftSection={<Printer size={16} />}>
            Print Options
          </Tabs.Tab>
          <Tabs.Tab value="print-settings" leftSection={<Monitor size={16} />}>
            Print Settings
          </Tabs.Tab>
          <Tabs.Tab value="email" leftSection={<Mail size={16} />}>
            Email (SMTP)
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="users" pt="md">
          <UsersTab />
        </Tabs.Panel>
        <Tabs.Panel value="roles" pt="md">
          <RolesRightsTab />
        </Tabs.Panel>
        <Tabs.Panel value="menu" pt="md">
          <MenuSettingsPage />
        </Tabs.Panel>
        <Tabs.Panel value="global-settings" pt="md">
          <GlobalSettingsTab />
        </Tabs.Panel>
        <Tabs.Panel value="bulk-update" pt="md">
          <BulkUpdateTab />
        </Tabs.Panel>
        <Tabs.Panel value="database" pt="md">
          <DatabaseTab />
        </Tabs.Panel>
        <Tabs.Panel value="email" pt="md">
          <EmailSettingsTab />
        </Tabs.Panel>
        <Tabs.Panel value="print-options" pt="md">
          <PrintOptionsTab />
        </Tabs.Panel>
        <Tabs.Panel value="print-settings" pt="md">
          <Card withBorder p="lg" maw={520}>
            <Text size="sm" c="dimmed" mb="md">
              This PC's own printers (USB or network), used for direct, silent printing from this browser. The Print Agent
              panel in any Print dialog has the per-document version of this.
            </Text>
            <LocalPrinterSetting />
          </Card>
        </Tabs.Panel>
      </Tabs>
      <style>{`
        .vt-admin-tabs { flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
        .vt-admin-tabs .mantine-Tabs-tab { white-space: nowrap; min-height: 44px; flex-shrink: 0; padding-inline: 12px; }
      `}</style>
    </Stack>
  )
}

/** Database Connectivity (legacy dialog): which SQL Server / database the app is on now, and the form to repoint it. */
function DatabaseTab() {
  const { data } = useQuery({ queryKey: ['db-settings'], queryFn: dbSettingsApi.getDbSettings })
  return (
    <Stack gap="lg">
      <UtilityBanner
        title="Database Connectivity"
        subtitle="Connect the app to a SQL Server database."
        heading={data?.db_name || 'Database'}
        sub="Connected database"
        facts={[{ label: 'server', value: data?.db_server ? `${data.db_server}${data.db_port ? `:${data.db_port}` : ''}` : '-', text: true }]}
        emblem={<Database size={60} color="#F4E1A6" strokeWidth={1.4} />}
      />
      <Card withBorder p="lg" maw={520}>
        <DatabaseSettingsPanel />
      </Card>
    </Stack>
  )
}
