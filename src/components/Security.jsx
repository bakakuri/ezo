import { useEffect, useState } from 'react'
import { Sheet } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { QrCode } from './Share.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useToast } from './Toast.jsx'

// 2FA: ჩართვა (QR + კოდი) ან გამორთვა
export function TwoFactorSheet({ state, onClose, onChange }) {
  const toast = useToast()
  const [enroll, setEnroll] = useState(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  useEffect(() => {
    if (state.enabled) return
    api.mfaEnroll().then(setEnroll).catch((e) => { toast(e.message, 'error'); onClose() })
  }, [state.enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const verify = async (e) => {
    e.preventDefault()
    setBusy(true)
    try { await api.mfaVerify(enroll.factorId, code); toast('ორფაქტორიანი შესვლა ჩაირთო'); onChange(); onClose() } catch (er) { toast(er.message, 'error'); setCode(''); setBusy(false) }
  }
  const disable = async () => {
    setBusy(true)
    try { await api.mfaDisable(state.factorId); toast('ორფაქტორიანი შესვლა გამოირთო'); onChange(); onClose() } catch (er) { toast(er.message, 'error'); setBusy(false) }
  }

  if (state.enabled) {
    return (
      <Sheet title="ორფაქტორიანი შესვლა" onClose={onClose}>
        <div className="sheet-body vstack">
          <p className="tfa-on"><Icon name="shield" size={22} />ჩართულია. ახალ მოწყობილობაზე შესვლისას პაროლის გარდა კოდიც მოგეთხოვება.</p>
          <button className="btn btn-danger lg block" disabled={busy} onClick={disable}>გამორთვა</button>
          <button className="btn btn-ghost block" onClick={onClose}>დახურვა</button>
        </div>
      </Sheet>
    )
  }
  return (
    <Sheet title="ორფაქტორიანი შესვლა" onClose={onClose}>
      <form className="sheet-body tfa" onSubmit={verify}>
        <ol className="tfa-steps">
          <li>დააყენე ავთენტიკატორის აპი: Google Authenticator, Microsoft Authenticator ან სხვა.</li>
          <li>აპში დაასკანერე ეს QR კოდი.</li>
          <li>ჩაწერე 6-ციფრიანი კოდი, რომელსაც აპი გაჩვენებს.</li>
        </ol>
        <div className="tfa-qr">
          {!enroll ? <span className="spinner" /> : enroll.qr ? <img src={enroll.qr} alt="QR კოდი ავთენტიკატორისთვის" width={200} height={200} /> : <QrCode text={enroll.uri} size={200} label="QR კოდი ავთენტიკატორისთვის" />}
        </div>
        {enroll && (
          <button type="button" className="link-btn" onClick={() => setShowSecret((v) => !v)}>{showSecret ? 'დამალე გასაღები' : 'სკანერი არ მუშაობს? ხელით ჩაწერე'}</button>
        )}
        {showSecret && enroll && <code className="tfa-secret">{enroll.secret.replace(/(.{4})/g, '$1 ').trim()}</code>}
        <input className="input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" aria-label="6-ციფრიანი კოდი" />
        <button className="btn btn-accent lg block" disabled={busy || !enroll || code.length !== 6}>ჩართვა</button>
      </form>
    </Sheet>
  )
}

// მონაცემების ჩამოტვირთვა JSON ფაილად
export async function downloadMyData(username, toast) {
  try {
    const data = await api.exportMyData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `ezo-${username}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 3000)
    toast('ფაილი ჩამოიტვირთა')
  } catch (e) { toast(e.message, 'error') }
}

// ანგარიშის სამუდამოდ წაშლა — მომხმარებლის სახელის აკრეფით
export function DeleteAccountSheet({ onClose }) {
  const { me } = useAuth()
  const toast = useToast()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const del = async () => {
    setBusy(true)
    try { await api.deleteMyAccount(); toast('ანგარიში წაიშალა. მშვიდობით!') } catch (e) { toast(e.message, 'error'); setBusy(false) }
  }
  return (
    <Sheet title="ანგარიშის წაშლა" onClose={onClose}>
      <div className="sheet-body vstack">
        <p className="danger-note"><Icon name="trash" size={20} />სამუდამოდ წაიშლება პროფილი, პოსტები, სთორიები, მესიჯები, განცხადებები, ქულები და ფოტოები. ამის დაბრუნება შეუძლებელია.</p>
        <p className="small muted">თუ გინდა, ჯერ ჩამოტვირთე შენი მონაცემები. დასადასტურებლად ჩაწერე: <b>{me.username}</b></p>
        <input className="input" value={typed} onChange={(e) => setTyped(e.target.value.trim())} placeholder={me.username} autoCapitalize="off" autoCorrect="off" aria-label="მომხმარებლის სახელი" />
        <button className="btn btn-danger lg block" disabled={busy || typed !== me.username} onClick={del}>სამუდამოდ წაშლა</button>
        <button className="btn btn-ghost block" onClick={onClose}>გაუქმება</button>
      </div>
    </Sheet>
  )
}
