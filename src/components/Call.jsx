import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { CallSession, RING_TIMEOUT } from '../lib/call.js'
import { api } from '../lib/api.js'
import { useToast } from './Toast.jsx'

const CallCtx = createContext({ startCall: () => {}, busy: false })
export const useCalls = () => useContext(CallCtx)

// ზარის ხმა WebAudio-თი (ფაილის გარეშე)
function useTone(kind) {
  useEffect(() => {
    if (!kind) return
    let ctx
    try { ctx = new (window.AudioContext || window.webkitAudioContext)() } catch { return }
    const beep = (f, at, len) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = f
      g.gain.setValueAtTime(0, ctx.currentTime + at)
      g.gain.linearRampToValueAtTime(0.08, ctx.currentTime + at + 0.02)
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + at + len)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + at)
      o.stop(ctx.currentTime + at + len + 0.05)
    }
    const play = () => (kind === 'incoming' ? (beep(660, 0, 0.25), beep(880, 0.3, 0.25), beep(660, 0.6, 0.25)) : beep(440, 0, 1.2))
    play()
    const t = setInterval(play, kind === 'incoming' ? 2200 : 3500)
    return () => { clearInterval(t); ctx.close().catch(() => {}) }
  }, [kind])
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export function CallProvider({ children }) {
  const [session, setSession] = useState(null)
  const [, force] = useState(0)
  const sessionRef = useRef(null)
  const toast = useToast()

  const attach = useCallback((s) => {
    sessionRef.current = s
    s.onChange = () => {
      force((n) => n + 1)
      if (s.state === 'ended') {
        setTimeout(() => {
          if (sessionRef.current === s) { sessionRef.current = null; setSession(null) }
        }, 1600)
      }
    }
    setSession(s)
  }, [])

  const startCall = useCallback(async (conv, other, kind) => {
    if (sessionRef.current) { toast('უკვე ზარზე ხარ', 'error'); return }
    if (!navigator.mediaDevices?.getUserMedia) { toast('ამ ბრაუზერში ზარი არ მუშაობს', 'error'); return }
    try {
      const call = await api.startCall(conv.id, other.id, kind)
      const s = new CallSession({ call: { ...call, peer: other }, role: 'caller' })
      attach(s)
      s.startAsCaller()
    } catch (e) { toast(e.message, 'error') }
  }, [attach, toast])

  useEffect(() => api.onIncomingCall((call) => {
    // ძველი ან უკვე გამოტოვებული ზარი არ ირეკება
    if (Date.now() - new Date(call.created_at).getTime() > RING_TIMEOUT) return
    if (sessionRef.current) { api.updateCall(call.id, 'busy').catch(() => {}); return }
    const s = new CallSession({ call: { ...call, peer: call.caller }, role: 'callee' })
    attach(s)
    s.watchIncoming()
  }), [attach])

  return (
    <CallCtx.Provider value={{ startCall, busy: Boolean(session) }}>
      {children}
      {session && <CallScreen s={session} />}
    </CallCtx.Provider>
  )
}

function Video({ stream, muted, mirror, className }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null
  }, [stream])
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} style={mirror ? { transform: 'scaleX(-1)' } : undefined} />
}

const END_TEXT = {
  declined: 'უარყო ზარი', busy: 'სხვა ზარზეა', missed: 'არ უპასუხა', failed: 'კავშირი ვერ დამყარდა',
  nomedia: 'მიკროფონზე ან კამერაზე წვდომა არ არის', ended: 'ზარი დასრულდა',
}

function CallScreen({ s }) {
  const [now, setNow] = useState(Date.now())
  const { call, state, role } = s
  const video = call.kind === 'video'
  const peer = call.peer || {}
  const incoming = role === 'callee' && state === 'ringing'
  useTone(state === 'ringing' ? (role === 'callee' ? 'incoming' : 'outgoing') : null)
  useEffect(() => {
    if (state !== 'active') return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [state])

  const status = state === 'ringing'
    ? (incoming ? (video ? 'შემომავალი ვიდეოზარი' : 'შემომავალი ზარი') : 'ირეკება…')
    : state === 'connecting' ? 'კავშირი…'
      : state === 'active' ? fmt(Math.max(0, Math.round((now - s.startedAt) / 1000)))
        : `${END_TEXT[s.reason] || END_TEXT.ended}${s.duration ? `, ${fmt(s.duration)}` : ''}`
  const showRemote = video && s.remote && state !== 'ringing'

  return createPortal(
    <div className={`call-screen${showRemote ? ' has-video' : ''}`} role="dialog" aria-label={`ზარი: ${peer.full_name || ''}`}>
      {showRemote
        ? <Video stream={s.remote} className="remote" />
        : (
          <div className="call-backdrop" aria-hidden="true">
            {peer.avatar_url && <img src={peer.avatar_url} alt="" />}
          </div>
        )}
      {!video && s.remote && <Video stream={s.remote} className="sr-only" />}
      <div className="call-top">
        {!showRemote && <span className={`call-avatar${state === 'ringing' ? ' ringing' : ''}`}><Avatar user={peer} size={112} /></span>}
        <h2>{peer.full_name || peer.username}</h2>
        <p aria-live="polite">{status}</p>
      </div>
      {video && s.local && state !== 'ended' && !s.cameraOff && (
        <Video stream={s.local} muted mirror={s.facing === 'user'} className={`local${incoming ? ' preview' : ''}`} />
      )}
      <div className="call-controls">
        {incoming ? (
          <>
            <button className="cbtn end" onClick={() => s.decline()} aria-label="ზარის უარყოფა"><Icon name="callEnd" size={30} /></button>
            <button className="cbtn accept" onClick={() => s.accept()} aria-label="ზარის მიღება"><Icon name={video ? 'video' : 'call'} size={28} /></button>
          </>
        ) : state !== 'ended' && (
          <>
            <button className={`cbtn${s.muted ? ' on' : ''}`} onClick={() => s.toggleMute()} aria-label={s.muted ? 'მიკროფონის ჩართვა' : 'მიკროფონის გამორთვა'} aria-pressed={s.muted}>
              <Icon name={s.muted ? 'micOff' : 'mic'} size={26} />
            </button>
            {video && (
              <>
                <button className={`cbtn${s.cameraOff ? ' on' : ''}`} onClick={() => s.toggleCamera()} aria-label="კამერა" aria-pressed={s.cameraOff}><Icon name={s.cameraOff ? 'videoOff' : 'video'} size={26} /></button>
                <button className="cbtn" onClick={() => s.flipCamera()} aria-label="კამერის შეცვლა"><Icon name="refresh" size={24} /></button>
              </>
            )}
            <button className="cbtn end" onClick={() => s.hangup()} aria-label="დასრულება"><Icon name="callEnd" size={30} /></button>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
