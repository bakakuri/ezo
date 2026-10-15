// ჯგუფების და ივენთების საერთო ელემენტები
import { useState } from 'react'
import { Avatar, Sheet } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { Link, navigate } from '../lib/router.jsx'
import { api } from '../lib/api.js'
import { useToast } from './Toast.jsx'
import { compressImage } from '../lib/media.js'
import { initials, count } from '../lib/format.js'

import { MONTHS_SHORT as MONTHS, MONTHS_LONG, WEEKDAYS as DAYS } from '../lib/format.js'
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export function eventWhen(e) {
  const s = new Date(e.starts_at)
  let out = `${DAYS[s.getDay()]}, ${s.getDate()} ${MONTHS_LONG[s.getMonth()]}, ${hm(s)}`
  if (e.ends_at) {
    const en = new Date(e.ends_at)
    out += s.toDateString() === en.toDateString() ? `–${hm(en)}` : ` — ${en.getDate()} ${MONTHS_LONG[en.getMonth()]}, ${hm(en)}`
  }
  return out
}

export function relDay(iso) {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / 864e5)
  if (diff === 0) return 'დღეს'
  if (diff === 1) return 'ხვალ'
  if (diff > 1 && diff < 7) return DAYS[d.getDay()]
  return null
}

export function DateTile({ iso, size = 'md' }) {
  const d = new Date(iso)
  return (
    <span className={`date-tile ${size}`} aria-label={`${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`}>
      <i>{MONTHS[d.getMonth()]}</i>
      <b>{d.getDate()}</b>
    </span>
  )
}

const TONES = ['#9e1b32', '#2c7a73', '#6b4226', '#5b3a70', '#3a5a8c', '#1f5f4a']
const tone = (id = '') => TONES[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % TONES.length]

export function GroupThumb({ group, size = 56 }) {
  return (
    <span className="group-thumb" style={{ width: size, height: size, borderRadius: size * 0.26, background: group.cover_url ? 'var(--bg-2)' : tone(group.id), fontSize: size * 0.36 }}>
      {group.cover_url ? <img src={group.cover_url} alt="" loading="lazy" /> : initials(group.name).slice(0, 2)}
    </span>
  )
}

export function GroupRow({ group, right }) {
  return (
    <div className="person-row">
      <Link to={`/groups/${group.slug}`}><GroupThumb group={group} size={52} /></Link>
      <Link to={`/groups/${group.slug}`} className="who">
        <b>{group.name}</b>
        <small>{group.privacy === 'private' ? 'დახურული' : 'საჯარო'}, {count(group.members_count) || 0} წევრი</small>
      </Link>
      {right}
    </div>
  )
}

export function EventCard({ event: e }) {
  const rel = relDay(e.starts_at)
  return (
    <Link to={`/events/${e.id}`} className="event-card">
      <DateTile iso={e.starts_at} />
      <div className="grow" style={{ minWidth: 0 }}>
        <b className="title">{e.title}</b>
        <span className="when">{rel ? `${rel}, ` : ''}{eventWhen(e).split(', ').slice(rel ? 2 : 1).join(', ')}</span>
        <span className="where">{[e.place, e.city].filter(Boolean).join(', ')}</span>
        <span className="who">
          {e.going_count > 0 && `${e.going_count} მიდის`}
          {e.my_rsvp === 'going' && <em> შენც</em>}
          {e.my_rsvp === 'interested' && <em> გაინტერესებს</em>}
        </span>
      </div>
      {e.cover_url && <img className="thumb" src={e.cover_url} alt="" loading="lazy" />}
    </Link>
  )
}

const slugify = (s) => s.toLowerCase()
  .replace(/[ა-ჰ]/g, (c) => ({ ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i', კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'zh', რ: 'r', ს: 's', ტ: 't', უ: 'u', ფ: 'p', ქ: 'k', ღ: 'gh', ყ: 'q', შ: 'sh', ჩ: 'ch', ც: 'ts', ძ: 'dz', წ: 'ts', ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h' }[c] || ''))
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

