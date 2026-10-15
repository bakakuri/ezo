import { useEffect, useMemo, useState } from 'react'
import { Avatar } from '../ui.jsx'
import { loto } from '../../games/index.js'

// ბილეთი: დაფარული რიცხვი ბროწეულისფერი ნიშნით, ერთი დარჩენილი რიგი — ანთებული
export function Ticket({ ticket, drawn, last, size = 'md' }) {
  const left = loto.rowsLeft(ticket, drawn)
  return (
    <div className={`ticket ${size}`} role="table" aria-label="ბილეთი">
      {ticket.map((row, r) => (
        <div key={r} role="row" className={`trow${left[r] === 0 ? ' done' : left[r] === 1 ? ' hot' : ''}`}>
          {row.map((n, c) => (
            <span key={c} role="cell" className={`tcell${n === null ? ' void' : drawn.has(n) ? ' hit' : ''}${n === last ? ' fresh' : ''}`}>
              {n !== null && <b>{n}</b>}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function Countdown({ at, interval }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t) }, [])
  if (!at) return null
  const pct = Math.max(0, Math.min(1, 1 - (at - now) / interval))
  return <span className="loto-timer" style={{ '--p': pct }} aria-hidden="true" />
}

export default function LotoTable({ state, seat = 'a', players = {} }) {
  const drawn = useMemo(() => new Set(state.drawn), [state.drawn])
  const seats = Object.keys(state.tickets)
  const mine = state.tickets[seat] ? seat : null
  const others = seats.filter((s) => s !== mine)
  const last = state.last
  const myLeft = mine ? Math.min(...loto.rowsLeft(state.tickets[mine], drawn)) : null
  const [showBoard, setShowBoard] = useState(false)
  const name = (s) => (s === mine ? 'შენ' : (players[s]?.full_name || 'მოთამაშე').split(' ')[0])

  return (
    <div className="loto" aria-label="ლოტოს მაგიდა">
      <div className="loto-top">
        <div className="keg-wrap" aria-live="polite">
          {last ? (
            <span className="keg" key={last}>
              <b>{last}</b>
            </span>
          ) : <span className="keg empty"><small>{state.phase === 'play' ? 'ტრიალებს…' : ''}</small></span>}
          {state.phase === 'play' && <Countdown at={state.next_at} interval={state.interval} />}
        </div>
        <div className="loto-info">
          <small>კასრი {state.drawn.length} / 90</small>
          {last && loto.NICK[last] && <em>„{loto.NICK[last]}“</em>}
          <div className="recent">{state.drawn.slice(-7, -1).reverse().map((n) => <span key={n}>{n}</span>)}</div>
          <small className="mode">{loto.MODES[state.mode].title}: {loto.MODES[state.mode].sub.toLowerCase()}</small>
        </div>
      </div>

      {mine && (
        <section className="my-ticket">
          <div className="ticket-head">
            <b>შენი ბილეთი</b>
            {state.phase === 'play' && myLeft !== null && myLeft <= 2 && (
              <span className={`near${myLeft === 1 ? ' one' : ''}`}>{myLeft === 1 ? 'ერთი დაგრჩა!' : `${myLeft} დაგრჩა`}</span>
            )}
          </div>
          <Ticket ticket={state.tickets[mine]} drawn={drawn} last={last} />
        </section>
      )}

      <div className="rivals">
        {others.map((s) => {
          const left = loto.rowsLeft(state.tickets[s], drawn)
          const best = state.mode === 'full' ? left.reduce((a, b) => a + b, 0) : Math.min(...left)
          const won = state.winners?.includes(s)
          return (
            <div key={s} className={`rival${won ? ' won' : ''}${best <= 1 && !won ? ' hot' : ''}`}>
              <span className="who"><Avatar user={players[s]} size={26} /><b>{name(s)}</b></span>
              <Ticket ticket={state.tickets[s]} drawn={drawn} last={last} size="xs" />
              <small>{won ? 'შეავსო!' : `დარჩა ${best}`}</small>
            </div>
          )
        })}
      </div>

      <button className="btn btn-ghost sm board-toggle" onClick={() => setShowBoard((v) => !v)} aria-expanded={showBoard}>
        {showBoard ? 'დამალე ყველა რიცხვი' : 'ყველა რიცხვი 1–90'}
      </button>
      {showBoard && (
        <div className="all-numbers" aria-label="გამოსული რიცხვები">
          {Array.from({ length: 90 }, (_, i) => i + 1).map((n) => <span key={n} className={drawn.has(n) ? `on${n === last ? ' last' : ''}` : ''}>{n}</span>)}
        </div>
      )}
    </div>
  )
}
