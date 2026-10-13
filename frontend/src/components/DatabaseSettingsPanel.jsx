import { useEffect, useState } from 'react'
import { Alert, Button, Group, PasswordInput, Select, Stack, Text, TextInput } from '@mantine/core'
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
    db_driver_odbc: '',
    db_server: '',
    db_port: '',
    db_name: '',
    db_user: '',
    db_password: '',
    db_trust_cert: 'yes',
  })
  const [passwordSet, setPasswordSet] = useState(false)
  const [current, setCurrent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // {ok, detail} | null
  const [databases, setDatabases] = useState(null) // null = server not connected yet

  // The form always starts blank: saved/.env values are never pre-filled, so a
  // new connection is entered and saved fresh. Only a read-only note shows
  // what the backend is connected to right now.
  useEffect(() => {
    dbSettingsApi
      .getDbSettings()
      .then((d) => {
        setCurrent(d)
        setPasswordSet(Boolean(d.password_set))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function body() {
    // Send exactly what is on screen (blank port -> null, blank password
    // stays blank) so the connection uses only these values, never saved ones.
    return { ...form, db_port: form.db_port === '' ? null : Number(form.db_port) }
  }

  // Step 1: connect to the server only, then offer its databases.
  async function onConnectServer() {
    setBusy(true)
    setResult(null)
    try {
      const r = await dbSettingsApi.listDatabases({ ...body(), db_name: 'master' })
      setResult({ ok: r.ok, detail: r.detail })
      if (r.ok) {
        setDatabases(r.databases)
        if (!r.databases.includes(form.db_name)) set('db_name', r.databases[0] || '')
      } else {
        setDatabases(null)
      }
    } catch (err) {
      setDatabases(null)
      setResult({ ok: false, detail: err?.response?.data?.detail || 'Could not reach the backend' })
    } finally {
      setBusy(false)
    }
  }

  // Changing any server credential invalidates the database list.
  function setServerField(field, value) {
    setDatabases(null)
    set(field, value)
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
        setPasswordSet(Boolean(form.db_password))
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
      {current?.db_server && (
        <Text size="xs" c="dimmed">
          Currently: {current.db_server}
          {current.db_port ? `:${current.db_port}` : ''} / {current.db_name || '(no database)'}
        </Text>
      )}
      <Text size="xs" c="dimmed">Step 1 — connect to the server</Text>
      <Group grow>
        <TextInput className="vt-field-required" label="Server Name" placeholder="host or host\instance" value={form.db_server} onChange={(e) => setServerField('db_server', e.currentTarget.value)} />
        <TextInput
          label="Port"
          type="number"
          placeholder="optional"
          value={form.db_port}
          onChange={(e) => setServerField('db_port', Number(e.currentTarget.value) || '')}
        />
      </Group>
      <Group grow>
        <TextInput className="vt-field-required" label="SQL User Name" value={form.db_user} onChange={(e) => setServerField('db_user', e.currentTarget.value)} />
        <PasswordInput
          className="vt-field-required"
          label="SQL Password"
          placeholder={passwordSet ? 'Re-enter to connect (not stored on screen)' : ''}
          value={form.db_password}
          onChange={(e) => setServerField('db_password', e.currentTarget.value)}
        />
      </Group>
      <Group justify="flex-end">
        <Button variant="default" size="xs" loading={busy} disabled={!form.db_server || !form.db_user} onClick={onConnectServer}>
          Connect
        </Button>
      </Group>
      {databases && (
        <>
          <Text size="xs" c="dimmed">Step 2 — choose the database</Text>
          <Select
            className="vt-field-required"
            label="Database Name"
            data={databases}
            value={form.db_name || null}
            onChange={(v) => set('db_name', v || '')}
            searchable
            nothingFoundMessage="No databases"
          />
        </>
      )}

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
        <Button variant="default" size="xs" loading={busy} disabled={!databases || !form.db_name} onClick={onTest}>
          Test Connection
        </Button>
        <Button color="kumkum" size="xs" loading={busy} disabled={!databases || !form.db_name} onClick={onSave}>
          Save &amp; Reconnect
        </Button>
      </Group>
    </Stack>
  )
}