function CoverPicker({ value, onChange }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const pick = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setBusy(true)
    try { onChange(await api.upload(await compressImage(f, 1600), 'covers')) } catch (er) { toast(er.message, 'error') } finally { setBusy(false) }
  }
  return (
    <label className="cover-pick">
      {value ? <img src={value} alt="" /> : <span className="hstack muted">{busy ? <span className="spinner" /> : <Icon name="image" />}ყდის ფოტო</span>}
      <input type="file" accept="image/*" hidden onChange={pick} />
    </label>
  )
}

export function GroupForm({ initial, onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState({ name: initial?.name || '', slug: initial?.slug || '', description: initial?.description || '', privacy: initial?.privacy || 'public', cover_url: initial?.cover_url || null, touched: Boolean(initial) })
  const [busy, setBusy] = useState(false)
  const slugOk = /^[a-z0-9-]{3,40}$/.test(f.slug)
  const save = async () => {
    setBusy(true)
    try {
      if (initial) {
        const g = await api.updateGroup(initial.id, { name: f.name.trim(), description: f.description.trim(), privacy: f.privacy, cover_url: f.cover_url })
        onSaved?.(g)
        toast('შენახულია')
        onClose()
        return
      }
      if (!(await api.slugFree(f.slug))) { toast('ეს მისამართი დაკავებულია — შეცვალე', 'error'); setBusy(false); return }
      const g = await api.createGroup({ name: f.name.trim(), slug: f.slug, description: f.description.trim(), privacy: f.privacy, cover_url: f.cover_url })
      onClose()
      navigate(`/groups/${g.slug}`)
    } catch (e) { toast(e.message, 'error'); setBusy(false) }
  }
  return (
    <Sheet title={initial ? 'ჯგუფის რედაქტირება' : 'ახალი ჯგუფი'} onClose={onClose} actions={
      <button className="btn btn-primary sm" disabled={busy || f.name.trim().length < 2 || !slugOk} onClick={save}>{initial ? 'შენახვა' : 'შექმნა'}</button>
    }>
      <div className="sheet-body vstack">
        <CoverPicker value={f.cover_url} onChange={(u) => setF((x) => ({ ...x, cover_url: u }))} />
        <label className="field"><span>სახელი</span>
          <input className="input" maxLength={80} value={f.name} placeholder="მაგ. ქუთაისის მე-2 სკოლა, 2012"
            onChange={(e) => { const v = e.target.value; setF((x) => ({ ...x, name: v, slug: x.touched ? x.slug : slugify(v) })) }} />
        </label>
        {!initial && (
          <label className="field"><span>მისამართი</span>
            <input className="input" value={f.slug} autoCapitalize="none" spellCheck={false}
              onChange={(e) => setF((x) => ({ ...x, touched: true, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} />
            <span className={`hint${f.slug && !slugOk ? ' err' : ''}`}>{f.slug && !slugOk ? 'ლათინური ასოები, ციფრები და „-“ (3–40)' : `/groups/${f.slug || '…'}`}</span>
          </label>
        )}
        <label className="field"><span>აღწერა</span>
          <textarea className="textarea" maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="რას ეხება ჯგუფი, ვისთვისაა" />
        </label>
        <div className="field"><span>ხილვადობა</span>
          <div className="vstack" style={{ gap: 8 }}>
            {[['public', 'საჯარო', 'ყველა ხედავს პოსტებს და შეუძლია გაწევრიანება'], ['private', 'დახურული', 'პოსტებს ხედავენ მხოლოდ წევრები; გაწევრიანებას ადმინი ადასტურებს']].map(([k, l, d]) => (
              <label key={k} className={`choice${f.privacy === k ? ' on' : ''}`}>
                <input type="radio" name="privacy" checked={f.privacy === k} onChange={() => setF({ ...f, privacy: k })} />
                <span><b>{l}</b><small>{d}</small></span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  )
}

const pad = (n) => String(n).padStart(2, '0')
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function EventForm({ initial, group = null, myGroups = [], onClose, onSaved }) {
  const toast = useToast()
  const start = initial ? new Date(initial.starts_at) : null
  const end = initial?.ends_at ? new Date(initial.ends_at) : null
  const tomorrow = new Date(Date.now() + 864e5)
  const [f, setF] = useState({
    title: initial?.title || '', description: initial?.description || '', place: initial?.place || '', city: initial?.city || '',
    date: start ? localDate(start) : localDate(tomorrow), time: start ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : '19:00',
    endTime: end ? `${pad(end.getHours())}:${pad(end.getMinutes())}` : '', cover_url: initial?.cover_url || null,
    group_id: initial?.group_id ?? group?.id ?? null,
  })
  const [busy, setBusy] = useState(false)
  const startsAt = new Date(`${f.date}T${f.time}`)
  const endsAt = f.endTime ? new Date(`${f.date}T${f.endTime}`) : null
  const valid = f.title.trim().length >= 2 && !Number.isNaN(startsAt.getTime()) && (!endsAt || endsAt >= startsAt) && (initial || startsAt > new Date())
  const save = async () => {
    setBusy(true)
    const data = {
      title: f.title.trim(), description: f.description.trim(), place: f.place.trim(), city: f.city.trim(), cover_url: f.cover_url,
      starts_at: startsAt.toISOString(), ends_at: endsAt ? endsAt.toISOString() : null, group_id: f.group_id || null,
    }
    try {
      const e = initial ? await api.updateEvent(initial.id, data) : await api.createEvent(data)
      onSaved?.(e)
      onClose()
      if (!initial) navigate(`/events/${e.id}`)
    } catch (er) { toast(er.message, 'error'); setBusy(false) }
  }
  return (
    <Sheet title={initial ? 'ივენთის რედაქტირება' : 'ახალი ივენთი'} onClose={onClose} actions={
      <button className="btn btn-primary sm" disabled={!valid || busy} onClick={save}>{initial ? 'შენახვა' : 'შექმნა'}</button>
    }>
      <div className="sheet-body vstack">
        <CoverPicker value={f.cover_url} onChange={(u) => setF((x) => ({ ...x, cover_url: u }))} />
        <label className="field"><span>სახელი</span><input className="input" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="მაგ. კლასის შეხვედრა" /></label>
        <div className="hstack">
          <label className="field grow"><span>თარიღი</span><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label className="field" style={{ width: 110 }}><span>დაწყება</span><input className="input" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>
          <label className="field" style={{ width: 110 }}><span>დასრულება</span><input className="input" type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></label>
        </div>
        {!initial && startsAt <= new Date() && <span className="hint err xs">დრო უკვე გასულია</span>}
        <div className="hstack">
          <label className="field grow"><span>ადგილი</span><input className="input" maxLength={200} value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} placeholder="მისამართი ან დაწესებულება" /></label>
          <label className="field" style={{ width: 130 }}><span>ქალაქი</span><input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="თბილისი" /></label>
        </div>
        {!group && myGroups.length > 0 && (
          <label className="field"><span>ჯგუფი (არასავალდებულო)</span>
            <select className="select" value={f.group_id || ''} onChange={(e) => setF({ ...f, group_id: e.target.value || null })}>
              <option value="">საჯარო ივენთი</option>
              {myGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>აღწერა</span><textarea className="textarea" maxLength={3000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      </div>
    </Sheet>
  )
}

export function AvatarStack({ users, max = 5, size = 28 }) {
  return (
    <span className="avatar-stack">
      {users.slice(0, max).map((u) => <Avatar key={u.id} user={u} size={size} />)}
    </span>
  )
}
