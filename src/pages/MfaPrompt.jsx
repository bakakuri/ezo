import { useState } from 'react'
import { Icon, Mark } from '../components/Icon.jsx'
import { api } from '../lib/api.js'

// შესვლის მეორე ნაბიჯი: კოდი ავთენტიკატორის აპიდან
export default function MfaPrompt() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    if (code.length !== 6) return
    setBusy(true)
    setErr(null)
    try { await api.mfaVerifyLogin(code) } catch (er) { setErr(er.message); setCode(''); setBusy(false) }
  }
  return (
    <main className="mfa-page">
      <form className="mfa-card" onSubmit={submit}>
        <span className="mfa-emblem" aria-hidden="true">
          <Mark size={60} />
          <span className="mfa-shield"><Icon name="shield" size={17} strokeWidth={2.4} /></span>
        </span>
        <h1>შეიყვანე კოდი</h1>
        <p>გახსენი ავთენტიკატორის აპი (Google Authenticator, Microsoft Authenticator…) და ჩაწერე ეზოს 6-ციფრიანი კოდი.</p>
        <input className="input code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} autoFocus
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-label="6-ციფრიანი კოდი" placeholder="••••••" />
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn btn-accent lg block" disabled={busy || code.length !== 6}>დადასტურება</button>
        <button type="button" className="btn btn-ghost block" onClick={() => api.signOut()}>სხვა ანგარიშით შესვლა</button>
      </form>
    </main>
  )
}
