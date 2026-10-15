import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar, Sheet, TopBar, Loader, Empty } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { GAMES } from '../games/index.js'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Link, navigate } from '../lib/router.jsx'
import { whenText, untilText } from '../lib/format.js'
import { useToast } from '../components/Toast.jsx'
import { CoinIcon } from '../components/Rewards.jsx'
import { Swatch } from '../components/games/Swatch.jsx'

export const TOURNAMENT_TYPES = ['nardi', 'longnardi', 'chess', 'checkers', 'durak', 'bura', 'domino']
const CLOCKED = new Set(['chess', 'checkers'])

export function phaseOf(t, now = Date.now()) {
  if (now < Date.parse(t.starts_at)) return 'soon'
  if (now < Date.parse(t.ends_at)) return 'live'
  return 'done'
}

function useTick(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

const subtitle = (t) => `${GAMES[t.type].title}${t.tc ? `, ბლიცი ${t.tc}` : ''}`

export function TournamentCard({ t }) {
  const now = useTick(30_000)
  const ph = phaseOf(t, now)
  return (
    <Link to={`/t/${t.id}`} className={`tour-card ${ph}`}>
      <Swatch type={t.type} />
      <div style={{ minWidth: 0 }}>
        <h3>{t.title}</h3>
        <p className="tour-when">
          {ph === 'live' && <><span className="live-dot">მიმდინარეობს</span><span>დარჩა {untilText(Date.parse(t.ends_at) - now)}</span></>}
          {ph === 'soon' && <><b>{whenText(t.starts_at)}</b><span>{subtitle(t)}</span></>}
          {ph === 'done' && <span>დასრულდა, {subtitle(t)}</span>}
        </p>
      </div>
      {ph === 'done' && t.winner
        ? <span className="tour-winner" title="გამარჯვებული"><Avatar user={t.winner} size={30} /><Icon name="trophy" size={14} /></span>
        : <Icon name="back" size={18} className="flip-x" />}
    </Link>
  )
}

export default function TournamentPage({ id }) {
  const { me } = useAuth()
  const toast = useToast()
  const [t, setT] = useState(undefined)
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const now = useTick(1000)
  const load = useCallback(async () => {
    try {
      const [tt, st] = await Promise.all([api.tournament(id), api.tournamentStandings(id)])
      setT(tt); setRows(st)
    } catch { setT(null) }
  }, [id])
  useEffect(() => { load(); return api.subscribeTournament(id, load) }, [id, load])

  // დაწყების/დასრულების დამუშავება: თუ დრო მოვიდა და სერვერმა (pg_cron) ჯერ არ დაამუშავა
  const ticked = useRef('')
  useEffect(() => {
    if (!t) return
    const due = (now >= Date.parse(t.ends_at) && !t.finished_at) ? 'end' : (now >= Date.parse(t.starts_at) && !t.start_notified_at) ? 'start' : ''
    if (due && ticked.current !== due) {
      ticked.current = due
      api.tournamentTick().then(load).catch(() => {})
    }
  }, [t, now, load])

  if (t === undefined) return <><TopBar title="ტურნირი" backTo="/games" /><Loader /></>
  if (t === null) return <><TopBar title="ტურნირი" backTo="/games" /><Empty icon="trophy" title="ტურნირი ვერ მოიძებნა" /></>

  const ph = phaseOf(t, now)
  const start = Date.parse(t.starts_at)
  const end = Date.parse(t.ends_at)
  const mine = rows?.find((r) => r.user_id === me.id)
  const progress = ph === 'live' ? (now - start) / (end - start) : ph === 'done' ? 1 : 0

  const run = async (fn) => { setBusy(true); try { await fn() } catch (e) { toast(e.message, 'error') } finally { setBusy(false) } }
  const play = () => run(async () => navigate(`/g/${await api.joinRandom(t.type, { tournament: t.id })}`))

  return (
    <>
      <TopBar title="ტურნირი" backTo="/games" />
      <section className={`tour-hero ${ph}`}>
        <Swatch type={t.type} />
        <h1>{t.title}</h1>
        <p className="sub">{subtitle(t)}</p>
        {ph === 'live' && <div className="countdown" role="timer"><b>{untilText(end - now)}</b><span>დარჩა</span></div>}
        {ph === 'soon' && <div className={`countdown${start - now > 864e5 ? ' small' : ''}`}><b>{untilText(start - now)}</b><span>დაწყებამდე, {whenText(t.starts_at)}</span></div>}
        {ph === 'done' && <div className="countdown small"><b>დასრულდა</b><span>{whenText(t.ends_at)}</span></div>}
        {ph === 'live' && <div className="tour-progress" aria-hidden="true"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
        {t.description && <p className="desc">{t.description}</p>}
        <div className="prizes" aria-label="პრიზები">
          {[[1, 50], [2, 30], [3, 20]].map(([place, coins]) => (
            <span key={place} className={`prize p${place}`}><em>{place}</em><CoinIcon size={15} />{coins}</span>
          ))}
        </div>
        {ph !== 'done' && <p className="rules">მოგება 2 ქულა, ფრე 1. ზედიზედ ორი მოგების შემდეგ ქულები ორმაგდება, სანამ არ წააგებ ან ფრეს არ ითამაშებ. თამაშობ რამდენიც გინდა — ტურნირის ბოლოს იგებს ყველაზე მეტი ქულის მქონე.</p>}
        <div className="tour-actions">
          {ph !== 'done' && !mine && <button className="btn btn-accent lg" disabled={busy} onClick={() => run(async () => { await api.joinTournament(t.id); await load() })}>შეერთება</button>}
          {ph === 'live' && mine && <button className="btn btn-accent lg" disabled={busy} onClick={play}><Icon name="play" size={18} />თამაში</button>}
          {ph === 'soon' && mine && <><span className="joined"><Icon name="check" size={16} />შენ მონაწილეობ</span>{!mine.games && <button className="btn btn-ghost" disabled={busy} onClick={() => run(async () => { await api.leaveTournament(t.id); await load() })}>გასვლა</button>}</>}
        </div>
      </section>

      {ph === 'done' && rows?.length > 0 && (
        <div className="podium" aria-label="გამარჯვებულები">
          {[1, 0, 2].map((i) => rows[i] && (
            <Link key={rows[i].user_id} to={`/u/${rows[i].p?.username}`} className={`step s${i + 1}`}>
              <Avatar user={rows[i].p} size={i === 0 ? 64 : 48} />
              <b className="ellipsis">{(rows[i].p?.full_name || rows[i].p?.username || '').split(' ')[0]}</b>
              <span className="base"><em>{i + 1}</em>{rows[i].score}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="section-title"><h2>{ph === 'soon' ? 'მონაწილეები' : 'ცხრილი'}</h2>{rows?.length > 0 && <span className="small muted">{rows.length} მონაწილე</span>}</div>
      {rows === null && <Loader />}
      {rows?.length === 0 && <p className="pad small faint">{ph === 'done' ? 'ტურნირში არავინ ითამაშა.' : 'ჯერ არავინ შეერთებია. იყავი პირველი.'}</p>}
      <div style={{ paddingBottom: 24 }}>
        {rows?.map((r, i) => (
          <Link key={r.user_id} to={`/u/${r.p?.username}`} className={`leader${r.user_id === me.id ? ' me' : ''}`}>
            <span className={`pos${i < 3 && ph !== 'soon' ? ' top' : ''}`}>{ph === 'soon' ? '' : i + 1}</span>
            <Avatar user={r.p} size={38} />
            <div style={{ minWidth: 0 }}>
              <b className="ellipsis" style={{ display: 'block' }}>{r.p?.full_name || r.p?.username}{r.streak >= 2 && <Icon name="flame" size={15} className="fire" />}</b>
              <span className="xs faint">{ph === 'soon' ? 'შეუერთდა' : `${r.games} თამაში, ${r.wins} მოგება`}</span>
            </div>
            {ph !== 'soon' && <span className="rt">{r.score}</span>}
          </Link>
        ))}
      </div>
    </>
  )
}

// ტურნირის შექმნა (ადმინი/მოდერატორი; ჯგუფში — ჯგუფის ადმინი)
export function CreateTournament({ onClose, group = null }) {
  const toast = useToast()
  const pad = (n) => String(n).padStart(2, '0')
  const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  const next = new Date(Date.now() + 3600e3); next.setMinutes(0, 0, 0)
  const [f, setF] = useState({ type: 'nardi', tc: '3+2', title: '', starts: local(next), minutes: 60, description: '' })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const save = async () => {
    const starts = new Date(f.starts)
    if (f.title.trim().length < 3) { toast('სათაური მოკლეა', 'error'); return }
    setBusy(true)
    try {
      const t = await api.createTournament({
        type: f.type, tc: CLOCKED.has(f.type) ? f.tc : null, title: f.title.trim(), description: f.description.trim(),
        starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + f.minutes * 60e3).toISOString(), group_id: group?.id || null,
      })
      onClose()
      navigate(`/t/${t.id}`)
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const chip = (on, label, onClick) => <button key={label} type="button" className={`chip${on ? ' on' : ''}`} onClick={onClick}>{label}</button>
  return (
    <Sheet title={group ? `ტურნირი: ${group.name}` : 'ახალი ტურნირი'} onClose={onClose} actions={
      <button className="btn btn-primary sm" disabled={busy || f.title.trim().length < 3} onClick={save}>შექმნა</button>
    }>
      <div className="sheet-body vstack">
        <div className="field"><span>თამაში</span>
          <div className="chips inline">{TOURNAMENT_TYPES.map((x) => chip(f.type === x, GAMES[x].title, () => set('type', x)))}</div>
        </div>
        {CLOCKED.has(f.type) && (
          <div className="field"><span>დრო თითოეულს</span>
            <div className="chips inline">{['1+0', '3+0', '3+2', '5+0', '10+0'].map((x) => chip(f.tc === x, x, () => set('tc', x)))}</div>
            <span className="hint">წუთები + დამატებითი წამები ყოველ სვლაზე</span>
          </div>
        )}
        <label className="field"><span>სათაური</span>
          <input className="input" value={f.title} maxLength={80} placeholder={`მაგ. პარასკევის ${GAMES[f.type].title}`} onChange={(e) => set('title', e.target.value)} />
        </label>
        <label className="field"><span>დაწყება</span>
          <input className="input" type="datetime-local" value={f.starts} onChange={(e) => set('starts', e.target.value)} />
        </label>
        <div className="field"><span>ხანგრძლივობა</span>
          <div className="chips inline">{[30, 60, 90, 120].map((m) => chip(f.minutes === m, m === 90 ? '1,5 სთ' : m < 60 ? `${m} წთ` : `${m / 60} სთ`, () => set('minutes', m)))}</div>
        </div>
        <label className="field"><span>აღწერა</span>
          <textarea className="textarea" maxLength={500} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="პრიზი, წესები, ვისთვისაა" />
        </label>
      </div>
    </Sheet>
  )
}
