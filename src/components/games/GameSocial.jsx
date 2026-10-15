import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Avatar, Sheet } from '../ui.jsx'
import { Icon } from '../Icon.jsx'
import { api } from '../../lib/api.js'
import { useToast } from '../Toast.jsx'

export const REACTIONS = ['👍', '😂', '😮', '🔥', '😡', '🎉', '🤝', '😢']

// რეაქციები (ყველას, მაყურებელსაც) და ჩატი (მოთამაშეებს) თამაშის დროს
export function GameSocial({ gameId, me, isPlayer, active }) {
  const toast = useToast()
  const [msgs, setMsgs] = useState([])
  const [floats, setFloats] = useState([])
  const [pop, setPop] = useState(null)
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [text, setText] = useState('')
  const [viewers, setViewers] = useState(0)
  const openRef = useRef(false)
  openRef.current = open
  const listRef = useRef(null)

  useEffect(() => {
    api.gameMessages(gameId).then(setMsgs).catch(() => {})
    const off = api.subscribeGameMessages(gameId, (m) => {
      setMsgs((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur.slice(-59), m]))
      if (m.kind === 'emoji') {
        const id = `${m.id}-${Math.random()}`
        setFloats((f) => [...f.slice(-11), { id, e: m.body, x: 12 + Math.random() * 70, mine: m.user_id === me?.id, name: m.p?.full_name?.split(' ')[0] }])
        setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 2600)
      } else if (m.user_id !== me?.id) {
        if (!openRef.current) setUnread((n) => n + 1)
        setPop(m)
        setTimeout(() => setPop((p) => (p === m ? null : p)), 4200)
      }
    })
    const offWatch = api.watchGame(gameId, isPlayer ? 'player' : 'spectator', setViewers)
    return () => { off?.(); offWatch?.() }
  }, [gameId, me?.id, isPlayer])

  useEffect(() => { if (open) { setUnread(0); listRef.current?.scrollTo(0, 1e6) } }, [open, msgs.length])

  const send = async (kind, body) => {
    try { await api.sendGameMessage(gameId, kind, body) } catch (e) { toast(e.message, 'error') }
  }
  const submit = (e) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    setText('')
    send('text', t)
  }
  const texts = msgs.filter((m) => m.kind === 'text')

  return (
    <>
      <div className="g-social">
        {active && (
          <div className="emoji-bar" role="group" aria-label="რეაქციები">
            {REACTIONS.map((e) => <button key={e} onClick={() => send('emoji', e)} aria-label={`რეაქცია ${e}`}>{e}</button>)}
          </div>
        )}
        <div className="g-social-meta">
          {viewers > 0 && <span className="viewers" title="მაყურებლები"><Icon name="eye" size={15} />{viewers}</span>}
          {isPlayer && (
            <button className="chat-btn" onClick={() => setOpen(true)} aria-label="თამაშის ჩატი">
              <Icon name="chat" size={18} />{texts.length > 0 && <span>{texts.length}</span>}
              {unread > 0 && <i className="dot" />}
            </button>
          )}
        </div>
      </div>
      {createPortal(
        <div className="emoji-layer" aria-hidden="true">
          {floats.map((f) => (
            <span key={f.id} className={`emoji-float${f.mine ? ' mine' : ''}`} style={{ left: `${f.x}%` }}>
              {f.e}{f.name && !f.mine && <small>{f.name}</small>}
            </span>
          ))}
          {pop && <div className="chat-pop"><Avatar user={pop.p} size={24} /><b>{pop.p?.full_name?.split(' ')[0]}</b>{pop.body}</div>}
        </div>,
        document.body,
      )}
      {open && (
        <Sheet title="ჩატი" onClose={() => setOpen(false)}>
          <div className="g-chat" ref={listRef}>
            {!texts.length && <p className="small muted" style={{ textAlign: 'center', padding: 20 }}>მოწინააღმდეგეს მიესალმე 👋</p>}
            {texts.map((m) => (
              <div key={m.id} className={`g-line${m.user_id === me?.id ? ' me' : ''}`}>
                {m.user_id !== me?.id && <Avatar user={m.p} size={26} />}
                <span>{m.body}</span>
              </div>
            ))}
          </div>
          {active && (
            <form className="g-chat-form" onSubmit={submit}>
              {['გამარჯობა!', 'კარგი სვლაა', 'წარმატებები 🤝'].map((q) => <button type="button" key={q} className="chip" onClick={() => send('text', q)}>{q}</button>)}
              <div className="row">
                <input className="input" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder="მესიჯი…" aria-label="მესიჯი" />
                <button className="btn btn-accent" disabled={!text.trim()} aria-label="გაგზავნა"><Icon name="send" size={18} /></button>
              </div>
            </form>
          )}
        </Sheet>
      )}
    </>
  )
}
