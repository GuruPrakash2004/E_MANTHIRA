import { Mail, Phone } from 'lucide-react'

// Vendor contact shown under the Softvent logo (login credit badge + sidebar credit card).
const PHONES = ['9945036934', '9880606365']
const EMAIL = 'mail@softvent.com'

const link = { color: 'inherit', textDecoration: 'none' }
const row = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap' }

export default function SoftventContact() {
  return (
    <div
      style={{
        width: '100%',
        marginTop: 2,
        paddingTop: 8,
        borderTop: '1px solid rgba(244,225,166,0.22)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontSize: 11.5,
        lineHeight: 1.3,
        fontWeight: 500,
        letterSpacing: 0.2,
        color: '#F4E1A6',
      }}
    >
      <div style={row}>
        <Phone size={12} aria-hidden style={{ flex: 'none', opacity: 0.85 }} />
        <span>
          {PHONES.map((p, i) => (
            <span key={p}>
              {i > 0 && <span style={{ opacity: 0.6 }}> / </span>}
              <a href={`tel:${p}`} style={link}>{p}</a>
            </span>
          ))}
        </span>
      </div>
      <div style={row}>
        <Mail size={12} aria-hidden style={{ flex: 'none', opacity: 0.85 }} />
        <a href={`mailto:${EMAIL}`} style={link}>{EMAIL}</a>
      </div>
    </div>
  )
}
