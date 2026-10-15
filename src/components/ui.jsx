import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon.jsx'
import { Link, back } from '../lib/router.jsx'
import { initials, isOnline } from '../lib/format.js'

const TONES = ['#9e1b32', '#2c7a73', '#6b4226', '#5b3a70', '#3a5a8c', '#7a4e2d', '#1f5f4a', '#a34a28']
const tone = (id = '') => TONES[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % TONES.length]

export function Avatar({ user, size = 40, online = false }) {
  const name = user?.full_name || user?.username || ''
  return (
    <span className="avatar-wrap">
      <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: user?.avatar_url ? 'var(--bg-2)' : tone(user?.id) }}>
        {user?.avatar_url ? <img src={user.avatar_url} alt="" loading="lazy" /> : initials(name).slice(0, size < 34 ? 1 : 2)}
      </span>
      {online && isOnline(user?.last_seen) && <i className="online" />}
    </span>
  )
}

export function Sheet({ title, onClose, children, actions }) {
  const ref = useRef(null)
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="sheet-grip" />
        {(title || actions) && (
          <div className="sheet-head">
            <h2>{title}</h2>
            {actions}
            <button className="icon-btn sm" onClick={onClose} aria-label="დახურვა"><Icon name="close" size={20} /></button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function TopBar({ title, backTo, children, lined = true, hideBack = false }) {
  return (
    <header className={`topbar${lined ? ' lined' : ''}`}>
      {backTo !== undefined && !hideBack ? (
        <div className="back-title">
          <button className="icon-btn" onClick={() => back(backTo || '/')} aria-label="უკან"><Icon name="back" /></button>
          <h1 className="ellipsis">{title}</h1>
        </div>
      ) : (
        <h1 className="ellipsis">{title}</h1>
      )}
      {children}
    </header>
  )
}

export function Empty({ icon = 'sparkle', title, text, action }) {
  return (
    <div className="empty">
      <div className="art"><Icon name={icon} size={28} /></div>
      <h3>{title}</h3>
      {text && <p className="small">{text}</p>}
      {action}
    </div>
  )
}

export function PostSkeleton({ n = 3 }) {
  return Array.from({ length: n }, (_, i) => (
    <div className="skel-post" key={i} aria-hidden="true">
      <div className="skel" style={{ width: 44, height: 44, borderRadius: '50%' }} />
      <div className="vstack" style={{ gap: 8 }}>
        <div className="skel" style={{ width: '40%', height: 12 }} />
        <div className="skel" style={{ width: '92%', height: 12 }} />
        <div className="skel" style={{ width: '70%', height: 12 }} />
        {i === 0 && <div className="skel" style={{ width: '100%', height: 220, borderRadius: 14 }} />}
      </div>
    </div>
  ))
}

export function Loader() {
  return <div className="page-loader"><div className="spinner" /></div>
}

// დადასტურებული ანგარიში — ნიშანს მხოლოდ ადმინი ანიჭებს
export function Verified({ user, size = 16 }) {
  if (!user?.verified) return null
  return (
    <svg className="verified" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="დადასტურებული ანგარიში">
      <title>დადასტურებული ანგარიში</title>
      <path d="M12 1.8l2.6 1.9 3.2-.1 1 3.1 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3.1-3.2-.1L12 22.2l-2.6-1.9-3.2.1-1-3.1-2.6-1.9 1-3.1-1-3.1 2.6-1.9 1-3.1 3.2.1z" fill="currentColor" />
      <path d="M8 12.3l2.7 2.7L16.2 9.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function PersonRow({ user, sub, right }) {
  return (
    <div className="person-row">
      <Link to={`/u/${user.username}`}><Avatar user={user} size={46} online /></Link>
      <Link to={`/u/${user.username}`} className="who">
        <b>{user.full_name || user.username}<Verified user={user} size={15} /></b>
        <small>{sub ?? `@${user.username}`}</small>
      </Link>
      {right}
    </div>
  )
}

export function Toggle({ on, onChange, label }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)} />
}

export function ConfirmSheet({ title, text, confirm = 'წაშლა', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="sheet-body vstack">
        {text && <p className="muted">{text}</p>}
        <button className="btn btn-danger lg block" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm() } finally { setBusy(false); onClose() } }}>{confirm}</button>
        <button className="btn btn-ghost block" onClick={onClose}>გაუქმება</button>
      </div>
    </Sheet>
  )
}
