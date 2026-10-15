import { useState } from 'react'
import { Mark } from '../components/Icon.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useToast } from '../components/Toast.jsx'

// პაროლის აღდგენის ბმულიდან შემოსული მომხმარებელი აქ აყენებს ახალ პაროლს
export default function NewPassword() {
  const { endRecovery } = useAuth()
  const toast = useToast()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const mismatch = pw2 && pw !== pw2
  const save = async (e) => {
    e.preventDefault()
    if (pw.length < 6 || pw !== pw2) return
    setBusy(true)
    setErr(null)
    try {
      await api.updatePassword(pw)
      history.replaceState({}, '', '/')
      toast('პაროლი შეიცვალა')
      endRecovery()
    } catch (er) { setErr(er.message); setBusy(false) }
  }
  return (
    <main className="auth">
      <section className="auth-hero">
        <Mark size={44} />
        <h1 style={{ fontSize: 34 }}>ახალი პაროლი</h1>
        <p>მოიფიქრე ახალი პაროლი — მინიმუმ 6 სიმბოლო.</p>
      </section>
      <form className="auth-form" onSubmit={save}>
        <label className="field"><span>ახალი პაროლი</span>
          <input className="input" type="password" autoComplete="new-password" minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className="field"><span>გაიმეორე</span>
          <input className="input" type="password" autoComplete="new-password" minLength={6} required value={pw2} onChange={(e) => setPw2(e.target.value)} />
          {mismatch && <span className="hint err">პაროლები არ ემთხვევა</span>}
        </label>
        {err && <div className="notice err">{err}</div>}
        <button className="btn btn-accent lg block" disabled={busy || pw.length < 6 || pw !== pw2}>{busy ? 'ვინახავ…' : 'პაროლის შენახვა'}</button>
      </form>
    </main>
  )
}
