import { useEffect, useState } from 'react'
import { Button, Group, Menu, Modal, Select, Stack, Text, TextInput, Textarea, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import { ChevronUp, Mail, MessageSquare, Send, X } from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'
import * as docActions from '../../api/endpoints/docActions'
import useRights from '../../hooks/useRights'
import { AmendmentDialog, AttachmentsDialog, LabelPrintDialog } from './DocExtraDialogs'

/**
 * The Options menu of a transaction screen. Which entries exist is data (UtlTransactions flags, served by
 * GET /doc-actions/{doc}/options), so each client's database decides. Send EMAIL / Send SMS are built; the rest
 * are listed disabled so nothing the legacy menu offers silently disappears. `extra` = entries the screen adds itself
 * (Hall Booking: Receipt Info, Donation for NMM / SLV): [{ name, label, onClick(recordId) }], listed first.
 */
export default function DocOptionsMenu({ docId, recordId, extra = [] }) {
  const { data: allOptions = [] } = useQuery({ queryKey: ['doc-options', docId], queryFn: () => docActions.getOptions(docId), staleTime: 5 * 60_000 })
  const rights = useRights(docId)
  // mail, SMS and labels are printing-type actions; amendments change the record
  const options = allOptions.filter((o) => (['Send EMAIL', 'Send SMS', 'Label Print'].includes(o.name) ? rights.print : o.name === 'Amendment' ? rights.edit : true))
  const [open, setOpen] = useState(null)
  const has = (name) => options.some((o) => o.name === name && o.supported)
  // legacy toolbar shortcuts: Attachment Ctrl+Shift+A, Ammend Ctrl+Shift+J
  useHotkeys('ctrl+shift+a', (e) => { e.preventDefault(); if (recordId && has('Attachment')) setOpen('Attachment') }, { enableOnFormTags: true }, [recordId, options])
  useHotkeys('ctrl+shift+j', (e) => { e.preventDefault(); if (recordId && has('Amendment')) setOpen('Amendment') }, { enableOnFormTags: true }, [recordId, options])
  if (options.length === 0 && extra.length === 0) return null
  return (
    <>
      <Menu position="top-end" withinPortal>
        <Menu.Target>
          <Tooltip label="Open a saved record first (List, Find or the arrows) - Options act on one record" withArrow disabled={Boolean(recordId)}>
            <span>
              <Button variant="light" color="gold" c="var(--vt-badge-ink)" rightSection={<ChevronUp size={14} />} disabled={!recordId}>
                Options
              </Button>
            </span>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          {extra.map((o) => (
            <Menu.Item key={o.name} onClick={() => o.onClick(recordId)}>
              {o.label}
            </Menu.Item>
          ))}
          {options.map((o) => (
            <Menu.Item key={o.name} disabled={!o.supported} onClick={() => setOpen(o.name)} title={o.supported ? undefined : 'Not available in the web app yet'} leftSection={o.name === 'Send EMAIL' ? <Mail size={14} /> : o.name === 'Send SMS' ? <MessageSquare size={14} /> : undefined}>
              {o.label}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
      {open === 'Attachment' && <AttachmentsDialog docId={docId} recordId={recordId} onClose={() => setOpen(null)} />}
      {open === 'Amendment' && <AmendmentDialog docId={docId} recordId={recordId} onClose={() => setOpen(null)} />}
      {open === 'Label Print' && <LabelPrintDialog docId={docId} recordId={recordId} onClose={() => setOpen(null)} />}
      {open === 'Send EMAIL' && <EmailDialog docId={docId} recordId={recordId} onClose={() => setOpen(null)} />}
      {open === 'Send SMS' && <SmsDialog docId={docId} recordId={recordId} onClose={() => setOpen(null)} />}
    </>
  )
}

const fail = (err, fb) => notifications.show({ message: err?.response?.data?.detail || fb, color: 'red' })

function EmailDialog({ docId, recordId, onClose }) {
  const { data: templates = [] } = useQuery({ queryKey: ['email-templates', docId], queryFn: () => docActions.emailTemplates(docId) })
  const [template, setTemplate] = useState(null)
  const [f, setF] = useState({ to: '', cc: '', subject: '', body: '' })
  const [sending, setSending] = useState(false)
  useEffect(() => {
    if (!template) return
    docActions.emailPrepare(docId, recordId, template).then((r) => setF({ to: r.to, cc: r.cc, subject: r.subject, body: r.body })).catch((e) => fail(e, 'Could not load the template'))
  }, [template, docId, recordId])
  async function onSend() {
    setSending(true)
    try {
      const r = await docActions.emailSend(docId, recordId, f)
      notifications.show({ message: r.message, color: 'teal' })
      onClose()
    } catch (e) {
      fail(e, 'Could not send the email')
    } finally {
      setSending(false)
    }
  }
  return (
    <Modal opened onClose={onClose} size="lg" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Send Email</Text>}>
      <Stack gap="sm">
        <Select label="Template" placeholder={templates.length ? 'Choose a template' : 'No templates for this document'} data={templates} value={template} onChange={setTemplate} clearable />
        <TextInput label="To" description="Separate addresses with ;" value={f.to} onChange={(e) => setF({ ...f, to: e.currentTarget.value })} />
        <TextInput label="CC" value={f.cc} onChange={(e) => setF({ ...f, cc: e.currentTarget.value })} />
        <TextInput label="Subject" value={f.subject} onChange={(e) => setF({ ...f, subject: e.currentTarget.value })} />
        <Textarea label="Body" autosize minRows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.currentTarget.value })} />
        <Group justify="flex-end">
          <Button color="kumkum" leftSection={<Send size={16} />} loading={sending} onClick={onSend}>
            Send
          </Button>
          <Button variant="default" leftSection={<X size={16} />} onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function SmsDialog({ docId, recordId, onClose }) {
  const { data: templates = [] } = useQuery({ queryKey: ['sms-templates', docId], queryFn: () => docActions.smsTemplates(docId) })
  const { data: providers = [] } = useQuery({ queryKey: ['sms-providers'], queryFn: docActions.smsProviders })
  const [template, setTemplate] = useState(null)
  const [provider, setProvider] = useState(null)
  const [f, setF] = useState({ mobile: '', text: '' })
  const [sending, setSending] = useState(false)
  useEffect(() => {
    if (!provider && providers.length) setProvider((providers.find((p) => p.Def === 'Y') || providers[0]).Provider)
  }, [providers, provider])
  useEffect(() => {
    if (!template) return
    docActions.smsPrepare(docId, recordId, template).then((r) => setF({ mobile: r.mobile, text: r.text })).catch((e) => fail(e, 'Could not load the template'))
  }, [template, docId, recordId])
  async function onSend() {
    setSending(true)
    try {
      const r = await docActions.smsSend(docId, recordId, { mobile: f.mobile, text: f.text, provider: provider || '' })
      notifications.show({ message: r.message, color: 'teal' })
      onClose()
    } catch (e) {
      fail(e, 'Could not send the message')
    } finally {
      setSending(false)
    }
  }
  return (
    <Modal opened onClose={onClose} size="lg" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Send SMS</Text>}>
      <Stack gap="sm">
        <Select label="Template" placeholder={templates.length ? 'Choose a template' : 'No templates for this document'} data={templates} value={template} onChange={setTemplate} clearable />
        <Select label="Provider" placeholder="No provider configured" data={providers.map((p) => p.Provider)} value={provider} onChange={setProvider} />
        <TextInput label="Mobile number(s)" description="Separate numbers with ;" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.currentTarget.value })} />
        <Textarea label="Message" autosize minRows={4} value={f.text} onChange={(e) => setF({ ...f, text: e.currentTarget.value })} />
        <Text size="xs" c="dimmed">
          Message length: {f.text.length}
        </Text>
        <Group justify="flex-end">
          <Button color="kumkum" leftSection={<Send size={16} />} loading={sending} onClick={onSend}>
            Send
          </Button>
          <Button variant="default" leftSection={<X size={16} />} onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
