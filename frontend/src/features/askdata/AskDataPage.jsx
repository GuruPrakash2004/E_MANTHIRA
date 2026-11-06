import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Badge, Button, Drawer, Group, ScrollArea, SegmentedControl, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, History, Mic, Plus, RotateCcw, Search, Square, Trash2 } from 'lucide-react'
import * as api from '../../api/endpoints/askData'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import NotAvailableHere from '../../components/ui/NotAvailableHere'
import AskChart from './AskChart'
import useSpeech from './useSpeech'
import './askdata.css'

const errText = (e) => e?.response?.data?.detail || e?.message || 'Something went wrong'
let seq = 0
const nextId = () => `m${Date.now()}_${++seq}`

/** Reveals `text` grapheme by grapheme (Indic scripts stay intact); instant under prefers-reduced-motion. */
function Typed({ text }) {
  const chars = useMemo(() => {
    try { return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment) } catch { return Array.from(text) }
  }, [text])
  const [n, setN] = useState(0)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setN(chars.length); return undefined }
    setN(0)
    const step = Math.max(1, Math.ceil(chars.length / 45))
    const id = setInterval(() => setN((x) => { if (x >= chars.length) { clearInterval(id); return x } return x + step }), 22)
    return () => clearInterval(id)
  }, [chars])
  return <>{chars.slice(0, n).join('')}{n < chars.length && <span className="ad-caret" />}</>
}

/** ChatGPT/Claude style "thinking" bubble: animated dots, rotating status line, shimmering skeleton. */
function Thinking({ t }) {
  const steps = [t.step1, t.step2, t.step3]
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), 1400)
    return () => clearInterval(id)
  }, [steps.length])
  return (
    <div className="ad-think" role="status" aria-live="polite">
      <div className="ad-think-head">
        <span className="ad-dots"><i /><i /><i /></span>
        <Text size="sm" key={i} className="ad-step">{steps[i]}…</Text>
      </div>
      <div className="ad-skel w1" /><div className="ad-skel w2" /><div className="ad-skel w3" />
    </div>
  )
}

function Answer({ m, t }) {
  const r = m.result || {}
  if (m.status === 'error' || m.status === 'nomatch') {
    return (
      <Stack gap={6}>
        <Text size="sm" c={m.status === 'error' ? 'red' : undefined}>{r.error}</Text>
        {(r.suggestions || []).map((s) => <button key={s} type="button" className="ad-chip" onClick={() => m.onPick(s)}>{s}</button>)}
      </Stack>
    )
  }
  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text fw={600}><Typed text={r.answer || ''} /></Text>
          {(r.period_label || r.filter_label) && <Text size="xs" c="dimmed">{[r.period_label, r.filter_label].filter(Boolean).join(' · ')}</Text>}
        </div>
      </Group>
      <AskChart type={r.chart} columns={r.columns} rows={r.rows} />
      {r.rows?.length > 0 && r.chart !== 'kpi' && (
        <ScrollArea.Autosize mah={340}>
          <Table striped withTableBorder fz="sm" stickyHeader>
            <Table.Thead><Table.Tr>{r.columns.map((c) => <Table.Th key={c}>{c}</Table.Th>)}</Table.Tr></Table.Thead>
            <Table.Tbody>{r.rows.map((row, i) => <Table.Tr key={i}>{row.map((v, j) => <Table.Td key={j}>{v == null ? '' : String(v)}</Table.Td>)}</Table.Tr>)}</Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      )}
    </Stack>
  )
}

