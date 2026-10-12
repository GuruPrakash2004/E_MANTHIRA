import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Checkbox, Modal, Paper, PasswordInput, Stack, Text, TextInput, Title, Alert, Group } from '@mantine/core'
import { AlertCircle, FlaskConical, Lock, Settings, User } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import DatabaseSettingsPanel from '../../components/DatabaseSettingsPanel'
import HeroVisual from '../../components/HeroVisual'
import { enterDemoMode } from '../../lib/demoAuth'

// Original artwork (see vTemple_Analysis/08_UI_UX_Design_System.md §4 "Ornament kit"):
// hand-built SVG gopuram + kolam pattern, drawn for this project — not stock icons.
const KOLAM_PATTERN = '/illustrations/kolam.svg'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dbSettingsOpen, setDbSettingsOpen] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    if (!username.trim()) return setError('User Name Empty')
    if (!password) return setError('Password Empty')
    setBusy(true)
    try {
      await login(username.trim(), password)
      sessionStorage.setItem('vt-welcome', '1')
      navigate('/')
    } catch (err) {
      setError(err?.response?.data?.detail || 'UserName / Password is incorrect')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="vt-login">
      {/* Left: dark maroon + gold hero. Hidden below 860px; the form column then shows a compact brand header. */}
      <div className="vt-login-art">
        <div aria-hidden className="vt-login-kolam" style={{ backgroundImage: `url(${KOLAM_PATTERN})` }} />
        <div style={{ position: 'relative', padding: '2rem 2.5rem 0', flex: '0 0 auto' }}>
          {/* Light-text variant of the official logo (public/brand), legible on the maroon panel. */}
          <img src="/brand/lockup-horizontal-light.png" alt="e-Mandira Pranali" style={{ height: 'clamp(72px, 11vh, 104px)', width: 'auto', display: 'block' }} />
          <Text size="md" c="#F4E1A6" mt={10} fw={500}>
            Temple management for seva, donation and hall counters
          </Text>
        </div>
        <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, padding: '0.5rem 1.5rem' }}>
          <HeroVisual />
        </div>
        <Text size="xs" c="#D9B9A3" ta="center" pb="lg" px="xl" style={{ position: 'relative' }}>
          Seva bookings, donations, hall bookings and accounts in one place
        </Text>
      </div>

      {/* Right: sign-in. */}
      <main className="vt-login-form">
        <div aria-hidden className="vt-login-glow vt-login-glow-a" />
        <div aria-hidden className="vt-login-glow vt-login-glow-b" />

        <Stack w="100%" maw={400} gap="md" style={{ position: 'relative' }} className="vt-rise">
          <img className="vt-login-mobile-brand" src="/brand/lockup-horizontal.png" alt="e-Mandira Pranali" />

          <Paper w="100%" p="xl" withBorder shadow="md" component="form" onSubmit={onSubmit} noValidate>
            <Stack gap={4} mb="lg">
              <Title order={2} style={{ fontSize: 28 }}>
                Sign in
              </Title>
              <Text size="sm" c="dimmed">
                Use your temple office user name and password.
              </Text>
            </Stack>

            <Stack gap="md">
              {error && (
                <Alert color="red" variant="light" icon={<AlertCircle size={16} />} role="alert">
                  {error}
                </Alert>
              )}
              <TextInput
                label="User name"
                placeholder="e.g. ADMIN"
                leftSection={<User size={16} />}
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
                autoComplete="username"
                size="md"
                autoFocus
              />
              <PasswordInput
                label="Password"
                placeholder="Enter password"
                leftSection={<Lock size={16} />}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                autoComplete="current-password"
                size="md"
              />
              <Checkbox label="Remember me" checked={remember} onChange={(e) => setRemember(e.currentTarget.checked)} />
              <Button type="submit" color="kumkum" size="md" h={46} loading={busy} fullWidth>
                Sign in
              </Button>
            </Stack>
          </Paper>

          {/* Outside the form: fixing the server must not require logging in first. */}
          <Group gap="xs" justify="center">
            <Button variant="subtle" color="gray" size="compact-md" leftSection={<Settings size={14} />} onClick={() => setDbSettingsOpen(true)}>
              Database settings
            </Button>
            {/* Developer escape hatch: canned data, no SQL Server needed, never saves (see lib/demoAuth.js). */}
            <Button variant="subtle" color="gray" size="compact-md" leftSection={<FlaskConical size={14} />} onClick={() => {
                sessionStorage.setItem('vt-welcome', '1')
                enterDemoMode()
              }}>
              Continue with demo data
            </Button>
          </Group>

          {/* Dark credit badge: gold + silver Softvent mark (public/softvent-logo-dark.png, recoloured from the original). */}
          <Stack
            align="center"
            gap={8}
            mt={4}
            py="md"
            px="lg"
            style={{ background: 'linear-gradient(180deg, #5A1414 0%, #2B0909 100%)', border: '1px solid rgba(244,225,166,0.3)', borderRadius: 16 }}
          >
            {/* One line, logo centred beneath. */}
            <Text size="xs" fw={600} c="#D9B9A3" tt="uppercase" ta="center" style={{ letterSpacing: 2, whiteSpace: 'nowrap' }}>
              Designed &amp; developed by
            </Text>
            <img src="/softvent-logo-dark.png" alt="Softvent" style={{ height: 44, width: 'auto', objectFit: 'contain', display: 'block' }} />
          </Stack>
        </Stack>

        <Modal opened={dbSettingsOpen} onClose={() => setDbSettingsOpen(false)} title="Database Settings" centered>
          <DatabaseSettingsPanel />
        </Modal>
      </main>

      <style>{`
        .vt-login { display: flex; min-height: 100dvh; background: #FBF6EC; }
        .vt-login-art {
          flex: 1.15; overflow: hidden; display: flex; flex-direction: column; height: 100dvh; position: sticky; top: 0;
          background: linear-gradient(180deg, #2B0909 0%, #5A1414 28%, #7A1F1F 60%, #2B0909 100%);
        }
        .vt-login-kolam { position: absolute; inset: 0; background-size: 120px 120px; opacity: 0.05; }
        .vt-login-form { flex: 1; min-width: 0; position: relative; display: flex; align-items: center; justify-content: center; padding: 2rem 1.25rem; overflow: hidden; }
        .vt-login-glow { position: absolute; border-radius: 50%; pointer-events: none; }
        .vt-login-glow-a { top: -120px; right: -120px; width: 340px; height: 340px; background: radial-gradient(circle, rgba(224,123,22,0.14) 0%, rgba(224,123,22,0) 70%); }
        .vt-login-glow-b { bottom: -140px; left: -100px; width: 320px; height: 320px; background: radial-gradient(circle, rgba(122,31,31,0.08) 0%, rgba(122,31,31,0) 70%); }
        .vt-login-mobile-brand { display: none; height: 64px; width: auto; align-self: center; filter: drop-shadow(0 2px 6px rgba(90,20,20,0.15)); }
        @media (max-width: 860px) {
          .vt-login-art { display: none; }
          .vt-login-mobile-brand { display: block; }
        }
      `}</style>
    </div>
  )
}
