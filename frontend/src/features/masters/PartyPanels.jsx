import { useEffect, useMemo, useRef, useState } from 'react'
import { Autocomplete, Avatar, Button, Checkbox, Group, Modal, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { FilePlus, ImageUp, Save, SquarePen, Trash2, X } from 'lucide-react'
import * as mastersApi from '../../api/endpoints/masters'
import EmptyState from '../../components/ui/EmptyState'
import { useConfirm } from '../../components/ui/ConfirmProvider'

// The Supplier form's four sub-screens, ported from the legacy frmMstPartyAddress / ContactPerson / Alert / Activities.
// Everything shown comes from the backend (GET /masters/{doc}/{row}/party/...); nothing is stored in the browser.

const fail = (err, fallback) => notifications.show({ message: err?.response?.data?.detail || fallback, color: 'red' })
const ok = (message) => notifications.show({ message, color: 'teal' })

function Title2({ children }) {
  return (
    <Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
      {children}
    </Text>
  )
}

/** Header line the legacy dialogs show: party code + name, then "Total ... present for this ..." */
function PartyHeader({ party, summary }) {
  return (
    <Stack gap={2} mb="sm">
      <Text size="sm" fw={600}>
        {party.codeCaption}: <span className="vt-num">{party.code}</span> &nbsp;·&nbsp; {party.name}
      </Text>
      <Text size="xs" c="dimmed">
        {summary}
      </Text>
    </Stack>
  )
}

function useRefresh(docId, rowId, keys) {
  const qc = useQueryClient()
  return () => {
    keys.forEach((k) => qc.invalidateQueries({ queryKey: [k, docId, rowId] }))
    qc.invalidateQueries({ queryKey: ['party-counts', docId, rowId] })
  }
}

// ------------------------------------------------------------------ Multi Address

const EMPTY_ADDR = { AddCat: '', Add1: '', Add2: '', Add3: '', Add4: '', SHPGSTNO: '', City: '', State: '', PinCode: '', Country: '', DefShipAdd: 'N' }

export function AddressesModal({ opened, onClose, docId, rowId, party }) {
  const confirm = useConfirm()
  const refresh = useRefresh(docId, rowId, ['party-addresses'])
  const { data: rows = [] } = useQuery({ queryKey: ['party-addresses', docId, rowId], queryFn: () => mastersApi.listAddresses(docId, rowId), enabled: opened })
  const { data: cities = [] } = useQuery({ queryKey: ['master-core-lookup', docId, 'City', ''], queryFn: () => mastersApi.coreLookup(docId, 'City', ''), enabled: opened })
  const [selected, setSelected] = useState(null)
  const [edit, setEdit] = useState(null) // null = list, object = form
  const [saving, setSaving] = useState(false)
  const states = useMemo(() => [...new Set(cities.map((c) => c.State).filter(Boolean))], [cities])
  const countries = useMemo(() => [...new Set(cities.map((c) => c.Country).filter(Boolean))], [cities])
  const row = rows.find((r) => r.PartyAddID === selected)
  const set = (k, v) => setEdit((e) => ({ ...e, [k]: v }))

  async function onSave() {
    setSaving(true)
    try {
      await mastersApi.saveAddress(docId, rowId, edit, edit.PartyAddID)
      ok('Data Saved Successfully!')
      setEdit(null)
      refresh()
    } catch (err) {
      fail(err, 'Save failed')
    } finally {
      setSaving(false)
    }
  }
  async function onDelete() {
    if (!row) return
    if (!(await confirm({ title: 'Delete this address?', message: `'${row.AddCat}' will be deleted.`, confirmLabel: 'Delete' }))) return
    try {
      await mastersApi.deleteAddress(docId, rowId, row.PartyAddID)
      ok('Deleted Successfully!')
      setSelected(null)
      refresh()
    } catch (err) {
      fail(err, 'Delete failed')
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} size="xl" radius="lg" title={<Title2>Multi Addresses</Title2>}>
      <PartyHeader party={party} summary={rows.length ? `Total Addresses Present for this ${party.noun} is ${rows.length}` : `No Addresses Present for this ${party.noun}`} />
      {edit ? (
        <Stack gap="sm">
          <TextInput className="vt-field-required" label="Category" required data-autofocus value={edit.AddCat} onChange={(e) => set('AddCat', e.currentTarget.value)} />
          <TextInput className="vt-field-required" label="Address" required value={edit.Add1} onChange={(e) => set('Add1', e.currentTarget.value)} />
          <TextInput aria-label="Address line 2" value={edit.Add2} onChange={(e) => set('Add2', e.currentTarget.value)} />
          <TextInput aria-label="Address line 3" value={edit.Add3} onChange={(e) => set('Add3', e.currentTarget.value)} />
          <TextInput aria-label="Address line 4" value={edit.Add4} onChange={(e) => set('Add4', e.currentTarget.value)} />
          <TextInput label="GST No" value={edit.SHPGSTNO} maxLength={15} onChange={(e) => set('SHPGSTNO', e.currentTarget.value)} />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Autocomplete
              className="vt-field-required"
              label="City"
              required
              data={cities.map((c) => c.label)}
              value={edit.City}
              onChange={(v) => {
                const hit = cities.find((c) => c.label === v)
                setEdit((e) => ({ ...e, City: v, ...(hit ? { State: hit.State || e.State, Country: hit.Country || e.Country } : {}) }))
              }}
            />
            <TextInput label="PinCode" value={edit.PinCode} maxLength={6} onChange={(e) => set('PinCode', e.currentTarget.value.replace(/\D/g, ''))} />
            <Autocomplete label="State" data={states} value={edit.State} onChange={(v) => set('State', v)} />
            <Autocomplete label="Country" data={countries} value={edit.Country} onChange={(v) => set('Country', v)} />
          </SimpleGrid>
          <Checkbox color="kumkum" label="Default Ship Address" checked={edit.DefShipAdd === 'Y'} onChange={(e) => set('DefShipAdd', e.currentTarget.checked ? 'Y' : 'N')} />
          <Group justify="flex-end">
            <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={onSave}>
              Save
            </Button>
            <Button variant="default" leftSection={<X size={16} />} onClick={() => setEdit(null)}>
              Cancel
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="sm">
          <Table.ScrollContainer minWidth={480}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Category</Table.Th>
                  <Table.Th>Address</Table.Th>
                  <Table.Th>Default Shipping Address</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.PartyAddID} onClick={() => setSelected(r.PartyAddID)} onDoubleClick={() => setEdit({ ...EMPTY_ADDR, ...r })} style={{ cursor: 'pointer', background: selected === r.PartyAddID ? 'var(--vt-gold-chip)' : undefined }}>
                    <Table.Td>{r.AddCat}</Table.Td>
                    <Table.Td style={{ whiteSpace: 'pre-line' }}>{r.address}</Table.Td>
                    <Table.Td>{r.DefShipAdd === 'Y' ? 'Y' : 'N'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {rows.length === 0 && <EmptyState title="No addresses yet" hint="Use Add to record another address for this party." />}
          <Group justify="flex-end" gap="xs">
            <Button color="kumkum" leftSection={<FilePlus size={16} />} onClick={() => setEdit({ ...EMPTY_ADDR })}>
              Add
            </Button>
            <Button variant="light" color="kumkum" leftSection={<SquarePen size={16} />} disabled={!row} onClick={() => setEdit({ ...EMPTY_ADDR, ...row })}>
              Edit
            </Button>
            <Button variant="light" color="red" leftSection={<Trash2 size={16} />} disabled={!row} onClick={onDelete}>
              Delete
            </Button>
            <Button variant="default" leftSection={<X size={16} />} onClick={onClose}>
              Close
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ Contact Person

const EMPTY_CONTACT = { CName: '', CDepartment: '', CDesig: '', CMobNo: '', CPhone: '', Fax: '', Email: '', CRemarks: '', SetDefault: 'N' }

function ContactImage({ docId, rowId, cid, version }) {
  const { data: src } = useQuery({
    queryKey: ['contact-image', docId, rowId, cid, version],
    queryFn: async () => {
      try {
        return URL.createObjectURL(await mastersApi.contactImage(docId, rowId, cid))
      } catch {
        return null
      }
    },
    enabled: Boolean(cid),
  })
  return <Avatar src={src} size={72} radius="md" color="kumkum" aria-label="Contact image" />
}

export function ContactsModal({ opened, onClose, docId, rowId, party }) {
  const confirm = useConfirm()
  const refresh = useRefresh(docId, rowId, ['party-contacts'])
  const { data: rows = [] } = useQuery({ queryKey: ['party-contacts', docId, rowId], queryFn: () => mastersApi.listContacts(docId, rowId), enabled: opened })
  const [selected, setSelected] = useState(null)
  const [edit, setEdit] = useState(null)
  const [saving, setSaving] = useState(false)
  const [imgVersion, setImgVersion] = useState(0)
  const fileRef = useRef(null)
  const row = rows.find((r) => r.PartyCID === selected)
  const set = (k, v) => setEdit((e) => ({ ...e, [k]: v }))

  async function onSave() {
    setSaving(true)
    try {
      await mastersApi.saveContact(docId, rowId, edit, edit.PartyCID)
      ok('Data Saved Successfully!')
      setEdit(null)
      refresh()
    } catch (err) {
      fail(err, 'Save failed')
    } finally {
      setSaving(false)
    }
  }
  async function onDelete() {
    if (!row) return
    if (!(await confirm({ title: 'Delete this contact?', message: `'${row.CName}' will be deleted.`, confirmLabel: 'Delete' }))) return
    try {
      await mastersApi.deleteContact(docId, rowId, row.PartyCID)
      ok('Deleted Successfully!')
      setSelected(null)
      refresh()
    } catch (err) {
      fail(err, 'Delete failed')
    }
  }
  async function onPickImage(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !edit?.PartyCID) return
    try {
      await mastersApi.setContactImage(docId, rowId, edit.PartyCID, file)
      setImgVersion((v) => v + 1)
      ok('Image updated')
    } catch (err) {
      fail(err, 'Could not update the image')
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} size="xl" radius="lg" title={<Title2>Contact Person(s)</Title2>}>
      <PartyHeader party={party} summary={rows.length ? `Total Contacts present for this ${party.noun} is ${rows.length}` : `No Contacts present for this ${party.noun}`} />
      {edit ? (
        <Stack gap="sm">
          <Group align="flex-start" wrap="nowrap">
            <Stack gap={6} align="center">
              {edit.PartyCID ? <ContactImage docId={docId} rowId={rowId} cid={edit.PartyCID} version={imgVersion} /> : <Avatar size={72} radius="md" color="kumkum" />}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickImage} />
              <Button size="compact-xs" variant="light" color="kumkum" leftSection={<ImageUp size={13} />} disabled={!edit.PartyCID} onClick={() => fileRef.current?.click()}>
                Image
              </Button>
              {!edit.PartyCID && (
                <Text size="xs" c="dimmed" ta="center" maw={110}>
                  Save first, then add an image
                </Text>
              )}
            </Stack>
            <Stack gap="sm" style={{ flex: 1 }}>
              <TextInput className="vt-field-required" label="Contact Person Name" required data-autofocus value={edit.CName} onChange={(e) => set('CName', e.currentTarget.value)} />
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput label="Department" value={edit.CDepartment} onChange={(e) => set('CDepartment', e.currentTarget.value)} />
                <TextInput label="Designation" value={edit.CDesig} onChange={(e) => set('CDesig', e.currentTarget.value)} />
                <TextInput label="Mobile No" value={edit.CMobNo} onChange={(e) => set('CMobNo', e.currentTarget.value)} />
                <TextInput label="Tel No" value={edit.CPhone} onChange={(e) => set('CPhone', e.currentTarget.value)} />
                <TextInput label="Fax" value={edit.Fax} onChange={(e) => set('Fax', e.currentTarget.value)} />
                <TextInput label="Email" value={edit.Email} onChange={(e) => set('Email', e.currentTarget.value)} />
              </SimpleGrid>
              <Textarea label="Remarks" autosize minRows={2} value={edit.CRemarks} onChange={(e) => set('CRemarks', e.currentTarget.value)} />
              <Checkbox color="kumkum" label="Default" checked={edit.SetDefault === 'Y'} onChange={(e) => set('SetDefault', e.currentTarget.checked ? 'Y' : 'N')} />
            </Stack>
          </Group>
          <Group justify="flex-end">
            <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={onSave}>
              Save
            </Button>
            <Button variant="default" leftSection={<X size={16} />} onClick={() => setEdit(null)}>
              Close
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="sm">
          <Table.ScrollContainer minWidth={560}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Contact Person Name</Table.Th>
                  <Table.Th>Department</Table.Th>
                  <Table.Th>Designation</Table.Th>
                  <Table.Th>Mobile Number</Table.Th>
                  <Table.Th>Phone Number</Table.Th>
                  <Table.Th>Fax</Table.Th>
                  <Table.Th>EmailID</Table.Th>
                  <Table.Th>Default</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.PartyCID} onClick={() => setSelected(r.PartyCID)} onDoubleClick={() => setEdit({ ...EMPTY_CONTACT, ...r })} style={{ cursor: 'pointer', background: selected === r.PartyCID ? 'var(--vt-gold-chip)' : undefined }}>
                    <Table.Td>{r.CName}</Table.Td>
                    <Table.Td>{r.CDepartment}</Table.Td>
                    <Table.Td>{r.CDesig}</Table.Td>
                    <Table.Td>{r.CMobNo}</Table.Td>
                    <Table.Td>{r.CPhone}</Table.Td>
                    <Table.Td>{r.Fax}</Table.Td>
                    <Table.Td>{r.Email}</Table.Td>
                    <Table.Td>{r.SetDefault === 'Y' ? 'Y' : 'N'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {rows.length === 0 && <EmptyState title="No contacts yet" hint="Use Add to record a contact person." />}
          <Group justify="flex-end" gap="xs">
            <Button color="kumkum" leftSection={<FilePlus size={16} />} onClick={() => setEdit({ ...EMPTY_CONTACT })}>
              Add
            </Button>
            <Button variant="light" color="kumkum" leftSection={<SquarePen size={16} />} disabled={!row} onClick={() => setEdit({ ...EMPTY_CONTACT, ...row })}>
              Edit
            </Button>
            <Button variant="light" color="red" leftSection={<Trash2 size={16} />} disabled={!row} onClick={onDelete}>
              Delete
            </Button>
            <Button variant="default" leftSection={<X size={16} />} onClick={onClose}>
              Close
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ Alert Message

export function AlertsModal({ opened, onClose, docId, rowId, party }) {
  const refresh = useRefresh(docId, rowId, ['party-alerts'])
  const { data } = useQuery({ queryKey: ['party-alerts', docId, rowId], queryFn: () => mastersApi.listAlerts(docId, rowId), enabled: opened })
  const [messages, setMessages] = useState({})
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (data) setMessages(Object.fromEntries(data.map((a) => [a.doc_id, a.message])))
  }, [data])
  const total = Object.values(messages).filter((m) => (m || '').trim()).length

  async function onSave() {
    setSaving(true)
    try {
      await mastersApi.saveAlerts(docId, rowId, Object.entries(messages).map(([doc_id, message]) => ({ doc_id: Number(doc_id), message })))
      ok('Message Saved Successfully')
      refresh()
      onClose()
    } catch (err) {
      fail(err, 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} size="lg" radius="lg" title={<Title2>Alert Message</Title2>}>
      <PartyHeader party={party} summary={total ? `Total Alert Messages Present For this ${party.noun} Is ${total}` : `No Alert Messages Present For this ${party.noun}`} />
      <Stack gap="sm">
        {(data || []).map((a) => (
          <Textarea key={a.doc_id} label={`Transaction: ${a.doc_name}`} description="Alert Message" autosize minRows={2} value={messages[a.doc_id] || ''} onChange={(e) => setMessages((m) => ({ ...m, [a.doc_id]: e.currentTarget.value }))} />
        ))}
        {(data || []).length === 0 && <EmptyState title="No transactions are linked to this master" hint="Alert messages are kept per transaction document." />}
        <Group justify="flex-end">
          <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={onSave}>
            Save
          </Button>
          <Button variant="default" leftSection={<X size={16} />} onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

// ------------------------------------------------------------------ Activities

export function ActivitiesModal({ opened, onClose, docId, rowId, party }) {
  const confirm = useConfirm()
  const refresh = useRefresh(docId, rowId, ['party-activities'])
  const { data: rows = [] } = useQuery({ queryKey: ['party-activities', docId, rowId], queryFn: () => mastersApi.listActivities(docId, rowId), enabled: opened })
  const [selected, setSelected] = useState(null)
  const [notes, setNotes] = useState(null) // null = list, string = adding
  const [saving, setSaving] = useState(false)

  async function onSave() {
    setSaving(true)
    try {
      await mastersApi.addActivity(docId, rowId, notes)
      ok('Note Saved Successfully')
      setNotes(null)
      refresh()
    } catch (err) {
      fail(err, 'Save failed')
    } finally {
      setSaving(false)
    }
  }
  async function onRemove() {
    if (selected == null) return
    if (!(await confirm({ title: 'Remove this note?', message: 'The note will be deleted.', confirmLabel: 'Remove' }))) return
    try {
      await mastersApi.deleteActivity(docId, rowId, selected)
      ok('Deleted Successfully!')
      setSelected(null)
      refresh()
    } catch (err) {
      fail(err, 'Delete failed')
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} size="lg" radius="lg" title={<Title2>Activities</Title2>}>
      <PartyHeader party={party} summary={rows.length ? `Total Notes Present for this ${party.noun} is ${rows.length}` : `No Notes Present For this ${party.noun}`} />
      {notes !== null ? (
        <Stack gap="sm">
          <Text size="xs" c="dimmed">
            Date: {dayjs().format('DD/MM/YYYY HH:mm')} (recorded when you save)
          </Text>
          <Textarea className="vt-field-required" label="Notes" required data-autofocus autosize minRows={3} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={onSave}>
              Save
            </Button>
            <Button variant="default" leftSection={<X size={16} />} onClick={() => setNotes(null)}>
              Cancel
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="sm">
          <Table.ScrollContainer minWidth={440}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={150}>Date</Table.Th>
                  <Table.Th>Notes</Table.Th>
                  <Table.Th w={110}>User</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.act_id} onClick={() => setSelected(r.act_id)} style={{ cursor: 'pointer', background: selected === r.act_id ? 'var(--vt-gold-chip)' : undefined }}>
                    <Table.Td className="vt-num">{dayjs(r.act_date).format('DD/MM/YYYY HH:mm')}</Table.Td>
                    <Table.Td style={{ whiteSpace: 'pre-line' }}>{r.notes}</Table.Td>
                    <Table.Td>{r.user_code}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {rows.length === 0 && <EmptyState title="No notes yet" hint="Use Add to record a note about this party." />}
          <Group justify="flex-end" gap="xs">
            <Button color="kumkum" leftSection={<FilePlus size={16} />} onClick={() => setNotes('')}>
              Add
            </Button>
            <Button variant="light" color="red" leftSection={<Trash2 size={16} />} disabled={selected == null} onClick={onRemove}>
              Remove
            </Button>
            <Button variant="default" leftSection={<X size={16} />} onClick={onClose}>
              Close
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}

