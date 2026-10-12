import { useRef, useState } from 'react'
import { Alert, Badge, Button, Card, FileButton, Group, Progress, Stack, Switch, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clapperboard, RotateCcw, Upload } from 'lucide-react'
import * as welcomeApi from '../../api/endpoints/welcome'
import { useConfirm } from '../../components/ui/ConfirmProvider'

const MAX_MB = 60

/**
 * Global Settings > Welcome video (ADMIN). Upload an MP4 that replaces the built-in welcome clips, preview it,
 * switch the welcome off, or go back to the built-in clips. The file is stored on the server (no DB changes).
 */
export default function WelcomeVideoCard() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [progress, setProgress] = useState(null)
  const resetRef = useRef(null)
  const { data, isLoading } = useQuery({ queryKey: ['welcome'], queryFn: welcomeApi.getWelcome })
  const cfg = data && typeof data === 'object' && !Array.isArray(data) ? data : { enabled: true, custom: false, size: 0, version: 0 }

  const apiError = (err) => err?.response?.data?.detail || 'Something went wrong'
  const refresh = (next) => qc.setQueryData(['welcome'], next)

  const upload = useMutation({
    mutationFn: (file) => welcomeApi.uploadWelcome(file, setProgress),
    onSuccess: (next) => {
      refresh(next)
      notifications.show({ message: 'Welcome video uploaded', color: 'teal' })
    },
    onError: (err) => notifications.show({ message: apiError(err), color: 'red' }),
    onSettled: () => {
      setProgress(null)
      resetRef.current?.()
    },
  })
  const toggle = useMutation({
    mutationFn: welcomeApi.setWelcomeEnabled,
    onSuccess: refresh,
    onError: (err) => notifications.show({ message: apiError(err), color: 'red' }),
  })
  const remove = useMutation({
    mutationFn: welcomeApi.removeWelcome,
    onSuccess: (next) => {
      refresh(next)
      notifications.show({ message: 'Back to the built-in welcome video', color: 'teal' })
    },
    onError: (err) => notifications.show({ message: apiError(err), color: 'red' }),
  })

  function pick(file) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.mp4')) return notifications.show({ message: 'Choose an .mp4 video', color: 'red' })
    if (file.size > MAX_MB * 1024 * 1024) return notifications.show({ message: `Video must be ${MAX_MB} MB or smaller`, color: 'red' })
    upload.mutate(file)
  }

  async function onRemove() {
    const ok = await confirm({
      title: 'Remove your welcome video?',
      message: 'The uploaded file is deleted and the built-in welcome video is used again.',
      confirmLabel: 'Remove',
    })
    if (ok) remove.mutate()
  }

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
          <Badge variant="light" color={cfg.custom ? 'yellow' : 'gray'}>
            {cfg.custom ? 'Custom video' : 'Built-in video'}
          </Badge>
        </Group>

        <Switch
          label="Play the welcome video after sign-in"
          checked={cfg.enabled}
          disabled={isLoading || toggle.isPending}
          onChange={(e) => toggle.mutate(e.currentTarget.checked)}
        />

        {cfg.custom && (
          <div>
            <video
              key={cfg.version}
              src={welcomeApi.welcomeVideoUrl(cfg.version)}
              controls
              preload="metadata"
              playsInline
              style={{ width: '100%', maxWidth: 480, borderRadius: 12, background: '#2B0909', display: 'block' }}
            />
            <Text size="xs" c="dimmed" mt={4}>
              {(cfg.size / (1024 * 1024)).toFixed(1)} MB
            </Text>
          </div>
        )}

        {progress !== null && <Progress value={progress} color="kumkum" size="sm" animated aria-label="Upload progress" />}

        <Group gap="sm">
          <FileButton onChange={pick} accept="video/mp4" resetRef={resetRef}>
            {(props) => (
              <Button {...props} leftSection={<Upload size={16} />} loading={upload.isPending}>
                {cfg.custom ? 'Replace video' : 'Upload video'}
              </Button>
            )}
          </FileButton>
          {cfg.custom && (
            <Button variant="default" leftSection={<RotateCcw size={16} />} onClick={onRemove} loading={remove.isPending}>
              Use built-in video
            </Button>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          MP4 (H.264 with AAC audio works everywhere), up to {MAX_MB} MB, about 10 to 15 seconds is ideal. It is shown full screen, so use a 16:9 video.
        </Text>
        {!cfg.enabled && (
          <Alert color="gray" variant="light">
            The welcome video is switched off. Users go straight to the dashboard.
          </Alert>
        )}
      </Stack>
    </Card>
  )
}
