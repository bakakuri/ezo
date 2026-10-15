import { useEffect, useRef, useState } from 'react'
import { Avatar, Empty, Loader, TopBar, Sheet } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { GiftSheet } from '../components/Gifts.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Link, navigate, useLocation } from '../lib/router.jsx'
import { ageFrom, isOnline, seenText, timeAgo } from '../lib/format.js'
import { compressImage } from '../lib/media.js'
import { useToast } from '../components/Toast.jsx'

const INTERESTS = ['მოგზაურობა', 'ლაშქრობა', 'ფოტო', 'მუსიკა', 'ცეკვა', 'კინო', 'წიგნები', 'სპორტი', 'ფეხბურთი', 'ღვინო', 'კულინარია', 'ხელოვნება', 'ზღვა', 'ნარდი', 'ჭადრაკი', 'ცხოველები', 'ტექნოლოგია', 'ყავა']

export default function Dating() {
  const { query } = useLocation()
  const [profile, setProfile] = useState(undefined)
  const [tab, setTab] = useState(query.get('tab') || 'discover')
  const [edit, setEdit] = useState(false)

  useEffect(() => { api.datingProfile().then(setProfile).catch(() => setProfile(null)) }, [])

  if (profile === undefined) return <><TopBar title="გაცნობა" backTo="/" /><Loader /></>
  if (!profile || edit) {
    return <DatingSetup initial={profile} onDone={(p) => { setProfile(p); setEdit(false) }} onCancel={profile ? () => setEdit(false) : null} />
  }
  return (
    <>
      <TopBar title="გაცნობა" backTo="/">
        <button className="icon-btn" onClick={() => setEdit(true)} aria-label="გაცნობის პროფილი"><Icon name="settings" /></button>
      </TopBar>
      <div className="seg" role="tablist">
        {[['discover', 'აღმოჩენა'], ['nearby', 'ახლოს'], ['matches', 'წყვილები']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'discover' && <Discover />}
      {tab === 'nearby' && <Nearby city={profile.city} />}
      {tab === 'matches' && <Matches />}
    </>
  )
}

function Discover() {
  const [cards, setCards] = useState(null)
  const [match, setMatch] = useState(null)
  const [gift, setGift] = useState(null)
  const toast = useToast()
  useEffect(() => { api.candidates().then(setCards).catch(() => setCards([])) }, [])

  const decide = async (card, liked) => {
    setCards((c) => c.filter((x) => x.id !== card.id))
    try {
      const r = await api.swipe(card.id, liked)
      if (r.match) setMatch({ card, conv: r.match.conversation_id })
    } catch (e) { toast(e.message, 'error') }
  }

  if (cards === null) return <Loader />
  const top = cards[0]
  return (
    <div className="dating-wrap">
      <div className="deck">
        {cards.length === 0 && (
          <Empty icon="flame" title="ახლა ახალი პროფილები აღარ არის" text="შეამოწმე მოგვიანებით, ან გააფართოვე ასაკის დიაპაზონი პარამეტრებში." action={<button className="btn btn-outline" onClick={() => { setCards(null); api.candidates().then(setCards) }}>განახლება</button>} />
        )}
        {cards.slice(0, 3).reverse().map((c) => (
          <SwipeCard key={c.id} card={c} active={c.id === top?.id} onDecide={(liked) => decide(c, liked)} />
        ))}
      </div>
      {top && (
        <div className="swipe-actions">
          <button className="nope" onClick={() => decide(top, false)} aria-label="გამოტოვება"><Icon name="close" size={30} strokeWidth={2.6} /></button>
          <button className="like" onClick={() => decide(top, true)} aria-label="მოწონება"><Icon name="heart" size={34} fill /></button>
          <button className="gift" onClick={() => setGift(top)} aria-label="საჩუქარი"><Icon name="gift" size={22} /></button>
        </div>
      )}
      {gift && <GiftSheet to={gift} onClose={() => { setGift(null) }} />}
      {match && <MatchOverlay match={match} onClose={() => setMatch(null)} />}
    </div>
  )
}

function SwipeCard({ card, active, onDecide }) {
  const el = useRef(null)
  const start = useRef(null)
  const [photo, setPhoto] = useState(0)
  const [drag, setDrag] = useState({ x: 0, y: 0, on: false })
  const [gone, setGone] = useState(0)
  const photos = card.photos?.length ? card.photos : [card.avatar_url].filter(Boolean)

  const down = (e) => {
    if (!active) return
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() }
    el.current.setPointerCapture(e.pointerId)
    setDrag({ x: 0, y: 0, on: true })
  }
  const move = (e) => {
    if (!start.current) return
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y, on: true })
  }
  const up = (e) => {
    if (!start.current) return
    const dx = e.clientX - start.current.x
    const dy = e.clientY - start.current.y
    const quick = Date.now() - start.current.t < 250 && Math.abs(dx) < 8 && Math.abs(dy) < 8
    start.current = null
    if (quick) {
      const r = el.current.getBoundingClientRect()
      const right = e.clientX - r.left > r.width / 2
      setPhoto((p) => Math.max(0, Math.min(photos.length - 1, p + (right ? 1 : -1))))
      setDrag({ x: 0, y: 0, on: false })
      return
    }
    if (Math.abs(dx) > 110) {
      setGone(dx > 0 ? 1 : -1)
      setTimeout(() => onDecide(dx > 0), 220)
    } else setDrag({ x: 0, y: 0, on: false })
  }

  const x = gone ? gone * 700 : drag.x
  const rot = x / 18
  const style = {
    transform: `translate(${x}px, ${gone ? drag.y : drag.y * 0.3}px) rotate(${rot}deg)${active ? '' : ' scale(0.96) translateY(10px)'}`,
    transition: drag.on && !gone ? 'none' : 'transform 0.28s cubic-bezier(.2,.8,.3,1)',
  }
  return (
    <div className="swipe-card" ref={el} style={style} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      aria-label={`${card.full_name}, ${card.age}`}>
      {photos[photo] ? <img src={photos[photo]} alt="" draggable={false} /> : <div className="center" style={{ height: '100%' }}><Avatar user={card} size={120} /></div>}
      {photos.length > 1 && <div className="photo-bars">{photos.map((_, i) => <i key={i} className={i === photo ? 'on' : ''} />)}</div>}
      <span className="stamp like" style={{ opacity: Math.max(0, Math.min(1, x / 100)) }}>მომწონს</span>
      <span className="stamp nope" style={{ opacity: Math.max(0, Math.min(1, -x / 100)) }}>შემდეგი</span>
      <div className="info">
        <h2>{card.full_name?.split(' ')[0] || card.username}<span>{card.age}</span></h2>
        <div className="meta">
          {isOnline(card.last_seen) && <><i style={{ width: 8, height: 8, borderRadius: 4, background: '#3ddc84', display: 'inline-block' }} />ონლაინ  </>}
          {card.city && <><Icon name="pin" size={14} />{card.city}</>}
        </div>
        {card.bio && <p className="bio">{card.bio}</p>}
        {card.interests?.length > 0 && <div className="tags">{card.interests.slice(0, 5).map((t) => <span key={t}>{t}</span>)}</div>}
      </div>
    </div>
  )
}

