import { historyParams } from '../../lib/history'
import { useEffect, useState } from 'react'
import { ActionIcon, Badge, Button, Group, NumberInput, Select, Stack, Table, Text, Title } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useSearchParams } from 'react-router-dom'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as voucherApi from '../../api/endpoints/voucher'
import LookupSelect from '../../components/LookupSelect'
import useDirectPrint from '../../hooks/useDirectPrint'
import PrintPickerModal from '../../components/PrintPickerModal'
import { handleAfterSave } from '../../lib/printing'
import DocFieldsForm, { docFieldErrors } from '../../components/DocFieldsForm'
import usePrefixes from '../../hooks/usePrefixes'
import useDocFields from '../../hooks/useDocFields'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard } from '../../components/ui/EntryParts'
import DocNavBar from '../../components/ui/DocNavBar'
import CopyFromDialog from '../../components/ui/CopyFromDialog'
import DocXlMenu from '../../components/ui/DocXlMenu'
import useDocRules from '../../hooks/useDocRules'
import { formatINR, isoDate } from '../../utils/format'
import { useAuth } from '../../hooks/useAuth'
import { columnsFromLines, computeFormulas } from '../../utils/docCompute'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const COMPUTED_CODES = ['TOTDR', 'TOTCR', 'AMTINWORDS']
const newLines = () => [
  { ac_led_id: '', dr_amt: 0, cr_amt: 0 },
  { ac_led_id: '', dr_amt: 0, cr_amt: 0 },
]

/**
 * One screen for the Payment (1224), Receipt (1248) and Journal (1254) vouchers. Their Header / Footer fields come
 * from the temple's Doc Designer (UtlDocDsgrFlds) through DocFieldsForm, so which fields exist, their captions, lists
 * and the cheque / card fields that appear only for some voucher types are all the Designer's call. The Dr/Cr
 * account-head grid is the voucher's fixed structure. `cfg` names the document-specific pieces.
 */
