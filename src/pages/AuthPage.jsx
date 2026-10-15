import { useEffect, useRef, useState } from 'react'
import { Icon, Mark } from '../components/Icon.jsx'
import { api } from '../lib/api.js'
import { Link, useLocation } from '../lib/router.jsx'
import { InviteBanner } from '../components/Growth.jsx'
import { useCaptcha, CaptchaBox } from '../components/Captcha.jsx'

// სტუმრის მთავარი გვერდი: რა არის ეზო + რეგისტრაცია/შესვლა.
// დესკტოპზე ფორმა მარჯვნივ ჩანს, ტელეფონზე — ღილაკი ფორმამდე ჩამოიყვანს.
const FEATURES = [
  ['school', 'მეგობრები და კლასელები', 'იპოვე ძველი კლასელები სკოლით, ქალაქით და გამოშვების წლით. პოსტები, სთორები, ჩატი და ზარები.'],
  ['dice', 'ნარდი და კიდევ რვა თამაში', 'ნარდი და გრძელი ნარდი, ჯოკერი, ბურა, დურაკი, ჭადრაკი, შაშკი, დომინო, ლოტო — მეგობართან, კომპიუტერთან ან ტურნირში.'],
  ['bag', 'ბაზარი', 'გაყიდე და იყიდე შენს ქალაქში: ფოტოები, ფასი და პირდაპირი მიწერა გამყიდველთან.'],
  ['users', 'ჯგუფები და შეხვედრები', 'სკოლის, უბნის ან ჰობის ჯგუფი და შეხვედრები, რომლებზეც მეგობრები მოდიან.'],
  ['flame', 'გაცნობა', 'ცალკე პროფილით, 18 წლიდან და მხოლოდ მაშინ, თუ თავად ჩართავ.'],
]

const returning = () => { try { return localStorage.getItem('ezo.returning') === '1' } catch { return false } }

