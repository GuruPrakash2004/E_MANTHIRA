// Temple design tokens — see vTemple_Analysis/08_UI_UX_Design_System.md §2.
// Palette locked to the e-Mandira Pranali brand mark (vtemple-web/logo/):
// deep maroon circle + gold shikhara/lotus on an ivory ground. `kumkum`
// already matched the logo's maroon almost exactly; `gold` is new, sampled
// off the logo's temple-gold rather than the more orange `saffron` scale
// (saffron is kept for existing badges/status — don't rename call sites).
import { createTheme } from '@mantine/core'

export const theme = createTheme({
  primaryColor: 'kumkum',
  colors: {
    kumkum: ['#FBEAEA', '#F2C9C9', '#E39E9E', '#CF6E6E', '#B84848', '#9E2F2F', '#7A1F1F', '#5A1414', '#420E0E', '#2B0909'],
    saffron: ['#FFF4E6', '#FDEBD6', '#FAD3A6', '#F5B56F', '#EE9A42', '#E07B16', '#BF6511', '#9A500D', '#763D0A', '#522A07'],
    teal: ['#E6F3F2', '#C2E1DF', '#94C9C5', '#62ADA8', '#3B918B', '#1F6F6B', '#185955', '#124340', '#0C2E2C', '#061918'],
    gold: ['#FBF6E9', '#F6EBC9', '#EEDA9C', '#E4C76C', '#D9B347', '#C79A3D', '#A97F32', '#876428', '#634A1E', '#403014'],
  },
  fontFamily: '"Noto Sans","Noto Sans Kannada",system-ui,sans-serif',
  headings: { fontFamily: 'Marcellus, Georgia, serif' },
  defaultRadius: 'md',
  components: {
    ActionIcon: { defaultProps: { radius: 'xl' } },
    Badge: { defaultProps: { radius: 'sm' } },
    Paper: { defaultProps: { radius: 'lg' } },
    Card: { defaultProps: { radius: 'lg' } },
    Modal: { defaultProps: { radius: 'lg' } },
    // Redesign foundation: roomy hit targets (>=40px), clear labels, quiet table headers.
    TextInput: { defaultProps: { radius: 'md' }, styles: { label: { fontWeight: 600, marginBottom: 4 } } },
    PasswordInput: { defaultProps: { radius: 'md' }, styles: { label: { fontWeight: 600, marginBottom: 4 } } },
    Select: { defaultProps: { radius: 'md' }, styles: { label: { fontWeight: 600, marginBottom: 4 } } },
    NumberInput: { defaultProps: { radius: 'md' }, styles: { label: { fontWeight: 600, marginBottom: 4 } } },
    Textarea: { defaultProps: { radius: 'md' }, styles: { label: { fontWeight: 600, marginBottom: 4 } } },
    Button: { defaultProps: { radius: 'xl' }, styles: { root: { fontWeight: 600 } } },
    Table: {
      defaultProps: { highlightOnHover: true, verticalSpacing: 'sm' },
      styles: {
        th: {
          background: 'var(--mantine-color-gold-0)',
          color: 'var(--mantine-color-kumkum-8)',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        },
      },
    },
  },
})

export const TOKENS = {
  sandal: '#FBF6EC',
  gold200: '#F4E1A6',
  ink900: '#2A211C',
  ink600: '#6B5E55',
  line: '#EADFD3',
  success: '#2E7D32',
  danger: '#C62828',
  warning: '#B26A00',
  today: '#FFE08A',
}
