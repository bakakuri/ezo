import { useEffect, useState } from 'react'
import { Avatar } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useToast } from './Toast.jsx'
import { useRewards } from './Rewards.jsx'

const readInvite = () => { try { return localStorage.getItem('ezo.invite') } catch { return null } }
const clearInvite = () => { try { localStorage.removeItem('ezo.invite') } catch { /* */ } }

// რეგისტრაციის შემდეგ მოწვევის გამოყენება (ერთხელ)
export function InviteClaimer() {
  const { me } = useAuth()
  const toast = useToast()
  const { refresh } = useRewards()
  useEffect(() => {
    const u = readInvite()
    if (!u || !me?.onboarded) return
    clearInvite()
    if (u === me.username) return
    api.claimInvite(u).then((r) => {
      if (r?.ok) { toast(`მოგესალმები! შენ და @${r.inviter} ახლა მეგობრები ხართ, +10 ბროწეული`); refresh() }
    }).catch(() => {})
  }, [me?.onboarded, me?.username]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// შესვლის გვერდზე: „X გეპატიჟება“
export function InviteBanner() {
  const [inv, setInv] = useState(null)
  useEffect(() => {
    const u = readInvite()
    if (u) api.ogPreview('i', u).then((r) => r && setInv(r)).catch(() => {})
  }, [])
  if (!inv) return null
  return (
    <div className="invite-banner">
      <Avatar user={{ id: inv.username, full_name: inv.name, avatar_url: inv.image }} size={40} />
      <span><b>{inv.name}</b> გეპატიჟება ეზოში. დარეგისტრირდი და ერთმანეთს ავტომატურად გამოიწერთ.</span>
    </div>
  )
}

// ინტერნეტი რომ გაითიშება
export function OfflineBar() {
  const [off, setOff] = useState(typeof navigator !== 'undefined' && navigator.onLine === false)
  useEffect(() => {
    const on = () => setOff(false)
    const offf = () => setOff(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', offf)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', offf) }
  }, [])
  if (!off) return null
  return <div className="offline-bar" role="status"><Icon name="globe" size={15} />კავშირი არ არის — ჩანს ბოლოს შენახული</div>
}
