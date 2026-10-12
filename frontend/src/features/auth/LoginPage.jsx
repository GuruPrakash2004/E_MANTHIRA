import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Checkbox, Modal, Paper, PasswordInput, Stack, Text, TextInput, Title, Alert, UnstyledButton, Group } from '@mantine/core'
import { AlertCircle, FlaskConical, Lock, Settings, User } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import DatabaseSettingsPanel from '../../components/DatabaseSettingsPanel'
import { enterDemoMode } from '../../lib/demoAuth'

// Original artwork (see vTemple_Analysis/08_UI_UX_Design_System.md §4 "Ornament kit"):
// hand-built SVG gopuram + kolam pattern, drawn for this project — not stock icons.
const GOPURAM_HERO = '/illustrations/gopuram-hero.svg'
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
      navigate('/')
    } catch (err) {
      setError(err?.response?.data?.detail || 'UserName / Password is incorrect')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#FFFBF5' }}>
      {/* Left panel — the temple illustration, on a deep kumkum-to-maroon dusk gradient,
          sized to always fit the viewport (never crops, never scrolls). */}
      <div
        className="vt-login-art"
        style={{
          flex: '1.15',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, #2B0909 0%, #5A1414 28%, #7A1F1F 60%, #2B0909 100%)',
        }}
      >
        <div
          aria-hidden
          style={{ position: 'absolute', inset: 0, backgroundImage: `url(${KOLAM_PATTERN})`, backgroundSize: '120px 120px', opacity: 0.05 }}
        />
        <div style={{ position: 'relative', padding: '2rem 2.5rem 0', flex: '0 0 auto' }}>
          {/* Real alpha-channel cutout (public/brand/lockup-transparent.png),
              chroma-keyed from logo/logo1.jpeg — not a crop-and-color-match
              trick, so it renders cleanly on any background. */}
          <img src="/brand/lockup-transparent.png" alt="e-Mandira Pranali" style={{ height: 150, width: 'auto', objectFit: 'contain', display: 'block' }} />
          <Text size="sm" c="#F4E1A6" mt={10}>
            Temple Management, reimagined
          </Text>
        </div>

        <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, padding: '0.5rem 1.5rem' }}>
          <img
            src={GOPURAM_HERO}
            alt="Illustration of a South Indian temple gopuram glowing at dusk, with diyas and a flagpole"
            style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 20px 40px rgba(0,0,0,0.35))' }}
          />
        </div>

        <div style={{ position: 'relative', padding: '0 2.5rem 1.5rem', textAlign: 'center', flex: '0 0 auto' }}>
          <Text size="xs" c="#D9B9A3">
            Seva bookings &middot; Donations &middot; Hall bookings &middot; Accounts — all in one place
          </Text>
        </div>
      </div>

      {/* Right panel — the sign-in card, with a faint kolam + warm corner glow so it
          doesn't read as a flat empty field next to the rich left illustration. */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          width: '100%',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          overflow: 'hidden',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url(${KOLAM_PATTERN})`,
            backgroundSize: '120px 120px',
            opacity: 0.035,
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: -120,
            right: -120,
            width: 340,
            height: 340,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(224,123,22,0.14) 0%, rgba(224,123,22,0) 70%)',
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            bottom: -140,
            left: -100,
            width: 320,
            height: 320,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(122,31,31,0.08) 0%, rgba(122,31,31,0) 70%)',
          }}
        />

        <Stack w="100%" maw={380} gap="md" style={{ position: 'relative' }}>
        <Paper w="100%" p="xl" radius="lg" withBorder shadow="md" component="form" onSubmit={onSubmit} style={{ position: 'relative' }}>
          <Stack gap={2} mb="lg">
            <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              Sign in
            </Title>
            <Text size="sm" c="dimmed">
              Enter your temple office credentials
            </Text>
          </Stack>

          <Stack gap="md">
            {error && (
              <Alert color="red" variant="light" icon={<AlertCircle size={16} />}>
                {error}
              </Alert>
            )}
            <TextInput
              label="User name"
              placeholder="e.g. ADMIN"
              leftSection={<User size={16} />}
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
              autoFocus
            />
            <PasswordInput
              label="Password"
              placeholder="••••••••"
              leftSection={<Lock size={16} />}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <Checkbox label="Remember me" checked={remember} onChange={(e) => setRemember(e.currentTarget.checked)} />
            <Button type="submit" color="kumkum" size="md" loading={busy} fullWidth>
              Sign In
            </Button>
          </Stack>

          <Stack gap={6} align="center" mt="xl" pt="lg" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.6 }}>
              Designed &amp; Developed by
            </Text>
            <img src="/softvent-logo-new.png" alt="Softvent" style={{ height: 36, width: 'auto', objectFit: 'contain' }} />
          </Stack>
        </Paper>

        {/* Below the login card, not inside the form — fixing which server
            this app talks to shouldn't require being able to log in first.
            Opens in a modal rather than inline, so the settings form isn't
            sitting half-visible on the login screen by default. */}
        <Group gap="lg" justify="center">
          <UnstyledButton onClick={() => setDbSettingsOpen(true)} p="xs">
            <Group gap={6} justify="center">
              <Settings size={14} />
              <Text size="xs" fw={600} c="dimmed">
                Database Settings
              </Text>
            </Group>
          </UnstyledButton>
          {/* Developer-only escape hatch: preview the whole UI against canned
              data with no SQL Server reachable — see src/lib/demoAuth.js.
              Never saves anything; get/post/put/del all know to refuse
              writes while this is on (api.js). */}
          <UnstyledButton onClick={enterDemoMode} p="xs">
            <Group gap={6} justify="center">
              <FlaskConical size={14} />
              <Text size="xs" fw={600} c="dimmed">
                Continue with Demo Data
              </Text>
            </Group>
          </UnstyledButton>
        </Group>

        <Modal opened={dbSettingsOpen} onClose={() => setDbSettingsOpen(false)} title="Database Settings" radius="lg" centered>
          <DatabaseSettingsPanel />
        </Modal>
        </Stack>
      </div>

      <style>{`
        @media (max-width: 860px) {
          /* !important is required here: the left panel's flex display comes
             from an inline style={{display:'flex'}}, and inline styles always
             win over a plain stylesheet rule regardless of media match. */
          .vt-login-art { display: none !important; }
        }
      `}</style>
    </div>
  )
}
