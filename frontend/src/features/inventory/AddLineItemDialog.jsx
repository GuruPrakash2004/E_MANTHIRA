import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Group, Modal, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Keyboard, PackagePlus, Plus, Search, X } from 'lucide-react'
import * as inventoryApi from '../../api/endpoints/inventory'
import { formatINR } from '../../utils/format'

/**
 * "Add Line Item" for the inventory documents: pick an item from the master on the left (type to search, Up / Down to
 * move, Enter or Tab to pick, double-click to pick and jump to Quantity), enter Quantity and Rate on the right, then
 * add it to the document (or "Save & Add Next" to keep the dialog open for the next item).
 *
 *   initial   a line being edited ({ item_id, item_code, item_name, uom_id, uom_code, qty, rate, remarks, adj_type }) or null for a new one
 *   onAdd(line) -> called with { item_id, item_code, item_name, uom_id, uom_code, qty, rate, remarks?, adj_type? }
 *
 * The same dialog serves Purchase Bill (quantity + required rate), Store Issue (quantity + remarks, no rate) and Stock
 * Adjustment (quantity + optional rate + Add / Reduce):
 *   showRate / rateRequired   show the Rate box / refuse a line without a rate
 *   withRemarks + remarksCaption   a Remarks box (carried as `remarks`)
 *   withAdjType + adjTypeCaption   an Add / Reduce choice (carried as `adj_type`)
 *   locId     the document's location: the QOH shown is that location's

 *   blockOver legacy "Qty cannot more than QOH....": refuse the line instead of only warning (when Inventory > AllowNegative is 'N')
 *   warnOver  show "only N on hand" under Quantity when the quantity is more than the QOH (display only);
 *             a function (adjType) => boolean may limit it (Stock Adjustment: only when reducing)
 */
const BLANK = { qty: 1, rate: 0 }

