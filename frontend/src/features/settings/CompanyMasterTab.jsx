import { useEffect, useState } from 'react'
import { Badge, Button, Card, Grid, Group, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { Plus } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import dayjs from 'dayjs'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as companyApi from '../../api/endpoints/company'

const EMPTY = {
  CompName: '', Address1: '', Address2: '', Address3: '', Address4: '', Address5: '',
  Custcode: '', EMAIL: '', MOBNO: '', PANNO: '', WEB: '', GSTNO: '', CompLoc: '', CINNO: '', TELNO: '', DashBoardLink: '',
}

export default function CompanyMasterTab() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [newFrom, setNewFrom] = useState(null)
  const [newTo, setNewTo] = useState(null)

  const { data } = useQuery({ queryKey: ['company'], queryFn: companyApi.getCompany })
  const { data: years, refetch: refetchYears } = useQuery({ queryKey: ['company-fy'], queryFn: companyApi.listFinancialYears })

  useEffect(() => {
    if (data) setForm({ ...EMPTY, ...data })
  }, [data])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function onSave() {
    setSaving(true)
    try {
      await companyApi.updateCompany(form)
      notifications.show({ message: 'Company details saved', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['company'] })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  async function onAddYear() {
    if (!newFrom || !newTo) return
    try {
      await companyApi.addFinancialYear(dayjs(newFrom).format('YYYY-MM-DD'), dayjs(newTo).format('YYYY-MM-DD'))
      notifications.show({ message: 'Financial year added', color: 'teal' })
      setNewFrom(null)
      setNewTo(null)
      refetchYears()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not add financial year', color: 'red' })
    }
  }

  async function onSetActive(fromDate) {
    if (!window.confirm(`Make ${dayjs(fromDate).format('DD/MM/YYYY')} the active financial year for the whole app?`)) return
    try {
      await companyApi.setActiveFinancialYear(dayjs(fromDate).format('YYYY-MM-DD'))
      notifications.show({ message: 'Active financial year updated', color: 'teal' })
      refetchYears()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not set active year', color: 'red' })
    }
  }

  return (
    <Stack>
      <Card withBorder radius="lg" p="lg" shadow="sm">
        <Title order={5} mb="md" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
          Company Info
        </Title>
        <Grid>
          <Grid.Col span={12}>
            <TextInput label="Company / Trust Name" required value={form.CompName} onChange={(e) => set('CompName', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={6}>
            <TextInput label="Address 1" value={form.Address1} onChange={(e) => set('Address1', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={6}>
            <TextInput label="Address 2" value={form.Address2} onChange={(e) => set('Address2', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput label="Address 3" value={form.Address3} onChange={(e) => set('Address3', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput label="Address 4" value={form.Address4} onChange={(e) => set('Address4', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput label="Address 5" value={form.Address5} onChange={(e) => set('Address5', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput label="Phone" value={form.TELNO} onChange={(e) => set('TELNO', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput label="Mobile" value={form.MOBNO} onChange={(e) => set('MOBNO', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput label="Email" value={form.EMAIL} onChange={(e) => set('EMAIL', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput label="Website" value={form.WEB} onChange={(e) => set('WEB', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput label="PAN No" value={form.PANNO} onChange={(e) => set('PANNO', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput label="GST No" value={form.GSTNO} onChange={(e) => set('GSTNO', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput label="CIN No" value={form.CINNO} onChange={(e) => set('CINNO', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput label="Customer Code" value={form.Custcode} onChange={(e) => set('Custcode', e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={8}>
            <TextInput label="Dashboard Link" value={form.DashBoardLink} onChange={(e) => set('DashBoardLink', e.currentTarget.value)} />
          </Grid.Col>
        </Grid>
        <Group justify="flex-end" mt="md">
          <Button color="kumkum" loading={saving} onClick={onSave}>
            Save
          </Button>
        </Group>
      </Card>

      <Card withBorder radius="lg" p="lg" shadow="sm">
        <Title order={5} mb="md" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
          Financial Year(s)
        </Title>
        <Table mb="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>From</Table.Th>
              <Table.Th>To</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th w={140}></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(years || []).map((y) => (
              <Table.Tr key={y.yrFdate}>
                <Table.Td>{dayjs(y.yrFdate).format('DD/MM/YYYY')}</Table.Td>
                <Table.Td>{dayjs(y.yrTdate).format('DD/MM/YYYY')}</Table.Td>
                <Table.Td>
                  {y.Active === 'Y' ? (
                    <Badge color="teal" variant="light">
                      Active
                    </Badge>
                  ) : (
                    <Badge color="gray" variant="light">
                      Inactive
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  {y.Active !== 'Y' && (
                    <Button size="xs" variant="light" color="kumkum" onClick={() => onSetActive(y.yrFdate)}>
                      Make Active
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Group align="end">
          <DateInput label="New FY From" value={newFrom} onChange={setNewFrom} />
          <DateInput label="New FY To" value={newTo} onChange={setNewTo} />
          <Button leftSection={<Plus size={16} />} variant="light" color="kumkum" onClick={onAddYear}>
            Add Financial Year
          </Button>
        </Group>
        <Text size="xs" c="dimmed" mt="xs">
          "Make Active" changes the whole app's default financial year — used at year-end rollover.
        </Text>
      </Card>
    </Stack>
  )
}
