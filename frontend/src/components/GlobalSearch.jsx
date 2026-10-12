import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Group, Modal, ScrollArea, Stack, Text, TextInput } from '@mantine/core'
import { CornerDownLeft, Search } from 'lucide-react'

/**
 * Universal top-nav search (design doc §4 "MenuTree... keyboard search (`/`)"
 * — never actually built until now). Searches every reachable screen
 * (metadata-driven menu items + the handful of hardcoded destinations
 * AppShellLayout itself adds) by caption, jumps to it on Enter/click.
 * Opens on the header's search icon or the `/` key (ignored while typing
 * in a real input/textarea, so it never hijacks normal form entry).
 */
export default function GlobalSearch({ opened, onClose, items }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items.slice(0, 20)
    return items.filter((it) => it.caption.toLowerCase().includes(q)).slice(0, 20)
  }, [query, items])

  useEffect(() => {
    if (opened) {
      setQuery('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [opened])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  function go(item) {
    if (!item?.to) return
    navigate(item.to)
    onClose()
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(results[activeIdx])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} size="md" radius="lg" padding={0} withCloseButton={false} centered>
      <Stack gap={0}>
        <Group px="md" py="sm" gap="xs" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
          <Search size={16} color="#7A1F1F" />
          <TextInput
            ref={inputRef}
            variant="unstyled"
            placeholder="Search screens..."
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            style={{ flex: 1 }}
          />
        </Group>
        <ScrollArea.Autosize mah={360}>
          <Stack gap={0} p={4}>
            {results.length === 0 && (
              <Text size="sm" c="dimmed" ta="center" py="md">
                No matching screens
              </Text>
            )}
            {results.map((item, i) => (
              <Group
                key={item.to}
                justify="space-between"
                px="sm"
                py={8}
                style={{
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: i === activeIdx ? 'rgba(212,164,55,0.12)' : undefined,
                }}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => go(item)}
              >
                <div>
                  <Text size="sm" fw={500}>
                    {item.caption}
                  </Text>
                  {item.group && (
                    <Text size="xs" c="dimmed">
                      {item.group}
                    </Text>
                  )}
                </div>
                {i === activeIdx && <CornerDownLeft size={14} color="#7A1F1F" />}
              </Group>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  )
}