function MatchOverlay({ match, onClose }) {
  const { me } = useAuth()
  return (
    <div className="match-overlay" role="dialog" aria-label="წყვილი">
      <div className="match-avatars"><Avatar user={me} size={110} /><Avatar user={match.card} size={110} /></div>
      <h2>წყვილი ხართ!</h2>
      <p style={{ opacity: 0.85 }}>შენ და {match.card.full_name?.split(' ')[0]} ერთმანეთი მოიწონეთ.</p>
      <button className="btn lg" style={{ background: '#fff', color: '#12020a', minWidth: 240 }} onClick={() => navigate(`/chat/${match.conv}`)}>მიწერე</button>
      <button className="btn lg" style={{ color: '#fff' }} onClick={onClose}>ძებნის გაგრძელება</button>
    </div>
  )
}

function Nearby({ city }) {
  const [list, setList] = useState(null)
  useEffect(() => { api.nearby().then(setList).catch(() => setList([])) }, [])
  if (list === null) return <Loader />
  return (
    <>
      <p className="pad small muted" style={{ paddingBottom: 0 }}>{city ? `${city} — ბოლოს აქტიურები პირველები` : 'მიუთითე ქალაქი გაცნობის პროფილში'}</p>
      {list.length === 0 && <Empty icon="pin" title="ახლოს ჯერ არავინაა" text="როცა შენს ქალაქში ვინმე გაცნობას ჩართავს, აქ გამოჩნდება." />}
      <div className="nearby-grid">
        {list.map((c) => (
          <Link key={c.id} to={`/u/${c.username}`} className="nearby-card">
            {c.photos?.[0] ? <img src={c.photos[0]} alt="" loading="lazy" /> : <div className="center" style={{ height: '100%' }}><Avatar user={c} size={80} /></div>}
            {isOnline(c.last_seen) && <span className="live" aria-label="ონლაინ" />}
            <div className="cap">{c.full_name?.split(' ')[0]}, {c.age}<small>{isOnline(c.last_seen) ? 'ახლა აქაა' : seenText(c.last_seen)}</small></div>
          </Link>
        ))}
      </div>
    </>
  )
}

