import { Stack, TextInput } from '@mantine/core'

/**
 * Address as stacked lines (like the Company Master), for any single "address" column. The value stays ONE string
 * exactly like the legacy multi-line cell: the lines joined with CR+LF; empty lines are dropped on the way out.
 * `lines` is how many boxes show (5 by default).
 */
export const ADDRESS_HINTS = [
  'Address line 1 - building / street',
  'Address line 2 - area / locality',
  'Address line 3 - city / district',
  'Address line 4 - state / PIN code',
  'Address line 5 - country / landmark',
]

export const splitAddress = (value, n = 5) => {
  const parts = String(value ?? '').split(/\r?\n/)
  while (parts.length < n) parts.push('')
  // anything beyond the last box stays in it, so no text is lost
  return parts.length > n ? [...parts.slice(0, n - 1), parts.slice(n - 1).join(' ')] : parts
}

export default function AddressLines({ label, value, onChange, readOnly = false, disabled = false, required = false, error, maxLength, lines = 5, onBlur }) {
  const parts = splitAddress(value, lines)
  const set = (i, v) => {
    const next = [...parts]
    next[i] = v.replace(/[\r\n]+/g, ' ')
    const joined = next.join('\r\n').replace(/(\r\n)+$/, '')
    onChange(maxLength ? joined.slice(0, maxLength) : joined)
  }
  return (
    <Stack gap={6}>
      {label && (
        <label style={{ fontSize: 'var(--mantine-font-size-sm)', fontWeight: 600 }}>
          {label}
          {required && <span style={{ color: 'var(--mantine-color-red-6)' }}> *</span>}
        </label>
      )}
      {parts.map((p, i) => (
        <TextInput
          key={i}
          aria-label={`${label || 'Address'} line ${i + 1}`}
          placeholder={ADDRESS_HINTS[i] || `Address line ${i + 1}`}
          value={p}
          readOnly={readOnly}
          disabled={disabled}
          error={i === 0 ? error : undefined}
          onChange={(e) => set(i, e.currentTarget.value)}
          onBlur={onBlur}
        />
      ))}
    </Stack>
  )
}
