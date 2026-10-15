import { useEffect, useState } from 'react'
import { ConfirmSheet, Empty, Loader, PersonRow, Sheet, TopBar } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { AvatarStack, DateTile, EventCard, EventForm, eventWhen } from '../components/Community.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Link, navigate } from '../lib/router.jsx'
import { useToast } from '../components/Toast.jsx'
import { MONTHS_LONG } from '../lib/format.js'

export default function Events() {
  const [tab, setTab] = useState('upcoming')
  const [list, setList] = useState(null)
  const [creating, setCreating] = useState(false)
  const [myGroups, setMyGroups] = useState([])
  useEffect(() => { setList(null); api.events({ scope: tab }).then(setList).catch(() => setList([])) }, [tab])
  useEffect(() => { api.myGroups().then((g) => setMyGroups(g.filter((x) => x.my_status === 'active'))).catch(() => {}) }, [])

  // დაჯგუფება თვეების მიხედვით
  const byMonth = []
  for (const e of list || []) {
    const sd = new Date(e.starts_at)
    const label = `${MONTHS_LONG[sd.getMonth()]}${sd.getFullYear() !== new Date().getFullYear() ? ` ${sd.getFullYear()}` : ''}`
    if (!byMonth.length || byMonth[byMonth.length - 1].label !== label) byMonth.push({ label, items: [] })
    byMonth[byMonth.length - 1].items.push(e)
  }
  return (
    <>
      <TopBar title="ივენთები" backTo="/explore">
        <button className="icon-btn" onClick={() => setCreating(true)} aria-label="ივენთის შექმნა"><Icon name="plus" /></button>
      </TopBar>
      <div className="seg" role="tablist">
        {[['upcoming', 'მომავალი'], ['mine', 'ჩემი']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {list === null && <Loader />}
      {list?.length === 0 && (
        tab === 'mine'
          ? <Empty icon="clock" title="ჯერ არსად მიდიხარ" text="მონიშნე „მივდივარ“ ან შექმენი შენი ივენთი." action={<button className="btn btn-primary" onClick={() => setCreating(true)}>ივენთის შექმნა</button>} />
          : <Empty icon="clock" title="დაგეგმილი ივენთები არ არის" action={<button className="btn btn-primary" onClick={() => setCreating(true)}>შექმენი პირველი</button>} />
      )}
      {byMonth.map((m) => (
        <section key={m.label}>
          <div className="section-title"><h2>{m.label}</h2></div>
          {m.items.map((e) => <EventCard key={e.id} event={e} />)}
        </section>
      ))}
      {creating && <EventForm myGroups={myGroups} onClose={() => setCreating(false)} />}
    </>
  )
}

const icsDate = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsEscape = (s = '') => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`)

function downloadIcs(e) {
  const end = e.ends_at || new Date(new Date(e.starts_at).getTime() + 2 * 3600e3).toISOString()
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ezo//ka', 'BEGIN:VEVENT',
    `UID:${e.id}@ezo`, `DTSTAMP:${icsDate(new Date().toISOString())}`, `DTSTART:${icsDate(e.starts_at)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(e.title)}`, `LOCATION:${icsEscape([e.place, e.city].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${icsEscape(e.description)}`, `URL:${location.origin}/events/${e.id}`, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
  a.download = `${e.title.slice(0, 40)}.ics`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export function EventPage({ id }) {
  const { me } = useAuth()
  const toast = useToast()
  const [e, setE] = useState(undefined)
  const [people, setPeople] = useState([])
  const [sheet, setSheet] = useState(null) // 'people' | 'edit' | 'menu'
  useEffect(() => {
    api.event(id).then(setE).catch(() => setE(null))
    api.attendees(id).then(setPeople).catch(() => {})
  }, [id])

  if (e === undefined) return <><TopBar title="" backTo="/events" /><Loader /></>
  if (e === null) return <><TopBar title="ივენთი" backTo="/events" /><Empty icon="clock" title="ივენთი ვერ მოიძებნა" text="შეიძლება წაიშალა ან დახურული ჯგუფისაა." /></>

  const host = e.host_id === me?.id
  const past = new Date(e.ends_at || e.starts_at) < new Date()
  const rsvp = async (status) => {
    const next = e.my_rsvp === status ? null : status
    const prev = e
    const delta = (s) => (next === s ? 1 : 0) - (e.my_rsvp === s ? 1 : 0)
    setE((x) => ({ ...x, my_rsvp: next, going_count: x.going_count + delta('going'), interested_count: x.interested_count + delta('interested') }))
    setPeople((list) => {
      const rest = list.filter((p) => p.id !== me.id)
      return next ? [{ ...me, status: next }, ...rest] : rest
    })
    try { await api.rsvp(e.id, next) } catch (er) { setE(prev); toast(er.message, 'error') }
  }
  const going = people.filter((p) => p.status === 'going')
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.place, e.city].filter(Boolean).join(', '))}`
  const share = async () => {
    const url = `${location.origin}/events/${e.id}`
    try { if (navigator.share) await navigator.share({ url, title: e.title }); else { await navigator.clipboard.writeText(url); toast('ბმული დაკოპირდა') } } catch { /* */ }
  }

  return (
    <>
      <TopBar title="ივენთი" backTo="/events">
        <button className="icon-btn" onClick={() => (host ? setSheet('menu') : share())} aria-label={host ? 'მეტი' : 'გაზიარება'}><Icon name={host ? 'more' : 'share'} /></button>
      </TopBar>
      <div className="event-hero">
        <div className="cover" style={e.cover_url ? undefined : { background: 'linear-gradient(135deg, var(--accent), #2b0b14)' }}>{e.cover_url && <img src={e.cover_url} alt="" />}</div>
        <DateTile iso={e.starts_at} size="lg" />
      </div>
      <section className="event-head">
        <h1>{e.title}</h1>
        {past && <span className="tag-dating" style={{ marginTop: 6, display: 'inline-block', background: 'var(--bg-2)', color: 'var(--ink-2)' }}>დასრულდა</span>}
      </section>
      <div className="event-facts">
        <div><Icon name="clock" size={20} /><span>{eventWhen(e)}</span></div>
        {(e.place || e.city) && <a href={mapUrl} target="_blank" rel="noreferrer"><Icon name="pin" size={20} /><span>{[e.place, e.city].filter(Boolean).join(', ')}<br /><small className="faint">რუკაზე ნახვა</small></span></a>}
        <Link to={`/u/${e.host?.username}`}><Icon name="user" size={20} /><span>მასპინძელი: <b>{e.host?.full_name || e.host?.username}</b></span></Link>
        {e.group && <Link to={`/groups/${e.group.slug}`}><Icon name="users" size={20} /><span>ჯგუფი: <b>{e.group.name}</b></span></Link>}
      </div>
      {!past && (
        <div className="rsvp">
          <button className={`btn lg ${e.my_rsvp === 'going' ? 'btn-accent' : 'btn-outline'}`} onClick={() => rsvp('going')}>{e.my_rsvp === 'going' && <Icon name="check" size={18} />}მივდივარ</button>
          <button className={`btn lg ${e.my_rsvp === 'interested' ? 'btn-primary' : 'btn-outline'}`} onClick={() => rsvp('interested')}>{e.my_rsvp === 'interested' && <Icon name="star" size={18} />}მაინტერესებს</button>
        </div>
      )}
      <button className="person-row" style={{ width: '100%', textAlign: 'left' }} onClick={() => setSheet('people')} disabled={!people.length}>
        <AvatarStack users={going.length ? going : people} />
        <div className="who"><b>{e.going_count} მიდის</b><small>{e.interested_count} დაინტერესებული</small></div>
        {people.length > 0 && <Icon name="back" size={18} className="flip-x" />}
      </button>
      {e.description && <p className="pad pre" style={{ paddingTop: 6 }}>{e.description}</p>}
      <div className="hstack pad">
        <button className="btn btn-soft" onClick={() => downloadIcs(e)}><Icon name="clock" size={17} />კალენდარში</button>
        <button className="btn btn-soft" onClick={share}><Icon name="share" size={17} />გაზიარება</button>
      </div>

      {sheet === 'people' && (
        <Sheet title="ვინ მოდის" onClose={() => setSheet(null)}>
          <div style={{ overflowY: 'auto', paddingBottom: 12 }}>
            {people.map((p) => <PersonRow key={p.id} user={p} sub={p.status === 'going' ? 'მიდის' : 'დაინტერესებულია'} />)}
          </div>
        </Sheet>
      )}
      {sheet === 'delete' && (
        <ConfirmSheet title="ივენთის წაშლა" text="მონაწილეები ივენთს ვეღარ ნახავენ." onClose={() => setSheet(null)}
          onConfirm={async () => { await api.deleteEvent(e.id); toast('ივენთი წაიშალა'); navigate('/events', { replace: true }) }} />
      )}
      {sheet === 'edit' && <EventForm initial={e} onClose={() => setSheet(null)} onSaved={(ne) => setE((x) => ({ ...x, ...ne }))} />}
      {sheet === 'menu' && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="menu">
            <button onClick={() => setSheet('edit')}><Icon name="edit" />რედაქტირება</button>
            <button onClick={() => { setSheet(null); share() }}><Icon name="share" />გაზიარება</button>
            <button className="danger" onClick={() => setSheet('delete')}><Icon name="trash" />წაშლა</button>
          </div>
        </Sheet>
      )}
    </>
  )
}