function Matches() {
  const [list, setList] = useState(null)
  useEffect(() => { api.matches().then(setList).catch(() => setList([])) }, [])
  if (list === null) return <Loader />
  if (!list.length) return <Empty icon="heart" title="წყვილები ჯერ არ გაქვს" text="როცა ვინმე, ვინც მოიწონე, შენც მოგიწონებს, აქ გამოჩნდება." />
  return (
    <>
      <div className="chips" style={{ padding: '14px 16px', gap: 14 }}>
        {list.map((m) => (
          <Link key={m.id} to={`/chat/${m.conversation_id}`} className="vstack" style={{ alignItems: 'center', gap: 6, width: 76 }}>
            <span className="story-ring"><span className="inner"><Avatar user={m.other} size={62} /></span></span>
            <span className="xs ellipsis" style={{ maxWidth: 76 }}>{m.other?.full_name?.split(' ')[0]}</span>
          </Link>
        ))}
      </div>
      <div className="hr" />
      {list.map((m) => (
        <Link key={m.id} to={`/chat/${m.conversation_id}`} className="inbox-row">
          <Avatar user={m.other} size={54} online />
          <div className="who"><div className="top"><b>{m.other?.full_name}</b><time>{timeAgo(m.created_at)}</time></div><div className="last">მიწერე პირველმა</div></div>
        </Link>
      ))}
    </>
  )
}

