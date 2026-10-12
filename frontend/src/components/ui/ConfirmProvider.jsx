import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { Button, Group, Modal, Text } from '@mantine/core'
import { AlertTriangle } from 'lucide-react'

// One shared confirmation dialog for every destructive action (delete, remove, cancel, clear, sign out).
//   const confirm = useConfirm()
//   if (!(await confirm({ title: 'Delete user?', message: '...', confirmLabel: 'Delete' }))) return
// Resolves true on confirm, false on cancel / Esc / click outside. The safe button (Cancel) has focus first.
const ConfirmContext = createContext(null)

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return ctx
}

export default function ConfirmProvider({ children }) {
  const [opts, setOpts] = useState(null)
  const resolver = useRef(null)

  const confirm = useCallback(
    (options = {}) =>
      new Promise((resolve) => {
        resolver.current = resolve
        setOpts(options)
      }),
    []
  )

  function settle(result) {
    resolver.current?.(result)
    resolver.current = null
    setOpts(null)
  }

  const { title = 'Are you sure?', message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'danger' } = opts || {}

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        opened={Boolean(opts)}
        onClose={() => settle(false)}
        centered
        size="sm"
        withCloseButton={false}
        title={
          <Group gap="xs" wrap="nowrap">
            <AlertTriangle size={20} color={tone === 'danger' ? 'var(--mantine-color-red-7)' : 'var(--mantine-color-gold-7)'} aria-hidden />
            <Text fw={700} style={{ fontFamily: 'Marcellus, Georgia, serif', fontSize: 18 }}>
              {title}
            </Text>
          </Group>
        }
        trapFocus
        returnFocus
      >
        {message && (
          <Text size="sm" c="dimmed" mb="lg">
            {message}
          </Text>
        )}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={() => settle(false)} data-autofocus>
            {cancelLabel}
          </Button>
          <Button color={tone === 'danger' ? 'red' : 'kumkum'} onClick={() => settle(true)}>
            {confirmLabel}
          </Button>
        </Group>
      </Modal>
    </ConfirmContext.Provider>
  )
}
