import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Group, Loader, Modal, Select, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import { useHotkeys } from 'react-hotkeys-hook'
import { AlertTriangle, Download, FileText, Printer } from 'lucide-react'
import * as printApi from '../api/endpoints/print'
import { agentNow, detectAgent, getRememberedPrinter, rememberPrinter, warmAgent } from '../lib/localPrint'
import { loadFormats, pickFormat, printErrorMessage, printInBrowser, printOnServer, printOnThisPc, renderToPreview, renderToUrl, rememberFormat, setPrintDialogOpen } from '../lib/printing'

const BROWSER = 'browser'
const SERVER = 'server'

/**
 * One print dialog for every document. Left: the formats the document can print in (the `.rpt` files its `UtlOption`
 * rows point at). Right: a live preview of THIS record rendered by the print bridge from the original Crystal report.
 * Keyboard: Up/Down choose the format, Enter prints (the Print button has focus on open), Esc closes.
 */
export default function PrintDialog({ opened, onClose, docId, recordId, title }) {
  const [selected, setSelected] = useState(null) // option_name
  const [target, setTarget] = useState(null) // 'browser' | 'server' | 'pc:<printer>'
  const [targetTouched, setTargetTouched] = useState(false)
  const [pdfUrl, setPdfUrl] = useState(null)
  const [pages, setPages] = useState([]) // [{ png, w, h }]: the report's pages at their real shape (points)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [printing, setPrinting] = useState(false)
  const [agent, setAgent] = useState(agentNow())
  const urlRef = useRef(null)

  const { data: formats, isError: formatsFailed } = useQuery({
    queryKey: ['print-formats', docId],
    queryFn: () => loadFormats(docId),
    enabled: opened && Boolean(docId),
  })

  useEffect(() => {
    setPrintDialogOpen(opened)
    return () => setPrintDialogOpen(false)
  }, [opened])

  // A dropdown open on the page behind must not stay open over the form.
  useEffect(() => {
    if (opened && document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }, [opened])

  useEffect(() => {
    if (!opened) return undefined
    warmAgent()
    let cancelled = false
    detectAgent().then((a) => !cancelled && setAgent(a))
    return () => {
      cancelled = true
    }
  }, [opened])

  // pre-select: this user's last choice beats the designer default
  useEffect(() => {
    if (opened && formats?.length && !selected) setSelected(pickFormat(formats)?.option_name || null)
  }, [opened, formats, selected])

  // reset when closed
  useEffect(() => {
    if (!opened) {
      setSelected(null)
      setTarget(null)
      setTargetTouched(false)
      setError('')
      setLoading(false)
    }
  }, [opened])

  const format = formats?.find((f) => f.option_name === selected) || null

  const targets = useMemo(() => {
    const groups = []
    if (format?.printer_name) groups.push({ group: 'Print service PC', items: [{ value: SERVER, label: format.printer_name }] })
    if (agent?.printers?.length) groups.push({ group: `This PC (${agent.host})`, items: agent.printers.map((p) => ({ value: `pc:${p}`, label: p === agent.default ? `${p} · default` : p })) })
    groups.push({ group: 'Browser', items: [{ value: BROWSER, label: 'Browser print dialog' }] })
    return groups
  }, [format, agent])

  // default target (until the user picks one): this PC's remembered printer, else the format's own printer, else this PC's default, else the browser
  useEffect(() => {
    if (!opened || !format || targetTouched) return
    const remembered = getRememberedPrinter()
    if (agent?.printers?.length && remembered && agent.printers.includes(remembered)) setTarget(`pc:${remembered}`)
    else if (format.printer_name) setTarget(SERVER)
    else if (agent?.printers?.length) setTarget(`pc:${agent.default || agent.printers[0]}`)
    else setTarget(BROWSER)
  }, [opened, format, agent, targetTouched])

  // render the preview whenever the format / record changes
  useEffect(() => {
    if (!opened || !selected || !recordId) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    setPdfUrl(null)
    setPages([])
    renderToPreview({ docId, recordId, optionName: selected })
      .then(({ url, pages: shown }) => {
        if (cancelled) return URL.revokeObjectURL(url)
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = url
        setPdfUrl(url)
        setPages(shown)
      })
      .catch(async (err) => !cancelled && setError(await printErrorMessage(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [opened, selected, docId, recordId])

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  const chooseFormat = useCallback(
    (optionName) => {
      setSelected(optionName)
      setTargetTouched(false)
      rememberFormat(docId, optionName)
    },
    [docId],
  )

  const choosePrinter = (value) => {
    setTarget(value)
    setTargetTouched(true)
    if (value?.startsWith('pc:')) rememberPrinter(value.slice(3))
  }

  const onPrint = useCallback(async () => {
    if (!format || printing) return
    setPrinting(true)
    try {
      if (target === SERVER) {
        await printOnServer({ docId, recordId, optionName: selected, printerName: format.printer_name, copies: format.copies })
        notifications.show({ message: `Sent to ${format.printer_name}`, color: 'teal' })
      } else if (target?.startsWith('pc:')) {
        const printer = target.slice(3)
        await printOnThisPc({ docId, recordId, optionName: selected, printer })
        notifications.show({ message: `Sent to ${printer} on this PC`, color: 'teal' })
      } else {
        const url = pdfUrl || (await renderToUrl({ docId, recordId, optionName: selected }))
        printInBrowser(url)
      }
      onClose()
    } catch (err) {
      notifications.show({ title: 'Could not print', message: await printErrorMessage(err), color: 'red' })
    } finally {
      setPrinting(false)
    }
  }, [format, printing, target, docId, recordId, selected, pdfUrl, onClose])

  // F10 = print now from anywhere in the dialog (even with the format list or the printer picker focused)
  useHotkeys('f10', (e) => { e.preventDefault(); onPrint() }, { enabled: opened, enableOnFormTags: true }, [onPrint, opened])

  // Up/Down = previous/next available format; Enter = print (unless a control that uses Enter has focus)
  function onKeyDown(e) {
    if (e.target.closest?.('[data-print-target]')) return
    const available = (formats || []).filter((f) => f.available)
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && available.length > 1) {
      e.preventDefault()
      const i = available.findIndex((f) => f.option_name === selected)
      const next = available[(i + (e.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length]
      chooseFormat(next.option_name)
    } else if (e.key === 'Enter' && !e.target.closest?.('button, a')) {
      e.preventDefault()
      onPrint()
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} size="min(1180px, 96vw)" radius="lg" title={null} padding={0} centered yOffset={0} styles={{ inner: { padding: 8 } }}>
      <div onKeyDown={onKeyDown} style={{ display: 'flex', height: 'min(760px, calc(100dvh - 16px))' }}>
        <div style={{ width: 320, flex: '0 0 320px', minHeight: 0, borderRight: '1px solid var(--vt-line)', display: 'flex', flexDirection: 'column' }}>
          <Group gap="sm" p="md" style={{ borderBottom: '1px solid var(--vt-line)' }}>
            <div aria-hidden style={{ width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'linear-gradient(160deg, var(--vt-g1), var(--vt-g2d))' }}>
              <Printer size={20} color="#F4E1A6" />
            </div>
            <div>
              <Title order={5} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
                {title || 'Print'}
              </Title>
              <Text size="xs" c="dimmed">
                {formats ? `${formats.length} format${formats.length === 1 ? '' : 's'}` : 'Loading formats'}
              </Text>
            </div>
          </Group>

          <div role="radiogroup" aria-label="Print format" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
            {!formats && !formatsFailed && <Loader size="sm" color="kumkum" m="md" />}
            {formatsFailed && <Text size="sm" c="red">Could not load the print formats.</Text>}
            {formats && formats.length === 0 && <Text size="sm" c="dimmed">This document has no print format set up.</Text>}
            <Stack gap="xs">
              {(formats || []).map((f) => {
                const active = selected === f.option_name
                return (
                  <UnstyledButton
                    key={f.option_name}
                    role="radio"
                    aria-checked={active}
                    aria-disabled={!f.available}
                    tabIndex={-1}
                    onClick={() => f.available && chooseFormat(f.option_name)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: 12,
                      borderRadius: 12,
                      border: `1px solid ${active ? 'var(--vt-accent)' : 'var(--vt-line)'}`,
                      background: active ? 'var(--vt-gold-chip)' : 'var(--vt-surface)',
                      opacity: f.available ? 1 : 0.55,
                      cursor: f.available ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <Group justify="space-between" wrap="nowrap" align="flex-start">
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={600}>
                          {f.option_name}
                        </Text>
                        <Text size="xs" c="dimmed" ff="monospace" truncate>
                          {f.rpt_file}
                        </Text>
                        {!f.available && (
                          <Text size="xs" c="red">
                            This report file is not in the RPT folder.
                          </Text>
                        )}
                        {f.printer_name && (
                          <Text size="xs" c="dimmed">
                            Printer: {f.printer_name}
                          </Text>
                        )}
                      </div>
                      <Stack gap={4} align="flex-end">
                        {f.preferred && (
                          <Badge size="xs" variant="light" color="kumkum">
                            Your last
                          </Badge>
                        )}
                        {!f.preferred && f.default && (
                          <Badge size="xs" variant="light" color="gold" c="var(--vt-badge-ink)">
                            Default
                          </Badge>
                        )}
                        {!f.available && (
                          <Badge size="xs" variant="light" color="red">
                            File missing
                          </Badge>
                        )}
                      </Stack>
                    </Group>
                  </UnstyledButton>
                )
              })}
            </Stack>
          </div>

          <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--vt-line)' }} data-print-target>
            <Select label="Print to" size="xs" data={targets} value={target} onChange={choosePrinter} allowDeselect={false} comboboxProps={{ withinPortal: true }} />
            {!agent && (
              <Button component="a" href={printApi.agentDownloadUrl()} variant="subtle" size="xs" color="gray" mt={6} fullWidth leftSection={<Download size={14} />}>
                Download Print Agent for this PC
              </Button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--vt-sandal)' }}>
          <Group justify="space-between" p="md" style={{ borderBottom: '1px solid var(--vt-line)', background: 'var(--vt-surface)' }}>
            <Group gap={6}>
              <FileText size={16} color="var(--vt-accent)" aria-hidden />
              <Text size="sm" c="dimmed">
                Preview: <b>{format?.rpt_file || '-'}</b>
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              Up/Down format · Enter or F10 print · Esc close
            </Text>
          </Group>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '0.75rem' }}>
            {loading && <Loader mt="xl" color="kumkum" />}
            {!loading && error && (
              <Alert color="red" variant="light" icon={<AlertTriangle size={18} />} title="Could not prepare the print" maw={520} mt="xl" style={{ alignSelf: 'flex-start' }}>
                {error}
              </Alert>
            )}
            {!loading && !error && pdfUrl && (
              // The report's own page(s) as images: A4 stays A4, a 3-inch receipt stays a narrow slip cut at the end of the receipt.
              // 1.5 px per point (about 108 dpi) keeps text readable; a wide page shrinks to the pane, never stretches.
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%' }}>
                {pages.map((p, i) => (
                  <img
                    key={i}
                    alt={`Page ${i + 1} of ${format?.rpt_file || 'the report'}`}
                    src={`data:image/png;base64,${p.png}`}
                    style={{ width: p.w * 1.5, maxWidth: '100%', height: 'auto', background: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', display: 'block' }}
                  />
                ))}
              </div>
            )}
            {!loading && !error && !pdfUrl && (
              <Text c="dimmed" mt="xl">
                Choose a format to preview
              </Text>
            )}
          </div>
          <Group justify="flex-end" gap="xs" wrap="nowrap" p="sm" style={{ borderTop: '1px solid var(--vt-line)', background: 'var(--vt-surface)' }}>
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button data-autofocus color="kumkum" leftSection={<Printer size={16} />} loading={printing} disabled={!format?.available} onClick={onPrint}>
              Print (F10)
            </Button>
          </Group>
        </div>
      </div>
    </Modal>
  )
}
