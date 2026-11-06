import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useEffect, useState } from 'react'
import { Badge, Button, Card, Grid, Group, Select, Stack, Text, Title } from '@mantine/core'
import DataGrid from '../../components/ui/DataGrid'
import { DateInput } from '../../components/ui/AppDates'
import { Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as auditApi from '../../api/endpoints/audit'
import { useAuth } from '../../hooks/useAuth'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

const ACTION_COLORS = { A: 'teal', M: 'saffron', D: 'red', C: 'gray' }

/**
 * Audit Trail — port of the legacy frmRptAuditLog's filters (Entity /
 * Action / User / date range) and columns, reading this app's own
 * WebAuditLog table (the legacy UtlAuditLog lives in a separate database
 * this app doesn't have — see app/core/audit.py and app/api/v1/audit.py).
 */
export default function AuditTrailPage() {
  const { user } = useAuth()
  const isAdmin = user?.user_code?.toUpperCase() === 'ADMIN'

  const [fromDate, setFromDate] = useState(dayjs().subtract(30, 'day').toDate())
  const [toDate, setToDate] = useState(new Date())
  const [entity, setEntity] = useState(null)
  const [action, setAction] = useState(null)
  const [userCode, setUserCode] = useState(null)

  const { data: filters } = useQuery({ queryKey: ['audit-filters'], queryFn: auditApi.getAuditFilters })

  const params = {
    from_date: dayjs(fromDate).format('YYYY-MM-DD'),
    to_date: dayjs(toDate).format('YYYY-MM-DD'),
    entity: entity || undefined,
    action: action || undefined,
    user_code: userCode || undefined,
  }
  const { data: rows, isLoading, refetch } = useQuery({
    queryKey: ['audit-log', params],
    queryFn: () => auditApi.listAuditLog(params),
  })

  useEffect(() => {
    refetch()
  }, [fromDate, toDate, entity, action, userCode])

  const confirm = useConfirm()
  async function onPurge() {
    if (!(await confirm({ title: 'Delete old audit entries?', message: `Every audit log entry before ${dayjs(fromDate).format('DD-MMM-YYYY')} will be deleted. This cannot be undone.`, confirmLabel: 'Delete' }))) return
    try {
      const r = await auditApi.purgeAuditLog(dayjs(fromDate).format('YYYY-MM-DD'))
      notifications.show({ message: `Deleted ${r.deleted} entries`, color: 'teal' })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not purge', color: 'red' })
    }
  }

  return (
    <Stack>
      <Group gap="sm">
        <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
        <div>
          <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
            Audit Trail
          </Title>
          <Text size="sm" c="dimmed">
            Every create, edit, delete and cancel recorded by this app — who did what, and when.
          </Text>
        </div>
      </Group>

      <Card withBorder radius="lg" p="lg">
        <Grid align="flex-end">
          <Grid.Col span={{ base: 6, md: 2 }}>
            <DateInput label="From" value={fromDate} onChange={setFromDate} valueFormat="DD-MMM-YYYY" />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <DateInput label="To" value={toDate} onChange={setToDate} valueFormat="DD-MMM-YYYY" />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <Select label="Entity" data={filters?.entities || []} value={entity} onChange={setEntity} clearable searchable />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <Select
              label="Action"
              data={(filters?.actions || []).map((a) => ({ value: a, label: { A: 'Added', M: 'Modified', D: 'Deleted', C: 'Cancelled' }[a] || a }))}
              value={action}
              onChange={setAction}
              clearable
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <Select label="User" data={filters?.users || []} value={userCode} onChange={setUserCode} clearable searchable />
          </Grid.Col>
          {isAdmin && (
            <Grid.Col span={{ base: 12, md: 2 }}>
              <Button color="red" variant="light" leftSection={<Trash2 size={16} />} onClick={onPurge} fullWidth>
                Purge before From
              </Button>
            </Grid.Col>
          )}
        </Grid>
      </Card>

      <>
        <DataGrid
          name="audit-trail"
          idKey="id"
          loading={isLoading}
          rows={rows || []}
          emptyTitle="No activity in this range"
          maxHeight="65vh"
          columns={[
            { key: 'at', label: 'Date / Time', value: (r) => dayjs(r.at).format('DD-MMM-YYYY HH:mm:ss') },
            { key: 'entity', label: 'Entity' },
            { key: 'action_label', label: 'Action', render: (r) => <Badge size="sm" color={ACTION_COLORS[r.action] || 'gray'} variant="light">{r.action_label}</Badge> },
            { key: 'entity_id', label: 'Entity ID' },
            { key: 'user_code', label: 'User' },
            { key: 'details', label: 'Details' },
          ]}
        />
      </>
    </Stack>
  )
}
