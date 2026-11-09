import { Suspense, lazy, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ActionIcon, Alert, Badge, Button, Card, Checkbox, FileButton, Group, NumberInput, Progress, SegmentedControl, Stack, Switch, Text, TextInput, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clapperboard, FolderInput, Play, Trash2, Upload } from 'lucide-react'
import dayjs from 'dayjs'
import * as welcomeApi from '../../api/endpoints/welcome'
import { useAuth } from '../../hooks/useAuth'
import { useConfirm } from '../../components/ui/ConfirmProvider'

const WelcomeSplash = lazy(() => import('../../components/WelcomeSplash'))
const MAX_MB = 60
const MODES = [
  { value: 'login', label: 'Random each sign-in' },
  { value: 'day', label: 'Random per day' },
  { value: 'hours', label: 'Change every N hours' },
]
const mb = (bytes) => `${((bytes || 0) / (1024 * 1024)).toFixed(1)} MB`

/**
 * Global Settings > Welcome video (ADMIN). A library of MP4s (add your own or import the temple-videos folder), tick the ones in
 * play, and choose how one is picked: random on every sign-in, one per day, or a new one every N hours. The files and the settings
 * are kept on the server (no DB changes). The built-in two-clip welcome can be ticked as one more choice.
 */
export default function WelcomeVideoCard() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { user } = useAuth()
  const [progress, setProgress] = useState(null)
  const [previewId, setPreviewId] = useState(null) // which library clip has its small player open
  const [splash, setSplash] = useState(false)
  const resetRef = useRef(null)
  const { data, isLoading } = useQuery({ queryKey: ['welcome'], queryFn: () => welcomeApi.getWelcome() })
  const cfg = data && typeof data === 'object' && !Array.isArray(data) ? data : { enabled: true, mode: 'login', hours: 3, builtin_active: false, videos: [], play: null, next_change: null }
  const videos = cfg.videos || []

  const apiError = (err) => err?.response?.data?.detail || 'Something went wrong'
  const refresh = (next) => qc.setQueryData(['welcome'], next)
  const fail = (err) => notifications.show({ message: apiError(err), color: 'red' })

  const upload = useMutation({
    mutationFn: async (files) => {
      let last = null
      for (const f of files) last = await welcomeApi.uploadWelcomeVideo(f, setProgress)
      return last
    },
    onSuccess: (next) => {
      refresh(next)
      notifications.show({ message: 'Video added to the library', color: 'teal' })
    },
    onError: fail,
    onSettled: () => {
      setProgress(null)
      resetRef.current?.()
    },
  })
  const importFolder = useMutation({
    mutationFn: welcomeApi.importWelcomeFolder,
    onSuccess: (r) => {
      refresh(r)
      notifications.show({ message: r.added ? `${r.added} video${r.added === 1 ? '' : 's'} added from the app's welcome folder` : r.converted ? `${r.converted} video${r.converted === 1 ? '' : 's'} now play straight from the app` : 'Nothing new in the welcome folder', color: r.imported ? 'teal' : 'yellow' })
      if (r.skipped?.length) notifications.show({ message: `Skipped: ${r.skipped.join(', ')}`, color: 'orange' })
    },
    onError: fail,
  })
  const enable = useMutation({ mutationFn: welcomeApi.setWelcomeEnabled, onSuccess: refresh, onError: fail })
  const settings = useMutation({ mutationFn: welcomeApi.setWelcomeSettings, onSuccess: refresh, onError: fail })
  const patch = useMutation({ mutationFn: ({ id, body }) => welcomeApi.patchWelcomeVideo(id, body), onSuccess: refresh, onError: fail })
  const remove = useMutation({
    mutationFn: welcomeApi.deleteWelcomeVideo,
    onSuccess: (next) => {
      refresh(next)
      setPreviewId(null)
      notifications.show({ message: 'Video removed', color: 'teal' })
    },
    onError: fail,
  })

  function pick(files) {
    const list = (Array.isArray(files) ? files : [files]).filter(Boolean)
    if (!list.length) return
    const bad = list.find((f) => !f.name.toLowerCase().endsWith('.mp4'))
    if (bad) return notifications.show({ message: `${bad.name}: choose .mp4 videos`, color: 'red' })
    const big = list.find((f) => f.size > MAX_MB * 1024 * 1024)
    if (big) return notifications.show({ message: `${big.name}: each video must be ${MAX_MB} MB or smaller`, color: 'red' })
    upload.mutate(list)
  }

  async function onRemove(v) {
    const ok = await confirm({ title: `Remove "${v.name}"?`, message: 'The video file is deleted from the library. This cannot be undone.', confirmLabel: 'Remove' })
    if (ok) remove.mutate(v.id)
  }

  const active = videos.filter((v) => v.active && !v.missing).length + (cfg.builtin_active ? 1 : 0)
  const when = cfg.next_change ? dayjs(cfg.next_change).format('DD/MM/YYYY hh:mm A') : ''
  const playName = cfg.play?.name

  return (
    <Card withBorder radius="lg" p="lg" mb="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="sm" wrap="nowrap" align="flex-start">
            <Clapperboard size={22} color="var(--vt-accent)" aria-hidden style={{ marginTop: 2 }} />
            <div>
              <Text fw={700}>Welcome video</Text>
              <Text size="sm" c="dimmed">
                Plays after every sign-in with the user's greeting over its last seconds. Staff can always Skip.
              </Text>
            </div>
          </Group>
          <Badge variant="light" color={active ? 'yellow' : 'gray'}>
            {active ? `${active} in play` : 'Built-in video'}
          </Badge>
        </Group>

        <Switch label="Play the welcome video after sign-in" checked={cfg.enabled} disabled={isLoading || enable.isPending} onChange={(e) => enable.mutate(e.currentTarget.checked)} />

        {cfg.enabled && (
          <>
            <div>
              <Text size="sm" fw={600} mb={4}>How the video is chosen</Text>
              <Group gap="md" align="center" wrap="wrap">
                <SegmentedControl
                  color="kumkum"
                  value={cfg.mode}
                  disabled={settings.isPending}
                  onChange={(mode) => settings.mutate({ mode })}
                  data={MODES}
                  aria-label="How the welcome video is chosen"
                />
                {cfg.mode === 'hours' && (
                  <NumberInput
                    aria-label="Change the video every this many hours"
                    w={150}
                    min={1}
                    max={24}
                    allowDecimal={false}
                    suffix=" hours"
                    value={cfg.hours}
                    disabled={settings.isPending}
                    onChange={(v) => Number(v) >= 1 && Number(v) <= 24 && Number(v) !== cfg.hours && settings.mutate({ hours: Number(v) })}
                  />
                )}
              </Group>
              <Text size="xs" c="dimmed" mt={6}>
                {cfg.mode === 'login' && 'Every sign-in plays a random clip from the ticked ones (never the one just seen, when there is a choice).'}
                {cfg.mode === 'day' && `One random clip for the whole day, the same for every user; it changes at midnight.${playName ? ` Today: ${playName}.` : ''}`}
                {cfg.mode === 'hours' && `A new random clip every ${cfg.hours} hour${cfg.hours === 1 ? '' : 's'}, counted from midnight, the same for every user.${playName ? ` Now: ${playName}, changes at ${when}.` : ''}`}
                {' '}Tick only one clip to always play that one.
              </Text>
            </div>

            <div>
              <Text size="sm" fw={600} mb={6}>Library ({videos.length})</Text>
              <Stack gap={6}>
                <Checkbox
                  color="kumkum"
                  checked={cfg.builtin_active}
                  disabled={settings.isPending}
                  onChange={(e) => settings.mutate({ builtin_active: e.currentTarget.checked })}
                  label="Built-in temple clips (awakening + aarati)"
                  description="The original two-clip welcome. With nothing else ticked it plays."
                />
                {videos.length === 0 && <Text size="sm" c="dimmed">No videos yet. Add your own, or import the clips that come with the app.</Text>}
                {videos.map((v) => (
                  <Card key={v.id} withBorder radius="md" p="xs" style={{ opacity: v.missing ? 0.6 : 1 }}>
                    <Group gap="sm" wrap="nowrap" align="center">
                      <Checkbox color="kumkum" aria-label={`Use ${v.name}`} checked={v.active} disabled={patch.isPending || v.missing} onChange={(e) => patch.mutate({ id: v.id, body: { active: e.currentTarget.checked } })} />
                      <TextInput
                        aria-label={`Name of ${v.name}`}
                        size="xs"
                        style={{ flex: 1, minWidth: 120 }}
                        defaultValue={v.name}
                        key={`${v.id}-${v.name}`}
                        maxLength={80}
                        onBlur={(e) => {
                          const name = e.currentTarget.value.trim()
                          if (name && name !== v.name) patch.mutate({ id: v.id, body: { name } })
                          else e.currentTarget.value = v.name
                        }}
                      />
                      {cfg.mode !== 'login' && cfg.play?.id === v.id && <Badge size="sm" variant="light" color="teal">{cfg.mode === 'day' ? 'Today' : 'Now'}</Badge>}
                      {v.missing && <Badge size="sm" variant="light" color="red">File missing</Badge>}
                      <Text size="xs" c="dimmed" w={64} ta="right">{mb(v.size)}</Text>
                      <Tooltip label={previewId === v.id ? 'Close the player' : 'Watch this video'} withArrow>
                        <ActionIcon variant="light" color="kumkum" aria-label={`Watch ${v.name}`} disabled={v.missing} onClick={() => setPreviewId(previewId === v.id ? null : v.id)}>
                          <Play size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Remove from the library" withArrow>
                        <ActionIcon variant="subtle" color="red" aria-label={`Remove ${v.name}`} loading={remove.isPending && remove.variables === v.id} onClick={() => onRemove(v)}>
                          <Trash2 size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                    {previewId === v.id && (
                      <video
                        key={v.version}
                        src={welcomeApi.welcomeVideoUrl(v.id, v.version, v.static)}
                        controls
                        autoPlay
                        preload="metadata"
                        playsInline
                        style={{ width: '100%', maxWidth: 480, marginTop: 8, borderRadius: 12, background: '#2B0909', display: 'block' }}
                      />
                    )}
                  </Card>
                ))}
              </Stack>
            </div>

            {progress !== null && <Progress value={progress} color="kumkum" size="sm" animated aria-label="Upload progress" />}

            <Group gap="sm" wrap="wrap">
              <FileButton onChange={pick} accept="video/mp4" resetRef={resetRef} multiple>
                {(props) => (
                  <Button {...props} leftSection={<Upload size={16} />} loading={upload.isPending}>
                    Add video
                  </Button>
                )}
              </FileButton>
              <Button variant="default" leftSection={<FolderInput size={16} />} onClick={() => importFolder.mutate()} loading={importFolder.isPending}>
                Import app welcome folder
              </Button>
              <Button variant="light" color="kumkum" leftSection={<Play size={16} />} onClick={() => setSplash(true)}>
                Preview welcome now
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              MP4 (H.264 with AAC audio works everywhere), up to {MAX_MB} MB each, about 10 to 15 seconds is ideal. It is shown full screen, so use a 16:9 video.
            </Text>
          </>
        )}
        {!cfg.enabled && (
          <Alert color="gray" variant="light">
            The welcome video is switched off. Users go straight to the dashboard.
          </Alert>
        )}
      </Stack>
      {splash &&
        // a portal: the settings page animates with a transform, which would trap this fixed full-screen layer inside the card
        createPortal(
          <Suspense fallback={null}>
            <WelcomeSplash
              name={user?.user_name || user?.user_code}
              onDone={() => {
                setSplash(false)
                qc.invalidateQueries({ queryKey: ['welcome'] })
              }}
            />
          </Suspense>,
          document.body
        )}
    </Card>
  )
}
