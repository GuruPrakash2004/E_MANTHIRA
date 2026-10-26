import { useRef } from 'react'
import { Alert, Button, Card, Group, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Upload } from 'lucide-react'
import * as printOptionsApi from '../api/endpoints/printOptions'
import { useAuth } from '../hooks/useAuth'

/**
 * Old Indian-language reports (Kannada, Telugu, Tamil, Hindi ...) draw their text in non-Unicode fonts such as
 * "BRH Kannada". A machine without that font prints Latin gibberish instead. The print service installs every font
 * file in the report folder's Fonts folder, so the fix is to add the font file once. ADMIN can do it right here.
 */
function useFontUpload() {
  const queryClient = useQueryClient()
  const input = useRef(null)
  const upload = useMutation({
    mutationFn: printOptionsApi.uploadFontFile,
    onSuccess: (r) => {
      notifications.show({ message: `Font ${r.saved} added. The print service is restarting; preview again in a few seconds.`, color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['format-fonts'] })
      queryClient.invalidateQueries({ queryKey: ['font-files'] })
    },
    onError: (err) => notifications.show({ message: err?.response?.data?.detail || 'Could not add the font', color: 'red' }),
  })
  return { input, upload }
}

/** Shown in the print preview when the chosen format uses a font this machine lacks. */
export function ReportFontsNotice({ docId, optionName }) {
  const { user } = useAuth()
  const { input, upload } = useFontUpload()
  const { data } = useQuery({
    queryKey: ['format-fonts', docId, optionName],
    queryFn: () => printOptionsApi.getFormatFonts(docId, optionName),
    enabled: Boolean(docId && optionName),
    staleTime: 60_000,
    retry: false,
  })
  const missing = data?.missing || []
  if (!missing.length) return null
  const isAdmin = String(user?.user_code || '').toUpperCase() === 'ADMIN'
  return (
    <Alert color="yellow" variant="light" icon={<AlertTriangle size={18} />} title="Some text may print wrongly" m="sm" mb={0}>
      <Stack gap={6}>
        <Text size="sm">
          This format uses {missing.length === 1 ? 'a font' : 'fonts'} this computer does not have: <b>{missing.join(', ')}</b>. Regional-language text
          set in {missing.length === 1 ? 'it' : 'them'} shows as odd Latin characters. Add the font file once and it is fixed for every print.
        </Text>
        {isAdmin ? (
          <Group gap="xs">
            <input ref={input} type="file" accept=".ttf,.otf,.ttc" hidden onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
            <Button size="compact-sm" variant="light" color="kumkum" leftSection={<Upload size={14} />} loading={upload.isPending} onClick={() => input.current?.click()}>
              Add font file
            </Button>
          </Group>
        ) : (
          <Text size="xs" c="dimmed">Ask ADMIN to add the font file (Admin Master &gt; Print Options).</Text>
        )}
      </Stack>
    </Alert>
  )
}

/** Admin card: the font files the print service installs, with an upload button. */
export function ReportFontsCard() {
  const { user } = useAuth()
  const { input, upload } = useFontUpload()
  const { data } = useQuery({ queryKey: ['font-files'], queryFn: printOptionsApi.listFontFiles })
  const isAdmin = String(user?.user_code || '').toUpperCase() === 'ADMIN'
  return (
    <Card withBorder p="md">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Text fw={600}>Report fonts</Text>
          <Text size="xs" c="dimmed" maw={560}>
            Old reports use fonts such as "BRH Kannada" for Kannada, Telugu or Tamil text. Font files added here are installed for the print
            service, so those reports print correctly on this computer.
          </Text>
          <Text size="xs" mt={6}>
            {data?.files?.length ? data.files.join(', ') : 'No extra fonts added yet.'}
          </Text>
        </div>
        {isAdmin && (
          <>
            <input ref={input} type="file" accept=".ttf,.otf,.ttc" hidden onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
            <Button size="xs" variant="light" color="kumkum" leftSection={<Upload size={14} />} loading={upload.isPending} onClick={() => input.current?.click()}>
              Add font file
            </Button>
          </>
        )}
      </Group>
    </Card>
  )
}
