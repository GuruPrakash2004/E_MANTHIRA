import { Card, Group, Stack, Tabs, Text, Title } from '@mantine/core'
import { SlidersHorizontal, University, Database, Printer, Settings, ShieldLock, Import, Users } from 'lucide-react'
import BulkUpdateTab from './BulkUpdateTab'
import CompanyMasterTab from './CompanyMasterTab'
import GlobalSettingsTab from './GlobalSettingsTab'
import MenuSettingsPage from './MenuSettingsPage'
import RolesRightsTab from './RolesRightsTab'
import UsersTab from './UsersTab'
import PrintOptionsTab from './PrintOptionsTab'
import DatabaseSettingsPanel from '../../components/DatabaseSettingsPanel'
import LocalPrinterSetting from '../../components/LocalPrinterSetting'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

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
export default function AdminMasterPage() {
  return (
    <Stack>
      <Group gap="sm">
        <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
        <div>
          <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
            Admin Master
          </Title>
          <Text size="sm" c="dimmed">
            Users, roles and structured permissions, menu visibility, global settings.
          </Text>
        </div>
      </Group>

      <Tabs defaultValue="users" color="kumkum" keepMounted={false}>
        <Tabs.List>
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
          <Tabs.Tab value="company" leftSection={<University size={16} />}>
            Company Master
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
          <Tabs.Tab value="print-settings" leftSection={<Printer size={16} />}>
            Print Settings
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
        <Tabs.Panel value="company" pt="md">
          <CompanyMasterTab />
        </Tabs.Panel>
        <Tabs.Panel value="bulk-update" pt="md">
          <BulkUpdateTab />
        </Tabs.Panel>
        <Tabs.Panel value="database" pt="md">
          <Card withBorder radius="lg" p="lg" maw={460}>
            <DatabaseSettingsPanel />
          </Card>
        </Tabs.Panel>
        <Tabs.Panel value="print-options" pt="md">
          <PrintOptionsTab />
        </Tabs.Panel>
        <Tabs.Panel value="print-settings" pt="md">
          <Card withBorder radius="lg" p="lg" maw={520}>
            <Text size="sm" c="dimmed" mb="md">
              This PC's own printers (USB or network), used for direct, silent printing from this browser — see the
              Print Agent panel in any Print dialog for the per-document version of this.
            </Text>
            <LocalPrinterSetting />
          </Card>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
