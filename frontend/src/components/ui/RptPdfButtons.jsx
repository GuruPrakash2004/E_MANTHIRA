import { useEffect, useRef, useState } from 'react'
import { Button, Group, Loader, Modal, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { Eye, Printer } from 'lucide-react'
import usePrintKey from '../../hooks/usePrintKey'

/** The message of a failed blob request: the server's JSON error sits inside the blob. */
async function messageOf(err, fallback) {
  try {
    const data = err?.response?.data
    if (data instanceof Blob) return JSON.parse(await data.text())?.detail || fallback
    return data?.detail || fallback
  } catch {
    return fallback
  }
}

/**
 * Preview and Print for a report printed from its original .rpt file: `load()` returns the report's PDF (made by the
 * Crystal print service). Preview shows it in a window; Print sends the same PDF to the browser's print dialog.
 */
export default function RptPdfButtons({ title, load, disabled = false, size = 'sm', hotkey = false }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState(null)
  const frame = useRef(null)

  useEffect(() => () => url && URL.revokeObjectURL(url), [url])

  async function fetchPdf() {
    setBusy(true)
    try {
      return URL.createObjectURL(await load())
    } catch (e) {
      notifications.show({ title: 'Could not prepare the report', message: await messageOf(e, 'The print service could not make this report.'), color: 'red' })
      return null
    } finally {
      setBusy(false)
    }
  }

  async function preview() {
    const u = await fetchPdf()
    if (!u) return
    setUrl(u)
    setOpen(true)
  }

  async function printNow() {
    if (open && frame.current?.contentWindow) {
      frame.current.contentWindow.focus()
      frame.current.contentWindow.print()
      return
    }
    const u = await fetchPdf()
    if (!u) return
    const f = document.createElement('iframe')
    f.setAttribute('aria-hidden', 'true')
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
    f.onload = () => {
      try {
        f.contentWindow.focus()
        f.contentWindow.print()
      } finally {
        setTimeout(() => {
          f.remove()
          URL.revokeObjectURL(u)
        }, 60_000)
      }
    }
    f.src = u
    document.body.appendChild(f)
  }
  usePrintKey(hotkey ? () => !disabled && printNow() : undefined)

  return (
    <>
      <Button size={size} variant="light" color="kumkum" leftSection={<Eye size={15} />} disabled={disabled || busy} loading={busy && !open} onClick={preview}>
        Preview
      </Button>
      <Button size={size} variant="light" color="kumkum" leftSection={<Printer size={15} />} disabled={disabled || busy} onClick={printNow} aria-keyshortcuts={hotkey ? 'F10' : undefined}>
        Print{hotkey ? ' (F10)' : ''}
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} size="min(1000px, 96vw)" radius="lg" centered zIndex={400} title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Print preview - {title}</Text>}>
        {url ? <iframe ref={frame} title="Report preview" src={url} style={{ width: '100%', height: '72vh', border: '1px solid var(--vt-line)', borderRadius: 8, background: '#fff' }} /> : <Loader color="kumkum" />}
        <Group justify="flex-end" mt="sm" gap="xs">
          <Button color="kumkum" leftSection={<Printer size={15} />} onClick={printNow}>Print</Button>
          <Button variant="default" onClick={() => setOpen(false)}>Close</Button>
        </Group>
      </Modal>
    </>
  )
}