/** Ask the Data: chat with the temple database. Type or speak a question in any of 5 languages. */
export default function AskDataPage() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [lang, setLang] = useState(() => { try { return localStorage.getItem('ask-lang') || 'en' } catch { return 'en' } })
  const [draft, setDraft] = useState('')
  const [thread, setThread] = useState([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [search, setSearch] = useState('')
  const endRef = useRef(null)
  const baseRef = useRef('')
  const taRef = useRef(null)

  const { data: meta } = useQuery({ queryKey: ['ask-meta'], queryFn: api.getAskMeta, staleTime: 30 * 60 * 1000 })
  const { data: history = [] } = useQuery({ queryKey: ['ask-history', search], queryFn: () => api.getAskHistory(search.trim()), enabled: !!meta?.available && historyOpen })
  const t = meta?.captions?.[lang] || meta?.captions?.en || {}
  const speechLang = meta?.languages?.find((l) => l.code === lang)?.speech || 'en-IN'
  const busy = thread.some((m) => m.status === 'loading')

  const speech = useSpeech(speechLang, (txt) => setDraft(baseRef.current ? `${baseRef.current} ${txt}` : txt))

  // keep the newest question at the top of the view so a tall answer (chart + table) is read from its start
  useEffect(() => {
    const rows = document.querySelectorAll('.ad-row.me')
    rows[rows.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [thread.length])
  useEffect(() => { const el = taRef.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px` } }, [draft])

  const run = useCallback(async (question, call) => {
    const id = nextId()
    setThread((th) => [...th, { id, q: question, status: 'loading' }])
    try {
      // hold the thinking bubble for a moment even when the answer is instant, so the user sees the system working
      const [r] = await Promise.all([call(), new Promise((ok) => setTimeout(ok, 1100))])
      setThread((th) => th.map((m) => (m.id === id ? { ...m, status: r.status, result: r } : m)))
      qc.invalidateQueries({ queryKey: ['ask-history'] })
    } catch (e) {
      setThread((th) => th.map((m) => (m.id === id ? { ...m, status: 'error', result: { error: errText(e) } } : m)))
    }
  }, [qc])

  const submit = useCallback((text) => {
    const q = (text ?? draft).trim()
    if (q.length < 2 || busy) return
    speech.stop()
    setDraft('')
    baseRef.current = ''
    run(q, () => api.askQuestion(q, lang))
  }, [draft, busy, lang, run, speech])

  const toggleMic = () => {
    if (speech.listening) { speech.stop(); return }
    baseRef.current = draft.trim()
    speech.start()
  }

  async function remove(h) {
    if (!(await confirm({ title: `${t.delete}?`, message: h.Question, confirmLabel: t.delete }))) return
    try {
      await api.deleteAsk(h.ID)
      qc.invalidateQueries({ queryKey: ['ask-history'] })
    } catch (e) {
      notifications.show({ message: errText(e), color: 'red' })
    }
  }

  if (meta && !meta.available) return <NotAvailableHere feature={t.title || 'Ask the Data'} missing={['WebAiQueryHistory']} />
  const suggestions = meta?.suggestions?.[lang] || []
  const micMsg = speech.error === 'unsupported' || (meta && !speech.supported) ? t.mic_unsupported : speech.error === 'denied' ? t.mic_denied : ''

  return (
    <div className="ad-root">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Group gap="xs">
          <Button variant="subtle" size="compact-sm" leftSection={<Plus size={15} />} onClick={() => setThread([])} disabled={!thread.length}>{t.new_chat}</Button>
          <Button variant="subtle" size="compact-sm" leftSection={<History size={15} />} onClick={() => setHistoryOpen(true)}>{t.history}</Button>
        </Group>
        {meta && <SegmentedControl size="xs" value={lang} onChange={(v) => { speech.stop(); setLang(v); try { localStorage.setItem('ask-lang', v) } catch { /* storage unavailable */ } }} data={meta.languages.map((l) => ({ value: l.code, label: l.label }))} />}
      </Group>

      <div className="ad-scroll">
        {thread.length === 0 && (
          <div className="ad-empty">
            <img src="/illustrations/gopuram-mark.svg" alt="" aria-hidden style={{ height: 56, width: 56 }} />
            <Text fz={28} fw={700} mt="xs">{t.title}</Text>
            <Text c="dimmed" mb="md">{t.subtitle}</Text>
            <Text size="xs" tt="uppercase" c="dimmed" ta="left" mt="md">{t.try}</Text>
            {suggestions.map((s) => <button key={s} type="button" className="ad-chip" onClick={() => submit(s)}>{s}</button>)}
          </div>
        )}
        {thread.map((m) => (
          <div key={m.id} style={{ display: 'contents' }}>
            <div className="ad-row me"><div className="ad-bubble-me">{m.q}</div></div>
            <div className="ad-row">
              <div className="ad-bot">
                <div className={`ad-avatar${m.status === 'loading' ? ' busy' : ''}`}><img src="/illustrations/gopuram-mark.svg" alt="" aria-hidden /></div>
                <div className="ad-card">
                  {m.status === 'loading' ? <Thinking t={t} /> : <Answer m={{ ...m, onPick: submit }} t={t} />}
                </div>
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="ad-composer-wrap">
        {speech.listening && (
          <div className="ad-listen"><span className="ad-wave"><i /><i /><i /><i /><i /></span>{t.listening}</div>
        )}
        {micMsg && !speech.listening && <Text size="xs" c="red" ta="center" mb={6}>{micMsg}</Text>}
        <div className={`ad-composer${speech.listening ? ' live' : ''}`}>
          <textarea
            ref={taRef} rows={1} value={draft} placeholder={t.composer} aria-label={t.composer}
            onChange={(e) => { baseRef.current = ''; setDraft(e.target.value) }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }}
          />
          <Tooltip label={speech.listening ? t.stop : t.speak}>
            <button type="button" className={`ad-btn mic${speech.listening ? ' on' : ''}`} onClick={toggleMic} aria-label={speech.listening ? t.stop : t.speak} aria-pressed={speech.listening}>
              {speech.listening ? <Square size={16} fill="currentColor" /> : <Mic size={19} />}
            </button>
          </Tooltip>
          <Tooltip label={t.send}>
            <button type="button" className="ad-btn send" onClick={() => submit()} disabled={draft.trim().length < 2 || busy} aria-label={t.send}><ArrowUp size={19} /></button>
          </Tooltip>
        </div>
      </div>

      <Drawer opened={historyOpen} onClose={() => setHistoryOpen(false)} position="right" size="md" title={t.history}>
        <Stack gap="xs">
          <TextInput size="xs" leftSection={<Search size={14} />} placeholder={t.search} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          {history.length === 0 && <Text size="sm" c="dimmed">{t.empty}</Text>}
          {history.map((h) => (
            <div key={h.ID} className="ad-chip" style={{ cursor: 'default' }}>
              <Text size="sm" lineClamp={2}>{h.Question}</Text>
              <Group justify="space-between" mt={4}>
                <Group gap={6}>
                  <Badge size="xs" variant="light" color={h.Status === 'ok' ? 'kumkum' : 'red'}>{h.Status === 'ok' ? `${h.RowCount ?? 0} ${t.rows}` : h.Status}</Badge>
                  <Text size="xs" c="dimmed">{String(h.AskedAt).slice(0, 16).replace('T', ' ')}</Text>
                </Group>
                <Group gap={2}>
                  {h.Status === 'ok' && (
                    <Tooltip label={t.rerun}>
                      <ActionIcon size="sm" variant="subtle" onClick={() => { setHistoryOpen(false); run(h.Question, () => api.rerunAsk(h.ID)) }}><RotateCcw size={14} /></ActionIcon>
                    </Tooltip>
                  )}
                  <Tooltip label={t.delete}><ActionIcon size="sm" variant="subtle" color="red" onClick={() => remove(h)}><Trash2 size={14} /></ActionIcon></Tooltip>
                </Group>
              </Group>
            </div>
          ))}
        </Stack>
      </Drawer>
    </div>
  )
}
