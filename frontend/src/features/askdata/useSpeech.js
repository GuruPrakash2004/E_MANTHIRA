import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Voice input via the browser's built-in speech recognition (Chrome / Edge; audio goes to the browser vendor's
 * speech service, so it needs internet). `onText(fullTranscript)` is called continuously with the interim text so
 * the composer fills as the user speaks. Nothing is sent to our backend until the user presses Send.
 */
export default function useSpeech(speechLang, onText) {
  const Rec = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null
  const [listening, setListening] = useState(false)
  const [error, setError] = useState(null) // 'unsupported' | 'denied' | null
  const ref = useRef(null)
  const cb = useRef(onText)
  cb.current = onText

  const stop = useCallback(() => { try { ref.current?.stop() } catch { /* already stopped */ } }, [])

  const start = useCallback(() => {
    if (!Rec) { setError('unsupported'); return }
    try { ref.current?.abort() } catch { /* nothing running */ }
    const r = new Rec()
    r.lang = speechLang
    r.interimResults = true
    r.continuous = false
    r.maxAlternatives = 1
    r.onresult = (e) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
      cb.current(text)
    }
    r.onerror = (e) => {
      setListening(false)
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError('denied')
    }
    r.onend = () => setListening(false)
    ref.current = r
    setError(null)
    try { r.start(); setListening(true) } catch { setListening(false) }
  }, [Rec, speechLang])

  // a language switch or leaving the page must release the microphone
  useEffect(() => () => { try { ref.current?.abort() } catch { /* ignore */ } }, [speechLang])

  return { supported: !!Rec, listening, error, start, stop }
}
