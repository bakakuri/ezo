import { useState } from 'react'
import { Sheet, Avatar } from './ui.jsx'
import { api } from '../lib/api.js'
import { useToast } from './Toast.jsx'
import { CoinIcon, Coins, useRewards } from './Rewards.jsx'
import { GIFT_PRICES } from '../lib/rewards.js'
import { Link } from '../lib/router.jsx'

export const GIFTS = [
  { kind: 'pomegranate', name: 'ბროწეული' },
  { kind: 'churchkhela', name: 'ჩურჩხელა' },
  { kind: 'khachapuri', name: 'ხაჭაპური' },
  { kind: 'wine', name: 'ღვინო' },
  { kind: 'rose', name: 'ვარდი' },
  { kind: 'heart', name: 'გული' },
  { kind: 'star', name: 'ვარსკვლავი' },
  { kind: 'dice', name: 'კამათელი' },
  { kind: 'qvevri', name: 'ქვევრი' },
  { kind: 'crown', name: 'გვირგვინი' },
].map((g) => ({ ...g, price: GIFT_PRICES[g.kind] || 0 })).sort((a, b) => a.price - b.price)
export const giftName = (k) => GIFTS.find((g) => g.kind === k)?.name || k

export function GiftArt({ kind, size = 44 }) {
  const s = { width: size, height: size }
  switch (kind) {
    case 'pomegranate':
      return (
        <svg viewBox="0 0 48 48" style={s}><path d="M19 9l-1.6-5 4.3 2.6L24 3l2.3 3.6L30.6 4 29 9z" fill="#6b0f22" />
          <circle cx="24" cy="27" r="16" fill="#c3183f" /><circle cx="18" cy="21" r="4.5" fill="#fff" opacity=".25" /></svg>
      )
    case 'churchkhela':
      return (
        <svg viewBox="0 0 48 48" style={s}><path d="M24 3v4" stroke="#7a4e2d" strokeWidth="2" />
          {[10, 17, 24, 31, 38].map((y) => <ellipse key={y} cx="24" cy={y} rx="7.5" ry="5" fill="#7e2553" />)}
          <path d="M24 42v4" stroke="#7a4e2d" strokeWidth="2" /></svg>
      )
    case 'khachapuri':
      return (
        <svg viewBox="0 0 48 48" style={s}><path d="M4 24c6-12 34-12 40 0-6 12-34 12-40 0z" fill="#d99a4e" />
          <ellipse cx="24" cy="24" rx="12" ry="6.5" fill="#f6e3a8" /><circle cx="24" cy="24" r="4.5" fill="#f4a619" />
          <rect x="27" y="17" width="6" height="4" rx="1.5" fill="#fff6d5" /></svg>
      )
    case 'wine':
      return (
        <svg viewBox="0 0 48 48" style={s}><path d="M14 5h20c0 12-3 19-10 19S14 17 14 5z" fill="#e9e4dc" />
          <path d="M15 12h18c-.6 7-3.6 11-9 11s-8.4-4-9-11z" fill="#7e2553" />
          <path d="M24 24v14M16 42h16" stroke="#cfc6b8" strokeWidth="3" strokeLinecap="round" /></svg>
      )
    case 'rose':
      return (
        <svg viewBox="0 0 48 48" style={s}><path d="M24 26v18" stroke="#2c7a73" strokeWidth="3" strokeLinecap="round" />
          <path d="M24 36c-6-1-9-5-9-5s5-2 9 2" fill="#2c7a73" />
          <circle cx="24" cy="17" r="11" fill="#e2335a" /><path d="M18 17c2-5 10-5 12 0-3 4-9 4-12 0z" fill="#a8173a" /></svg>
      )
    case 'heart':
      return <svg viewBox="0 0 48 48" style={s}><path d="M24 42S6 31 6 18a9 9 0 0 1 18-3 9 9 0 0 1 18 3c0 13-18 24-18 24z" fill="#e2335a" /></svg>
    case 'star':
      return <svg viewBox="0 0 48 48" style={s}><path d="M24 4l6 12.5 13.5 2-9.8 9.5 2.3 13.5L24 35l-12 6.5 2.3-13.5L4.5 18.5l13.5-2z" fill="#f4a619" /></svg>
    case 'dice':
      return (
        <svg viewBox="0 0 48 48" style={s}><rect x="6" y="6" width="36" height="36" rx="9" fill="#efe1c6" />
          {[[16, 16], [32, 16], [24, 24], [16, 32], [32, 32]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="3.3" fill="#9e1b32" />)}</svg>
      )
    case 'qvevri':
      return (
        <svg viewBox="0 0 48 48" style={s}><path d="M17 6h14l-1 4c7 3 11 9 11 16 0 9-7 16-17 18C14 42 7 35 7 26c0-7 4-13 11-16z" fill="#b5652f" />
          <path d="M16 6h16v4H16z" fill="#8a4a20" /><path d="M11 24c3 2 8 3 13 3s10-1 13-3" stroke="#e7b07a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <circle cx="17" cy="19" r="3" fill="#fff" opacity=".22" /></svg>
      )
    case 'crown':
      return (
        <svg viewBox="0 0 48 48" style={s}><path d="M6 15l9 9 9-14 9 14 9-9-4 24H10z" fill="#f4b41a" />
          <rect x="10" y="37" width="28" height="5" rx="2" fill="#d9951a" /><circle cx="24" cy="10" r="3" fill="#e2335a" />
          <circle cx="6" cy="15" r="2.6" fill="#e2335a" /><circle cx="42" cy="15" r="2.6" fill="#e2335a" /><circle cx="24" cy="29" r="3.4" fill="#8a35e8" /></svg>
      )
    default:
      return null
  }
}

