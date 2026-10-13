import { useEffect, useState } from 'react'
import { ActionIcon, Alert, Button, Checkbox, Group, NumberInput, PasswordInput, SimpleGrid, Skeleton, Stack, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, Plus, Save, Send, Trash2 } from 'lucide-react'
import * as mailApi from '../../api/endpoints/mailSettings'
import { SectionCard } from '../../components/ui/EntryParts'

/**
 * Email (SMTP) settings — ADMIN only. Every field is shown and editable, including the password (masked with a show
 * toggle). They are the same UtlGSettings rows the legacy EXE uses, so both apps send mail with one configuration.
 */
/** SMS providers (UtlMsgSettings). The URL carries the gateway credentials, so only ADMIN sees this card. */
function SmsProviders() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['sms-providers-admin'], queryFn: mailApi.getSmsProviders, retry: false })
  const [rows, setRows] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (data) setRows(data)
  }, [data])
  if (!rows) return null
  const set = (i, k, v) => setRows((r) => r.map((x, xi) => (xi === i ? { ...x, [k]: v } : x)))
  async function onSave() {
    setSaving(true)
    try {
      const saved = await mailApi.saveSmsProviders(rows)
      setRows(saved)
      qc.invalidateQueries({ queryKey: ['sms-providers'] })
      notifications.show({ message: 'SMS providers saved', color: 'teal' })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not save', color: 'red' })
    } finally {
      setSaving(false)
    }
  }
  return (
    <SectionCard title="SMS providers" hint="Gateway used by Options > Send SMS. In the URL, <<MOBNO>> is replaced by the mobile number and <<MSG>> by the message.">
      <Stack gap="md">
        {rows.length === 0 && (
          <Text size="sm" c="dimmed">
            No provider yet. Add one to enable sending SMS.
          </Text>
        )}
        {rows.map((r, i) => (
          <Stack key={r.RowID ?? `n${i}`} gap="xs" p="sm" style={{ border: '1px solid var(--vt-line)', borderRadius: 12 }}>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label="Provider" value={r.Provider || ''} onChange={(e) => set(i, 'Provider', e.currentTarget.value)} />
              <NumberInput label="Daily limit" min={0} hideControls value={r.DailyLimit ?? 0} onChange={(v) => set(i, 'DailyLimit', v)} />
              <Group align="flex-end" gap="sm" wrap="nowrap">
                <Checkbox color="kumkum" label="Default" checked={r.Def === 'Y'} onChange={(e) => setRows((all) => all.map((x, xi) => ({ ...x, Def: xi === i && e.currentTarget.checked ? 'Y' : 'N' })))} />
                <ActionIcon variant="subtle" color="red" size={36} aria-label={`Remove ${r.Provider || 'provider'}`} onClick={() => setRows((all) => all.filter((_, xi) => xi !== i))}>
                  <Trash2 size={16} />
                </ActionIcon>
              </Group>
            </SimpleGrid>
            <TextInput label="Gateway URL" value={r.SMSURL || ''} onChange={(e) => set(i, 'SMSURL', e.currentTarget.value)} />
          </Stack>
        ))}
        <Group justify="space-between">
          <Button variant="light" color="kumkum" leftSection={<Plus size={16} />} onClick={() => setRows((r) => [...r, { Provider: '', DailyLimit: 0, SMSURL: '', Def: r.length ? 'N' : 'Y' }])}>
            Add provider
          </Button>
          <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={onSave}>
            Save providers
          </Button>
        </Group>
      </Stack>
    </SectionCard>
  )
}

export default function EmailSettingsTab() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['mail-settings'], queryFn: mailApi.getMailSettings, retry: false })
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)
  useEffect(() => {
    if (data) setForm(data)
  }, [data])
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const flag = (k) => (form?.[k] || '').toUpperCase() === 'Y'

  async function onSave() {
    setSaving(true)
    try {
      await mailApi.saveMailSettings(form)
      notifications.show({ message: 'Email settings saved', color: 'teal' })
      qc.invalidateQueries({ queryKey: ['mail-settings'] })
      qc.invalidateQueries({ queryKey: ['master-layout'] })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not save', color: 'red' })
    } finally {
      setSaving(false)
    }
  }
  async function onTest() {
    setTesting(true)
    try {
      const r = await mailApi.sendTestMail(testTo)
      notifications.show({ message: r.message, color: 'teal' })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Test mail failed', color: 'red' })
    } finally {
      setTesting(false)
    }
  }

  if (error) return <Alert color="red">{error?.response?.data?.detail || 'Only ADMIN can view the Email settings.'}</Alert>
  if (isLoading || !form) return <Skeleton height={320} radius="md" />

  return (
    <Stack gap="md" maw={760}>
      <SectionCard title="SMTP server" hint="Used for every mail the app sends. Visible to ADMIN only.">
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="SMTP Host Name" placeholder="smtp.gmail.com" value={form.host} onChange={(e) => set('host', e.currentTarget.value)} />
          <TextInput label="Server Port" inputMode="numeric" placeholder="587" value={form.port} onChange={(e) => set('port', e.currentTarget.value.replace(/\D/g, ''))} />
          <TextInput label="Mail ID (user name)" value={form.mail_id} onChange={(e) => set('mail_id', e.currentTarget.value)} autoComplete="off" />
          <PasswordInput label="Mail Password" value={form.password} onChange={(e) => set('password', e.currentTarget.value)} autoComplete="new-password" />
        </SimpleGrid>
        <Group mt="md" gap="lg">
          <Checkbox color="kumkum" label="Enable SSL" checked={flag('enable_ssl')} onChange={(e) => set('enable_ssl', e.currentTarget.checked ? 'Y' : 'N')} />
          <Checkbox color="kumkum" label="Enable TLS" checked={flag('enable_tls')} onChange={(e) => set('enable_tls', e.currentTarget.checked ? 'Y' : 'N')} />
        </Group>
      </SectionCard>

      <SectionCard title="Approval mails" hint="When on, masters that need approval offer Options > Send Mail for Approval, which mails everyone holding the authorise right.">
        <Stack gap="sm">
          <Checkbox color="kumkum" label="Send e-Mail for approval" checked={flag('approval_mail')} onChange={(e) => set('approval_mail', e.currentTarget.checked ? 'Y' : 'N')} />
          <TextInput label="Approval link URL" description="The approval page the mail's link opens. Leave blank to send no link (approvers use Options > Approve in the app)." value={form.approval_url} onChange={(e) => set('approval_url', e.currentTarget.value)} />
        </Stack>
      </SectionCard>

      <SmsProviders />

      <Group justify="space-between" wrap="wrap">
        <Group gap="xs" align="flex-end">
          <TextInput label="Send a test mail to" placeholder="you@example.com" value={testTo} onChange={(e) => setTestTo(e.currentTarget.value)} w={260} />
          <Button variant="light" color="kumkum" leftSection={<Send size={16} />} loading={testing} disabled={!testTo.includes('@')} onClick={onTest}>
            Send test
          </Button>
        </Group>
        <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={onSave}>
          Save
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        <Mail size={12} style={{ verticalAlign: -2 }} aria-hidden /> Save first, then send a test mail to confirm the details work.
      </Text>
    </Stack>
  )
}
