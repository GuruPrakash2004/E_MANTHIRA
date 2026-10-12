import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Group, Select, Stack, Text } from '@mantine/core'
import { CircleCheck, Download, PrinterX } from 'lucide-react'
import * as printApi from '../api/endpoints/print'
import { detectAgent, getRememberedPrinter, rememberPrinter } from '../lib/localPrint'

/**
 * Print Settings — lets counter staff pick which of THIS PC's printers
 * vTemple should use, and (when the Print Agent isn't installed yet) walk
 * them through the one-click setup. Same role as DatabaseSettingsPanel —
 * a small local-machine override, not a server-side setting — but this one
 * talks to the Print Agent directly (http://127.0.0.1:8787), never the API,
 * except to fetch the ready-made installer file.
 */
export default function LocalPrinterSetting() {
  const [agent, setAgent] = useState(null) // {host, default, printers} | null
  const [checked, setChecked] = useState(false)
  const [printer, setPrinter] = useState(getRememberedPrinter())

  useEffect(() => {
    let cancelled = false
    let timer

    async function poll() {
      const result = await detectAgent()
      if (cancelled) return
      setAgent(result)
      setChecked(true)
      if (!result) timer = setTimeout(poll, 4000) // re-check until the one-click setup finishes
    }
    poll()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  function choosePrinter(name) {
    setPrinter(name)
    if (name) rememberPrinter(name)
  }

  if (!checked) {
    return (
      <Text size="sm" c="dimmed">
        Looking for the Print Agent on this PC…
      </Text>
    )
  }

  if (!agent) {
    return (
      <Stack gap="sm">
        <Alert icon={<PrinterX size={18} />} color="kumkum" variant="light" title="Print Agent not found on this PC">
          To print receipts directly on this counter's printer without the browser's print dialog, install the
          vTemple Print Agent once. It then starts automatically whenever you sign in to Windows.
        </Alert>
        <Group>
          <Button
            component="a"
            href={printApi.agentDownloadUrl()}
            leftSection={<Download size={16} />}
            color="saffron"
          >
            Download Print Agent for this PC
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          After downloading, double-click the file once. This page will pick up the agent automatically.
        </Text>
      </Stack>
    )
  }

  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Badge color="teal" variant="light" leftSection={<CircleCheck size={14} />}>
          Print Agent running on {agent.host}
        </Badge>
      </Group>
      <Select
        label="Printer for this PC"
        description="Used for direct, silent printing from this browser — independent of the server's print options."
        data={agent.printers.map((p) => ({ value: p, label: p === agent.default ? `${p} (Windows default)` : p }))}
        value={printer && agent.printers.includes(printer) ? printer : null}
        onChange={choosePrinter}
        placeholder={agent.default || 'Choose a printer'}
        clearable
        maw={420}
      />
      {!printer && (
        <Text size="xs" c="dimmed">
          No printer chosen — this PC's Windows default ({agent.default || 'none set'}) will be used.
        </Text>
      )}
    </Stack>
  )
}
