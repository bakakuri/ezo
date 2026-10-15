import { useState } from 'react'
import { Icon, Mark } from '../components/Icon.jsx'
import { api } from '../lib/api.js'
import { InviteBanner } from '../components/Growth.jsx'

export default function AuthPage() {
  const [mode, setMode] = useState('signup')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setMsg(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { needsConfirm } = await api.signUp(form.email.trim(), form.password, form.name.trim())
        if (needsConfirm) setMsg({ ok: true, text: `დადასტურების ბმული გამოგზავნილია ${form.email}-ზე. გახსენი წერილი და დაბრუნდი.` })
      } else if (mode === 'signin') {
        await api.signIn(form.email.trim(), form.password)
      } else {
        await api.resetPassword(form.email.trim())
        setMsg({ ok: true, text: 'პაროლის აღდგენის ბმული გამოგზავნილია.' })
      }
    } catch (er) {
      setMsg({ ok: false, text: er.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <section className="auth-hero">
        <div className="hstack" style={{ gap: 12 }}>
          <Mark size={48} />
          <h1>ეზო</h1>
        </div>
        <p>მეგობრები, ვიდეოები, გაცნობა და ნარდი — ერთ ეზოში.</p>
        <div className="auth-tiles" aria-hidden="true">
          <div><Icon name="home" size={26} /></div>
          <div><Icon name="reels" size={26} /></div>
          <div><Icon name="flame" size={26} /></div>
          <div><Icon name="dice" size={26} /></div>
        </div>
      </section>
      <form className="auth-form" onSubmit={submit}>
        <InviteBanner />
        {mode === 'signup' && (
          <label className="field"><span>სახელი და გვარი</span>
            <input className="input" required autoComplete="name" value={form.name} onChange={set('name')} placeholder="მაგ. ნინო ბერიძე" />
          </label>
        )}
        <label className="field"><span>ელფოსტა</span>
          <input className="input" required type="email" autoComplete="email" inputMode="email" value={form.email} onChange={set('email')} placeholder="name@mail.ge" />
        </label>
        {mode !== 'reset' && (
          <label className="field"><span>პაროლი</span>
            <input className="input" required type="password" minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={form.password} onChange={set('password')} placeholder="მინიმუმ 6 სიმბოლო" />
          </label>
        )}
        {msg && <div className={`notice${msg.ok ? '' : ' err'}`}>{msg.text}</div>}
        <button className="btn btn-accent lg block" disabled={busy}>
          {busy ? 'ერთი წამით…' : mode === 'signup' ? 'ანგარიშის შექმნა' : mode === 'signin' ? 'შესვლა' : 'ბმულის გაგზავნა'}
        </button>
        {mode === 'signin' && (
          <button type="button" className="btn btn-ghost" onClick={() => { setMode('reset'); setMsg(null) }}>დაგავიწყდა პაროლი?</button>
        )}
        {mode !== 'reset' && (
          <>
            <div className="auth-or"><span>ან</span></div>
            <button type="button" className="btn btn-outline lg block" disabled={busy} onClick={async () => {
              setMsg(null)
              try { await api.signInWithGoogle() } catch (er) { setMsg({ ok: false, text: er.message }) }
            }}>Google-ით შესვლა</button>
          </>
        )}
        {mode === 'reset' && (
          <button type="button" className="btn btn-ghost" onClick={() => { setMode('signin'); setMsg(null) }}>შესვლაზე დაბრუნება</button>
        )}
        <p className="auth-switch">
          {mode === 'signup' ? 'უკვე გაქვს ანგარიში? ' : 'ახალი ხარ? '}
          <button type="button" onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setMsg(null) }}>
            {mode === 'signup' ? 'შესვლა' : 'რეგისტრაცია'}
          </button>
        </p>
      </form>
    </main>
  )
}
