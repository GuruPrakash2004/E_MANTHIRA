import { ActionIcon, Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core'
import { Moon, Sun } from 'lucide-react'

// Light / dark switch. The choice is remembered by Mantine (localStorage `mantine-color-scheme-value`).
// `tone="onDark"` is for use on the maroon art panel of the login page.
export default function ThemeToggle({ size = 40 }) {
  const { setColorScheme } = useMantineColorScheme()
  const scheme = useComputedColorScheme('light', { getInitialValueInEffect: false })
  const dark = scheme === 'dark'
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <Tooltip label={label} withArrow>
      <ActionIcon
        variant="light"
        color={dark ? 'gold' : 'kumkum'}
        size={size}
        aria-label={label}
        aria-pressed={dark}
        style={dark ? { color: '#F4E1A6', background: 'rgba(244,225,166,0.14)' } : undefined}
        onClick={() => setColorScheme(dark ? 'light' : 'dark')}
      >
        {dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
      </ActionIcon>
    </Tooltip>
  )
}
