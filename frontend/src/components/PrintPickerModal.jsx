import { useEffect, useState } from 'react'
import { Badge, Button, Divider, Group, Loader, Modal, Paper, Radio, ScrollArea, Select, Stack, Text, Title } from '@mantine/core'
import { Monitor, Download, FileText, Printer } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import * as printApi from '../api/endpoints/print'
import { agentNow, detectAgent, getRememberedPrinter, printDocumentOnThisPc, rememberPrinter, warmAgent } from '../lib/localPrint'

/**
 * Folder-mapped print-format picker — lists every .rpt option the backend
 * found for this document (UtlOption rows cross-referenced against the real
 * files under RPT_PATH), lets the user choose one, renders a live preview of
 * THIS record through it (Crystal service / mock bridge — never rendered
 * in-house, per CLAUDE.md), and prints from there.
 */
export default function PrintPickerModal({ opened, onClose, docId, recordId, title }) {
  const [selected, setSelected] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [agent, setAgent] = useState(agentNow())
  const [pcPrinter, setPcPrinter] = useState(getRememberedPrinter())
  const [printingOnPc, setPrintingOnPc] = useState(false)

  // The Print Agent on THIS PC (see src/lib/localPrint.js) — lets this
  // counter print straight to its own printer, no browser dialog.
  useEffect(() => {
    if (!opened) return
    warmAgent()
    let cancelled = false
    detectAgent().then((a) => !cancelled && setAgent(a))
    return () => {
      cancelled = true
    }
  }, [opened])

  function choosePcPrinter(name) {
    setPcPrinter(name)
    if (name) rememberPrinter(name)
  }

  const { data: options } = useQuery({
    queryKey: ['print-options', docId],
    queryFn: () => printApi.getPrintOptions(docId),
    enabled: opened && Boolean(docId),
  })

  useEffect(() => {
    if (!opened) return
    if (options?.length && !selected) {
      // This user's own last pick (see print_prefs.py) wins over the shared
      // UtlOption.DefaultPrint — same "sticky last choice" as the old EXE.
      const def =
        options.find((o) => o.preferred && o.available) ||
        options.find((o) => o.default && o.available) ||
        options.find((o) => o.available) ||
        options[0]
      setSelected(def.option_name)
    }
  }, [opened, options])

  function selectOption(optionName) {
    setSelected(optionName)
    if (optionName) printApi.setPrintPreference(docId, optionName).catch(() => {})
  }

  useEffect(() => {
    if (!opened || !selected || !recordId) return
    let cancelled = false
    setLoadingPreview(true)
    setPreviewUrl(null)
    printApi
      .previewPdf(docId, selected, recordId)
      .then((blob) => {
        if (cancelled) return
        setPreviewUrl(URL.createObjectURL(blob))
      })
      .catch(() => {
        if (!cancelled) notifications.show({ message: 'Could not render preview — check the print service', color: 'red' })
      })
      .finally(() => !cancelled && setLoadingPreview(false))
    return () => {
      cancelled = true
    }
  }, [opened, selected, docId, recordId])

  useEffect(() => {
    if (!opened) {
      setSelected(null)
      setPreviewUrl(null)
    }
  }, [opened])

  const selectedOption = options?.find((o) => o.option_name === selected)
  const [sendingDirect, setSendingDirect] = useState(false)

  async function onPrint() {
    try {
      const win = window.open(previewUrl, '_blank')
      if (win) {
        win.addEventListener('load', () => {
          win.focus()
          win.print()
        })
      }
    } catch {
      notifications.show({ message: 'Could not open print dialog', color: 'red' })
    }
  }

  async function onPrintOnThisPc() {
    setPrintingOnPc(true)
    try {
      await printDocumentOnThisPc(printApi.pagesUrl(docId, selected, recordId), pcPrinter || undefined)
      notifications.show({ message: `Sent to ${pcPrinter || agent.default} on this PC`, color: 'teal' })
    } catch (err) {
      notifications.show({ message: err.message || 'Could not print on this PC', color: 'red' })
    } finally {
      setPrintingOnPc(false)
    }
  }

  async function onDirectPrint() {
    setSendingDirect(true)
    try {
      await printApi.printDirect(docId, selected, recordId)
      notifications.show({ message: `Sent to ${selectedOption.direct_printer_name.trim()}`, color: 'teal' })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not reach the print service', color: 'red' })
    } finally {
      setSendingDirect(false)
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} size="90%" radius="lg" title={null} padding={0}>
      <div style={{ display: 'flex', minHeight: 560, maxHeight: '80vh' }}>
        <div style={{ width: 340, borderRight: '1px solid var(--vt-line)', display: 'flex', flexDirection: 'column' }}>
          <Group gap="sm" p="md" style={{ borderBottom: '1px solid var(--vt-line)' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg,#E07B16,#D4A437)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Printer size={20} color="white" />
            </div>
            <div>
              <Title order={5} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
                {title || 'Print Format'}
              </Title>
              <Text size="xs" c="dimmed">
                {options?.length ?? '...'} format{options?.length === 1 ? '' : 's'} available from backend
              </Text>
            </div>
          </Group>
          <ScrollArea style={{ flex: 1 }} p="sm">
            {!options && <Loader size="sm" m="md" />}
            <Radio.Group value={selected} onChange={selectOption}>
              <Stack gap="xs">
                {(options || []).map((o) => (
                  <Paper
                    key={o.option_name}
                    withBorder
                    radius="md"
                    p="sm"
                    onClick={() => o.available && selectOption(o.option_name)}
                    style={{
                      cursor: o.available ? 'pointer' : 'not-allowed',
                      opacity: o.available ? 1 : 0.5,
                      borderColor: selected === o.option_name ? '#D4A437' : undefined,
                      background: selected === o.option_name ? 'rgba(212,164,55,0.08)' : undefined,
                    }}
                  >
                    <Group justify="space-between" wrap="nowrap" align="flex-start">
                      <Group gap="xs" wrap="nowrap" align="flex-start">
                        <Radio value={o.option_name} disabled={!o.available} mt={2} />
                        <div>
                          <Text size="sm" fw={600}>
                            {o.option_name}
                          </Text>
                          <Text size="xs" c="dimmed" ff="monospace">
                            {o.rpt_file}
                          </Text>
                          {o.direct_printer_name && (
                            <Text size="xs" c="dimmed">
                              Printer: {o.direct_printer_name}
                            </Text>
                          )}
                        </div>
                      </Group>
                      <Stack gap={4} align="flex-end">
                        {o.preferred && (
                          <Badge size="xs" color="teal" variant="light">
                            Your default
                          </Badge>
                        )}
                        {!o.preferred && o.default && (
                          <Badge size="xs" color="kumkum" variant="light">
                            Default
                          </Badge>
                        )}
                        {!o.available && (
                          <Badge size="xs" color="red" variant="light">
                            Not Found
                          </Badge>
                        )}
                      </Stack>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </Radio.Group>
          </ScrollArea>
          <Divider />
          <div style={{ padding: '0.75rem 1rem' }}>
            {agent ? (
              <Select
                label={`This PC (${agent.host})`}
                size="xs"
                data={agent.printers.map((p) => ({ value: p, label: p === agent.default ? `${p} · default` : p }))}
                value={pcPrinter && agent.printers.includes(pcPrinter) ? pcPrinter : null}
                onChange={choosePcPrinter}
                placeholder={agent.default || 'Choose a printer'}
                clearable
              />
            ) : (
              <Button
                component="a"
                href={printApi.agentDownloadUrl()}
                variant="subtle"
                size="xs"
                color="gray"
                leftSection={<Download size={14} />}
                fullWidth
              >
                Download Print Agent for this PC
              </Button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--vt-sandal)' }}>
          <Group justify="space-between" p="md" style={{ borderBottom: '1px solid var(--vt-line)', background: 'var(--vt-surface)' }}>
            <Group gap={6}>
              <FileText size={16} color="#7A1F1F" />
              <Text size="sm" c="dimmed">
                Preview: <b>{selectedOption?.rpt_file || '—'}</b>
              </Text>
            </Group>
          </Group>
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '1.5rem' }}>
            {loadingPreview && <Loader mt="xl" color="kumkum" />}
            {!loadingPreview && previewUrl && (
              <iframe title="Print preview" src={previewUrl} style={{ width: '100%', height: '100%', minHeight: 500, border: 'none', background: 'var(--vt-surface)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }} />
            )}
            {!loadingPreview && !previewUrl && (
              <Text c="dimmed" mt="xl">
                Choose a format to preview
              </Text>
            )}
          </div>
          <Group justify="flex-end" p="md" style={{ borderTop: '1px solid var(--vt-line)', background: 'var(--vt-surface)' }}>
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            {selectedOption?.direct_printer_name && (
              <Button
                variant="light"
                color="saffron"
                leftSection={<Monitor size={16} />}
                loading={sendingDirect}
                onClick={onDirectPrint}
              >
                Direct Print &middot; {selectedOption.direct_printer_name.trim()}
              </Button>
            )}
            {agent && (
              <Button
                variant="light"
                color="teal"
                leftSection={<Monitor size={16} />}
                loading={printingOnPc}
                disabled={!selected}
                onClick={onPrintOnThisPc}
              >
                Print on this PC &middot; {pcPrinter || agent.default}
              </Button>
            )}
            <Button leftSection={<Printer size={16} />} color="kumkum" disabled={!previewUrl} onClick={onPrint}>
              Print{selectedOption ? ` · ${selectedOption.rpt_file}` : ''}
            </Button>
          </Group>
        </div>
      </div>
    </Modal>
  )
}
