import { useEffect, useState } from 'react'
import { ActionIcon, Button, Card, Checkbox, Group, Modal, NumberInput, Radio, ScrollArea, Select, Stack, Table, Text, TextInput, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import * as api from '../../api/endpoints/otherSettings'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import EmptyState from '../../components/ui/EmptyState'

const say = (e, fallback) => e?.response?.data?.detail || fallback
const ok = (message) => notifications.show({ message, color: 'teal' })
const fail = (message) => notifications.show({ message, color: 'red' })
const Title = ({ children }) => <Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>{children}</Text>

// ------------------------------------------------------------------------------------------------ Field Captions
/** Legacy frmUtlFldCaptions: Field Code -> Field Caption grid. Add one, edit captions in the grid, Save writes the whole grid, Remove one. */
export function FieldCaptionsDialog({ onClose }) {
  const confirm = useConfirm()
  const { data, isLoading, refetch } = useQuery({ queryKey: ['other-field-captions'], queryFn: api.listCaptions, staleTime: 0 })
  const [rows, setRows] = useState([])
  const [dirty, setDirty] = useState(false)
  const [sel, setSel] = useState(null)
  const [nu, setNu] = useState({ code: '', caption: '' })
  useEffect(() => {
    if (data) { setRows(data); setDirty(false) }
  }, [data])

  async function add() {
    try {
      const r = await api.addCaption(nu)
      ok(r.message)
      setNu({ code: '', caption: '' })
      refetch()
    } catch (e) { fail(say(e, 'Error during Save')) }
  }
  async function saveAll() {
    try {
      const r = await api.saveCaptions(rows)
      ok(r.message)
      refetch()
    } catch (e) { fail(say(e, 'Error during Save')) }
  }
  async function remove() {
    if (sel === null || !rows[sel]) return fail('No item present to delete!')
    if (!(await confirm({ title: 'Deletion Confirmation...', message: `Are you sure you want to Remove ${rows[sel].code}?`, confirmLabel: 'Remove' }))) return
    try {
      const r = await api.deleteCaption(rows[sel].code)
      ok(r.message)
      setSel(null)
      refetch()
    } catch (e) { fail(say(e, 'Field Caption Removal Failed')) }
  }

  return (
    <Modal opened onClose={onClose} size="lg" radius="lg" title={<Title>Field Captions</Title>}>
      <Stack gap="sm">
        <Group align="flex-end" gap="xs" wrap="wrap">
          <TextInput label="Field Code" value={nu.code} onChange={(e) => setNu({ ...nu, code: e.currentTarget.value })} />
          <TextInput label="Field Caption" value={nu.caption} onChange={(e) => setNu({ ...nu, caption: e.currentTarget.value })} style={{ flex: 1 }} />
          <Button variant="light" color="kumkum" leftSection={<Plus size={16} />} onClick={add}>Add</Button>
        </Group>
        <ScrollArea h={340} type="auto">
          {isLoading ? <Text size="sm" c="dimmed">Loading...</Text> : rows.length === 0 ? (
            <EmptyState title="No field captions" hint="Add a field code and its caption above." />
          ) : (
            <Table stickyHeader highlightOnHover withColumnBorders>
              <Table.Thead><Table.Tr><Table.Th w={220}>Field Code</Table.Th><Table.Th>Field Caption</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {rows.map((r, i) => (
                  <Table.Tr key={r.code + i} onClick={() => setSel(i)} style={{ background: sel === i ? 'var(--vt-gold-chip)' : undefined, cursor: 'pointer' }}>
                    <Table.Td>{r.code}</Table.Td>
                    <Table.Td p={2}>
                      <TextInput size="xs" aria-label={`Caption of ${r.code}`} value={r.caption} onFocus={() => setSel(i)} onChange={(e) => { const v = e.currentTarget.value; setRows((rs) => rs.map((x, xi) => (xi === i ? { ...x, caption: v } : x))); setDirty(true) }} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
        <Group justify="space-between">
          <Button variant="default" color="red" leftSection={<Trash2 size={16} />} onClick={remove} disabled={sel === null}>Remove</Button>
          <Group>
            <Button color="kumkum" leftSection={<Save size={16} />} disabled={!dirty} onClick={saveAll}>Save</Button>
            <Button variant="default" onClick={onClose}>Close</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------- Delete Linkage Updation
/**
 * Legacy FrmUtlDeleteLinkageUpdation: for a master table, which other tables refer to it. Those links are what stops a
 * record being deleted while it is in use ("Load" lists every table that has the checked column; tick/keep the ones that
 * matter, give each its display column and document name).
 */
export function DeleteLinkageDialog({ onClose }) {
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { data: links = [], refetch } = useQuery({ queryKey: ['other-delete-linkage'], queryFn: api.listLinkages, staleTime: 0 })
  const { data: tables = [] } = useQuery({ queryKey: ['other-tables'], queryFn: api.listTables, staleTime: 5 * 60_000 })
  const [f, setF] = useState({ table: '', doc_name: '', field: '', refs: [] })
  const { data: cols = [] } = useQuery({ queryKey: ['other-columns', f.table], queryFn: () => api.listColumns(f.table), enabled: Boolean(f.table), staleTime: 60_000 })

  function edit(l) {
    setF({ table: l.table, doc_name: l.doc_name, field: l.field, refs: l.refs.map((r) => ({ ...r })) })
  }
  async function load() {
    try {
      const rows = await api.linkageCandidates(f.table, f.field)
      // keep what is already described for the same table/column
      setF((cur) => ({ ...cur, refs: rows.map((r) => cur.refs.find((x) => x.table === r.table && x.column === r.column) || r) }))
    } catch (e) { fail(say(e, 'Error during Load')) }
  }
  async function save() {
    try {
      const r = await api.saveLinkage(f)
      ok(r.message)
      setF({ table: '', doc_name: '', field: '', refs: [] })
      refetch()
      qc.invalidateQueries({ queryKey: ['other-delete-linkage'] })
    } catch (e) { fail(say(e, 'Error during save')) }
  }
  async function remove(t) {
    if (!(await confirm({ title: 'Deletion Confirmation...', message: `Are you sure you want to delete the links of ${t}?`, confirmLabel: 'Delete' }))) return
    try {
      const r = await api.deleteLinkage(t)
      ok(r.message)
      if (f.table === t) setF({ table: '', doc_name: '', field: '', refs: [] })
      refetch()
    } catch (e) { fail(say(e, 'Error during delete')) }
  }
  const setRef = (i, patch) => setF((cur) => ({ ...cur, refs: cur.refs.map((r, ri) => (ri === i ? { ...r, ...patch } : r)) }))

  return (
    <Modal opened onClose={onClose} size="xl" radius="lg" title={<Title>Delete Linkage Updation</Title>}>
      <Stack gap="sm">
        <Group align="flex-end" gap="xs" wrap="wrap">
          <Select label="Table Name" searchable data={tables} value={f.table || null} onChange={(v) => setF({ ...f, table: v || '', field: '', refs: [] })} w={220} />
          <TextInput label="Document Name" value={f.doc_name} onChange={(e) => setF({ ...f, doc_name: e.currentTarget.value })} w={200} />
          <Select label="Field To be Checked for Deletion" searchable data={cols} value={f.field || null} onChange={(v) => setF({ ...f, field: v || '' })} w={240} />
          <Button variant="light" color="kumkum" leftSection={<Download size={16} />} onClick={load}>Load</Button>
        </Group>
        <ScrollArea h={230} type="auto">
          {f.refs.length === 0 ? <Text size="sm" c="dimmed" p="sm">Choose a table and the field to be checked, then press Load to list the tables that use it.</Text> : (
            <Table stickyHeader withColumnBorders>
              <Table.Thead><Table.Tr><Table.Th>Table</Table.Th><Table.Th>Column</Table.Th><Table.Th>Display Column</Table.Th><Table.Th>Doc Name</Table.Th><Table.Th w={40} /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {f.refs.map((r, i) => (
                  <Table.Tr key={r.table + r.column}>
                    <Table.Td>{r.table}</Table.Td>
                    <Table.Td>{r.column}</Table.Td>
                    <Table.Td p={2}><TextInput size="xs" aria-label={`Display column for ${r.table}`} value={r.display} onChange={(e) => setRef(i, { display: e.currentTarget.value })} /></Table.Td>
                    <Table.Td p={2}><TextInput size="xs" aria-label={`Doc name for ${r.table}`} value={r.doc} onChange={(e) => setRef(i, { doc: e.currentTarget.value })} /></Table.Td>
                    <Table.Td p={2}><ActionIcon variant="subtle" color="red" aria-label={`Remove ${r.table}`} onClick={() => setF((cur) => ({ ...cur, refs: cur.refs.filter((_, ri) => ri !== i) }))}><Trash2 size={16} /></ActionIcon></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
        <Group justify="flex-end">
          <Button color="kumkum" leftSection={<Save size={16} />} onClick={save}>Save</Button>
          <Button variant="default" onClick={() => setF({ table: '', doc_name: '', field: '', refs: [] })}>Cancel</Button>
        </Group>
        <Text size="sm" fw={600}>Existing links</Text>
        <ScrollArea h={150} type="auto">
          <Table withColumnBorders>
            <Table.Thead><Table.Tr><Table.Th>Table</Table.Th><Table.Th>Document</Table.Th><Table.Th>Checked field</Table.Th><Table.Th>Linked tables</Table.Th><Table.Th w={80} /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {links.map((l) => (
                <Table.Tr key={l.table}>
                  <Table.Td>{l.table}</Table.Td><Table.Td>{l.doc_name}</Table.Td><Table.Td>{l.field}</Table.Td>
                  <Table.Td>{l.refs.map((r) => r.table).join(', ')}</Table.Td>
                  <Table.Td p={2}>
                    <Group gap={2} wrap="nowrap">
                      <ActionIcon variant="subtle" aria-label={`Edit ${l.table}`} onClick={() => edit(l)}><Pencil size={16} /></ActionIcon>
                      <ActionIcon variant="subtle" color="red" aria-label={`Delete ${l.table}`} onClick={() => remove(l.table)}><Trash2 size={16} /></ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Close</Button></Group>
      </Stack>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------- View Search Display Fields
const EMPTY_FIND = { id: null, table: '', storage: '', display: '', alias1: '', alias2: '', alias3: '', alias4: '', alias5: '' }

/** Legacy frmUtlFindFlds: per table, the stored key column and the column shown in search / lookup lists (plus up to five alias columns). */
export function SearchFieldsDialog({ onClose }) {
  const confirm = useConfirm()
  const { data: rows = [], refetch } = useQuery({ queryKey: ['other-search-fields'], queryFn: api.listSearchFields, staleTime: 0 })
  const { data: tables = [] } = useQuery({ queryKey: ['other-tables'], queryFn: api.listTables, staleTime: 5 * 60_000 })
  const [f, setF] = useState(null) // null = list, object = add/edit panel
  const { data: cols = [] } = useQuery({ queryKey: ['other-columns', f?.table], queryFn: () => api.listColumns(f.table), enabled: Boolean(f?.table), staleTime: 60_000 })

  async function save() {
    try {
      const r = f.id === null ? await api.addSearchField(f) : await api.updateSearchField(f.id, f)
      ok(r.message)
      setF(null)
      refetch()
    } catch (e) { fail(say(e, 'Error during save')) }
  }
  async function remove(row) {
    if (!(await confirm({ title: 'Deletion Confirmation...', message: `Are you sure you want to delete ${row.table}?`, confirmLabel: 'Delete' }))) return
    try {
      const r = await api.deleteSearchField(row.id)
      ok(r.message)
      refetch()
    } catch (e) { fail(say(e, 'Error during Delete')) }
  }
  const upd = (k) => (e) => setF({ ...f, [k]: e.currentTarget.value })

  return (
    <Modal opened onClose={onClose} size="xl" radius="lg" title={<Title>View Search Display Fields</Title>}>
      <Stack gap="sm">
        {f ? (
          <Stack gap="xs">
            <Group grow align="flex-start">
              <Select label="Table Name" required searchable data={tables} value={f.table || null} onChange={(v) => setF({ ...f, table: v || '', storage: '' })} disabled={f.id !== null} />
              <Select label="Storage Field" required searchable data={cols} value={f.storage || null} onChange={(v) => setF({ ...f, storage: v || '' })} />
              <TextInput label="Display Field" required value={f.display} onChange={upd('display')} />
            </Group>
            <Group grow>
              {[1, 2, 3, 4, 5].map((n) => <TextInput key={n} label={`Alias Field${n}`} value={f[`alias${n}`]} onChange={upd(`alias${n}`)} />)}
            </Group>
            <Group justify="flex-end">
              <Button color="kumkum" leftSection={<Save size={16} />} onClick={save}>Save</Button>
              <Button variant="default" onClick={() => setF(null)}>Cancel</Button>
            </Group>
          </Stack>
        ) : (
          <Group justify="space-between"><Text size="sm" c="dimmed">Which columns the search lists show for each table.</Text><Button variant="light" color="kumkum" leftSection={<Plus size={16} />} onClick={() => setF({ ...EMPTY_FIND })}>Add</Button></Group>
        )}
        <ScrollArea h={300} type="auto">
          <Table stickyHeader highlightOnHover withColumnBorders>
            <Table.Thead><Table.Tr><Table.Th>TableID</Table.Th><Table.Th>Table Name</Table.Th><Table.Th>Storage Field</Table.Th><Table.Th>Display Field</Table.Th><Table.Th>Alias 1</Table.Th><Table.Th>Alias 2</Table.Th><Table.Th>Alias 3</Table.Th><Table.Th>Alias 4</Table.Th><Table.Th>Alias 5</Table.Th><Table.Th w={80} /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>{r.id}</Table.Td><Table.Td>{r.table}</Table.Td><Table.Td>{r.storage}</Table.Td><Table.Td>{r.display}</Table.Td>
                  <Table.Td>{r.alias1}</Table.Td><Table.Td>{r.alias2}</Table.Td><Table.Td>{r.alias3}</Table.Td><Table.Td>{r.alias4}</Table.Td><Table.Td>{r.alias5}</Table.Td>
                  <Table.Td p={2}>
                    <Group gap={2} wrap="nowrap">
                      <ActionIcon variant="subtle" aria-label={`Edit ${r.table}`} onClick={() => setF({ ...r })}><Pencil size={16} /></ActionIcon>
                      <ActionIcon variant="subtle" color="red" aria-label={`Delete ${r.table}`} onClick={() => remove(r)}><Trash2 size={16} /></ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Close</Button></Group>
      </Stack>
    </Modal>
  )
}

// ------------------------------------------------------------------------------------------------------ Login Settings
/** Legacy frmUtlLoginSettings (ADMIN only): how users sign in, the password policy and whether rights follow the user or the role. */
export function LoginSettingsDialog({ onClose }) {
  const { data, isLoading } = useQuery({ queryKey: ['other-login'], queryFn: api.getLoginSettings, staleTime: 0 })
  const [f, setF] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (data) setF(data) }, [data])
  const set = (patch) => setF((cur) => ({ ...cur, ...patch }))
  async function save() {
    setSaving(true)
    try {
      const r = await api.saveLoginSettings(f)
      ok(r.message)
      onClose()
    } catch (e) { fail(say(e, 'Error during save')) } finally { setSaving(false) }
  }
  const num = (key, label) => <NumberInput size="xs" label={label} min={0} hideControls disabled={!f?.pwd_rules} value={f?.[key] ?? 0} onChange={(v) => set({ [key]: Number(v) || 0 })} />
  return (
    <Modal opened onClose={onClose} size="lg" radius="lg" title={<Title>Login Settings</Title>}>
      {isLoading || !f ? <Text size="sm" c="dimmed">Loading...</Text> : (
        <Stack gap="sm">
          <Checkbox color="kumkum" label="Login Required" checked={f.login_required} onChange={(e) => set({ login_required: e.currentTarget.checked })} />
          <Card withBorder p="sm">
            <Text fw={600} size="sm" mb={6}>Authentication</Text>
            <Radio.Group value={f.ad_auth ? 'ad' : 'reg'} onChange={(v) => set({ ad_auth: v === 'ad' })}>
              <Group><Radio color="kumkum" value="reg" label="Software Authentication" /><Radio color="kumkum" value="ad" label="AD Authentication" /></Group>
            </Radio.Group>
            {f.ad_auth && (
              <Stack gap="xs" mt="sm">
                <Radio.Group value={f.ad_auto_login ? 'auto' : 'reg'} onChange={(v) => set({ ad_auto_login: v === 'auto' })}>
                  <Stack gap={4}>
                    <Radio color="kumkum" value="reg" label="Regular Login" description="During opening of the software, Login screen will be shown for the user to enter UserName and Password." />
                    <Radio color="kumkum" value="auto" label="Auto Login" description="During opening of the software, will not show login screen. Will take user as the windows user only." />
                  </Stack>
                </Radio.Group>
                {!f.ad_auto_login && <TextInput className="vt-field-required" label="Domain Settings" required value={f.ad_domain} onChange={(e) => set({ ad_domain: e.currentTarget.value.replace(/'/g, '') })} />}
                <Text size="xs" c="dimmed">The web sign-in page always uses the software user name and password; these AD options apply to the Windows application.</Text>
              </Stack>
            )}
          </Card>
          {!f.ad_auth && (
            <Card withBorder p="sm">
              <Checkbox color="kumkum" label="Password Policy" checked={f.pwd_policy} onChange={(e) => set({ pwd_policy: e.currentTarget.checked })} />
              {f.pwd_policy && (
                <Stack gap="xs" mt="sm">
                  <Group gap="md" align="flex-end">
                    <Radio.Group value={f.never_expires ? 'never' : 'days'} onChange={(v) => set({ never_expires: v === 'never' })}>
                      <Group><Radio color="kumkum" value="never" label="Never Expires" /><Radio color="kumkum" value="days" label="Expires Every" /></Group>
                    </Radio.Group>
                    {!f.never_expires && <NumberInput size="xs" w={90} min={0} hideControls aria-label="Expiry days" rightSection={<Text size="xs">Days</Text>} rightSectionWidth={40} value={f.expiry_days} onChange={(v) => set({ expiry_days: Number(v) || 0 })} />}
                  </Group>
                  <Radio.Group value={f.pwd_rules ? 'rules' : 'none'} onChange={(v) => set({ pwd_rules: v === 'rules' })}>
                    <Group><Radio color="kumkum" value="none" label="No Rules" /><Radio color="kumkum" value="rules" label="Password Rules" /></Group>
                  </Radio.Group>
                  {f.pwd_rules && (
                    <Group grow align="flex-end">
                      {num('min_length', 'Min. length of Password')}{num('min_alpha', 'Min. no of Alphabets')}{num('min_numeric', 'Min. no of Numeric')}{num('min_special', 'Min. no of Special Characters')}
                      {num('min_lower', 'Min. no of Lower Case')}{num('min_upper', 'Min. no of Upper Case')}
                    </Group>
                  )}
                </Stack>
              )}
            </Card>
          )}
          <Card withBorder p="sm">
            <Text fw={600} size="sm" mb={6}>Rights Allocation</Text>
            <Radio.Group value={f.role_based ? 'role' : 'user'} onChange={(v) => set({ role_based: v === 'role' })}>
              <Group><Radio color="kumkum" value="user" label="User Based" /><Radio color="kumkum" value="role" label="Role Based" /></Group>
            </Radio.Group>
          </Card>
          <Group justify="flex-end">
            <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={save}>Save</Button>
            <Button variant="default" onClick={onClose}>Close</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------------------------------------- Doc Prefix Settings
const OPERATORS = ['=', '>', '<', '>=', '<=', '<>']

/**
 * Legacy frmUtlDocNumber: how each document's printed number is built. F1..F14 each hold a token (1 Prefix, 2 Year From,
 * 3 Year To, 4 Sh YearFrom, 5 Sh YearTo, 6 DocNo, 7 ShDocNo, 8/9/10 Adnl Doc No 1-3) or free text such as "/" or "-"; the
 * Example column shows the result. "Prefix Settings" edits the prefixes a document may use and the field value that selects each.
 */
export function DocPrefixDialog({ onClose }) {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['other-doc-numbers'], queryFn: api.getDocNumbers, staleTime: 0 })
  const [rows, setRows] = useState([])
  const [sel, setSel] = useState(null)
  const [pfx, setPfx] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (data) setRows(data.documents) }, [data])
  const tokens = data?.example_tokens || []

  const example = (r) => r.f.map((v) => { const n = Number(v); return v && Number.isInteger(n) && n >= 1 && n <= 10 ? tokens[n - 1] : v }).join('')
  const patch = (i, p) => setRows((rs) => rs.map((r, ri) => (ri === i ? { ...r, ...p } : r)))
  const setF = (i, k, v) => setRows((rs) => rs.map((r, ri) => (ri === i ? { ...r, f: r.f.map((x, xi) => (xi === k ? v : x)) } : r)))

  async function save() {
    setSaving(true)
    try {
      const r = await api.saveDocNumbers(rows.map((x) => ({ doc_id: x.doc_id, cont_group: x.cont_group, pfx_reset: x.pfx_reset, docno_change: x.docno_change, f: x.f })))
      ok(r.message)
      refetch()
    } catch (e) { fail(say(e, 'Error during save')) } finally { setSaving(false) }
  }
  function openPrefixes() {
    if (sel === null) return notifications.show({ message: 'Please select a document!', color: 'yellow' })
    setPfx(rows[sel])
  }

  return (
    <Modal opened onClose={onClose} size="95%" radius="lg" title={<Title>Document Number</Title>}>
      <Stack gap="sm">
        <Text size="xs" c="dimmed">Tokens: 1 Prefix · 2 Year From · 3 Year To · 4 Sh YearFrom · 5 Sh YearTo · 6 DocNo · 7 ShDocNo · 8/9/10 Adnl Doc No 1/2/3 · anything else is printed as typed. Example uses the active financial year.</Text>
        <ScrollArea h={380} type="auto">
          {isLoading ? <Text size="sm" c="dimmed">Loading...</Text> : (
            <Table stickyHeader withColumnBorders highlightOnHover style={{ minWidth: 1500 }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={190}>Document</Table.Th><Table.Th w={110}>Cont.Document No</Table.Th><Table.Th w={70}>Pfx-Wise Reset No</Table.Th><Table.Th w={70}>Allow DocNo Change</Table.Th>
                  {Array.from({ length: 14 }, (_, i) => <Table.Th key={i} w={52} ta="center">F{i + 1}</Table.Th>)}
                  <Table.Th w={160}>Example</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r, i) => (
                  <Table.Tr key={r.doc_id} onClick={() => setSel(i)} style={{ background: sel === i ? 'var(--vt-gold-chip)' : undefined }}>
                    <Table.Td>{r.name}</Table.Td>
                    <Table.Td p={2}><TextInput size="xs" aria-label={`Continuation group of ${r.name}`} value={r.cont_group} onFocus={() => setSel(i)} onChange={(e) => patch(i, { cont_group: e.currentTarget.value })} /></Table.Td>
                    <Table.Td ta="center"><Checkbox color="kumkum" aria-label={`Prefix-wise reset for ${r.name}`} checked={r.pfx_reset} onChange={(e) => patch(i, { pfx_reset: e.currentTarget.checked })} /></Table.Td>
                    <Table.Td ta="center"><Checkbox color="kumkum" aria-label={`Allow number change for ${r.name}`} checked={r.docno_change} onChange={(e) => patch(i, { docno_change: e.currentTarget.checked })} /></Table.Td>
                    {r.f.map((v, k) => <Table.Td key={k} p={2}><TextInput size="xs" aria-label={`F${k + 1} of ${r.name}`} value={v} onFocus={() => setSel(i)} onChange={(e) => setF(i, k, e.currentTarget.value)} styles={{ input: { textAlign: 'center', paddingInline: 2 } }} /></Table.Td>)}
                    <Table.Td className="vt-num" fw={600}>{example(r)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
        <Group justify="space-between">
          <Button variant="light" color="kumkum" onClick={openPrefixes}>Prefix Settings</Button>
          <Group>
            <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={save}>Save</Button>
            <Button variant="default" onClick={onClose}>Close</Button>
          </Group>
        </Group>
      </Stack>
      {pfx && <PrefixDialog doc={pfx} onClose={() => setPfx(null)} />}
    </Modal>
  )
}

const BLANK_PFX = { prefix: '', operator: '', field: '', value: '' }

function PrefixDialog({ doc, onClose }) {
  const { data, isLoading } = useQuery({ queryKey: ['other-doc-prefixes', doc.doc_id], queryFn: () => api.getDocPrefixes(doc.doc_id), staleTime: 0 })
  const confirm = useConfirm()
  const [rows, setRows] = useState([])
  useEffect(() => { if (data) setRows(data.rows.length ? data.rows : [{ ...BLANK_PFX }]) }, [data])
  const upd = (i, p) => setRows((rs) => rs.map((r, ri) => (ri === i ? { ...r, ...p } : r)))
  async function remove(i) {
    if (!(await confirm({ title: 'Remove prefix', message: `Do You want to Remove the Prefix --> ${rows[i].prefix} ?`, confirmLabel: 'Remove' }))) return
    setRows((rs) => (rs.length > 1 ? rs.filter((_, ri) => ri !== i) : [{ ...BLANK_PFX }]))
  }
  async function save() {
    try {
      const r = await api.saveDocPrefixes(doc.doc_id, rows)
      notifications.show({ message: r.message, color: r.message === 'Please Fill Details' ? 'yellow' : 'teal' })
      onClose()
    } catch (e) { fail(say(e, 'Error during save')) }
  }
  return (
    <Modal opened onClose={onClose} size="lg" radius="lg" title={<Title>Prefix Settings: {doc.name}</Title>}>
      <Stack gap="sm">
        <Text size="xs" c="dimmed">A prefix is offered on the document when its field matches the value (leave the field empty to always offer it).</Text>
        <ScrollArea h={280} type="auto">
          {isLoading ? <Text size="sm" c="dimmed">Loading...</Text> : (
            <Table stickyHeader withColumnBorders>
              <Table.Thead><Table.Tr><Table.Th>Prefix</Table.Th><Table.Th>Field Code</Table.Th><Table.Th w={90}>Operator</Table.Th><Table.Th>Value</Table.Th><Table.Th w={40} /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {rows.map((r, i) => (
                  <Table.Tr key={i}>
                    <Table.Td p={2}><TextInput size="xs" aria-label="Prefix" value={r.prefix} onChange={(e) => upd(i, { prefix: e.currentTarget.value })} /></Table.Td>
                    <Table.Td p={2}><Select size="xs" aria-label="Field code" searchable clearable data={data?.columns || []} value={r.field || null} onChange={(v) => upd(i, { field: v || '' })} /></Table.Td>
                    <Table.Td p={2}><Select size="xs" aria-label="Operator" data={OPERATORS} clearable value={r.operator || null} onChange={(v) => upd(i, { operator: v || '' })} /></Table.Td>
                    <Table.Td p={2}><TextInput size="xs" aria-label="Value" value={r.value} onChange={(e) => upd(i, { value: e.currentTarget.value })} /></Table.Td>
                    <Table.Td p={2}><ActionIcon variant="subtle" color="red" aria-label="Remove prefix" onClick={() => remove(i)}><Trash2 size={16} /></ActionIcon></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
        <Group justify="space-between">
          <Button variant="light" color="kumkum" leftSection={<Plus size={16} />} onClick={() => setRows((rs) => [...rs, { ...BLANK_PFX }])}>Add row</Button>
          <Group>
            <Button color="kumkum" leftSection={<Save size={16} />} onClick={save}>Save</Button>
            <Button variant="default" onClick={onClose}>Close</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  )
}

// ------------------------------------------------------------------------------ Transaction / Voucher Settings
/**
 * Legacy FrmUtlTrnSettings: pick a document, change its switches (authorisation, freeze, copy from, amendment, import/export ...)
 * and Save. These are the same UtlTransactions columns the Doc Designer and the whole web app read, so a change shows up
 * on the document right away. "Misc. Settings" holds the item captions, search size and menu icons (UtlMisc).
 */
export function TransactionSettingsDialog({ onClose, kind = 'transaction' }) {
  const isMaster = kind === 'master'
  const { data: docs = [] } = useQuery({ queryKey: ['other-trn-docs', kind], queryFn: () => api.listTrnDocuments(kind), staleTime: 60_000 })
  const [docId, setDocId] = useState(null)
  const { data, isFetching, refetch } = useQuery({ queryKey: ['other-trn', kind, docId], queryFn: () => api.getTrnSettings(docId, kind), enabled: Boolean(docId), staleTime: 0 })
  const [vals, setVals] = useState({})
  const [tab, setTab] = useState(null)
  const [saving, setSaving] = useState(false)
  const [misc, setMisc] = useState(false)
  useEffect(() => {
    if (data) { setVals(data.values); setTab((t) => (data.sections.some((s) => s.title === t) ? t : data.sections[0]?.title)) }
  }, [data])
  const dirty = data && JSON.stringify(vals) !== JSON.stringify(data.values)
  const set = (k, v) => setVals((cur) => ({ ...cur, [k]: v }))

  async function save() {
    setSaving(true)
    try {
      const r = await api.saveTrnSettings(docId, vals, kind)
      ok(r.message)
      refetch()
    } catch (e) { fail(say(e, 'Error during save')) } finally { setSaving(false) }
  }
  const section = data?.sections.find((s) => s.title === tab)

  return (
    <Modal opened onClose={onClose} size="xl" radius="lg" title={<Title>{isMaster ? 'Master Settings' : 'Transaction/Voucher Settings'}</Title>}>
      <Stack gap="sm">
        <Group align="flex-end" gap="xs">
          <Select label={isMaster ? 'Master' : 'Transaction'} searchable placeholder="Select a document" data={docs.map((d) => ({ value: String(d.doc_id), label: isMaster ? d.name : `${d.name} (${d.type})` }))} value={docId ? String(docId) : null} onChange={(v) => setDocId(v ? Number(v) : null)} style={{ flex: 1 }} />
          <Button variant="light" color="kumkum" onClick={() => setMisc(true)}>Misc. Settings</Button>
        </Group>
        {!docId ? (
          <Text size="sm" c="dimmed">Choose a document to see and change its settings.</Text>
        ) : isFetching && !data ? (
          <Text size="sm" c="dimmed">Loading...</Text>
        ) : data && (
          <>
            <Group gap={6} wrap="wrap">
              {data.sections.map((s) => (
                <Button key={s.title} size="compact-sm" radius="xl" variant={tab === s.title ? 'filled' : 'light'} color="kumkum" onClick={() => setTab(s.title)}>{s.title}</Button>
              ))}
            </Group>
            <ScrollArea h={330} type="auto">
              <Stack gap="xs" p={4}>
                {section?.fields.map((f) => (
                  <div key={f.key}>
                    {f.kind === 'flag' ? (
                      <Checkbox color="kumkum" label={f.caption} description={f.help || undefined} checked={Boolean(vals[f.key])} onChange={(e) => set(f.key, e.currentTarget.checked)} />
                    ) : f.kind === 'number' ? (
                      <NumberInput label={f.caption} description={f.help || undefined} min={0} hideControls w={220} value={vals[f.key] ?? 0} onChange={(v) => set(f.key, Number(v) || 0)} />
                    ) : f.kind === 'list' ? (
                      <Select label={f.caption} description={f.help || undefined} w={260} clearable data={(f.options || []).filter(Boolean)} value={vals[f.key] || null} onChange={(v) => set(f.key, v || '')} />
                    ) : (
                      <TextInput label={f.caption} description={f.help || undefined} value={vals[f.key] ?? ''} onChange={(e) => set(f.key, e.currentTarget.value)} />
                    )}
                  </div>
                ))}
              </Stack>
            </ScrollArea>
            <Group justify="flex-end">
              <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} disabled={!dirty} onClick={save}>Save</Button>
              <Button variant="default" disabled={!dirty} onClick={() => setVals(data.values)}>Cancel</Button>
              <Button variant="default" onClick={onClose}>Close</Button>
            </Group>
          </>
        )}
        {!docId && <Group justify="flex-end"><Button variant="default" onClick={onClose}>Close</Button></Group>}
      </Stack>
      {misc && <MiscDialog onClose={() => setMisc(false)} />}
    </Modal>
  )
}

function MiscDialog({ onClose }) {
  const { data } = useQuery({ queryKey: ['other-misc'], queryFn: api.getMisc, staleTime: 0 })
  const [f, setF] = useState(null)
  useEffect(() => { if (data) setF(data) }, [data])
  async function save() {
    try {
      const r = await api.saveMisc(f)
      ok(r.message)
      onClose()
    } catch (e) { fail(say(e, 'Error during save')) }
  }
  return (
    <Modal opened onClose={onClose} size="md" radius="lg" title={<Title>Misc. Settings</Title>}>
      {!f ? <Text size="sm" c="dimmed">Loading...</Text> : (
        <Stack gap="sm">
          <TextInput label="Item Caption" value={f.item_caption} onChange={(e) => setF({ ...f, item_caption: e.currentTarget.value })} />
          <TextInput label="Item Name Caption" value={f.item_name_caption} onChange={(e) => setF({ ...f, item_name_caption: e.currentTarget.value })} />
          <TextInput label="Item Desc Caption" value={f.item_desc_caption} onChange={(e) => setF({ ...f, item_desc_caption: e.currentTarget.value })} />
          <NumberInput label="Fld Search Top N" min={0} hideControls value={f.search_top_n} onChange={(v) => setF({ ...f, search_top_n: Number(v) || 0 })} />
          <Checkbox color="kumkum" label="Show Menu Icons" checked={f.show_menu_icons} onChange={(e) => setF({ ...f, show_menu_icons: e.currentTarget.checked })} />
          <Group justify="flex-end">
            <Button color="kumkum" leftSection={<Save size={16} />} onClick={save}>Save</Button>
            <Button variant="default" onClick={onClose}>Cancel</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}

export const MasterSettingsDialog = (props) => <TransactionSettingsDialog {...props} kind="master" />

// ------------------------------------------------------------------------------------------------------ Filter Settings
/** Legacy FrmUtlFilterSettings: for a master or transaction document, which text columns its search can be filtered on. */
export function FilterSettingsDialog({ onClose }) {
  const confirm = useConfirm()
  const [kind, setKind] = useState('master')
  const [docId, setDocId] = useState(null)
  const { data: docs = [] } = useQuery({ queryKey: ['other-filter-docs', kind], queryFn: () => api.listFilterDocuments(kind), staleTime: 60_000 })
  const { data, isFetching, refetch } = useQuery({ queryKey: ['other-filter', docId], queryFn: () => api.getFilter(docId), enabled: Boolean(docId), staleTime: 0 })
  const [items, setItems] = useState([])
  useEffect(() => { if (data) setItems(data.items) }, [data])
  const dirty = data && JSON.stringify(items) !== JSON.stringify(data.items)

  async function save() {
    try {
      const r = await api.saveFilter(docId, items)
      ok(r.message)
      refetch()
    } catch (e) { fail(say(e, 'Error during save')) }
  }
  async function remove() {
    if (!(await confirm({ title: 'Delete', message: 'Are you sure you want to delete this record?', confirmLabel: 'Delete' }))) return
    try {
      const r = await api.deleteFilter(docId)
      ok(r.message)
      refetch()
    } catch (e) { fail(say(e, 'Error during delete')) }
  }
  return (
    <Modal opened onClose={onClose} size="lg" radius="lg" title={<Title>Filter Settings</Title>}>
      <Stack gap="sm">
        <Group align="flex-end" gap="md" wrap="wrap">
          <Radio.Group label="Apply Filter On" value={kind} onChange={(v) => { setKind(v); setDocId(null); setItems([]) }}>
            <Group mt={4}><Radio color="kumkum" value="master" label="Masters" /><Radio color="kumkum" value="transaction" label="Transactions" /></Group>
          </Radio.Group>
          <Select label="Document" searchable placeholder="Select a document" data={docs.map((d) => ({ value: String(d.doc_id), label: d.name }))} value={docId ? String(docId) : null} onChange={(v) => setDocId(v ? Number(v) : null)} style={{ flex: 1 }} />
        </Group>
        {!docId ? <Text size="sm" c="dimmed">Please Select a Document!!</Text> : isFetching && !data ? <Text size="sm" c="dimmed">Loading...</Text> : (
          <ScrollArea h={300} type="auto">
            <Table stickyHeader withColumnBorders>
              <Table.Thead><Table.Tr><Table.Th w={70}>Select</Table.Th><Table.Th>Field Code</Table.Th><Table.Th>Field Caption</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {items.map((it, i) => (
                  <Table.Tr key={it.code}>
                    <Table.Td ta="center"><Checkbox color="kumkum" aria-label={`Filter on ${it.code}`} checked={it.selected} onChange={(e) => setItems((rs) => rs.map((x, xi) => (xi === i ? { ...x, selected: e.currentTarget.checked } : x)))} /></Table.Td>
                    <Table.Td>{it.code}</Table.Td>
                    <Table.Td p={2}><TextInput size="xs" aria-label={`Caption of ${it.code}`} value={it.caption} onChange={(e) => { const v = e.currentTarget.value; setItems((rs) => rs.map((x, xi) => (xi === i ? { ...x, caption: v } : x))) }} /></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
        <Group justify="space-between">
          <Button variant="default" color="red" leftSection={<Trash2 size={16} />} disabled={!docId} onClick={remove}>Delete</Button>
          <Group>
            <Button color="kumkum" leftSection={<Save size={16} />} disabled={!dirty} onClick={save}>Save</Button>
            <Button variant="default" onClick={onClose}>Close</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  )
}

// ------------------------------------------------------------------------------------------- Form Userwise Settings
const AFTER_SAVE = [{ value: '-', label: '-' }, { value: 'N', label: 'New Doc' }, { value: 'S', label: 'Save Doc' }, { value: 'C', label: 'Clear Doc' }]
const FORM_FLAGS = [['header', 'Header Grid'], ['detail', 'Detail Grid'], ['footer', 'Footer Grid'], ['total', 'Total Grid'], ['newmode', 'New Mode'], ['loadlasttrnno', 'Load Last Transaction'], ['fullscreen', 'Full Screen']]

/** Legacy frmUtlFormSettings: the signed-in user's own preferences for each transaction screen (any user can open it). */
export function FormUserwiseDialog({ onClose }) {
  const { data, isLoading } = useQuery({ queryKey: ['other-form-settings'], queryFn: api.getFormSettings, staleTime: 0 })
  const [rows, setRows] = useState([])
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (data) setRows(data) }, [data])
  const patch = (i, p) => setRows((rs) => rs.map((r, ri) => (ri === i ? { ...r, ...p } : r)))
  async function save() {
    setSaving(true)
    try {
      const r = await api.saveFormSettings(rows)
      ok(r.message)
    } catch (e) { fail(say(e, 'Error during save')) } finally { setSaving(false) }
  }
  return (
    <Modal opened onClose={onClose} size="95%" radius="lg" title={<Title>Form Settings</Title>}>
      <Stack gap="sm">
        <Text size="xs" c="dimmed">These preferences belong to you (the signed-in user) and apply to the Windows application's transaction forms.</Text>
        <ScrollArea h={380} type="auto">
          {isLoading ? <Text size="sm" c="dimmed">Loading...</Text> : (
            <Table stickyHeader withColumnBorders highlightOnHover style={{ minWidth: 980 }}>
              <Table.Thead><Table.Tr><Table.Th>Document</Table.Th>{FORM_FLAGS.map(([, label]) => <Table.Th key={label} ta="center" w={86}>{label}</Table.Th>)}<Table.Th w={130}>After Save</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {rows.map((r, i) => (
                  <Table.Tr key={r.doc_id}>
                    <Table.Td>{r.name}</Table.Td>
                    {FORM_FLAGS.map(([k, label]) => <Table.Td key={k} ta="center"><Checkbox color="kumkum" aria-label={`${label} for ${r.name}`} checked={r[k]} onChange={(e) => patch(i, { [k]: e.currentTarget.checked })} /></Table.Td>)}
                    <Table.Td p={2}><Select size="xs" aria-label={`After save for ${r.name}`} allowDeselect={false} data={AFTER_SAVE} value={r.after_save} onChange={(v) => patch(i, { after_save: v || '-' })} /></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
        <Group justify="flex-end">
          <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={save}>Save</Button>
          <Button variant="default" onClick={onClose}>Close</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

// ----------------------------------------------------------------------------------------------------- Stock Settings
const AFFECTS = [{ value: 'Add', label: 'Add' }, { value: 'Reduce', label: 'Reduce' }, { value: 'Transfer', label: 'Transfer' }, { value: 'NA', label: 'NA' }]
const ACTIONS = ['Save', 'Auth', 'QC']

/** Legacy frmUtlStkSettings: how each transaction affects stock and which of its fields carry the quantity, rate and locations. */
export function StockSettingsDialog({ onClose }) {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['other-stock'], queryFn: api.getStockSettings, staleTime: 0 })
  const [rows, setRows] = useState([])
  const [all, setAll] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (data) setRows(data.documents) }, [data])
  const patch = (i, p) => setRows((rs) => rs.map((r, ri) => (ri === i ? { ...r, ...p } : r)))
  const dirty = data && JSON.stringify(rows) !== JSON.stringify(data.documents)
  async function save() {
    setSaving(true)
    try {
      const r = await api.saveStockSettings(rows)
      ok(r.message)
      refetch()
    } catch (e) { fail(say(e, 'Error during Save')) } finally { setSaving(false) }
  }
  const visible = rows.map((r, i) => [r, i]).filter(([r]) => all || (r.affects && r.affects !== 'NA'))
  const fld = (r, i, key, list = r.fields) => <Select size="xs" aria-label={`${key} of ${r.name}`} searchable clearable data={Array.from(new Set([...list, ...(r[key] ? [r[key]] : [])]))} value={r[key] || null} onChange={(v) => patch(i, { [key]: v || '' })} disabled={!r.affects || r.affects === 'NA'} />
  return (
    <Modal opened onClose={onClose} size="97%" radius="lg" title={<Title>Stock Setting</Title>}>
      <Stack gap="sm">
        <Checkbox color="kumkum" label="Show All Transactions" checked={all} onChange={(e) => setAll(e.currentTarget.checked)} />
        <ScrollArea h={360} type="auto">
          {isLoading ? <Text size="sm" c="dimmed">Loading...</Text> : visible.length === 0 ? <Text size="sm" c="dimmed" p="sm">No transaction affects stock. Tick Show All Transactions to set one up.</Text> : (
            <Table stickyHeader withColumnBorders style={{ minWidth: 1500 }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={170}>Document</Table.Th><Table.Th w={110}>Affects Stock</Table.Th><Table.Th w={130}>Affects Stock Field</Table.Th><Table.Th w={100}>Affect On</Table.Th>
                  <Table.Th w={130}>Qty Field</Table.Th><Table.Th w={90}>Valuation</Table.Th><Table.Th w={130}>Rate Field</Table.Th><Table.Th w={130}>Loc Field</Table.Th><Table.Th w={130}>Loc 2 Field</Table.Th><Table.Th w={120}>Rej Loc</Table.Th><Table.Th w={130}>Rej Field</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visible.map(([r, i]) => (
                  <Table.Tr key={r.doc_id}>
                    <Table.Td>{r.name}</Table.Td>
                    <Table.Td p={2}><Select size="xs" aria-label={`Affects stock for ${r.name}`} clearable data={AFFECTS} value={r.affects || null} onChange={(v) => patch(i, { affects: v || '' })} /></Table.Td>
                    <Table.Td p={2}>{fld(r, i, 'affects_fld')}</Table.Td>
                    <Table.Td p={2}><Select size="xs" aria-label={`Affect on for ${r.name}`} clearable data={ACTIONS} value={r.action || null} onChange={(v) => patch(i, { action: v || '' })} disabled={!r.affects || r.affects === 'NA'} /></Table.Td>
                    <Table.Td p={2}>{fld(r, i, 'qty_fld', r.numeric_fields)}</Table.Td>
                    <Table.Td p={2}><Select size="xs" aria-label={`Valuation for ${r.name}`} clearable data={['Y', 'N']} value={r.valuation || null} onChange={(v) => patch(i, { valuation: v || '' })} disabled={!r.affects || r.affects === 'NA'} /></Table.Td>
                    <Table.Td p={2}>{fld(r, i, 'rate_fld', r.numeric_fields)}</Table.Td>
                    <Table.Td p={2}>{fld(r, i, 'loc_fld')}</Table.Td>
                    <Table.Td p={2}>{fld(r, i, 'loc2_fld')}</Table.Td>
                    <Table.Td p={2}><Select size="xs" aria-label={`Reject location for ${r.name}`} searchable clearable data={data?.locations || []} value={r.rej_loc || null} onChange={(v) => patch(i, { rej_loc: v || '' })} /></Table.Td>
                    <Table.Td p={2}>{fld(r, i, 'rej_fld')}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
        <Group justify="flex-end">
          <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} disabled={!dirty} onClick={save}>Save</Button>
          <Button variant="default" onClick={onClose}>Close</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

// ----------------------------------------------------------------------------------------------------- Post Doc List
/** Legacy frmUtlPostDocList + frmUtlPostDocDesign: the "post document" definitions (name, condition, pending condition, report and key columns). */
export function PostDocListDialog({ onClose }) {
  const confirm = useConfirm()
  const { data: list = [], refetch } = useQuery({ queryKey: ['other-post-docs'], queryFn: api.listPostDocs, staleTime: 0 })
  const [edit, setEdit] = useState(null) // null = list, {id|null, ...} = designer
  const [sel, setSel] = useState(null)
  async function open(id) {
    if (id === null) return setEdit({ id: null, name: '', remarks: '', condition: '', pending_condition: '', columns: [{ table: '', field: '', caption: '', date_filter: false, hide: false, allow_edit: false }], primary: [{ table: '', field: '' }] })
    try { setEdit(await api.getPostDoc(id)) } catch (e) { fail(say(e, 'Could not open that record')) }
  }
  async function remove() {
    const row = list.find((x) => x.id === sel)
    if (!row) return
    if (!(await confirm({ title: 'Deletion Confirmation...', message: `Are you sure you want to delete ${row.name}?`, confirmLabel: 'Delete' }))) return
    try {
      const r = await api.deletePostDoc(row.id)
      ok(r.message)
      setSel(null)
      refetch()
    } catch (e) { fail(say(e, 'Error during delete')) }
  }
  return (
    <Modal opened onClose={onClose} size="xl" radius="lg" title={<Title>Post Doc List</Title>}>
      <Stack gap="sm">
        <ScrollArea h={300} type="auto">
          {list.length === 0 ? <EmptyState title="No post documents" hint="Add one to define a document that posts from pending items." /> : (
            <Table stickyHeader highlightOnHover withColumnBorders>
              <Table.Thead><Table.Tr><Table.Th w={90}>Post DocID</Table.Th><Table.Th>Post Document Name</Table.Th><Table.Th>Remarks</Table.Th><Table.Th>Condition Text</Table.Th><Table.Th>PendCond</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {list.map((r) => (
                  <Table.Tr key={r.id} onClick={() => setSel(r.id)} onDoubleClick={() => open(r.id)} style={{ cursor: 'pointer', background: sel === r.id ? 'var(--vt-gold-chip)' : undefined }}>
                    <Table.Td>{r.id}</Table.Td><Table.Td>{r.name}</Table.Td><Table.Td>{r.remarks}</Table.Td><Table.Td>{r.condition}</Table.Td><Table.Td>{r.pending_condition}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
        <Group justify="space-between">
          <Group>
            <Button variant="light" color="kumkum" leftSection={<Plus size={16} />} onClick={() => open(null)}>Add</Button>
            <Button variant="light" color="kumkum" leftSection={<Pencil size={16} />} disabled={sel === null} onClick={() => open(sel)}>Edit</Button>
            <Button variant="default" color="red" leftSection={<Trash2 size={16} />} disabled={sel === null} onClick={remove}>Delete</Button>
          </Group>
          <Button variant="default" onClick={onClose}>Close</Button>
        </Group>
      </Stack>
      {edit && <PostDocDesigner doc={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refetch() }} />}
    </Modal>
  )
}

function PostDocDesigner({ doc, onClose, onSaved }) {
  const { data: tables = [] } = useQuery({ queryKey: ['other-tables'], queryFn: api.listTables, staleTime: 5 * 60_000 })
  const [f, setF] = useState(doc)
  const [saving, setSaving] = useState(false)
  const setCol = (i, p) => setF((cur) => ({ ...cur, columns: cur.columns.map((c, ci) => (ci === i ? { ...c, ...p } : c)) }))
  const setKey = (i, p) => setF((cur) => ({ ...cur, primary: cur.primary.map((c, ci) => (ci === i ? { ...c, ...p } : c)) }))
  async function save() {
    setSaving(true)
    try {
      const body = { name: f.name, remarks: f.remarks, condition: f.condition, pending_condition: f.pending_condition, columns: f.columns, primary: f.primary }
      const r = f.id === null ? await api.addPostDoc(body) : await api.updatePostDoc(f.id, body)
      ok(r.message)
      onSaved()
    } catch (e) { fail(say(e, 'Error during save')) } finally { setSaving(false) }
  }
  return (
    <Modal opened onClose={onClose} size="xl" radius="lg" title={<Title>Post Document Designer</Title>}>
      <Stack gap="sm">
        <Group grow align="flex-start">
          <TextInput className="vt-field-required" label="Name" required readOnly={f.id !== null} value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} maxLength={50} />
          <TextInput label="Remarks" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.currentTarget.value })} maxLength={500} />
        </Group>
        <Textarea className="vt-field-required" label="Condition" required autosize minRows={2} value={f.condition} onChange={(e) => setF({ ...f, condition: e.currentTarget.value })} />
        <Textarea className="vt-field-required" label="Pending Condition" required autosize minRows={2} value={f.pending_condition} onChange={(e) => setF({ ...f, pending_condition: e.currentTarget.value })} />
        <Text size="sm" fw={600}>Report Columns</Text>
        <ScrollArea h={170} type="auto">
          <Table withColumnBorders>
            <Table.Thead><Table.Tr><Table.Th w={40}>#</Table.Th><Table.Th>Table</Table.Th><Table.Th>Field</Table.Th><Table.Th>Caption</Table.Th><Table.Th w={70}>Date Filter</Table.Th><Table.Th w={60}>Hide</Table.Th><Table.Th w={70}>Allow Edit</Table.Th><Table.Th w={40} /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {f.columns.map((c, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{i + 1}</Table.Td>
                  <Table.Td p={2}><Select size="xs" aria-label="Table" searchable data={tables} value={c.table || null} onChange={(v) => setCol(i, { table: v || '' })} /></Table.Td>
                  <Table.Td p={2}><FieldPick table={c.table} value={c.field} onChange={(v) => setCol(i, { field: v })} /></Table.Td>
                  <Table.Td p={2}><TextInput size="xs" aria-label="Caption" value={c.caption} maxLength={50} onChange={(e) => setCol(i, { caption: e.currentTarget.value })} /></Table.Td>
                  <Table.Td ta="center"><Checkbox color="kumkum" aria-label="Date filter" checked={c.date_filter} onChange={(e) => setCol(i, { date_filter: e.currentTarget.checked })} /></Table.Td>
                  <Table.Td ta="center"><Checkbox color="kumkum" aria-label="Hide" checked={c.hide} onChange={(e) => setCol(i, { hide: e.currentTarget.checked })} /></Table.Td>
                  <Table.Td ta="center"><Checkbox color="kumkum" aria-label="Allow edit" checked={c.allow_edit} onChange={(e) => setCol(i, { allow_edit: e.currentTarget.checked })} /></Table.Td>
                  <Table.Td p={2}><ActionIcon variant="subtle" color="red" aria-label="Remove column" onClick={() => setF((cur) => ({ ...cur, columns: cur.columns.filter((_, ci) => ci !== i) }))}><Trash2 size={16} /></ActionIcon></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <Button variant="subtle" color="kumkum" size="compact-sm" w="fit-content" leftSection={<Plus size={14} />} onClick={() => setF((cur) => ({ ...cur, columns: [...cur.columns, { table: '', field: '', caption: '', date_filter: false, hide: false, allow_edit: false }] }))}>Add column</Button>
        <Text size="sm" fw={600}>Primary Columns</Text>
        <Table withColumnBorders>
          <Table.Thead><Table.Tr><Table.Th w={40}>#</Table.Th><Table.Th>Table</Table.Th><Table.Th>Field</Table.Th><Table.Th w={40} /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {f.primary.map((c, i) => (
              <Table.Tr key={i}>
                <Table.Td>{i + 1}</Table.Td>
                <Table.Td p={2}><Select size="xs" aria-label="Key table" searchable data={tables} value={c.table || null} onChange={(v) => setKey(i, { table: v || '' })} /></Table.Td>
                <Table.Td p={2}><FieldPick table={c.table} value={c.field} onChange={(v) => setKey(i, { field: v })} /></Table.Td>
                <Table.Td p={2}><ActionIcon variant="subtle" color="red" aria-label="Remove key" onClick={() => setF((cur) => ({ ...cur, primary: cur.primary.filter((_, ci) => ci !== i) }))}><Trash2 size={16} /></ActionIcon></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Button variant="subtle" color="kumkum" size="compact-sm" w="fit-content" leftSection={<Plus size={14} />} onClick={() => setF((cur) => ({ ...cur, primary: [...cur.primary, { table: '', field: '' }] }))}>Add key column</Button>
        <Group justify="flex-end">
          <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={save}>Save</Button>
          <Button variant="default" onClick={onClose}>Cancel</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function FieldPick({ table, value, onChange }) {
  const { data: cols = [] } = useQuery({ queryKey: ['other-columns', table], queryFn: () => api.listColumns(table), enabled: Boolean(table), staleTime: 60_000 })
  return <Select size="xs" aria-label="Field" searchable data={cols} value={value || null} onChange={(v) => onChange(v || '')} disabled={!table} />
}
