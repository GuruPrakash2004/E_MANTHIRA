import { useEffect, useState } from 'react'
import { Stack, Text, Title } from '@mantine/core'
import dayjs from 'dayjs'
import { get } from '../../api/api'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

/**
 * Public, unauthenticated seva display board — replaces the legacy
 * UtlGSettings.WebDisplayURL (live-configured for this client:
 * http://192.168.1.49/displayseva/). Meant for a TV/monitor at the temple
 * counter, not for staff use — no login, auto-refreshes.
 */
export default function DisplayBoardPage() {
  const [sevas, setSevas] = useState([])
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    function load() {
      get('/display/today-sevas')
        .then(setSevas)
        .catch(() => {})
    }
    load()
    const dataTimer = setInterval(load, 60_000)
    const clockTimer = setInterval(() => setNow(new Date()), 1000)
    return () => {
      clearInterval(dataTimer)
      clearInterval(clockTimer)
    }
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, var(--vt-g2d) 0%, #1C0A0A 70%)', color: '#F4E1A6', padding: '2rem' }}>
      <Stack align="center" gap={4} mb="xl">
        <img src={GOPURAM_MARK} alt="" style={{ height: 64, width: 64 }} />
        <Title order={1} style={{ fontFamily: 'Marcellus, Georgia, serif', color: '#F4E1A6' }}>
          Today's Sevas
        </Title>
        <Text size="lg" c="dimmed">
          {dayjs(now).format('dddd, DD MMMM YYYY · hh:mm:ss A')}
        </Text>
      </Stack>

      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1.1rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #D4A437' }}>
              <th style={{ textAlign: 'left', padding: '0.75rem' }}>Devotee</th>
              <th style={{ textAlign: 'left', padding: '0.75rem' }}>Sannidhi</th>
              <th style={{ textAlign: 'left', padding: '0.75rem' }}>Seva</th>
              <th style={{ textAlign: 'left', padding: '0.75rem' }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {sevas.map((s, i) => (
              <tr key={i} style={{ borderBottom: '1px solid rgba(244,225,166,0.15)' }}>
                <td style={{ padding: '0.6rem' }}>
                  {s.name}
                  {s.name2 ? ` & ${s.name2}` : ''}
                </td>
                <td style={{ padding: '0.6rem' }}>{s.sannidhi}</td>
                <td style={{ padding: '0.6rem' }}>{s.seva || '—'}</td>
                <td style={{ padding: '0.6rem' }}>{s.date_text}</td>
              </tr>
            ))}
            {sevas.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: '2rem', opacity: 0.6 }}>
                  No sevas recorded for today yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
