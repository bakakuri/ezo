import { useEffect, useState } from 'react'
import { Avatar, Verified } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { QuoteCard } from './PostCard.jsx'
import { GiftSheet } from './Gifts.jsx'
import { useComposer } from './Composer.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { navigate } from '../lib/router.jsx'
import { useToast } from './Toast.jsx'

// მთავარ გვერდზე: დღევანდელი დაბადების და სახელობის დღეები (ვისაც გამოვიწერ ან ვინც მე მიწერს)
// და „ამ დღეს“ — ჩემი პოსტები წინა წლებიდან. ორივე დღეში ერთხელ იტვირთება და დღით იხურება.

export const tbilisiDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi' }).format(d)
const tbilisiYear = (d) => Number(tbilisiDay(d).slice(0, 4))

export function greetingFor(kind, feast) {
  if (kind === 'birthday') return 'გილოცავ დაბადების დღეს! 🎂'
  if (feast && /ობა$/.test(feast)) return `გილოცავ ${feast}ს! 🎉`
  return 'გილოცავ სახელობის დღეს! 🎉'
}

const read = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, v) } catch { /* პირადი რეჟიმი */ } }

// დღის ქეში მოდულში: მთავარზე დაბრუნებისას ხელახლა აღარ ვითხოვთ
let cache = { day: null, celebrations: undefined, memories: undefined }
function useDaily(key, load) {
  const day = tbilisiDay()
  if (cache.day !== day) cache = { day, celebrations: undefined, memories: undefined }
  const [value, setValue] = useState(cache[key])
  useEffect(() => {
    if (cache[key] !== undefined) return
    let live = true
    load().then((v) => { cache[key] = v ?? null; if (live) setValue(cache[key]) }).catch(() => { cache[key] = null; if (live) setValue(null) })
    return () => { live = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return [value, day]
}

export function Celebrate() {
  return (
    <>
      <Celebrations />
      <Memories />
    </>
  )
}

function Celebrations() {
  const { me } = useAuth()
  const toast = useToast()
  const [data, day] = useDaily('celebrations', () => api.celebrations())
  const [hidden, setHidden] = useState(() => read('ezo.celebrate') === day)
  const [all, setAll] = useState(false)
  const [gift, setGift] = useState(null)
  const [busy, setBusy] = useState(null)
  if (!data || hidden) return null

  const rows = [
    ...(data.birthdays || []).map((p) => ({ p, kind: 'birthday', why: 'დაბადების დღე აქვს' })),
    ...(data.namedays || []).flatMap((n) => (n.people || []).map((p) => ({ p, kind: 'nameday', feast: n.feast, why: n.feast }))),
  ]
  const mine = data.mine || {}
  if (!rows.length && !mine.birthday && !mine.nameday) return null
  const shown = all ? rows : rows.slice(0, 3)
  const first = (me?.full_name || '').trim().split(/\s+/)[0] || me?.username

  const greet = async (r) => {
    setBusy(r.p.id)
    try {
      const conv = await api.openDM(r.p.id)
      navigate(`/chat/${conv}?text=${encodeURIComponent(greetingFor(r.kind, r.feast))}`)
    } catch (e) {
      toast(e.message, 'error')
      setBusy(null)
    }
  }
  const close = () => { setHidden(true); write('ezo.celebrate', day) }

  return (
    <section className="celebrate" aria-label="დღევანდელი დღესასწაულები">
      <button type="button" className="celebrate-x" onClick={close} aria-label="დღეს აღარ მაჩვენო"><Icon name="close" size={16} /></button>
      {mine.birthday && (
        <div className="celebrate-mine">
          <span className="celebrate-glyph" aria-hidden="true">🎂</span>
          <div><b>გილოცავ დაბადების დღეს, {first}!</b><p>მრავალს დაესწარი! მეგობრების მილოცვები მესიჯებში მოვა.</p></div>
        </div>
      )}
      {!mine.birthday && mine.nameday && (
        <div className="celebrate-mine">
          <span className="celebrate-glyph" aria-hidden="true">🎉</span>
          <div><b>{/ობა$/.test(mine.nameday) ? `გილოცავ ${mine.nameday}ს, ${first}!` : `დღეს შენი სახელობის დღეა, ${first}!`}</b><p>მრავალს დაესწარი!</p></div>
        </div>
      )}
      {rows.length > 0 && (
        <>
          <h2 className="celebrate-title">დღეს ზეიმობენ</h2>
          <ul className="celebrate-list">
            {shown.map((r) => (
              <li key={`${r.kind}-${r.p.id}`}>
                <span className="celebrate-ava">
                  <Avatar user={r.p} size={44} />
                  <span className="celebrate-mark" aria-hidden="true">{r.kind === 'birthday' ? '🎂' : '🎉'}</span>
                </span>
                <button type="button" className="grow celebrate-who" onClick={() => navigate(`/u/${r.p.username}`)}>
                  <b><span className="ellipsis">{r.p.full_name || r.p.username}</span><Verified user={r.p} size={14} /></b>
                  <small>{r.why}</small>
                </button>
                <button type="button" className="icon-btn sm" onClick={() => setGift(r.p)} aria-label={`საჩუქარი — ${r.p.full_name || r.p.username}`}><Icon name="gift" size={19} /></button>
                <button type="button" className="btn btn-primary sm" disabled={busy === r.p.id} onClick={() => greet(r)}>მილოცვა</button>
              </li>
            ))}
          </ul>
          {rows.length > 3 && !all && <button type="button" className="celebrate-more" onClick={() => setAll(true)}>ყველას ნახვა ({rows.length})</button>}
        </>
      )}
      {gift && <GiftSheet to={gift} onClose={() => setGift(null)} />}
    </section>
  )
}

function Memories() {
  const { compose } = useComposer()
  const [list, day] = useDaily('memories', () => api.memories())
  const [hidden, setHidden] = useState(() => read('ezo.memories') === day)
  const [i, setI] = useState(0)
  if (!list?.length || hidden) return null
  const post = list[Math.min(i, list.length - 1)]
  const years = tbilisiYear(new Date()) - tbilisiYear(new Date(post.created_at))
  const close = () => { setHidden(true); write('ezo.memories', day) }

  return (
    <section className="memory" aria-label="ამ დღეს">
      <div className="memory-head">
        <Icon name="clock" size={18} />
        <h2>{years <= 1 ? 'შარშან ამ დღეს' : `${years} წლის წინ, ამ დღეს`}</h2>
        {list.length > 1 && (
          <span className="memory-pager">
            <button type="button" className="icon-btn sm" onClick={() => setI((i + list.length - 1) % list.length)} aria-label="წინა მოგონება"><Icon name="back" size={16} /></button>
            <small aria-live="polite">{i + 1} / {list.length}</small>
            <button type="button" className="icon-btn sm flip" onClick={() => setI((i + 1) % list.length)} aria-label="შემდეგი მოგონება"><Icon name="back" size={16} /></button>
          </span>
        )}
        <button type="button" className="icon-btn sm memory-x" onClick={close} aria-label="დღეს აღარ მაჩვენო"><Icon name="close" size={16} /></button>
      </div>
      <QuoteCard post={post} />
      <div className="memory-actions">
        <button type="button" className="btn btn-outline sm" onClick={() => compose({ quote: post })}><Icon name="repost" size={16} />გაზიარება</button>
      </div>
    </section>
  )
}
