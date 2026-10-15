import { useEffect, useState } from 'react'
import { pushStatus, enablePush, disablePush } from '../lib/push.js'
import { Toggle } from '../components/ui.jsx'
import { useToast } from '../components/Toast.jsx'
import { TopBar } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { api } from '../lib/api.js'
import { Link } from '../lib/router.jsx'
import { useAuth } from '../lib/auth.jsx'
import { ShareSheet } from '../components/Share.jsx'
import { TwoFactorSheet, DeleteAccountSheet, downloadMyData } from '../components/Security.jsx'

export function applyTheme(t) {
  const root = document.documentElement
  if (t === 'system') delete root.dataset.theme
  else root.dataset.theme = t
  try { localStorage.setItem('ezo.theme', t) } catch { /* */ }
}
const readTheme = () => { try { return localStorage.getItem('ezo.theme') || 'system' } catch { return 'system' } }

export default function Settings() {
  const { me, setProfile } = useAuth()
  const [isPrivate, setIsPrivate] = useState(Boolean(me?.is_private))
  const togglePrivate = async (on) => {
    setIsPrivate(on)
    try { setProfile(await api.updateProfile({ is_private: on })); toastP(on ? 'ანგარიში დაიხურა' : 'ანგარიში ღიაა — მოლოდინში მყოფი თხოვნები დადასტურდა') } catch (e) { setIsPrivate(!on); toastP(e.message, 'error') }
  }
  const [theme, setTheme] = useState(readTheme)
  const pick = (t) => { setTheme(t); applyTheme(t) }
  const toast = useToast()
  const toastP = toast
  const [push, setPush] = useState(null)
  useEffect(() => { pushStatus().then(setPush) }, [])
  const [sheet, setSheet] = useState(null) // 'invite' | '2fa' | 'delete'
  const [mfa, setMfa] = useState(null)
  const loadMfa = () => api.mfaState().then(setMfa).catch(() => setMfa(null))
  useEffect(() => { loadMfa() }, [])
  const togglePush = async (on) => {
    try {
      const st = on ? await enablePush() : await disablePush()
      setPush(st)
      if (st === 'denied') toast('ბრაუზერში შეტყობინებები დაბლოკილია — ჩართე საიტის პარამეტრებიდან', 'error')
    } catch (e) { toast(e.message, 'error') }
  }
  const pushHint = {
    unsupported: 'ეს ბრაუზერი ვერ იღებს შეტყობინებებს. iPhone-ზე ჯერ დაამატე ეზო მთავარ ეკრანზე.',
    unconfigured: 'სერვერზე Push ჯერ არ არის ჩართული (VITE_VAPID_PUBLIC_KEY).',
    denied: 'დაბლოკილია ბრაუზერის პარამეტრებში.',
    on: 'მესიჯები, სვლის რიგი, წყვილები, მოწონებები',
    off: 'მესიჯები, სვლის რიგი, წყვილები, მოწონებები',
  }
  return (
    <>
      <TopBar title="პარამეტრები" backTo={`/u/${me?.username}`} />
      <div className="section-title"><h2>გარეგნობა</h2></div>
      <div className="chips">
        {[['system', 'როგორც ტელეფონზე', 'phone'], ['light', 'ნათელი', 'sun'], ['dark', 'მუქი', 'moon']].map(([k, l, ic]) => (
          <button key={k} className={`chip${theme === k ? ' on' : ''}`} onClick={() => pick(k)}><Icon name={ic} size={16} />{l}</button>
        ))}
      </div>
      <div className="section-title"><h2>შეტყობინებები</h2></div>
      <div className="setting-row">
        <Icon name="bell" />
        <div className="grow">შეტყობინებები ტელეფონზე<small>{push ? pushHint[push] : '…'}</small></div>
        {(push === 'on' || push === 'off') && <Toggle on={push === 'on'} onChange={togglePush} label="Push შეტყობინებები" />}
      </div>
      <div className="section-title"><h2>კონფიდენციალურობა</h2></div>
      <div className="setting-row">
        <Icon name="lock" />
        <div className="grow">დახურული ანგარიში<small>{isPrivate ? 'პოსტებს და სთორიებს მხოლოდ დადასტურებული გამომწერები ხედავენ' : 'ყველა ხედავს შენს პოსტებს და სთორიებს'}</small></div>
        <Toggle on={isPrivate} onChange={togglePrivate} label="დახურული ანგარიში" />
      </div>
      <Link to="/requests" className="setting-row"><Icon name="userPlus" /><div className="grow">გამოწერის თხოვნები<small>დადასტურება ან უარყოფა</small></div></Link>
      <Link to="/close-friends" className="setting-row"><Icon name="star" /><div className="grow">ახლო მეგობრები<small>ვინ ნახავს „ახლო მეგობრების“ სთორიებს</small></div></Link>
      <Link to="/saved" className="setting-row"><Icon name="bookmark" /><div className="grow">შენახული<small>პოსტები და კოლექციები</small></div></Link>
      <button className="setting-row invite-row" onClick={() => setSheet('invite')}><Icon name="userPlus" /><div className="grow">მოიწვიე მეგობრები<small>ბმული და QR — თითოეულზე 20 ბროწეული</small></div></button>
      <div className="section-title"><h2>უსაფრთხოება</h2></div>
      <button className="setting-row" onClick={() => mfa && setSheet('2fa')} disabled={!mfa}>
        <Icon name="shield" />
        <div className="grow">ორფაქტორიანი შესვლა<small>{mfa?.enabled ? 'ჩართულია — შესვლისას კოდი ავთენტიკატორიდან' : 'პაროლს დაემატება კოდი ავთენტიკატორის აპიდან'}</small></div>
        <span className={`state-pill${mfa?.enabled ? ' on' : ''}`}>{mfa?.enabled ? 'ჩართული' : 'გამორთული'}</span>
      </button>
      <button className="setting-row" onClick={() => downloadMyData(me.username, toast)}><Icon name="download" /><div className="grow">ჩემი მონაცემები<small>ყველაფრის ჩამოტვირთვა ერთ JSON ფაილად</small></div></button>
      <button className="setting-row danger-row" onClick={() => setSheet('delete')}><Icon name="trash" /><div className="grow">ანგარიშის წაშლა<small>სამუდამოდ, ყველა მონაცემით</small></div></button>
      <div className="section-title"><h2>ანგარიში</h2></div>
      <Link to={`/u/${me?.username}`} className="setting-row"><Icon name="user" /><div className="grow">პროფილი<small>@{me?.username}</small></div></Link>
      <Link to="/guests" className="setting-row"><Icon name="eye" /><div className="grow">სტუმრები<small>ვინ ნახა შენი პროფილი</small></div></Link>
      <Link to="/dating" className="setting-row"><Icon name="flame" /><div className="grow">გაცნობის პროფილი<small>ჩართვა, ფოტოები, ასაკი</small></div></Link>
      <Link to="/explore?tab=classmates" className="setting-row"><Icon name="school" /><div className="grow">კლასელების ძებნა</div></Link>
      {['moderator', 'admin'].includes(me?.role) && (
        <Link to="/admin" className="setting-row"><Icon name="flag" /><div className="grow">მოდერაცია<small>რეპორტები და შეზღუდვები</small></div></Link>
      )}
      <div className="hr" style={{ margin: '8px 16px' }} />
      <button className="setting-row" onClick={async () => { await disablePush().catch(() => {}); api.signOut() }} style={{ color: 'var(--accent)' }}><Icon name="logout" /><div className="grow">გამოსვლა</div></button>
      {api.demo && <p className="pad xs faint">დემო რეჟიმი: მონაცემები მხოლოდ ამ ჩანართში ცოცხლობს. Supabase-ის მისაერთებლად იხ. README.</p>}
      {sheet === 'invite' && <ShareSheet user={me} invite onClose={() => setSheet(null)} />}
      {sheet === '2fa' && mfa && <TwoFactorSheet state={mfa} onClose={() => setSheet(null)} onChange={loadMfa} />}
      {sheet === 'delete' && <DeleteAccountSheet onClose={() => setSheet(null)} />}
    </>
  )
}
