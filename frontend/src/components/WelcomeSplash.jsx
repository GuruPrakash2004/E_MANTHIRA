import { useCallback, useEffect, useRef, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { motion } from 'framer-motion'
import { cachedWelcome, getWelcome, welcomeVideoUrl } from '../api/endpoints/welcome'

/**
 * Cinematic devotional welcome, shown once right after sign-in (LoginPage sets the flag, AppShellLayout shows it).
 * Two clips play back to back with their own soundtrack:
 *   1. temple-awakening.mp4 (8s): lamp close-up, priests open the doors, carved pillars, the bell, aerial gopuram.
 *   2. temple-aarati.mp4: opens on that same aerial gopuram shot; only its first 2.3s are played (the rest of the clip
 *      is not used), then it holds while "Namaskara" + the user's name settle in over the gopuram.
 * An ADMIN can upload their own MP4 in Global Settings (Welcome video); that replaces the two built-in clips, plays
 * in full, and the greeting appears over its last ~3s. The same screen can switch the welcome off.
 * Click, Esc or Skip ends it; reduced-motion users never see it. If the browser blocks sound-on autoplay it starts
 * muted (the button shows "Sound off"); if the first clip cannot load the welcome is skipped silently. The sound
 * choice is remembered in localStorage.
 */
export const CLIPS = ['/welcome/temple-awakening.mp4', '/welcome/temple-aarati.mp4']
const POSTER = '/welcome/temple-sunrise.jpg'
const SOUND_KEY = 'vt-welcome-sound'
const CLIP2_SECONDS = 2.3 // only the opening aerial shot of the Aarati clip is used
const HOLD_MS = 2800 // stay on the last frame so the greeting can be read

const GREETING_LEAD_S = 3.2 // custom video: greeting appears this long before the clip ends

// Looks up the admin's welcome settings first (max 1.5s, any failure = last known settings or built-in clips), then plays.
export default function WelcomeSplash({ name, onDone }) {
  // last known settings let the video start at once; the lookup below only refreshes them for next time
  const [cfg, setCfg] = useState(() => cachedWelcome())
  useEffect(() => {
    let alive = true
    // slow or failed lookup: fall back to the last settings we saw (cached by getWelcome), else the built-in clips
    const t = setTimeout(() => alive && setCfg((c) => c || {}), 1500)
    getWelcome()
      .then((c) => alive && setCfg((cur) => cur || (c && typeof c === 'object' && !Array.isArray(c) ? c : {})))
      .catch(() => alive && setCfg((cur) => cur || {}))
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [])
  const off = cfg?.enabled === false
  useEffect(() => {
    if (off) onDone()
  }, [off, onDone])
  if (!cfg || off) return <motion.div className="vt-ws" style={{ background: '#050101' }} aria-hidden exit={{ opacity: 0 }} />
  return <WelcomePlayer name={name} onDone={onDone} custom={cfg.custom ? welcomeVideoUrl(cfg.version) : null} />
}

function WelcomePlayer({ name, onDone, custom }) {
  const [greet, setGreet] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [clip, setClip] = useState(0)
  const [sound, setSound] = useState(() => localStorage.getItem(SOUND_KEY) !== 'off')
  const v0 = useRef(null)
  const v1 = useRef(null)
  const closing = useRef(false)

  const finish = useCallback(() => {
    if (closing.current) return
    closing.current = true
    setLeaving(true)
    ;[v0.current, v1.current].forEach((v) => {
      if (!v) return
      // fade the soundtrack out with the picture
      let vol = v.volume
      const fade = setInterval(() => {
        vol = Math.max(0, vol - 0.07)
        v.volume = vol
        if (vol === 0) clearInterval(fade)
      }, 70)
    })
    onDone() // AnimatePresence keeps this mounted while it dissolves
  }, [onDone])

  // Start clip 1: with sound if the browser allows it, otherwise muted.
  useEffect(() => {
    const v = v0.current
    if (!v) return undefined
    let cancelled = false
    v.muted = !sound
    v.play()
      .then(() => !cancelled && setPlaying(true))
      .catch(() => {
        if (cancelled) return
        v.muted = true
        setSound(false)
        v.play()
          .then(() => !cancelled && setPlaying(true))
          .catch(finish)
      })
    const onKey = (e) => e.key === 'Escape' && finish()
    window.addEventListener('keydown', onKey)
    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onCustomTime(e) {
    const v = e.currentTarget
    if (!greet && v.duration && v.currentTime >= Math.max(0, v.duration - GREETING_LEAD_S)) setGreet(true)
  }

  function nextClip() {
    const v = v1.current
    if (!v) return finish()
    v.muted = !sound
    v.play()
      .then(() => {
        setClip(1)
        // a timer (not timeupdate, which lags ~250ms) so we stop before the clip's own dissolve to the hall at ~2.5s
        setTimeout(() => {
          v.pause()
          setTimeout(finish, HOLD_MS)
        }, CLIP2_SECONDS * 1000)
      })
      .catch(finish)
  }

  function toggleSound(e) {
    e.stopPropagation()
    const next = !sound
    setSound(next)
    localStorage.setItem(SOUND_KEY, next ? 'on' : 'off')
    ;[v0.current, v1.current].forEach((v) => {
      if (!v) return
      v.muted = !next
      if (next) v.volume = 1
    })
  }

  const ending = custom ? greet : clip === 1

  return (
    <motion.div
      className={`vt-ws ${leaving ? 'vt-ws-out' : ''}`}
      role="status"
      aria-label={`Namaskara ${name || ''}. Welcome to e-Mandira Pranali.`}
      onClick={finish}
      exit={{ opacity: 0, scale: 1.04, filter: 'blur(6px)' }}
      transition={{ duration: 1, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* the picture fades up out of black once it is really playing */}
      <motion.div className="vt-ws-stage" aria-hidden initial={{ opacity: 0 }} animate={{ opacity: playing ? 1 : 0 }} transition={{ duration: 1.1, ease: 'easeOut' }}>
        {/* the last shot never freezes: a slow push-in keeps it alive while the greeting settles */}
        <motion.div style={{ position: 'absolute', inset: 0 }} animate={{ scale: ending ? 1.1 : 1 }} transition={{ duration: 6, ease: 'linear' }}>
        <video ref={v0} className={`vt-ws-video ${custom ? 'vt-ws-video-own' : ''}`} src={custom || CLIPS[0]} poster={custom ? undefined : POSTER} playsInline preload="auto" onEnded={custom ? () => setTimeout(finish, HOLD_MS) : nextClip} onTimeUpdate={custom ? onCustomTime : undefined} onError={finish} />
        {/* second clip is preloaded underneath and revealed the instant the first ends */}
        {!custom && (
        <video
          ref={v1}
          className="vt-ws-video"
          src={CLIPS[1]}
          playsInline
          preload="auto"
          style={{ opacity: clip === 1 ? 1 : 0, transition: 'opacity .8s ease' }}
          onError={finish}
        />
        )}
        </motion.div>
      </motion.div>

      {/* warm light blooms over the final shot */}
      <motion.div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at 50% 42%, rgba(255,205,120,.38), transparent 62%)' }} initial={{ opacity: 0 }} animate={{ opacity: ending ? 1 : 0 }} transition={{ duration: 2.2, ease: 'easeOut' }} />
      <div className="vt-ws-vignette" aria-hidden />

      {ending && (
        <>
          <div className="vt-ws-scrim" aria-hidden />
          <div className="vt-ws-text">
            <div className="vt-ws-hello">Namaskara</div>
            {name && <div className="vt-ws-name">{name}</div>}
            <div className="vt-ws-sub">Welcome to e-Mandira Pranali</div>
          </div>
        </>
      )}

      {playing && (
        <div className="vt-ws-ctrl">
          <button type="button" className="vt-ws-btn" onClick={toggleSound} aria-pressed={sound} aria-label={sound ? 'Turn welcome sound off' : 'Turn welcome sound on'}>
            {sound ? <Volume2 size={16} aria-hidden /> : <VolumeX size={16} aria-hidden />}
            <span>{sound ? 'Sound on' : 'Sound off'}</span>
          </button>
          <button
            type="button"
            className="vt-ws-btn"
            onClick={(e) => {
              e.stopPropagation()
              finish()
            }}
          >
            Skip
          </button>
        </div>
      )}
      <style>{CSS}</style>
    </motion.div>
  )
}

const CSS = `
.vt-ws { position: fixed; inset: 0; z-index: 3000; overflow: hidden; background: #050101; cursor: pointer;  }
.vt-ws-out { pointer-events: none; }
@keyframes vt-ws-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes vt-ws-fade { to { opacity: 0; } }

/* the clips carry a small generator mark in their bottom-right corner; scaling 12% from the top-left pushes it off-screen */
.vt-ws-stage { position: absolute; inset: 0; overflow: hidden; }
.vt-ws-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 0 0; transform: scale(1.12); transform-origin: 0 0; background: #050101; }

.vt-ws-video-own { transform: none; object-position: 50% 50%; } /* admin-uploaded clip: shown as is, no watermark crop */
.vt-ws-vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% 46%, transparent 55%, rgba(0,0,0,.5) 100%); }
.vt-ws-scrim { position: absolute; left: 0; right: 0; bottom: 0; height: 50vh; pointer-events: none; background: linear-gradient(180deg, transparent 0%, rgba(8,2,2,.6) 55%, rgba(8,2,2,.85) 100%); opacity: 0; animation: vt-ws-line 1.2s ease-out .2s forwards; }

/* greeting settles in over the aerial gopuram shot (timers start when clip 2 starts) */
.vt-ws-text { position: absolute; left: 0; right: 0; bottom: 9vh; text-align: center; pointer-events: none; }
.vt-ws-hello { font-family: Marcellus, Georgia, serif; font-size: clamp(36px, 6.2vw, 68px); color: #FFE9B8; padding-left: .3em; opacity: 0;
  text-shadow: 0 2px 18px rgba(0,0,0,.75), 0 0 28px rgba(255,190,90,.5); animation: vt-ws-hello 1.8s cubic-bezier(.2,.7,.2,1) .4s forwards; }
@keyframes vt-ws-hello { from { opacity: 0; letter-spacing: .55em; transform: translateY(14px); filter: blur(7px); } to { opacity: 1; letter-spacing: .14em; transform: none; filter: none; } }
.vt-ws-name { margin-top: 6px; font-family: Marcellus, Georgia, serif; font-size: clamp(18px, 2.4vw, 26px); color: #FBF6EC; text-shadow: 0 2px 12px rgba(0,0,0,.8); opacity: 0; animation: vt-ws-line 1s ease-out 1.3s forwards; }
.vt-ws-sub { margin-top: 6px; font-size: clamp(12px, 1.4vw, 15px); letter-spacing: .2em; text-transform: uppercase; color: #E9D2B8; text-shadow: 0 2px 10px rgba(0,0,0,.85); opacity: 0; animation: vt-ws-line 1s ease-out 1.7s forwards; }
@keyframes vt-ws-line { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

.vt-ws-ctrl { position: absolute; right: 18px; bottom: 18px; display: flex; gap: 8px; opacity: 0; animation: vt-ws-line .6s ease-out 1s forwards; }
.vt-ws-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid rgba(255,233,184,.4); background: rgba(20,6,6,.6); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); color: #FFE9B8; font: inherit; font-size: 13px; cursor: pointer; }
.vt-ws-btn:hover { background: rgba(255,233,184,.2); }
.vt-ws-btn:focus-visible { outline: 2px solid #FFE9B8; outline-offset: 2px; }

@media (max-width: 600px) { .vt-ws-btn span { display: none; } .vt-ws-btn { padding: 0 12px; } }
`
