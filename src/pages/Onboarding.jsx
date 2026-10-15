import { useEffect, useState } from 'react'
import { Avatar } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { USERNAME_RE } from '../lib/format.js'
import { compressImage } from '../lib/media.js'

const slug = (s) => s.toLowerCase()
  .replace(/[ა-ჰ]/g, (c) => ({ ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i', კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'zh', რ: 'r', ს: 's', ტ: 't', უ: 'u', ფ: 'p', ქ: 'k', ღ: 'gh', ყ: 'q', შ: 'sh', ჩ: 'ch', ც: 'ts', ძ: 'dz', წ: 'ts', ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h' }[c] || ''))
  .replace(/[^a-z0-9_.]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 20)

export default function Onboarding() {
  const { me, setProfile } = useAuth()
  const [step, setStep] = useState(0)
  const [f, setF] = useState({
    full_name: me?.full_name || '',
    username: me?.username?.startsWith('u') && me.username.length === 11 ? slug(me?.full_name || '') : me?.username || '',
    avatar_url: me?.avatar_url || null,
    city: me?.city || '', school: me?.school || '', grad_year: me?.grad_year || '', bio: me?.bio || '',
  })
  const [nameState, setNameState] = useState(null) // null | 'checking' | 'ok' | 'taken' | 'bad'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  useEffect(() => {
    const u = f.username
    if (!u) { setNameState(null); return }
    if (!USERNAME_RE.test(u)) { setNameState('bad'); return }
    setNameState('checking')
    const t = setTimeout(() => api.usernameFree(u).then((free) => setNameState(free ? 'ok' : 'taken')), 350)
    return () => clearTimeout(t)
  }, [f.username])

  const pickAvatar = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const url = await api.upload(await compressImage(file, 600), 'avatars')
      setF((x) => ({ ...x, avatar_url: url }))
    } catch (er) { setErr(er.message) } finally { setBusy(false) }
  }

  const finish = async () => {
    setBusy(true)
    setErr(null)
    try {
      const p = await api.updateProfile({
        full_name: f.full_name.trim(), username: f.username, avatar_url: f.avatar_url, bio: f.bio.trim(),
        city: f.city.trim(), school: f.school.trim(), grad_year: f.grad_year ? Number(f.grad_year) : null, onboarded: true,
      })
      setProfile(p)
    } catch (er) { setErr(er.message); setBusy(false) }
  }

  const step1ok = f.full_name.trim().length >= 2 && nameState === 'ok'
  return (
    <main className="auth">
      <section className="auth-hero" style={{ justifyContent: 'flex-start', paddingTop: 28 }}>
        <div className="steps"><i className="on" /><i className={step >= 1 ? 'on' : ''} /></div>
        {step === 0 ? (
          <>
            <h1 style={{ fontSize: 34 }}>მოგესალმები ეზოში</h1>
            <p>როგორ გიცნობენ?</p>
            <div className="avatar-picker">
              <label>
                <Avatar user={{ ...me, full_name: f.full_name, avatar_url: f.avatar_url }} size={84} />
                <input type="file" accept="image/*" hidden onChange={pickAvatar} />
              </label>
              <label className="btn btn-soft"><Icon name="camera" size={18} />{f.avatar_url ? 'შეცვლა' : 'ფოტოს დამატება'}
                <input type="file" accept="image/*" hidden onChange={pickAvatar} />
              </label>
            </div>
            <label className="field"><span>სახელი და გვარი</span>
              <input className="input" value={f.full_name} onChange={(e) => {
                const v = e.target.value
                setF((x) => ({ ...x, full_name: v, username: x.usernameTouched ? x.username : slug(v) }))
              }} placeholder="ნინო ბერიძე" />
            </label>
            <label className="field"><span>მომხმარებლის სახელი</span>
              <input className="input" value={f.username} autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onChange={(e) => setF((x) => ({ ...x, usernameTouched: true, username: e.target.value.toLowerCase().trim() }))} placeholder="nino.b" />
              <span className={`hint${nameState === 'taken' || nameState === 'bad' ? ' err' : ''}`}>
                {nameState === 'bad' && 'მხოლოდ ლათინური ასოები, ციფრები, _ და . (3–24)'}
                {nameState === 'taken' && 'დაკავებულია — სცადე სხვა'}
                {nameState === 'ok' && `@${f.username} თავისუფალია`}
                {nameState === 'checking' && 'ვამოწმებ…'}
              </span>
            </label>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 34 }}>ვინ არიან შენი კლასელები?</h1>
            <p>სკოლა და ქალაქი გეხმარება ძველი მეგობრების პოვნაში. შეგიძლია გამოტოვო.</p>
            <label className="field"><span>ქალაქი</span><input className="input" value={f.city} onChange={set('city')} placeholder="თბილისი" /></label>
            <label className="field"><span>სკოლა</span><input className="input" value={f.school} onChange={set('school')} placeholder="მაგ. ქუთაისის მე-2 საჯარო სკოლა" /></label>
            <label className="field"><span>დამთავრების წელი</span><input className="input" inputMode="numeric" maxLength={4} value={f.grad_year} onChange={set('grad_year')} placeholder="2012" /></label>
            <label className="field"><span>ორიოდე სიტყვა შენზე</span><textarea className="textarea" maxLength={300} value={f.bio} onChange={set('bio')} placeholder="რა გიყვარს, რას აკეთებ…" /></label>
          </>
        )}
      </section>
      <div className="auth-form">
        {err && <div className="notice err">{err}</div>}
        {step === 0
          ? <button className="btn btn-accent lg block" disabled={!step1ok || busy} onClick={() => setStep(1)}>გაგრძელება</button>
          : (
            <>
              <button className="btn btn-accent lg block" disabled={busy} onClick={finish}>{busy ? 'ვინახავ…' : 'ეზოში შესვლა'}</button>
              <button className="btn btn-ghost" onClick={() => setStep(0)}>უკან</button>
            </>
          )}
      </div>
    </main>
  )
}
