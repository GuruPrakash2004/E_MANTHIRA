import { useState } from 'react'
import { Button, Menu, Text, useMantineColorScheme } from '@mantine/core'
import { Check, Palette } from 'lucide-react'

// "F-mood": picks the colour palette. The choice is stored in localStorage and applied as data-vt-palette on <html>
// (see the palette block in theme/global.css). Works with both the light and dark themes.
export const PALETTES = [
  { id: 'default', label: 'Default', hint: 'Temple maroon and gold', swatch: ['#7A1F1F', '#C79A3D'] },
  { id: 'p1', label: 'P1 Burgundy', hint: 'Rich and dramatic', swatch: ['#800020', '#C79A3D'] },
  { id: 'p2', label: 'P2 Blush Beige', hint: 'Warm and elegant', swatch: ['#F4E4DD', '#913A4C'] },
  { id: 'p3', label: 'P3 Temple Gold', hint: 'The logo gold on ivory', swatch: ['#8A6420', '#FBF6EC'] },
]
// One-tap test presets: a palette plus a light or dark theme, all taken from the logo colours.
export const PRESETS = [
  { key: 'logo-light', label: 'Logo Light', hint: 'Maroon and gold on ivory', palette: 'default', scheme: 'light', swatch: ['#FBF6EC', '#7A1F1F'] },
  { key: 'logo-dark', label: 'Logo Dark', hint: 'Maroon night with gold', palette: 'default', scheme: 'dark', swatch: ['#1C0A0A', '#F4E1A6'] },
  { key: 'gold-light', label: 'Temple Gold Light', hint: 'Ivory with bronze-gold', palette: 'p3', scheme: 'light', swatch: ['#FBF6EC', '#8A6420'] },
  { key: 'gold-dark', label: 'Temple Gold Dark', hint: 'Deep gold-brown with gold', palette: 'p3', scheme: 'dark', swatch: ['#191208', '#F4E1A6'] },
]
const KEY = 'vt-palette'

export function applyPalette(id) {
  const root = document.documentElement
  if (id && id !== 'default') root.setAttribute('data-vt-palette', id)
  else root.removeAttribute('data-vt-palette')
}
export function storedPalette() {
  try {
    return localStorage.getItem(KEY) || 'default'
  } catch {
    return 'default'
  }
}

export default function PaletteSwitch() {
  const [current, setCurrent] = useState(storedPalette)
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  function pick(id, scheme) {
    if (scheme) setColorScheme(scheme)
    setCurrent(id)
    applyPalette(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* private mode: the palette still applies for this visit */
    }
  }
  return (
    <Menu position="bottom-end" withArrow>
      <Menu.Target>
        <Button variant="light" color="kumkum" size="sm" h={40} px="sm" leftSection={<Palette size={16} aria-hidden />} aria-label={`F-mood, colour palette: ${PALETTES.find((p) => p.id === current)?.label}`}>
          <Text span visibleFrom="md" fw={600} size="sm">F-mood</Text>
        </Button>
      </Menu.Target>
      <Menu.Dropdown style={{ maxHeight: 'calc(100dvh - 96px)', overflowY: 'auto' }}>
        <Menu.Label>F-mood: colour palette</Menu.Label>
        {PALETTES.map((p) => (
          <Menu.Item
            key={p.id}
            role="menuitemradio"
            aria-checked={current === p.id}
            onClick={() => pick(p.id)}
            leftSection={
              <span aria-hidden style={{ display: 'inline-flex', borderRadius: 999, overflow: 'hidden', border: '1px solid var(--vt-line)' }}>
                <span style={{ width: 14, height: 22, background: p.swatch[0] }} />
                <span style={{ width: 14, height: 22, background: p.swatch[1] }} />
              </span>
            }
            rightSection={current === p.id ? <Check size={16} aria-hidden /> : null}
          >
            <Text size="sm" fw={600}>{p.label}</Text>
            <Text size="xs" c="dimmed">{p.hint}</Text>
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Label>Test presets: palette and theme</Menu.Label>
        {PRESETS.map((p) => (
          <Menu.Item
            key={p.key}
            onClick={() => pick(p.palette, p.scheme)}
            rightSection={current === p.palette && colorScheme === p.scheme ? <Check size={16} aria-hidden /> : null}
            leftSection={
              <span aria-hidden style={{ display: 'inline-flex', borderRadius: 999, overflow: 'hidden', border: '1px solid var(--vt-line)' }}>
                <span style={{ width: 14, height: 22, background: p.swatch[0] }} />
                <span style={{ width: 14, height: 22, background: p.swatch[1] }} />
              </span>
            }
          >
            <Text size="sm" fw={600}>{p.label}</Text>
            <Text size="xs" c="dimmed">{p.hint}</Text>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
