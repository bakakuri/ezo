import { useEffect, useMemo, useState } from 'react'
import { Avatar, Sheet } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { CoinIcon } from './Rewards.jsx'
import { qrMatrix, qrPath } from '../lib/qr.js'
import { api } from '../lib/api.js'
import { useToast } from './Toast.jsx'

export function QrCode({ text, size = 220, label }) {
  const { d, size: n } = useMemo(() => qrPath(qrMatrix(text)), [text])
  return (
    <svg className="qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label || 'QR კოდი'} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#17121f" />
    </svg>
  )
}

// QR PNG-ად (ტელეფონში შესანახად)
function downloadQr(text, name) {
  const m = qrMatrix(text)
  const scale = 12
  const n = m.length + 8
  const c = document.createElement('canvas')
  c.width = c.height = n * scale
  const g = c.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#17121f'
  m.forEach((row, y) => row.forEach((dark, x) => { if (dark) g.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale) }))
  const a = document.createElement('a')
  a.href = c.toDataURL('image/png')
  a.download = `${name}.png`
  a.click()
}

export async function shareLink({ url, title, toast }) {
  try {
    if (navigator.share) { await navigator.share({ url, title }); return }
    await navigator.clipboard.writeText(url)
    toast?.('ბმული დაკოპირდა')
  } catch { /* გაუქმდა */ }
}

// პროფილის / მოწვევის ბმული QR-ით
export function ShareSheet({ user, invite = false, onClose }) {
  const toast = useToast()
  const [stats, setStats] = useState(null)
  const url = `${location.origin}/${invite ? 'invite' : 'u'}/${user.username}`
  useEffect(() => { if (invite) api.inviteStats().then(setStats).catch(() => {}) }, [invite])
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast('ბმული დაკოპირდა') } catch { toast(url) } }
  return (
    <Sheet title={invite ? 'მოიწვიე მეგობრები' : 'პროფილის გაზიარება'} onClose={onClose}>
      <div className="sheet-body share-body">
        <div className="qr-card">
          <QrCode text={url} size={200} label={`QR კოდი: ${url}`} />
          <span className="qr-who"><Avatar user={user} size={28} /><b>@{user.username}</b></span>
        </div>
        {invite && (
          <p className="invite-note">
            მეგობარი რომ ბმულით დარეგისტრირდება, ერთმანეთს გამოიწერთ, შენ მიიღებ <b><CoinIcon size={14} />20</b> ბროწეულს, ისიც <b><CoinIcon size={14} />10</b>-ს.
          </p>
        )}
        <div className="link-row">
          <span className="ellipsis">{url.replace(/^https?:\/\//, '')}</span>
          <button className="btn btn-soft sm" onClick={copy}><Icon name="copy" size={15} />კოპირება</button>
        </div>
        <div className="hstack share-actions">
          <button className="btn btn-accent lg" onClick={() => shareLink({ url, title: invite ? 'შემოდი ეზოში!' : user.full_name, toast })}><Icon name="share" size={18} />გაზიარება</button>
          <button className="btn btn-outline lg" onClick={() => downloadQr(url, `ezo-${user.username}`)}><Icon name="download" size={18} />QR</button>
        </div>
        {stats && stats.count > 0 && (
          <div className="invited">
            <small>შენი მოწვევით შემოვიდა: <b>{stats.count}</b></small>
            <span className="faces">{stats.recent.slice(0, 8).map((p) => <Avatar key={p.id} user={p} size={30} />)}</span>
          </div>
        )}
      </div>
    </Sheet>
  )
}
