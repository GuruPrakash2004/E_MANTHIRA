import { useEffect, useState } from 'react'
import { Alert, Button, Group, PasswordInput, Stack, Text, TextInput } from '@mantine/core'
import { AlertCircle, CircleCheck, Database } from 'lucide-react'
import * as dbSettingsApi from '../api/endpoints/dbSettings'

/**
 * Lets staff repoint this backend at a different SQL Server without a
 * developer editing .env and restarting the process (the DB server's IP
 * changed repeatedly during development — this is the fix for that).
 * Used both below the login form (unauthenticated — no DB connection
 * exists yet to gate it) and in Admin Master > Database for ongoing edits.
 * See backend/app/core/runtime_db_settings.py for the backend mechanism.
 *
 * Driver is always pyodbc (ODBC Driver 18 for SQL Server) — no picker
 * shown. This app's real counter PCs are Windows with the driver
 * installed (CLAUDE.md §3), and pymssql's bundled FreeTDS was tried and
 * confirmed (by directly testing both against this client's real server)
 * unable to complete the TLS/login handshake at all — pyodbc reaches the
 * same server fine. Don't switch this back to pymssql without re-testing
 * against a real server first.
 */
export default function DatabaseSettingsPanel() {
  const [form, setForm] = useState({
    db_engine: 'pyodbc',
    db_driver_odbc: 'ODBC Driver 18 for SQL Server',
    db_server: '',
    db_port: 1433,
    db_name: '',
    db_user: '',
    db_password: '',
    db_trust_cert: 'yes',
  })
  const [passwordSet, setPasswordSet] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // {ok, detail} | null

  useEffect(() => {
    dbSettingsApi
      .getDbSettings()
      .then((d) => {
        setForm((f) => ({ ...f, ...d, db_engine: 'pyodbc', db_driver_odbc: d.db_driver_odbc || 'ODBC Driver 18 for SQL Server', db_password: '' }))
        setPasswordSet(Boolean(d.password_set))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function body() {
    // Omit a blank password so the backend keeps whatever's already saved —
    // only send it when the user actually typed a new one.
    const { db_password, ...rest } = form
    return db_password ? form : rest
  }

  async function onTest() {
    setBusy(true)
    setResult(null)
    try {
      const r = await dbSettingsApi.testDbSettings(body())
      setResult(r)
    } catch (err) {
      setResult({ ok: false, detail: err?.response?.data?.detail || 'Could not reach the backend' })
    } finally {
      setBusy(false)
    }
  }

  async function onSave() {
    setBusy(true)
    setResult(null)
    try {
      const r = await dbSettingsApi.saveDbSettings(body())
      setResult(r)
      if (r.ok) {
        setPasswordSet(passwordSet || Boolean(form.db_password))
        set('db_password', '')
      }
    } catch (err) {
      setResult({ ok: false, detail: err?.response?.data?.detail || 'Could not reach the backend' })
    } finally {
      setBusy(false)
    }
  }

  if (loading) return null

  return (
    <Stack gap="sm">
      <Group gap={6}>
        <Database size={16} />
        <Text size="sm" fw={600}>
          Database Connection
        </Text>
      </Group>
      <Group grow>
        <TextInput label="Server" value={form.db_server} onChange={(e) => set('db_server', e.currentTarget.value)} />
        <TextInput
          label="Port"
          type="number"
          value={form.db_port}
          onChange={(e) => set('db_port', Number(e.currentTarget.value) || '')}
        />
      </Group>
      <TextInput label="Database Name" value={form.db_name} onChange={(e) => set('db_name', e.currentTarget.value)} />
      <Group grow>
        <TextInput label="User" value={form.db_user} onChange={(e) => set('db_user', e.currentTarget.value)} />
        <PasswordInput
          label="Password"
          placeholder={passwordSet ? '•••••••• (unchanged)' : ''}
          value={form.db_password}
          onChange={(e) => set('db_password', e.currentTarget.value)}
        />
      </Group>

      {result && (
        <Alert
          color={result.ok ? 'teal' : 'red'}
          icon={result.ok ? <CircleCheck size={16} /> : <AlertCircle size={16} />}
          variant="light"
        >
          {result.detail}
        </Alert>
      )}

      <Group justify="flex-end" gap="xs">
        <Button variant="default" size="xs" loading={busy} onClick={onTest}>
          Test Connection
        </Button>
        <Button color="kumkum" size="xs" loading={busy} onClick={onSave}>
          Save &amp; Reconnect
        </Button>
      </Group>
    </Stack>
  )
}
