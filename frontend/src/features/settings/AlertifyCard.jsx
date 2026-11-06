import { useEffect, useState } from 'react'
import { Alert, Button, Card, Group, NumberInput, PasswordInput, SimpleGrid, Stack, Switch, Text, TextInput } from '@mantine/core'
import { TimeInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, PlugZap, Save, XCircle } from 'lucide-react'
import * as alertifyApi from '../../api/endpoints/alertify'
import AlertifyLogo from '../alertify/AlertifyLogo'

const errText = (e) => e?.response?.data?.detail || e?.message || 'Something went wrong'

/**
 * Global Settings > Alertify (ADMIN). The reminder app's server details - server, port, database name, user name, password -
 * the default alert time, and the on / off switch for the Alertify button on
 * Seva Entry, Donation Receipt and Hall Booking. Test tries the typed details without saving; Save tests changed connection
 * details first, so a wrong password never replaces a working one. The saved password is never shown: leave the box blank to keep it.
 */
export default function AlertifyCard() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['alertify-settings'], queryFn: alertifyApi.getAlertifySettings, staleTime: 0 })
  const [f, setF] = useState({ enabled: false, host: '', port: 1433, database: '', user: '', password: '', default_time: '11:00' })
  const [busy, setBusy] = useState(null) // 'test' | 'save'
  const [result, setResult] = useState(null) // { ok, message }

  useEffect(() => {
    if (!data) return
    setF({ enabled: data.enabled, host: data.host || '', port: data.port || 1433, database: data.database || '', user: data.user || '', password: '', default_time: data.default_time || '11:00' })
  }, [data])
  const set = (k) => (v) => { setResult(null); setF((cur) => ({ ...cur, [k]: v })) }
  const body = () => ({ ...f })

  async function test() {
    setBusy('test')
    try {
      setResult(await alertifyApi.testAlertify(body()))
    } catch (e) {
      setResult({ ok: false, message: errText(e) })
    } finally {
      setBusy(null)
    }
  }
  // The on / off switch applies at once (nothing else is sent, so half-typed server details are not touched).
  async function toggle(on) {
    setF((cur) => ({ ...cur, enabled: on }))
    setResult(null)
    try {
      await alertifyApi.saveAlertify({ enabled: on })
      notifications.show({ message: on ? 'Alertify is on' : 'Alertify is off', color: 'teal' })
      qc.invalidateQueries({ queryKey: ['alertify-settings'] })
      qc.invalidateQueries({ queryKey: ['alertify-config'] })
    } catch (e) {
      setF((cur) => ({ ...cur, enabled: !on }))
      setResult({ ok: false, message: errText(e) })
    }
  }
  async function save() {
    setBusy('save')
    try {
      await alertifyApi.saveAlertify(body())
      setResult({ ok: true, message: 'Saved.' })
      notifications.show({ message: 'Alertify settings saved', color: 'teal' })
      qc.invalidateQueries({ queryKey: ['alertify-settings'] })
      qc.invalidateQueries({ queryKey: ['alertify-config'] })
    } catch (e) {
      setResult({ ok: false, message: errText(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card withBorder p="lg" radius="md">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <AlertifyLogo size={34} tagline="Create a reminder from a bill in one click" />
        <Switch
          size="md"
          checked={f.enabled}
          onChange={(e) => toggle(e.currentTarget.checked)}
          disabled={isLoading}
          label="Show the Alertify button"
          description="On Seva Entry, Donation Receipt and Hall Booking"
          aria-label="Enable Alertify"
        />
      </Group>

      <Text size="sm" c="dimmed" mt="md" mb="xs">Alertify's SQL Server. These are not temple data: they are kept on this server, in a file git ignores, and the password is never shown again.</Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <TextInput label="Host / Server" value={f.host} onChange={(e) => set('host')(e.currentTarget.value)} placeholder="103.231.43.48" disabled={isLoading} autoComplete="off" />
        <NumberInput label="Port" value={f.port} onChange={set('port')} min={1} max={65535} hideControls allowDecimal={false} disabled={isLoading} />
        <TextInput label="Database" value={f.database} onChange={(e) => set('database')(e.currentTarget.value)} placeholder="alertsvt" disabled={isLoading} autoComplete="off" />
        <TextInput label="Username" value={f.user} onChange={(e) => set('user')(e.currentTarget.value)} disabled={isLoading} autoComplete="off" />
        <PasswordInput
          label="Password"
          value={f.password}
          onChange={(e) => set('password')(e.currentTarget.value)}
          placeholder={data?.password_set ? 'Saved. Leave blank to keep it' : 'Enter the password'}
          disabled={isLoading}
          autoComplete="new-password"
        />
        <TimeInput label="Default alert time" value={f.default_time} onChange={(e) => set('default_time')(e.currentTarget.value)} disabled={isLoading} description="Used when a bill has no time of its own" w={{ base: '100%', sm: 220 }} />
      </SimpleGrid>

      {result && (
        <Alert mt="md" variant="light" color={result.ok ? 'teal' : 'red'} icon={result.ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />} role="status">
          {result.message}
        </Alert>
      )}

      <Group mt="md" gap="sm">
        <Button variant="default" leftSection={<PlugZap size={16} />} loading={busy === 'test'} disabled={isLoading || busy === 'save'} onClick={test}>
          Test connection
        </Button>
        <Button color="kumkum" leftSection={<Save size={16} />} loading={busy === 'save'} disabled={isLoading || busy === 'test'} onClick={save}>
          Save
        </Button>
      </Group>
    </Card>
  )
}
