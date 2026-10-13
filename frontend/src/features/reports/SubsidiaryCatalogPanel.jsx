import { useEffect, useState } from 'react'
import { Button, Card, Checkbox, Group, Modal, NumberInput, Select, Skeleton, Stack, Table, Text } from '@mantine/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { KeyRound, LayoutList, Play, Save, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import * as reportsApi from '../../api/endpoints/reports'
import { useAuth } from '../../hooks/useAuth'
import EmptyState from '../../components/ui/EmptyState'

/**
 * Subsidiary Reports (legacy frmRptReport): the reports registered in UtlReports (SlNo, Group, Report No, Report
 * Name), shown only if the user has the right (UtlReportsRights; ADMIN sees all). Double-click a row, or type the
 * Report No and press Load, to open it. ADMIN gets Assign Rights to choose which reports each user sees.
 */
export default function SubsidiaryCatalogPanel({ onOpenTab, tabFor }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.user_code?.toUpperCase() === 'ADMIN'
  const { data: catalog = [], isLoading } = useQuery({ queryKey: ['report-catalog'], queryFn: reportsApi.getReportCatalog })
  const [rptNo, setRptNo] = useState('')
  const [rightsOpen, setRightsOpen] = useState(false)

  function open(r) {
    const tab = tabFor(r.form_name)
    if (!tab) return notifications.show({ message: `"${r.name}" is not available in the web app yet`, color: 'yellow' })
    onOpenTab(tab)
  }
  function onLoad() {
    if (rptNo === '' || rptNo == null) return notifications.show({ message: 'Report no is Empty. Please Enter the Report No.', color: 'red' })
    const r = catalog.find((x) => x.rpt_id === Number(rptNo))
    if (!r) return notifications.show({ message: 'Invalid Report No.', color: 'red' })
    open(r)
  }

  return (
    <Card withBorder p="lg">
      <Stack gap="md">
        <Text size="sm" c="dimmed">Double-click a report, or enter its Report No and press Load.</Text>
        {isLoading ? (
          <Skeleton height={160} radius="md" />
        ) : catalog.length === 0 ? (
          <EmptyState icon={LayoutList} title="No reports available" hint="No subsidiary report is assigned to you. Ask the administrator to assign rights." />
        ) : (
          <Table.ScrollContainer minWidth={520} mah={420} type="native">
            <Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={60}>SlNo</Table.Th>
                  <Table.Th>Group Name</Table.Th>
                  <Table.Th w={110}>Report No.</Table.Th>
                  <Table.Th>Report Name</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {catalog.map((r, i) => (
                  <Table.Tr key={r.rpt_id} style={{ cursor: 'pointer' }} onDoubleClick={() => open(r)} onClick={() => setRptNo(r.rpt_id)}>
                    <Table.Td>{i + 1}</Table.Td>
                    <Table.Td>{r.group}</Table.Td>
                    <Table.Td fw={700}>{r.rpt_id}</Table.Td>
                    <Table.Td>{r.name}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        <Group justify="space-between" align="flex-end" wrap="wrap">
          <Group align="flex-end" gap="sm">
            <NumberInput className="vt-field-required" label="Enter Report No to view" hideControls min={0} allowDecimal={false} value={rptNo} onChange={setRptNo} onKeyDown={(e) => e.key === 'Enter' && onLoad()} w={200} />
            <Button color="kumkum" leftSection={<Play size={16} />} onClick={onLoad}>
              Load
            </Button>
          </Group>
          <Group gap="sm">
            {isAdmin && (
              <Button variant="light" color="kumkum" leftSection={<KeyRound size={16} />} onClick={() => setRightsOpen(true)}>
                Assign Rights
              </Button>
            )}
            <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>
              Close
            </Button>
          </Group>
        </Group>
      </Stack>
      {rightsOpen && <RightsDialog onClose={() => setRightsOpen(false)} />}
    </Card>
  )
}

function RightsDialog({ onClose }) {
  const qc = useQueryClient()
  const { data: users = [] } = useQuery({ queryKey: ['catalog-users'], queryFn: reportsApi.catalogUsers })
  const { data: all = [] } = useQuery({ queryKey: ['report-catalog'], queryFn: reportsApi.getReportCatalog })
  const [userId, setUserId] = useState(null)
  const [sel, setSel] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const { data: current } = useQuery({ queryKey: ['catalog-rights', userId], queryFn: () => reportsApi.catalogRights(userId), enabled: Boolean(userId) })
  useEffect(() => {
    if (current) setSel(new Set(current))
  }, [current])

  async function onSave() {
    setSaving(true)
    try {
      await reportsApi.saveCatalogRights(userId, [...sel])
      qc.invalidateQueries({ queryKey: ['catalog-rights', userId] })
      notifications.show({ message: 'Rights saved', color: 'teal' })
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Could not save', color: 'red' })
    } finally {
      setSaving(false)
    }
  }
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <Modal opened onClose={onClose} size="lg" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Assign Rights</Text>}>
      <Stack gap="sm">
        <Select className="vt-field-required" label="User" required searchable data={users.map((u) => ({ value: String(u.user_id), label: `${u.code} · ${u.name}` }))} value={userId ? String(userId) : null} onChange={(v) => setUserId(v ? Number(v) : null)} />
        {userId && (
          <>
            <Checkbox color="kumkum" label="Select All" checked={all.length > 0 && sel.size === all.length} onChange={(e) => setSel(e.currentTarget.checked ? new Set(all.map((r) => r.rpt_id)) : new Set())} />
            <Table.ScrollContainer minWidth={420} mah={320} type="native">
              <Table highlightOnHover>
                <Table.Tbody>
                  {all.map((r) => (
                    <Table.Tr key={r.rpt_id} style={{ cursor: 'pointer' }} onClick={() => toggle(r.rpt_id)}>
                      <Table.Td w={50}><Checkbox color="kumkum" aria-label={r.name} checked={sel.has(r.rpt_id)} onChange={() => toggle(r.rpt_id)} onClick={(e) => e.stopPropagation()} /></Table.Td>
                      <Table.Td>{r.group}</Table.Td>
                      <Table.Td>{r.name}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </>
        )}
        <Group justify="flex-end">
          <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} disabled={!userId} onClick={onSave}>Save</Button>
          <Button variant="default" onClick={onClose}>Cancel</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
