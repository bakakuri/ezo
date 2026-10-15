import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar, Empty, Loader, TopBar } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { shareLink } from '../components/Share.jsx'
import { useToast } from '../components/Toast.jsx'
import { BOARDS } from './GameRoom.jsx'
import { GAMES, RESULT_TEXT } from '../games/index.js'
import { describeFrames } from '../games/notation.js'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Link, useLocation } from '../lib/router.jsx'
import { timeAgo } from '../lib/format.js'

// პარტიის ჩანაწერი: სვლა-სვლით გადახვევა, ავტომატური დაკვრა, კონკრეტულ სვლაზე გაზიარება (?n=12)
const SPEED = { nardi: 1300, longnardi: 1300, gomoku: 650, domino: 1100 }
const nameOf = (p) => (p?.full_name || p?.username || 'მოთამაშე').split(' ')[0]
const noop = () => {}
// ფიგურის სიმბოლო ტექსტში ცოტა დიდი, რომ კარგად ჩანდეს
const withFigures = (t) => t.split(/([♚♛♜♝♞])/).map((x, i) => (i % 2 ? <span key={i} className="fig">{x}</span> : x))

export default function Replay({ id }) {
  const { me } = useAuth()
  const toast = useToast()
  const { query } = useLocation()
  const [data, setData] = useState(undefined)
  const [k, setK] = useState(0)
  const [playing, setPlaying] = useState(false)
  const strip = useRef(null)
  const nav = useRef({})

  useEffect(() => {
    let alive = true
    api.replay(id).then((d) => {
      if (!alive) return
      setData(d || null)
      const n = Number(query.get('n'))
      if (d?.moves?.length && Number.isInteger(n) && n > 0) setK(Math.min(n, d.moves.length - 1))
    }).catch(() => alive && setData(null))
    return () => { alive = false }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const states = useMemo(() => (data?.moves || []).map((m) => m.state), [data])
  const frames = useMemo(() => (data ? describeFrames(data.game.type, states) : []), [data, states])
  const lastK = Math.max(0, states.length - 1)

  // ავტომატური დაკვრა; ბოლოს ჩერდება
  useEffect(() => {
    if (!playing) return
    if (k >= lastK) { setPlaying(false); return }
    const t = setTimeout(() => setK((x) => Math.min(x + 1, lastK)), SPEED[data?.game.type] || 900)
    return () => clearTimeout(t)
  }, [playing, k, lastK, data])

  // კლავიატურა: ← → სვლა, Home/End, Space — დაკვრა/პაუზა
  useEffect(() => {
    const h = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      const { k: cur, last, toggle } = nav.current
      if (last === undefined) return
      const to = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: last }[e.key]
      if (to !== undefined) {
        e.preventDefault()
        setPlaying(false)
        setK(Math.max(0, Math.min(last, to)))
      } else if (e.key === ' ' && !e.target.closest?.('button, a')) {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // მიმდინარე სვლა ზოლის შუაში (გვერდი არ იძვრის)
  useEffect(() => {
    const box = strip.current
    const el = box?.querySelector('[aria-current="step"]')
    if (!box) return
    if (!el) { box.scrollTo({ left: 0 }); return }
    const left = el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2
    // შორს გადახტომისას (Home/End, ზოლი) — მაშინვე, ახლოს — რბილად
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    box.scrollTo({ left, behavior: calm || Math.abs(left - box.scrollLeft) > box.clientWidth * 2 ? 'auto' : 'smooth' })
  }, [k, frames])

  if (data === undefined) return <><TopBar title="პარტიის ჩანაწერი" backTo="/games" /><Loader /></>
  if (data === null) {
    return <><TopBar title="პარტიის ჩანაწერი" backTo="/games" /><Empty icon="dice" title="პარტია ვერ მოიძებნა" text="შეიძლება წაიშალა ან ბმული არასწორია." action={<Link className="btn btn-accent" to="/games">თამაშები</Link>} /></>
  }

  const g = data.game
  const type = g.type
  const Board = BOARDS[type]
  if (!states.length || !Board) {
    return (
      <>
        <TopBar title="პარტიის ჩანაწერი" backTo="/games" />
        <Empty icon="clock" title="ამ პარტიის ჩანაწერი არ შენახულა"
          text="სვლები ინახება ჭადრაკში, შაშკში, ნარდში, დომინოსა და ხუთ რიგში — 90 დღის განმავლობაში."
          action={<Link className="btn btn-accent" to="/games">თამაშები</Link>} />
      </>
    )
  }

  const mySeat = ['a', 'b'].find((s) => g[`player_${s}`] === me?.id) || null
  const top = mySeat === 'b' ? 'a' : 'b'
  const bottom = top === 'a' ? 'b' : 'a'
  const state = states[k]
  const frame = k > 0 ? frames[k - 1] : null
  const finished = g.status === 'finished'
  const atEnd = k === lastK
  const winnerSeat = g.winner ? ['a', 'b'].find((s) => g[`player_${s}`] === g.winner) : null
  const toMove = atEnd && finished ? null : GAMES[type].seatOf(state)
  const colored = !['domino'].includes(type)
  const seatColor = (seat) => (type === 'gomoku' ? (seat === 'a' ? 'b' : 'w') : seat === 'a' ? 'w' : 'b')

  const endText = () => {
    if (!finished) return 'პარტია ჯერ მიმდინარეობს'
    const reason = g.result === 'resign' && winnerSeat ? `${nameOf(g[winnerSeat === 'a' ? 'b' : 'a'])} დანებდა` : RESULT_TEXT[g.result] || ''
    if (!winnerSeat) return reason || 'ფრე'
    return `${winnerSeat === mySeat ? 'შენ მოიგე' : `${nameOf(g[winnerSeat])} მოიგო`}${reason ? ` — ${reason}` : ''}`
  }
  const statusText = k === 0 ? 'საწყისი პოზიცია' : `${frame?.no ? `${frame.no}. ` : ''}${nameOf(g[frame?.seat])}${frame?.text ? `: ${frame.text}` : ''}`

  const go = (n) => { setPlaying(false); setK(Math.max(0, Math.min(lastK, n))) }
  const toggle = () => {
    if (playing) { setPlaying(false); return }
    if (atEnd) setK(0)
    setPlaying(true)
  }
  nav.current = { k, last: lastK, toggle }
  const share = () => shareLink({
    url: `${location.origin}/g/${g.id}/replay${k ? `?n=${k}` : ''}`,
    title: `${GAMES[type].title}: ${nameOf(g.a)} და ${nameOf(g.b)}`,
    toast,
  })

  const P = ({ seat, right }) => (
    <div className={`player${toMove === seat ? ' turn' : ''}${right ? ' right' : ''}`}>
      <Avatar user={g[seat]} size={36} />
      <div className="nm">
        <b>{g[seat]?.full_name || g[seat]?.username || 'მოთამაშე'}</b>
        <small>{colored && <span className={`seat-dot ${seatColor(seat)}`} />}{atEnd && finished && winnerSeat === seat ? <span className="rp-won"><Icon name="trophy" size={12} />მოიგო</span> : seat === mySeat ? 'შენ' : ''}</small>
      </div>
    </div>
  )

  const chess = type === 'chess' || type === 'chess960'
  const dice = type === 'nardi' || type === 'longnardi'
  return (
    <div className={`game-room g-${type} replay`}>
      <TopBar title="პარტიის ჩანაწერი" backTo="/games">
        <button className="icon-btn" onClick={share} aria-label="ჩანაწერის გაზიარება"><Icon name="share" /></button>
      </TopBar>
      {!finished && <Link to={`/g/${g.id}`} className="watch-banner rp-live"><Icon name="eye" size={16} />პარტია ჯერ მიმდინარეობს — ცოცხლად ყურება</Link>}
      <div className="players"><P seat={top} /><span className="vs">vs</span><P seat={bottom} right /></div>
      <div className="board-wrap">
        <div className="board-col">
          <div className="game-status" aria-live="polite"><b>{atEnd && k > 0 ? endText() : withFigures(statusText)}</b></div>
          <div className="rp-board" inert>
            <Board state={state} orientation={mySeat || 'a'} seat={mySeat || 'a'} canMove={false} onMove={noop} players={{ a: g.a, b: g.b }} />
          </div>
        </div>
      </div>

      <div className="rp-dock">
        <ol className="rp-moves" ref={strip} aria-label="სვლები">
          {frames.map((f) => (
            <li key={f.k}>
              {f.no > 0 && (chess ? f.seat === 'a' : dice ? f.kind === 'roll' : true) && <span className="no">{f.no}.</span>}
              <button className={`mv ${f.kind}`} aria-current={f.k === k ? 'step' : undefined} onClick={() => go(f.k)}>
                {!chess && colored && <span className={`seat-dot ${seatColor(f.seat)}`} />}{f.text ? withFigures(f.text) : '…'}
              </button>
            </li>
          ))}
        </ol>
        <div className="rp-transport">
          <button className="rp-btn" onClick={() => go(0)} disabled={k === 0} aria-label="დასაწყისი"><Icon name="first" size={20} /></button>
          <button className="rp-btn" onClick={() => go(k - 1)} disabled={k === 0} aria-label="წინა სვლა"><Icon name="back" size={22} /></button>
          <button className="rp-play" onClick={toggle} aria-label={playing ? 'პაუზა' : 'დაკვრა'}><Icon name={playing ? 'pause' : 'play'} size={22} /></button>
          <button className="rp-btn" onClick={() => go(k + 1)} disabled={atEnd} aria-label="შემდეგი სვლა"><Icon name="next" size={22} /></button>
          <button className="rp-btn" onClick={() => go(lastK)} disabled={atEnd} aria-label="ბოლო"><Icon name="last" size={20} /></button>
        </div>
        <label className="rp-scrub">
          <input type="range" min="0" max={lastK} value={k} onChange={(e) => go(Number(e.target.value))} aria-label="სვლა" aria-valuetext={`სვლა ${k} / ${lastK}`} style={{ '--p': `${lastK ? (k / lastK) * 100 : 0}%` }} />
          <span className="rp-count">{k} / {lastK}</span>
        </label>
        <p className="rp-meta">{GAMES[type].title}{g.tc ? ` ${g.tc}` : ''}, {timeAgo(g.updated_at)}</p>
      </div>
    </div>
  )
}
