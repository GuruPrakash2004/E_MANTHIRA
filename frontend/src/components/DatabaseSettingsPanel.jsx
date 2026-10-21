import { useEffect, useState } from 'react'
import { PasswordInput, Select, TextInput } from '@mantine/core'
import { AlertCircle, CircleCheck, Database, Loader2, PlugZap } from 'lucide-react'
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
export default function DatabaseSettingsPanel({ onClose } = {}) {
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
    setResult(null)
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

  const hasInstance = form.db_server.indexOf(String.fromCharCode(92)) >= 0

  if (loading) return null

  function onSubmit(e) {
    e.preventDefault()
    if (busy) return
    if (!databases) {
      if (form.db_server && form.db_user) onConnectServer()
    } else if (form.db_name) onSave()
  }

  return (
    <form className="vt-dbcard vt-fade-up" onSubmit={onSubmit} noValidate>
      <div className="vt-dbcard-head">
        <Database size={16} />
        <span className="vt-dbcard-title">Database Connection</span>
        <span className="vt-dbcard-step">Step {databases ? 2 : 1} of 2</span>
      </div>
      {current?.db_server && (
        <p className="vt-dbcard-note">
          Currently: {current.db_server}
          {current.db_port ? `:${current.db_port}` : ''} / {current.db_name || '(no database)'}
        </p>
      )}

      {!databases ? (
        <div className="vt-dbcard-fields">
          <div className="vt-dbcard-row">
            <TextInput data-autofocus autoFocus label="Server Name" placeholder="host or host\instance" value={form.db_server} onChange={(e) => setServerField('db_server', e.currentTarget.value)} />
            <TextInput
              label="Port"
              type="number"
              placeholder={hasInstance ? 'not needed (instance name)' : 'optional'}
              disabled={hasInstance}
              value={hasInstance ? '' : form.db_port}
              onChange={(e) => setServerField('db_port', Number(e.currentTarget.value) || '')}
            />
          </div>
          <div className="vt-dbcard-row">
            <TextInput label="SQL User Name" value={form.db_user} onChange={(e) => setServerField('db_user', e.currentTarget.value)} />
            <PasswordInput
              label="SQL Password"
              placeholder={passwordSet ? 'Re-enter to connect' : ''}
              value={form.db_password}
              onChange={(e) => setServerField('db_password', e.currentTarget.value)}
            />
          </div>
        </div>
      ) : (
        <div className="vt-dbcard-fields">
          <p className="vt-dbcard-note" style={{ margin: 0 }}>
            Connected to <b>{form.db_server}</b>
            {hasInstance || !form.db_port ? '' : `:${form.db_port}`}
          </p>
          <Select data-autofocus label="Database Name" data={databases} value={form.db_name || null} onChange={(v) => set('db_name', v || '')} searchable nothingFoundMessage="No databases" />
        </div>
      )}

      {result && (
        <div className={`vt-dbcard-msg ${result.ok ? 'ok' : 'err'}`} role={result.ok ? 'status' : 'alert'}>
          {result.ok ? <CircleCheck size={14} /> : <AlertCircle size={14} />}
          <span>{result.detail}</span>
        </div>
      )}

      <div className="vt-dbcard-actions">
        {!databases ? (
          <>
            <button type="submit" className="vt-dbcard-primary" disabled={busy || !form.db_server || !form.db_user}>
              {busy ? <Loader2 size={16} className="vt-spin" /> : <PlugZap size={16} />}
              Connect &amp; Next
            </button>
            {onClose && (
              <button type="button" className="vt-dbcard-secondary" disabled={busy} onClick={onClose}>Cancel</button>
            )}
          </>
        ) : (
          <>
            <button type="submit" className="vt-dbcard-primary" disabled={busy || !form.db_name}>
              {busy ? <Loader2 size={16} className="vt-spin" /> : <CircleCheck size={16} />}
              Save &amp; Reconnect
            </button>
            <button type="button" className="vt-dbcard-secondary" disabled={busy || !form.db_name} onClick={onTest}>Test</button>
            <button type="button" className="vt-dbcard-secondary" disabled={busy} onClick={() => { setDatabases(null); setResult(null) }}>Back</button>
          </>
        )}
      </div>

      <style>{`
        .vt-dbcard { background: color-mix(in srgb, var(--vt-surface) 92%, transparent); backdrop-filter: blur(8px); border: 1px solid var(--vt-line); border-radius: 16px; padding: 1.25rem; box-shadow: 0 10px 30px rgba(90,20,20,0.10); display: flex; flex-direction: column; gap: 0.9rem; }
        .vt-dbcard-head { display: flex; align-items: center; gap: 8px; color: var(--vt-accent); }
        .vt-dbcard-title { font-size: 0.875rem; font-weight: 700; color: inherit; }
        .vt-dbcard-step { margin-left: auto; font-size: 11px; color: var(--mantine-color-dimmed); }
        .vt-dbcard-note { margin: 0; font-size: 12px; color: var(--mantine-color-dimmed); }
        .vt-dbcard-fields { display: flex; flex-direction: column; gap: 0.75rem; }
        .vt-dbcard-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
        @media (max-width: 480px) { .vt-dbcard-row { grid-template-columns: 1fr; } }
        .vt-dbcard .mantine-InputWrapper-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mantine-color-dimmed); margin-bottom: 4px; }
        .vt-dbcard .mantine-Input-input { border-radius: 12px; padding: 0.75rem 1rem; height: auto; min-height: 44px; font-size: 0.875rem; background: var(--vt-surface); border: 1px solid var(--vt-line); }
        .vt-dbcard .mantine-Input-input:focus, .vt-dbcard .mantine-Input-input:focus-within { border-color: var(--mantine-color-kumkum-7); box-shadow: 0 0 0 3px rgba(122,31,31,0.10); }
        :root[data-mantine-color-scheme='dark'] .vt-dbcard .mantine-Input-input:focus { border-color: #C79A3D; box-shadow: 0 0 0 3px rgba(199,154,61,0.15); }
        .vt-dbcard-actions { display: flex; gap: 0.5rem; }
        .vt-dbcard-primary { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 0; cursor: pointer; border-radius: 12px; padding: 0.75rem 1rem; font-size: 0.875rem; font-weight: 700; color: #fff; background: var(--mantine-color-kumkum-7); }
        :root[data-mantine-color-scheme='dark'] .vt-dbcard-primary { color: #2B0909; background: linear-gradient(135deg, #C79A3D, #F4E1A6, #C79A3D); }
        .vt-dbcard-secondary { border-radius: 12px; border: 1px solid var(--vt-line); background: transparent; color: inherit; padding: 0 1rem; font-size: 12px; cursor: pointer; }
        .vt-dbcard button:disabled { opacity: 0.45; cursor: not-allowed; }
        .vt-dbcard-msg { display: flex; align-items: flex-start; gap: 8px; border-radius: 12px; padding: 0.75rem 1rem; font-size: 12px; font-weight: 500; }
        .vt-dbcard-msg.err { background: rgba(154,75,69,0.10); color: #9A4B45; animation: vt-shake 0.4s; }
        .vt-dbcard-msg.ok { background: rgba(199,154,61,0.15); color: var(--vt-accent); }
        :root[data-mantine-color-scheme='dark'] .vt-dbcard-msg.err { background: rgba(239,68,68,0.10); color: #f87171; }
        .vt-spin { animation: vt-spin 0.9s linear infinite; }
        .vt-fade-up { animation: vt-fade-up 0.45s ease both; }
        @keyframes vt-spin { to { transform: rotate(360deg); } }
        @keyframes vt-fade-up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        @keyframes vt-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
        @media (prefers-reduced-motion: reduce) { .vt-spin, .vt-fade-up, .vt-dbcard-msg.err { animation: none; } }
      `}</style>
    </form>
  )
}
