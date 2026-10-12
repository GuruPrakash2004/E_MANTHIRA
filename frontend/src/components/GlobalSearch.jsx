import { useEffect, useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Kbd, Text, UnstyledButton } from '@mantine/core'
import { CornerDownLeft, Search, X } from 'lucide-react'

/**
 * Universal search that lives inside the header (no modal). Searches every reachable screen
 * (metadata-driven menu items + the few destinations AppShellLayout adds) by caption; results
 * drop down right under the input. `/` focuses it (wired in AppShellLayout, ignored while typing
 * in a real field), arrows move, Enter opens, Esc clears. `onDone` fires after a jump or Esc so the
 * phone layout can collapse back to the normal header.
 */
export default function GlobalSearch({ items, inputRef, autoFocus = false, onDone, style }) {
  const navigate = useNavigate()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? items.filter((it) => it.caption.toLowerCase().includes(q)) : items
    return list.slice(0, q ? 20 : 8)
  }, [query, items])

  useEffect(() => setActiveIdx(0), [query])

  function go(item) {
    if (!item?.to) return
    navigate(item.to)
    close()
  }

  function close() {
    setOpen(false)
    setQuery('')
    inputRef?.current?.blur()
    onDone?.()
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(results[activeIdx])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  return (
    <div style={{ position: 'relative', flex: 1, ...style }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 42,
          padding: '0 12px 0 14px',
          background: '#fff',
          border: `1px solid ${open ? 'var(--mantine-color-kumkum-5)' : 'var(--vt-line)'}`,
          borderRadius: 999,
          boxShadow: open ? '0 0 0 3px rgba(122,31,31,0.12)' : 'none',
          transition: 'border-color .15s, box-shadow .15s',
        }}
      >
        <Search size={16} color="var(--mantine-color-kumkum-6)" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search screens"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[activeIdx] ? `${listId}-${activeIdx}` : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="Search screens"
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', font: 'inherit', fontSize: 14, color: 'var(--mantine-color-text)' }}
        />
        {query ? (
          <UnstyledButton
            aria-label="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery('')
              inputRef?.current?.focus()
            }}
            style={{ display: 'flex', color: 'var(--mantine-color-dimmed)' }}
          >
            <X size={16} />
          </UnstyledButton>
        ) : (
          <Kbd size="xs" visibleFrom="sm">
            /
          </Kbd>
        )}
      </div>

      {open && (
        <div
          id={listId}
          role="listbox"
          // mousedown would blur the input before the click lands; keep focus so the click registers.
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            right: 0,
            zIndex: 400,
            maxHeight: 'min(60dvh, 380px)',
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid var(--vt-line)',
            borderRadius: 16,
            boxShadow: '0 16px 40px rgba(43,9,9,0.18)',
            padding: 6,
          }}
        >
          {!query.trim() && (
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="sm" pt={6} pb={4} style={{ letterSpacing: 0.8 }}>
              Jump to
            </Text>
          )}
          {results.length === 0 && (
            <Text size="sm" c="dimmed" ta="center" py="md">
              No matching screens
            </Text>
          )}
          {results.map((item, i) => (
            <div
              key={`${item.to}|${item.caption}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => go(item)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                minHeight: 44,
                padding: '6px 12px',
                borderRadius: 10,
                cursor: 'pointer',
                background: i === activeIdx ? 'var(--mantine-color-gold-0)' : undefined,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={600} truncate>
                  {item.caption}
                </Text>
                {item.group && (
                  <Text size="xs" c="dimmed">
                    {item.group}
                  </Text>
                )}
              </div>
              {i === activeIdx && <CornerDownLeft size={14} color="var(--mantine-color-kumkum-7)" aria-hidden />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