function DatingSetup({ initial, onDone, onCancel }) {
  const { me } = useAuth()
  const toast = useToast()
  const [f, setF] = useState({
    birth_date: initial?.birth_date || '', gender: initial?.gender || '', looking_for: initial?.looking_for || 'everyone',
    city: initial?.city || me?.city || '', bio: initial?.bio || '', interests: initial?.interests || [], photos: initial?.photos || [],
    age_min: initial?.age_min || 18, age_max: initial?.age_max || 45, enabled: initial?.enabled ?? true,
  })
  const [adult, setAdult] = useState(Boolean(initial))
  const [busy, setBusy] = useState(false)
  const [rules, setRules] = useState(false)
  const age = f.birth_date ? ageFrom(f.birth_date) : null
  const ok = adult && age >= 18 && f.gender && f.city.trim() && f.photos.length > 0

  const addPhoto = async (e) => {
    const files = [...(e.target.files || [])].slice(0, 4 - f.photos.length)
    e.target.value = ''
    setBusy(true)
    try {
      const urls = []
      for (const file of files) urls.push(await api.upload(await compressImage(file, 1440), 'dating'))
      setF((x) => ({ ...x, photos: [...x.photos, ...urls] }))
    } catch (er) { toast(er.message, 'error') } finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true)
    try {
      const p = await api.saveDatingProfile({ ...f, city: f.city.trim(), bio: f.bio.trim(), age_min: Number(f.age_min), age_max: Number(f.age_max) })
      onDone(p)
    } catch (e) { toast(e.message, 'error'); setBusy(false) }
  }
  const toggleInterest = (t) => setF((x) => ({ ...x, interests: x.interests.includes(t) ? x.interests.filter((y) => y !== t) : [...x.interests, t].slice(0, 6) }))

  return (
    <>
      <TopBar title={initial ? 'გაცნობის პროფილი' : 'გაცნობა'} backTo="/">
        {onCancel && <button className="btn btn-ghost sm" onClick={onCancel}>გაუქმება</button>}
      </TopBar>
      <div className="pad vstack" style={{ gap: 16 }}>
        {!initial && (
          <div className="vstack" style={{ gap: 6 }}>
            <h2 className="display" style={{ fontSize: 'var(--t-2xl)' }}>ცალკე სივრცე გაცნობისთვის</h2>
            <p className="muted">გაცნობის პროფილი შენს მთავარ პროფილზე არ ჩანს. ჩართე ან გამორთე ნებისმიერ დროს. მხოლოდ 18 წლიდან.</p>
          </div>
        )}
        <div>
          <span className="small muted">ფოტოები (1–4)</span>
          <div className="thumbs" style={{ marginTop: 8 }}>
            {f.photos.map((u, i) => (
              <div className="t" key={u}><img src={u} alt="" /><button aria-label="წაშლა" onClick={() => setF((x) => ({ ...x, photos: x.photos.filter((_, j) => j !== i) }))}><Icon name="close" size={14} /></button></div>
            ))}
            {f.photos.length < 4 && (
              <label className="t center" style={{ border: '1.5px dashed var(--line)', cursor: 'pointer' }}>
                {busy ? <div className="spinner" /> : <Icon name="plus" size={28} />}
                <input type="file" accept="image/*" multiple hidden onChange={addPhoto} />
              </label>
            )}
          </div>
        </div>
        <label className="field"><span>დაბადების თარიღი</span>
          <input className="input" type="date" value={f.birth_date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, birth_date: e.target.value })} />
          {age !== null && age < 18 && <span className="hint err">გაცნობის რეჟიმი მხოლოდ 18 წლიდანაა.</span>}
        </label>
        <div className="field"><span>მე ვარ</span>
          <div className="hstack">{[['woman', 'ქალი'], ['man', 'კაცი']].map(([k, l]) => <button key={k} className={`chip${f.gender === k ? ' on' : ''}`} onClick={() => setF({ ...f, gender: k })}>{l}</button>)}</div>
        </div>
        <div className="field"><span>მაინტერესებს</span>
          <div className="hstack">{[['woman', 'ქალები'], ['man', 'კაცები'], ['everyone', 'ყველა']].map(([k, l]) => <button key={k} className={`chip${f.looking_for === k ? ' on' : ''}`} onClick={() => setF({ ...f, looking_for: k })}>{l}</button>)}</div>
        </div>
        <div className="field"><span>ასაკი: {f.age_min}–{f.age_max}</span>
          <div className="hstack">
            <input className="input" type="number" min={18} max={99} value={f.age_min} onChange={(e) => setF({ ...f, age_min: Math.max(18, Number(e.target.value) || 18) })} aria-label="მინიმალური ასაკი" />
            <input className="input" type="number" min={18} max={99} value={f.age_max} onChange={(e) => setF({ ...f, age_max: Number(e.target.value) || 99 })} aria-label="მაქსიმალური ასაკი" />
          </div>
        </div>
        <label className="field"><span>ქალაქი</span><input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="თბილისი" /></label>
        <label className="field"><span>შენზე</span><textarea className="textarea" maxLength={500} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} placeholder="რა გიყვარს, რას ეძებ…" /></label>
        <div className="field"><span>ინტერესები (6-მდე)</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{INTERESTS.map((t) => <button key={t} className={`chip${f.interests.includes(t) ? ' on' : ''}`} onClick={() => toggleInterest(t)}>{t}</button>)}</div>
        </div>
        {initial && (
          <label className="setting-row" style={{ padding: '6px 0' }}>
            <div className="grow"><b>გაცნობა ჩართულია</b><small>გამორთვისას შენი ბარათი სხვებს აღარ უჩანს</small></div>
            <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} style={{ width: 22, height: 22, accentColor: 'var(--accent)' }} />
          </label>
        )}
        {!initial && (
          <label className="hstack small" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--accent)', marginTop: 2 }} />
            <span>ვადასტურებ, რომ 18 წლის ან უფროსი ვარ და ვეთანხმები <button className="tag" style={{ color: 'var(--accent)' }} onClick={(e) => { e.preventDefault(); setRules(true) }}>უსაფრთხოების წესებს</button>.</span>
          </label>
        )}
        <button className="btn btn-accent lg block" disabled={!ok || busy} onClick={save}>{initial ? 'შენახვა' : 'გაცნობის ჩართვა'}</button>
      </div>
      {rules && (
        <Sheet title="უსაფრთხოების წესები" onClose={() => setRules(false)}>
          <div className="sheet-body vstack small">
            <p>პირველი შეხვედრა დანიშნე საჯარო ადგილას და ახლობელს უთხარი, სად მიდიხარ.</p>
            <p>ნუ გაუგზავნი ფულს ან პირად დოკუმენტებს ადამიანს, ვისაც პირადად არ იცნობ.</p>
            <p>უხეში ან საეჭვო პროფილი დაბლოკე და დაარეპორტე — პროფილის მენიუდან.</p>
            <p>18 წლამდე პირებს გაცნობის რეჟიმი არ ეხსნებათ. ასაკის შეცდომით მითითება ანგარიშის დაბლოკვის საფუძველია.</p>
          </div>
        </Sheet>
      )}
    </>
  )
}
