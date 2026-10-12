import { Select } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import * as mastersApi from '../../api/endpoints/masters'

/**
 * A plain master-row picker (Item/UOM/Location/Supplier) — reads straight
 * off the already-working generic /masters/{docId} list, rather than
 * depending on per-field UtlDocDsgrFlds combo metadata (which isn't fully
 * configured for these low-usage inventory docs). Same data, simpler path.
 */
export default function MasterOptionsSelect({ docId, label, ariaLabel, required, value, onChange }) {
  const { data } = useQuery({ queryKey: ['master-options', docId], queryFn: () => mastersApi.listMaster(docId) })
  const meta = data?.meta
  const options = (data?.rows || [])
    .filter((r) => r[meta?.id_col] !== 0)
    .map((r) => ({ value: String(r[meta.id_col]), label: r[meta.name_col] }))

  return (
    <Select
      label={label}
      aria-label={ariaLabel}
      required={required}
      searchable
      clearable
      data={options}
      value={value !== '' && value != null ? String(value) : null}
      onChange={(v) => onChange(v === null ? '' : Number(v))}
      placeholder="Search..."
      comboboxProps={{ withinPortal: true }}
    />
  )
}