export default function AuthPage() {
  const { path } = useLocation()
  const [back] = useState(returning) // ამ მოწყობილობაზე უკვე შესულა — წინ „შესვლა“
  const [mode, setMode] = useState(back ? 'signin' : 'signup')
  const joinRef = useRef(null)
  const deepLink = path !== '/' && !path.startsWith('/invite/')

  const go = (m) => {
    setMode(m)
    const el = joinRef.current
    if (!el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    setTimeout(() => el.querySelector('input')?.focus({ preventScroll: true }), reduce ? 0 : 450)
  }

  return (
    <div className="landing">
      <header className="land-top">
        <Link to="/" className="land-brand" aria-label="ეზო — მთავარი"><Mark size={30} /><span>ეზო</span></Link>
        <button type="button" className="btn btn-ghost sm" onClick={() => go('signin')}>შესვლა</button>
      </header>

      <section className="land-hero">
        <h1>ძველი ეზოს სითბო, ახალ ტელეფონში</h1>
        <p className="land-lead">ეზო ქართული სოციალური ქსელია: მეგობრები და კლასელები, ნარდი და ჯოკერი ონლაინ, ბაზარი, ჯგუფები და გაცნობა — ერთ ადგილას.</p>
        {deepLink && <p className="land-deep"><Icon name="link" size={16} />ბმული, რომელიც გახსენი, ეზოშია. შედი ან დარეგისტრირდი და პირდაპირ იქ მოხვდები.</p>}
        <div className="land-cta">
          {back ? (
            <>
              <button type="button" className="btn btn-accent lg" onClick={() => go('signin')}>შესვლა</button>
              <button type="button" className="btn btn-outline lg" onClick={() => go('signup')}>ახალი ანგარიში</button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-accent lg" onClick={() => go('signup')}>ანგარიშის შექმნა</button>
              <button type="button" className="btn btn-outline lg" onClick={() => go('signin')}>შესვლა</button>
            </>
          )}
        </div>
      </section>

      <Balconies />

      <section className="land-features" aria-labelledby="land-f">
        <h2 id="land-f">რა ხდება ეზოში</h2>
        <ul>
          {FEATURES.map(([icon, title, text]) => (
            <li key={title}>
              <span className="land-ico"><Icon name={icon} size={22} /></span>
              <div><h3>{title}</h3><p>{text}</p></div>
            </li>
          ))}
        </ul>
        <p className="land-free">უფასოა. მუშაობს ბრაუზერში და ტელეფონზე დაყენებაც შეიძლება, როგორც აპლიკაცია.</p>
      </section>

      <section className="land-join" id="join" ref={joinRef} aria-labelledby="land-j">
        <h2 id="land-j">{mode === 'signup' ? 'შემოგვიერთდი' : mode === 'signin' ? 'შესვლა ეზოში' : 'პაროლის აღდგენა'}</h2>
        <AuthForm mode={mode} setMode={setMode} />
      </section>

      <footer className="land-foot">
        <Link to="/privacy">კონფიდენციალურობა</Link>
        <Link to="/terms">წესები</Link>
        <span>© {new Date().getFullYear()} ეზო</span>
      </footer>
    </div>
  )
}

// თბილისური აივნების მწკრივი — ეზოს სახე
function Balconies() {
  return (
    <div className="land-balconies" aria-hidden="true">
      <svg width="100%" height="88" preserveAspectRatio="none">
        <defs>
          <pattern id="ezo-balcony" width="64" height="88" patternUnits="userSpaceOnUse">
            <path d="M0 5h64" stroke="currentColor" strokeWidth="2.5" />
            <circle cx="0" cy="16" r="3.2" fill="currentColor" />
            <circle cx="64" cy="16" r="3.2" fill="currentColor" />
            <path d="M7 88V40a25 25 0 0 1 50 0v48" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <path d="M15 88V42a17 17 0 0 1 34 0v46" fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".55" />
            <path d="M32 44l7 9-7 9-7-9z" fill="currentColor" opacity=".22" />
            <path d="M32 25v10M27 30h10" stroke="currentColor" strokeWidth="1.4" opacity=".55" />
            <path d="M0 76h64M0 82h64" stroke="currentColor" strokeWidth="1.2" opacity=".45" />
            <path d="M15 76v6M23 76v6M41 76v6M49 76v6" stroke="currentColor" strokeWidth="1.2" opacity=".45" />
          </pattern>
        </defs>
        <rect width="100%" height="88" fill="url(#ezo-balcony)" />
      </svg>
    </div>
  )
}

function AuthForm({ mode, setMode }) {
  const captcha = useCaptcha()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  useEffect(() => { setMsg(null) }, [mode])

  const submit = async (e) => {
    e.preventDefault()
    setMsg(null)
    setBusy(true)
    try {
      const token = await captcha.get()
      if (mode === 'signup') {
        const { needsConfirm } = await api.signUp(form.email.trim(), form.password, form.name.trim(), token)
        if (needsConfirm) setMsg({ ok: true, text: `დადასტურების ბმული გამოგზავნილია ${form.email}-ზე. გახსენი წერილი და დაბრუნდი.` })
      } else if (mode === 'signin') {
        await api.signIn(form.email.trim(), form.password, token)
      } else {
        await api.resetPassword(form.email.trim(), token)
        setMsg({ ok: true, text: 'პაროლის აღდგენის ბმული გამოგზავნილია. ნახე ელფოსტა.' })
      }
    } catch (er) {
      setMsg({ ok: false, text: er.message })
    } finally {
      setBusy(false)
      captcha.reset()
    }
  }

  return (
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
      {msg && <div className={`notice${msg.ok ? '' : ' err'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <CaptchaBox captcha={captcha} />
      <button className="btn btn-accent lg block" disabled={busy}>
        {busy ? 'ერთი წამით…' : mode === 'signup' ? 'ანგარიშის შექმნა' : mode === 'signin' ? 'შესვლა' : 'ბმულის გაგზავნა'}
      </button>
      {mode === 'signin' && (
        <button type="button" className="btn btn-ghost" onClick={() => setMode('reset')}>დაგავიწყდა პაროლი?</button>
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
        <button type="button" className="btn btn-ghost" onClick={() => setMode('signin')}>შესვლაზე დაბრუნება</button>
      )}
      <p className="auth-switch">
        {mode === 'signup' ? 'უკვე გაქვს ანგარიში? ' : 'ახალი ხარ? '}
        <button type="button" onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>
          {mode === 'signup' ? 'შესვლა' : 'რეგისტრაცია'}
        </button>
      </p>
      {mode === 'signup' && <p className="auth-legal">რეგისტრაციით ეთანხმები <Link to="/terms">წესებს</Link> და <Link to="/privacy">კონფიდენციალურობის პოლიტიკას</Link>.</p>}
    </form>
  )
}
