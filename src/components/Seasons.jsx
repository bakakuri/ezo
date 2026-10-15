import { useEffect, useRef, useState } from 'react'
import { Avatar, Loader, Verified } from './ui.jsx'
import { GAME_LIST, GAMES } from '../games/index.js'
import { api } from '../lib/api.js'
import { Link } from '../lib/router.jsx'

// რეიტინგი: თვიური სეზონი (ლიგებით) ან საერთო; ყველა ან მეგობრები (შენ + ვისაც გამოიწერ)

export const LEAGUES = [
  { key: 'bronze', name: 'ბრინჯაო', from: -Infinity, color: '#b4703a' },
  { key: 'silver', name: 'ვერცხლი', from: 1100, color: '#8c97a6' },
  { key: 'gold', name: 'ოქრო', from: 1300, color: '#d4a21b' },
  { key: 'platinum', name: 'პლატინა', from: 1500, color: '#2f9e96' },
  { key: 'diamond', name: 'ალმასი', from: 1700, color: '#6f5cf2' },
]
export const leagueOf = (r) => [...LEAGUES].reverse().find((l) => r >= l.from) || LEAGUES[0]
const byKey = Object.fromEntries(LEAGUES.map((l) => [l.key, l]))
const MONTH_GEN = ['იანვრის', 'თებერვლის', 'მარტის', 'აპრილის', 'მაისის', 'ივნისის', 'ივლისის', 'აგვისტოს', 'სექტემბრის', 'ოქტომბრის', 'ნოემბრის', 'დეკემბრის']
const monthOf = (season) => MONTH_GEN[Number(String(season).slice(5, 7)) - 1] || ''
const prevMonthOf = (season) => MONTH_GEN[(Number(String(season).slice(5, 7)) + 10) % 12] || ''
const ord = (n) => (n === 1 ? '1-ლი' : `მე-${n}`)