export default function VoucherEntry({ cfg }) {
  const rowNo = cfg.rowNoKey || `Print${cfg.headerPrefix}NO`
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [values, setValues] = useState({})
  const [resetKey, setResetKey] = useState(0)
  const [lines, setLines] = useState(newLines())
  const [prefix, setPrefix] = useState(null) // null = not loaded yet; '' is a valid (blank) prefix
  const [docDate, setDocDate] = useState(new Date())
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [printFor, setPrintFor] = useState(null)
  const [viewId, setViewId] = useState(null) // a saved voucher being looked at (read-only)
  const [viewNo, setViewNo] = useState('')
  const [copyOpen, setCopyOpen] = useState(false)
  const [params] = useSearchParams()
  const rules = useDocRules(cfg.docId) // UtlTransactions switches (Copy From, authorisation, document-date lock ...)
  const [editing, setEditing] = useState(false)
  const [stamp, setStamp] = useState(null) // legacy CANCELLED / AUTHORISED label of the voucher being viewed
  const readOnly = Boolean(viewId) && !editing

  const { fields } = useDocFields(cfg.docId)
  const { user } = useAuth()
  const setValue = (code, v) => setValues((cur) => ({ ...cur, [code]: v }))
  const dateCodes = new Set(fields.filter((f) => f.FldDataType === 'Date').map((f) => f.FldCode))
  const caption = (code, fallback) => fields.find((f) => f.FldCode === code)?.FldCaption || fallback

  const { data: prefixes } = usePrefixes(cfg.docId)
  const { data: recent, isLoading: recentLoading, refetch } = useQuery({
    queryKey: [cfg.queryKey, 'recent'],
    queryFn: () => cfg.list(historyParams()),
  })
  useEffect(() => {
    if (prefixes?.length && prefix === null) setPrefix(prefixes[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefixes])

  const updateLine = (idx, patch) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))

  const totalDr = lines.reduce((s, l) => s + (Number(l.dr_amt) || 0), 0)
  const totalCr = lines.reduce((s, l) => s + (Number(l.cr_amt) || 0), 0)
  const amount = cfg.amountSide === 'cr' ? totalCr : totalDr
  // Total Dr / Total Cr / Amount in Words: the Designer's formulas over the grid (SVTCOLSUM(5) = the Credit column)
  const computed = readOnly
    ? undefined
    : computeFormulas(
        fields,
        values,
        { DRAMT: lines.map((l) => l.dr_amt), CRAMT: lines.map((l) => l.cr_amt), 5: lines.map((l) => l.cr_amt) },
        { userCode: user?.user_code || '' }
      )
  const balanced = Math.round(totalDr * 100) === Math.round(totalCr * 100) && amount > 0

  const headErrors = docFieldErrors(fields, values, COMPUTED_CODES)
  const firstError =
    Object.values(headErrors)[0] ||
    (prefix === null ? 'No document-number prefix configured' : null) ||
    (lines.some((l) => !l.ac_led_id) ? 'Every line needs an account head' : null) ||
    (!balanced ? 'Debit and Credit totals are NOT matching!' : null)

  async function onSave(mode) {
    if (readOnly) return
    setAttempted(true)
    if (firstError) {
      notifications.show({ message: firstError, color: 'red' })
      return
    }
    setSaving(true)
    try {
      const fieldsPayload = Object.fromEntries(
        Object.entries(values)
          .filter(([k, v]) => v !== '' && v !== null && v !== undefined && !COMPUTED_CODES.includes(k))
          .map(([k, v]) => [k, dateCodes.has(k) ? isoDate(v) : v])
      )
      const body = {
        prefix,
        [cfg.dateKey]: isoDate(docDate),
        fields: fieldsPayload,
        lines: lines
          .filter((l) => Number(l.dr_amt) || Number(l.cr_amt))
          .map((l) => ({ ac_led_id: Number(l.ac_led_id), dr_amt: Number(l.dr_amt) || 0, cr_amt: Number(l.cr_amt) || 0 })),
      }
      if (editing && viewId && cfg.update) {
        await cfg.update(viewId, body)
        notifications.show({ message: 'Updated successfully!', color: 'teal' })
        setAttempted(false)
        queryClient.invalidateQueries({ queryKey: [cfg.queryKey] })
        refetch()
        await viewRecord(viewId)
        setEditing(false)
        return
      }
      const result = await cfg.create(body)
      setLastSaved(result)
      // F10 = save and print now; Alt+S = save only; the Save & Print button follows the document's after-save setting
      if (mode === 'print') directPrint(result[cfg.idKey])
      else if (mode !== 'save') handleAfterSave({ docId: cfg.docId, recordId: result[cfg.idKey], openDialog: setPrintFor })
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setValues({})
      setResetKey((k) => k + 1)
      setLines(newLines())
      setAttempted(false)
      queryClient.invalidateQueries({ queryKey: [cfg.queryKey] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  async function viewRecord(id) {
    try {
      const r = await voucherApi.getVoucher(cfg.kind, id)
      const h = r.header
      const next = {}
      for (const f of fields) {
        if (f.FldSection === 'Detail') continue
        const v = h[f.FldCode]
        if (v === null || v === undefined) next[f.FldCode] = ''
        else if (f.FldDataType === 'Date') next[f.FldCode] = new Date(v)
        else if (f.FldBlnComboData === 'Y') next[f.FldCode] = Number(v) || ''
        else if (String(v).trim() === '0' && f.FldCode === 'CARDNO') next[f.FldCode] = ''
        else next[f.FldCode] = String(v).trim()
      }
      setValues(next)
      if (h.Prefix !== undefined) setPrefix(h.Prefix)
      const d = h[`${cfg.headerPrefix}Date`]
      if (d) setDocDate(new Date(d))
      setLines(r.lines.map((l) => ({ ac_led_id: String(l.ac_led_id), dr_amt: l.dr_amt, cr_amt: l.cr_amt })))
      const yes = (v) => String(v || 'N').trim().toUpperCase() === 'Y'
      setStamp(yes(h.Cancelled) ? { text: 'CANCELLED', color: 'red' } : rules.auth_req ? (yes(h.Authorised) ? { text: 'AUTHORISED', color: 'green' } : { text: 'NOT AUTHORISED', color: 'orange' }) : null)
      setViewId(id)
      setViewNo(h[`Print${cfg.headerPrefix}NO`] || h[`${cfg.headerPrefix}NO`])
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not open that voucher', color: 'red' })
    }
  }
  // Copy From: the chosen voucher's fields and lines become a new entry; "DC / CR Reversal" swaps the sides
  async function copyFrom(id, { reverse = false } = {}) {
    try {
      const r = await voucherApi.getVoucher(cfg.kind, id)
      if (reverse && r.has_bill_refs) {
        notifications.show({ message: 'Reversal is not possible against reference present!', color: 'red' })
        return
      }
      const next = {}
      for (const f of fields) {
        if (f.FldSection === 'Detail') continue
        const v = r.header[f.FldCode]
        if (v === null || v === undefined) next[f.FldCode] = ''
        else if (f.FldDataType === 'Date') next[f.FldCode] = new Date(v)
        else if (f.FldBlnComboData === 'Y') next[f.FldCode] = Number(v) || ''
        else if (String(v).trim() === '0' && f.FldCode === 'CARDNO') next[f.FldCode] = ''
        else next[f.FldCode] = String(v).trim()
      }
      setValues(next)
      setLines(r.lines.map((l) => ({ ac_led_id: String(l.ac_led_id), dr_amt: reverse ? l.cr_amt : l.dr_amt, cr_amt: reverse ? l.dr_amt : l.cr_amt })))
      notifications.show({ message: `Copied from ${r.header[`Print${cfg.headerPrefix}NO`] || r.header[`${cfg.headerPrefix}NO`]}${reverse ? ' (Dr/Cr reversed)' : ''}`, color: 'teal' })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not copy that voucher', color: 'red' })
    }
  }
  useHotkeys('ctrl+alt+f', (e) => { e.preventDefault(); if (!viewId && rules.allow_copy_from) setCopyOpen(true) }, { enableOnFormTags: true }, [viewId, rules.allow_copy_from])

  // `?open=<id>` shows that saved voucher (e.g. a Hall Booking receipt opened from Receipt Info)
  const openId = Number(params.get('open')) || 0
  useEffect(() => {
    if (openId && cfg.nav && fields.length && viewId !== openId) viewRecord(openId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, fields.length])

  // Edit / Cancel / Delete (legacy toolbar). The server applies the legacy rules and says why when it refuses.
  async function startEdit() {
    await viewRecord(viewId) // show what is saved right now, not what was loaded a while ago
    setEditing(true)
  }
  async function cancelEdit() {
    await viewRecord(viewId)
    setEditing(false)
  }
  async function cancelDocument() {
    if (stamp?.text === 'CANCELLED') return notifications.show({ message: 'Document is already cancelled', color: 'red' })
    if (!(await confirm({ title: 'Cancel this document?', message: `${cfg.title} ${viewNo} will be cancelled and its ledger posting reversed.`, confirmLabel: 'Cancel document' }))) return
    try {
      const r = await cfg.cancel(viewId, 'Cancelled')
      notifications.show({ message: r.message, color: 'teal' })
      queryClient.invalidateQueries({ queryKey: [cfg.queryKey] })
      refetch()
      await viewRecord(viewId)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not cancel the document', color: 'red' })
    }
  }
  async function deleteDocument() {
    if (!(await confirm({ title: 'Delete this document?', message: `${cfg.title} ${viewNo} and its ledger posting will be deleted.`, confirmLabel: 'Delete' }))) return
    try {
      const r = await cfg.remove(viewId)
      notifications.show({ message: r.message, color: 'teal' })
      queryClient.invalidateQueries({ queryKey: [cfg.queryKey] })
      refetch()
      startNew()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not delete the document', color: 'red' })
    }
  }

  function startNew() {
    setEditing(false)
    setStamp(null)
    setViewId(null)
    setViewNo('')
    setLines(newLines())
    setValues({})
    setResetKey((k) => k + 1) // re-applies the Designer defaults
    setDocDate(new Date())
    setAttempted(false)
  }
  async function findVouchers(q, { allFy = true } = {}) {
    const rows = await cfg.list({ search: q, top: 30, ...(allFy ? { days: 0 } : {}) })
    return rows.map((v) => ({ id: v[cfg.rowId], label: v[rowNo], sub: `${v.NARR || ''} · ${formatINR(v.TOTDR)}` }))
  }

  const directPrint = useDirectPrint(cfg.docId, setPrintFor)
  useDocShortcuts({
    onSave: () => !readOnly && onSave('save'),
    onPrint: () => lastSaved && setPrintFor(lastSaved[cfg.idKey]),
    onDirectPrint: () => (viewId ? directPrint(viewId) : onSave('print')),
  })

  const common = { docId: cfg.docId, values, setValue, setValues, resetKey, errors: attempted ? headErrors : {}, computed, readOnly }
  const Icon = cfg.icon

  return (
    <Stack gap="lg" className="vt-rise">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
          <div>
            <Group gap="sm" align="center">
              <Title order={2}>{cfg.title}</Title>
              {viewId && stamp && <Badge color={stamp.color} variant="light" size="lg">{stamp.text}</Badge>}
            </Group>
            <Text size="sm" c="dimmed">
              {cfg.subtitle}
            </Text>
          </div>
        </Group>
        <Group gap="xs" align="flex-end">
          {rules.allow_copy_from && !viewId && (
            <Button variant="light" color="kumkum" leftSection={<Copy size={16} />} onClick={() => setCopyOpen(true)}>
              Copy From
            </Button>
          )}
          {(prefixes || []).filter(Boolean).length > 1 && (
            <Select aria-label="Prefix" w={110} data={prefixes.filter(Boolean)} value={prefix || null} onChange={(v) => setPrefix(v || '')} allowDeselect={false} disabled={Boolean(viewId)} />
          )}
          <DateInput aria-label={cfg.dateLabel} valueFormat="DD-MMM-YYYY" value={docDate} onChange={(v) => v && setDocDate(v)} disabled={readOnly || !rules.edit_doc_date} w={150} />
        </Group>
      </Group>

      <EntryLayout
        viewing={readOnly}
        main={
          <Stack gap="lg">
            <SectionCard title="Voucher details" hint="Drawn from this temple's Doc Designer.">
              <DocFieldsForm {...common} section="Header" />
            </SectionCard>

            <SectionCard
              title="Account heads"
              hint="Pick the ledger for each line and enter either a debit or a credit. Totals must match."
              action={
                !readOnly && (
                  <Group gap="xs">
                    {rules.allow_imp_exp && <DocXlMenu docId={cfg.docId} name={cfg.title} rows={lines} setRows={setLines} />}
                    <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={() => setLines((ls) => [...ls, { ac_led_id: '', dr_amt: 0, cr_amt: 0 }])}>
                      Add line
                    </Button>
                  </Group>
                )
              }
            >
              <Table.ScrollContainer minWidth={560}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Account Head</Table.Th>
                      <Table.Th w={160}>Debit</Table.Th>
                      <Table.Th w={160}>Credit</Table.Th>
                      <Table.Th w={48} aria-label="Remove" />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {lines.map((l, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>
                          <LookupSelect ledgerPicker ariaLabel={`Account head, line ${i + 1}`} label="" disabled={readOnly} value={l.ac_led_id} onChange={(v) => updateLine(i, { ac_led_id: v })} />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput aria-label={`Debit, line ${i + 1}`} disabled={readOnly} value={l.dr_amt} onChange={(v) => updateLine(i, { dr_amt: v, cr_amt: v ? 0 : l.cr_amt })} decimalScale={2} />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput aria-label={`Credit, line ${i + 1}`} disabled={readOnly} value={l.cr_amt} onChange={(v) => updateLine(i, { cr_amt: v, dr_amt: v ? 0 : l.dr_amt })} decimalScale={2} />
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            size={36}
                            aria-label={`Remove line ${i + 1}`}
                            disabled={lines.length <= 2 || readOnly}
                            onClick={async () => {
                              if (await confirm({ title: 'Remove this line?', message: 'It will be removed from this entry. You can add it again before saving.', confirmLabel: 'Remove' })) {
                                setLines((ls) => ls.filter((_, ri) => ri !== i))
                              }
                            }}
                          >
                            <Trash2 size={16} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                  <Table.Tfoot>
                    <Table.Tr>
                      <Table.Th>
                        {caption('TOTDR', 'Total Dr')} / {caption('TOTCR', 'Total Cr')}
                      </Table.Th>
                      <Table.Th className="vt-num">{formatINR(totalDr)}</Table.Th>
                      <Table.Th className="vt-num">{formatINR(totalCr)}</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Tfoot>
                </Table>
              </Table.ScrollContainer>
              {!balanced && (totalDr > 0 || totalCr > 0) && (
                <Text size="sm" c="red" mt="xs" role="alert">
                  Debit and Credit totals are NOT matching!
                </Text>
              )}
            </SectionCard>

            <SectionCard title="Payment details" hint="Cheque, bank, card and narration — shown as set up for this voucher.">
              <DocFieldsForm {...common} section="Footer" />
              <DocFieldsForm {...common} section="Total" />
            </SectionCard>
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[
                { label: 'Total debit', value: formatINR(totalDr) },
                { label: 'Total credit', value: formatINR(totalCr) },
                { label: 'Difference', value: formatINR(Math.abs(totalDr - totalCr)) },
              ]}
              totalLabel={cfg.totalLabel}
              total={formatINR(amount)}
              words={amount}
              warning={balanced || (totalDr === 0 && totalCr === 0) ? null : 'Debit and Credit totals are NOT matching!'}
              saving={saving}
              onSave={readOnly ? undefined : () => onSave('save')}
              onSavePrint={readOnly || editing ? undefined : () => onSave('print')}
              saveDisabled={readOnly}
            />
            {lastSaved && <SavedPanel lines={[`Voucher ${lastSaved[cfg.noKey]}`]} onPrint={() => setPrintFor(lastSaved[cfg.idKey])} />}
            <RecentCard
              title={cfg.recentTitle}
              icon={Icon}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle={cfg.emptyTitle}
              emptyHint="Saved vouchers will be listed here."
              renderRow={(v) => ({
                key: v[cfg.rowId],
                title: v[rowNo],
                subtitle: `${v.NARR || ''} · ${formatINR(v.TOTDR)}`,
                printLabel: `Print ${v[rowNo]}`,
                onPrint: () => setPrintFor(v[cfg.rowId]),
              })}
            />
          </>
        }
      />

      <CopyFromDialog opened={copyOpen} onClose={() => setCopyOpen(false)} docName={cfg.title} search={findVouchers} onLoad={copyFrom} allowReversal />
      {cfg.nav && (
        <DocNavBar
          docId={cfg.docId}
          currentId={viewId}
          viewLabel={viewNo}
          onLoad={viewRecord}
          onNew={startNew}
          search={findVouchers}
          {...(cfg.update ? { onEdit: startEdit, onCancelEdit: cancelEdit, onSave: () => onSave('save'), saving, editing } : {})}
          {...(cfg.cancel ? { onCancelDoc: cancelDocument } : {})}
          {...(cfg.remove ? { onDelete: deleteDocument } : {})}
        />
      )}
      <PrintPickerModal opened={Boolean(printFor)} onClose={() => setPrintFor(null)} docId={cfg.docId} recordId={printFor} title={cfg.title} />
    </Stack>
  )
}