export default function AddLineItemDialog({
  opened, onClose, onAdd, initial = null, qtyCaption = 'Quantity', rateCaption = 'Rate',
  showRate = true, rateRequired = true, withRemarks = false, remarksCaption = 'Remarks', withAdjType = false, adjTypeCaption = 'Adjust Type',
  locId = null, warnOver = false, blockOver = false,
}) {
  const [remarks, setRemarks] = useState('')
  const [adjType, setAdjType] = useState('Add')
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, 250)
  const [picked, setPicked] = useState(null) // the item row chosen from the master
  const [hot, setHot] = useState(0) // highlighted row in the list
  const [qty, setQty] = useState(BLANK.qty)
  const [rate, setRate] = useState(BLANK.rate)
  const searchRef = useRef(null)
  const qtyRef = useRef(null)
  const listRef = useRef(null)

  const { data: items = [], isFetching } = useQuery({
    queryKey: ['line-items', debounced],
    queryFn: () => inventoryApi.searchLineItems(debounced),
    enabled: opened,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  // quantity on hand: the stock-balance table (TrnQOH), the same figure every other screen shows
  const { data: qohMap } = useQuery({
    queryKey: ['qoh', locId || 0, String(picked?.id || '')],
    queryFn: () => inventoryApi.getQoh([picked.id], locId ? Number(locId) : null),
    enabled: Boolean(opened && picked?.id),
    staleTime: 15_000,
  })

  // (re)start whenever the dialog opens: empty for a new line, prefilled when editing one
  useEffect(() => {
    if (!opened) return
    setSearch('')
    setHot(0)
    if (initial) {
      setPicked({ id: initial.item_id, code: initial.item_code, name: initial.item_name, uom_id: initial.uom_id, uom_code: initial.uom_code, std_rate: initial.rate })
      setQty(initial.qty)
      setRate(initial.rate)
      setRemarks(initial.remarks || '')
      setAdjType(initial.adj_type || 'Add')
    } else {
      setPicked(null)
      setQty(BLANK.qty)
      setRate(BLANK.rate)
      setRemarks('')
      setAdjType('Add')
    }
    setTimeout(() => searchRef.current?.focus(), 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened])
  useEffect(() => setHot(0), [debounced])
  useEffect(() => {
    listRef.current?.querySelector('[data-hot="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [hot])

  function choose(row, focusQty = true) {
    setPicked(row)
    setRate(Number(row.std_rate) || 0)
    if (focusQty) setTimeout(() => qtyRef.current?.select?.() || qtyRef.current?.focus(), 30)
  }
  function onSearchKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHot((h) => Math.min(h + 1, Math.max(items.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHot((h) => Math.max(h - 1, 0))
    } else if ((e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) && items[hot]) {
      e.preventDefault()
      choose(items[hot])
    }
  }

  const q = Number(qty) || 0
  const r = Number(rate) || 0
  const total = q * r
  const qoh = picked?.id ? qohMap?.[picked.id] : undefined
  // a quantity beyond the stock on hand is only warned about (display only), like the QOH column on the document
  const over = Boolean(warnOver) && (typeof warnOver === 'function' ? warnOver(adjType) : true) && qoh != null && q > Number(qoh)
  const valid = Boolean(picked?.id) && q > 0 && (!showRate || !rateRequired || r > 0) && !(blockOver && over)
  const line = () => ({
    item_id: picked.id, item_code: picked.code, item_name: picked.name, uom_id: picked.uom_id, uom_code: picked.uom_code, qty: q,
    ...(showRate ? { rate: r } : {}), ...(withRemarks ? { remarks } : {}), ...(withAdjType ? { adj_type: adjType } : {}),
  })
  function add(next) {
    if (!valid) return
    onAdd(line())
    if (next) {
      setPicked(null)
      setQty(BLANK.qty)
      setRate(BLANK.rate)
      setRemarks('')
      setSearch('')
      setTimeout(() => searchRef.current?.focus(), 30)
    } else onClose()
  }


  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="min(1100px, 96vw)"
      padding={0}
      radius="lg"
      centered
      withCloseButton={false}
      styles={{ content: { overflow: 'hidden', background: 'var(--vt-surface)' } }}
      closeOnEscape
    >
      <div style={{ background: 'linear-gradient(180deg, var(--vt-g2) 0%, var(--vt-g3) 100%)', color: '#FBF6EC', padding: '14px 20px' }}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap={10}>
            <PackagePlus size={20} color="#F4E1A6" aria-hidden />
            <Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>{initial ? 'Edit Line Item' : 'Add Line Item'}</Text>
          </Group>
          <Button variant="subtle" c="#F4E1A6" px={6} onClick={onClose} aria-label="Close"><X size={18} /></Button>
        </Group>
      </div>

      <div className="vt-line-dialog">
        {/* left: item master */}
        <div style={{ minWidth: 0 }}>
          <Group justify="space-between" mb={6}>
            <Text size="xs" fw={700} tt="uppercase" c="var(--vt-accent)" style={{ letterSpacing: 0.6 }}>Select item from master</Text>
            <Text size="xs" c="dimmed">Click or use &uarr; &darr; to select</Text>
          </Group>
          <TextInput
            ref={searchRef}
            leftSection={<Search size={15} />}
            placeholder="Type item code or name..."
            aria-label="Search items"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            onKeyDown={onSearchKey}
            rightSection={search ? <Button variant="subtle" color="gray" px={4} size="compact-xs" onClick={() => setSearch('')} aria-label="Clear search"><X size={13} /></Button> : null}
            mb="xs"
          />
          <div ref={listRef} role="listbox" aria-label="Items" style={{ height: 360, overflow: 'auto', border: '1px solid var(--vt-line)', borderRadius: 10, opacity: isFetching ? 0.75 : 1 }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--vt-sandal)', zIndex: 1 }}>
                <tr>
                  {['Item code', 'Item name', 'UOM'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--vt-accent)', borderBottom: '1px solid var(--vt-line)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const on = picked?.id === it.id
                  return (
                    <tr
                      key={it.id}
                      role="option"
                      aria-selected={on}
                      data-hot={i === hot}
                      onClick={() => { setHot(i); choose(it, false) }}
                      onDoubleClick={() => choose(it)}
                      style={{ cursor: 'pointer', background: on ? 'var(--vt-gold-chip)' : i === hot ? 'var(--vt-sandal)' : undefined, boxShadow: i === hot ? 'inset 3px 0 0 var(--vt-accent)' : undefined }}
                    >
                      <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--vt-line)', whiteSpace: 'nowrap' }}>{it.code}</td>
                      <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--vt-line)' }}>{it.name}</td>
                      <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--vt-line)' }}>{it.uom_code}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {items.length === 0 && <Text size="sm" c="dimmed" ta="center" py="xl">No items match.</Text>}
          </div>
          <Group gap={6} mt={6} c="dimmed">
            <Keyboard size={14} aria-hidden />
            <Text size="xs">Use &uarr; / &darr; to move, <b>Tab / Enter</b> to select an item, double-click to jump to Quantity</Text>
          </Group>
        </div>

        {/* right: this line */}
        <Stack gap="sm" style={{ minWidth: 0 }}>
          <div style={{ border: '1px solid var(--vt-line)', background: 'var(--vt-sandal)', borderRadius: 12, padding: '10px 12px' }}>
            <Group gap={6} wrap="wrap">
              <Badge variant="light" color="kumkum" tt="none">{picked?.code || '-'}</Badge>
              <Badge variant="outline" color="gray" tt="none">{picked?.uom_code || '-'}</Badge>
              <Badge variant="light" color="gold" c="var(--vt-badge-ink)" tt="none">QOH: {qoh != null ? Number(qoh).toLocaleString('en-IN') : '-'}</Badge>
            </Group>
            <Text fw={600} mt={6} lh={1.3}>{picked?.name || 'Pick an item from the list'}</Text>
          </div>
          <Group grow align="flex-start" wrap="nowrap">
            <NumberInput ref={qtyRef} label={qtyCaption} required className="vt-field-required" value={qty} onChange={setQty} decimalScale={2} min={0} rightSection={<Text size="xs" c="dimmed" pr={6}>{picked?.uom_code || ''}</Text>} rightSectionWidth={44} onKeyDown={(e) => e.key === 'Enter' && add(false)} />
            {showRate && <NumberInput label={rateCaption} required={rateRequired} className={rateRequired ? 'vt-field-required' : undefined} value={rate} onChange={setRate} decimalScale={2} min={0} leftSection={<Text size="sm">&#8377;</Text>} onKeyDown={(e) => e.key === 'Enter' && add(false)} />}
          </Group>
          {over && (
            <Text size="xs" c="orange.8" role="status">
              Only {Number(qoh).toLocaleString('en-IN')} on hand{locId ? ' at this location' : ''}: this quantity is more than the stock{blockOver ? ' (Qty cannot more than QOH)' : ''}.
            </Text>
          )}
          {withAdjType && (
            <Select label={adjTypeCaption} data={['Add', 'Reduce']} value={adjType} onChange={(v) => v && setAdjType(v)} allowDeselect={false} />
          )}
          {withRemarks && <TextInput label={remarksCaption} value={remarks} onChange={(e) => setRemarks(e.currentTarget.value)} maxLength={250} onKeyDown={(e) => e.key === 'Enter' && add(false)} />}
          {showRate && (
            <div style={{ borderRadius: 12, padding: '12px 16px', background: 'linear-gradient(160deg, var(--vt-g1) 0%, var(--vt-g3) 100%)', border: '1px solid rgba(244,225,166,0.3)', color: '#FBF6EC' }}>
              <Group justify="space-between" align="flex-end" wrap="nowrap">
                <div>
                  <Text size="xs" fw={700} tt="uppercase" c="#F4E1A6" style={{ letterSpacing: 1 }}>Line total</Text>
                  <Text size="xs" c="#E9D2B8" className="vt-num">{q.toFixed(2)} &times; {r.toFixed(2)}</Text>
                </div>
                <Text className="vt-num" c="#F4E1A6" style={{ fontFamily: 'Marcellus, Georgia, serif', fontSize: 28, fontWeight: 700 }}>{formatINR(total)}</Text>
              </Group>
            </div>
          )}
          <Group grow gap="xs" mt="xs" wrap="nowrap">
            <Button variant="default" styles={{ root: { height: 'auto', minHeight: 36, padding: '6px 10px' }, label: { whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.2 } }} leftSection={<X size={15} />} onClick={onClose}>Cancel</Button>
            {!initial && <Button variant="light" color="kumkum" styles={{ root: { height: 'auto', minHeight: 36, padding: '6px 10px' }, label: { whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.2 } }} leftSection={<Plus size={15} />} disabled={!valid} onClick={() => add(true)}>Save &amp; Add Next</Button>}
            <Button color="kumkum" styles={{ root: { height: 'auto', minHeight: 36, padding: '6px 10px' }, label: { whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.2 } }} disabled={!valid} onClick={() => add(false)}>{initial ? 'Update Line' : 'Add Item to Document'}</Button>
          </Group>
        </Stack>
      </div>
      <style>{`
        .vt-line-dialog { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 20px; padding: 16px 20px 20px; }
        @media (max-width: 800px) { .vt-line-dialog { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </Modal>
  )
}