// ლიგის ფარი: ფერი + ზოლების რაოდენობა (ფერის გარეშეც გასარჩევია), სახელი ყოველთვის წერია გვერდით ან title-ში
export function LeagueBadge({ league, size = 22 }) {
  const l = byKey[league] || LEAGUES[0]
  const tier = LEAGUES.indexOf(l)
  return (
    <svg className="league-badge" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={`${l.name}ს ლიგა`}>
      <title>{l.name}</title>
      <path d="M12 2.5 20 5.6v6.1c0 4.6-3.3 8.4-8 9.8-4.7-1.4-8-5.2-8-9.8V5.6z" fill={l.color} />
      <path d="M12 2.5 20 5.6v6.1c0 4.6-3.3 8.4-8 9.8z" fill="#fff" opacity=".14" />
      {Array.from({ length: Math.min(tier, 3) }, (_, i) => (
        <path key={i} d={`M8 ${9.5 + i * 3}l4 2 4-2`} stroke="#fff" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {tier === 4 && <path d="M12 7.5l2.2 2.6L12 15.5l-2.2-5.4z" fill="#fff" />}
    </svg>
  )
}

function SeasonCard({ data, type }) {
  const days = Math.max(0, Math.ceil((Date.parse(data.ends_at) - Date.now()) / 864e5))
  const me = data.me
  const rating = me?.rating ?? data.start
  const l = leagueOf(rating)
  const next = LEAGUES[LEAGUES.indexOf(l) + 1]
  const floor = Number.isFinite(l.from) ? l.from : 900
  const pct = next ? Math.max(4, Math.min(100, Math.round(((rating - floor) / (next.from - floor)) * 100))) : 100
  return (
    <div className="season-card" style={{ '--league': l.color }}>
      <div className="season-head">
        <span className="season-name">{monthOf(data.season)} სეზონი</span>
        <span className="season-left">{days === 0 ? 'მთავრდება დღეს' : `დარჩა ${days} დღე`}</span>
      </div>
      <div className="season-me">
        <LeagueBadge league={l.key} size={46} />
        <div className="grow">
          <b>{l.name}{me ? `, ${me.rating}` : ''}</b>
          <span>{me
            ? (me.provisional ? `${me.games} თამაში — რეიტინგი 5 თამაშის შემდეგ დაზუსტდება` : `${ord(me.pos)} ადგილი${data.scope === 'friends' ? ' მეგობრებში' : ''}, ${me.games} თამაში`)
            : `${GAMES[type]?.title || ''}ში ამ თვეში ჯერ არ გითამაშია — დაიწყებ ${data.start}-ით`}</span>
        </div>
      </div>
      {next && (
        <div className="season-progress">
          <div className="bar" role="progressbar" aria-valuemin={floor} aria-valuemax={next.from} aria-valuenow={rating} aria-label={`${next.name}მდე`}><i style={{ width: `${pct}%` }} /></div>
          <small>{next.name}მდე — {next.from - rating} ქულა</small>
        </div>
      )}
    </div>
  )
}

export function RatingBoard({ me, initialType }) {
  const [type, setType] = useState(initialType && GAMES[initialType] ? initialType : 'nardi')
  const [period, setPeriod] = useState('season')
  const [scope, setScope] = useState('all')
  const [data, setData] = useState(null)

  useEffect(() => {
    let live = true
    setData(null)
    api.gameBoard(type, period, scope).then((d) => { if (live) setData(d) }).catch(() => { if (live) setData({ rows: [], champions: [] }) })
    return () => { live = false }
  }, [type, period, scope])

  // არჩეული თამაში ჩიპების ზოლში ჩანდეს (მაგ. შეტყობინებიდან ?board=chess) — მხოლოდ ჰორიზონტალურად
  const chips = useRef(null)
  useEffect(() => {
    const row = chips.current
    const on = row?.querySelector('.chip.on')
    if (row && on) row.scrollLeft = Math.max(0, on.offsetLeft - row.offsetLeft - 16)
  }, [type])

  const rows = data?.rows || []
  const meOutside = data?.me && !rows.some((r) => r.user_id === me.id)

  return (
    <section className="rboard" id="board" aria-label="რეიტინგი">
      <div className="section-title"><h2>რეიტინგი</h2></div>
      <div className="chips" ref={chips}>
        {GAME_LIST.map((g) => <button key={g.type} className={`chip${type === g.type ? ' on' : ''}`} aria-pressed={type === g.type} onClick={() => setType(g.type)}>{g.title}</button>)}
      </div>
      <div className="rboard-filters">
        <div className="mini-seg" role="group" aria-label="პერიოდი">
          <button className={period === 'season' ? 'on' : ''} aria-pressed={period === 'season'} onClick={() => setPeriod('season')}>სეზონი</button>
          <button className={period === 'all' ? 'on' : ''} aria-pressed={period === 'all'} onClick={() => setPeriod('all')}>სულ</button>
        </div>
        <div className="mini-seg" role="group" aria-label="ვინ">
          <button className={scope === 'all' ? 'on' : ''} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>ყველა</button>
          <button className={scope === 'friends' ? 'on' : ''} aria-pressed={scope === 'friends'} onClick={() => setScope('friends')}>მეგობრები</button>
        </div>
      </div>

      {data === null && <Loader />}
      {data && period === 'season' && data.season && <SeasonCard data={data} type={type} />}
      {data && rows.length === 0 && (
        <p className="pad small faint">{scope === 'friends' ? 'ვისაც გამოიწერ, ჯერ არცერთს უთამაშია' : 'ჯერ არავის უთამაშია'}{period === 'season' ? ' ამ სეზონში' : ''}. იყავი პირველი.</p>
      )}
      <div className="rboard-list">
        {rows.map((l) => <BoardRow key={l.user_id} l={l} mine={l.user_id === me.id} />)}
        {meOutside && <><div className="rboard-gap" aria-hidden="true">…</div><BoardRow l={data.me} mine /></>}
      </div>

      {data && period === 'season' && data.champions?.length > 0 && (
        <div className="champions">
          <h3>{prevMonthOf(data.season)} ჩემპიონები</h3>
          <div className="champ-row">
            {data.champions.map((c) => (
              <Link key={c.p.id} to={`/u/${c.p.username}`} className={`champ p${c.place}`}>
                <span className="champ-ava"><Avatar user={c.p} size={44} /><span className="medal" aria-label={`${ord(c.place)} ადგილი`}>{c.place}</span></span>
                <b className="ellipsis">{(c.p.full_name || c.p.username).split(' ')[0]}</b>
                <small>{c.rating}</small>
              </Link>
            ))}
          </div>
        </div>
      )}
      {period === 'season' && (
        <p className="rboard-note">სეზონი თვის ბოლოს მთავრდება. ვინც 10 თამაშს მაინც ითამაშებს: 1-ლი ადგილი — 100, მე-2 — 60, მე-3 — 30 ბროწეული, ოქროს ლიგა და ზემოთ — 15. ახალ თვეში რეიტინგი ნახევრად უბრუნდება 1200-ს.</p>
      )}
    </section>
  )
}

function BoardRow({ l, mine }) {
  return (
    <Link to={`/u/${l.p?.username}`} className={`leader${mine ? ' me' : ''}`}>
      <span className={`pos${l.pos <= 3 ? ' top' : ''}`}>{l.pos}</span>
      <Avatar user={l.p} size={38} />
      <div style={{ minWidth: 0 }}>
        <b className="leader-name"><span className="ellipsis">{l.p?.full_name || l.p?.username}</span><Verified user={l.p} size={14} /></b>
        <span className="xs faint">{l.games} თამაში, {l.wins} მოგება</span>
      </div>
      <span className="rt">
        {l.league && <LeagueBadge league={l.league} size={20} />}
        <span className={l.provisional ? 'prov' : ''} title={l.provisional ? '5 თამაშამდე რეიტინგი ზუსტი არაა' : undefined}>{l.rating}{l.provisional ? '?' : ''}</span>
      </span>
    </Link>
  )
}