export function GiftSheet({ to, onClose }) {
  const [kind, setKind] = useState('pomegranate')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const { progress, refresh } = useRewards()
  const balance = progress?.coins ?? null
  const price = GIFT_PRICES[kind] || 0
  const short = balance !== null && price > balance
  const send = async () => {
    setBusy(true)
    try {
      await api.sendGift(to.id, kind, note.trim())
      toast(price ? `${giftName(kind)} გაეგზავნა (−${price} ბროწეული)` : `${giftName(kind)} გაეგზავნა`)
      refresh()
      onClose()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title="საჩუქარი" onClose={onClose}>
      <div className="sheet-body vstack" style={{ gap: 16 }}>
        <div className="hstack" style={{ justifyContent: 'space-between' }}>
          <span className="hstack" style={{ gap: 8, minWidth: 0 }}>
            <Avatar user={to} size={36} />
            <span className="small muted ellipsis">მიმღები: <b style={{ color: 'var(--ink)' }}>{to.full_name || to.username}</b></span>
          </span>
          {balance !== null && <Link to="/rewards" className="balance-pill" onClick={onClose}><Coins n={balance} /></Link>}
        </div>
        <div className="gift-grid">
          {GIFTS.map((g) => (
            <button key={g.kind} onClick={() => setKind(g.kind)} className={`gift-opt${kind === g.kind ? ' on' : ''}${balance !== null && g.price > balance ? ' dim' : ''}`} aria-pressed={kind === g.kind}>
              <GiftArt kind={g.kind} size={40} />
              <span className="xs">{g.name}</span>
              <span className={`gprice${g.price ? '' : ' free'}`}>{g.price ? <><CoinIcon size={12} />{g.price}</> : 'უფასო'}</span>
            </button>
          ))}
        </div>
        <input className="input" maxLength={140} placeholder="მიაწერე რამე (არასავალდებულო)" value={note} onChange={(e) => setNote(e.target.value)} />
        {short && <p className="small" style={{ color: 'var(--accent)', marginTop: -6 }}>ბროწეული არ გყოფნის — აკლია {price - balance}. <Link to="/rewards" onClick={onClose} className="link-btn">როგორ დავაგროვო?</Link></p>}
        <button className="btn btn-accent lg block" disabled={busy || short} onClick={send}>
          {price ? <>გაგზავნა <CoinIcon size={17} />{price}</> : 'გაგზავნა'}
        </button>
      </div>
    </Sheet>
  )
}
