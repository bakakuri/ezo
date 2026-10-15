import { useMemo, useState } from 'react'
import { joker } from '../../games/index.js'
import { sortHand, isJoker, SUITS, SUIT_NAME } from '../../games/cards.js'
import { Card, Suit } from './Card.jsx'
import { Fan } from './DurakTable.jsx'
import { Avatar, Sheet } from '../ui.jsx'
import { Icon } from '../Icon.jsx'

const { SEATS, nextSeat } = joker
const shortName = (p, fallback) => (p?.full_name || p?.username || fallback || '').split(' ')[0]

export function TrumpBadge({ state }) {
  if (state.phase === 'trump') return <span className="trump-badge muted">კოზირს ირჩევენ…</span>
  if (state.trump && !isJoker(state.trump)) return <span className="trump-badge"><Card c={state.trump} size="xs" />კოზირი</span>
  if (state.trumpSuit) return <span className="trump-badge"><Suit s={state.trumpSuit} />{SUIT_NAME[state.trumpSuit]}</span>
  return <span className="trump-badge">{state.trump ? <Card c={state.trump} size="xs" /> : null}უკოზიროდ</span>
}

export default function JokerTable({ state, seat = 'a', canMove, onMove, players = {} }) {
  const [jk, setJk] = useState(null) // ჯოკერის გამოცხადება
  const [sheet, setSheet] = useState(false)
  const left = nextSeat(seat)
  const top = nextSeat(left)
  const right = nextSeat(top)
  const pos = { [seat]: 'bottom', [left]: 'left', [top]: 'top', [right]: 'right' }
  const hand = useMemo(() => sortHand(joker.visibleHand(state, seat) || [], state.trumpSuit), [state, seat])
  const myTurn = canMove && state.turn === seat
  const legal = useMemo(() => (myTurn && state.phase === 'play' ? new Set(joker.legalCards(state, seat)) : null), [state, seat, myTurn])
  const leading = state.trick.length === 0
  const name = (s) => (s === seat ? 'შენ' : shortName(players[s], 'მოთამაშე'))

  const playCard = (c) => {
    if (isJoker(c)) { setJk(c); return }
    onMove({ play: c }, () => joker.play(state, c, {}))
  }
  const playJoker = (mode, suit) => {
    const c = jk
    setJk(null)
    onMove({ play: c, mode, suit }, () => joker.play(state, c, { mode, suit }))
  }

  const shown = state.trick.length ? state.trick : state.lastTrick?.cards || []
  const ghost = !state.trick.length
  const bidSum = SEATS.reduce((n, x) => n + (state.bids[x] ?? 0), 0)
  const forbidden = joker.forbiddenBid(state)
  const sets = joker.MODES[state.mode].sets

  const badge = (s) => {
    const b = state.bids[s]
    const active = state.turn === s && state.phase !== 'over'
    return (
      <div className={`jk-seat ${pos[s]}${active ? ' turn' : ''}`}>
        <Avatar user={players[s]} size={pos[s] === 'bottom' ? 30 : 36} />
        <div className="nm">
          <b>{players[s]?.username === 'bot' && <Icon name="cpu" size={12} />}{name(s)}{state.dealer === s && <i className="dealer" title="დამრიგებელი">დ</i>}</b>
          <span className={`bt${b != null && b === state.taken[s] ? ' made' : ''}`}>{b == null ? '—' : `${b} / ${state.taken[s]}`}</span>
        </div>
        {s !== seat && <span className="cnt">{state.hands[s]?.length ?? 0}</span>}
      </div>
    )
  }

  return (
    <div className="card-table joker" aria-label="ჯოკერის მაგიდა">
      <div className="jk-head">
        <TrumpBadge state={state} />
        <span className="deal">{state.n} კარტი, პულკა {state.set + 1}{sets.length > 1 ? ` / ${sets.length}` : ''}</span>
        <button className="btn btn-ghost sm" onClick={() => setSheet(true)}>ტაბულა</button>
      </div>
      <div className="felt-cards jk-felt">
        {badge(top)}
        {badge(left)}
        {badge(right)}
        <div className={`trick${ghost ? ' ghost' : ''}`} aria-live="polite">
          {shown.map((x) => (
            <span key={x.seat} className={`tc ${pos[x.seat]}${ghost && state.lastTrick?.winner === x.seat ? ' won' : ''}`}>
              <Card c={x.card} size="md" />
              {isJoker(x.card) && <em className="jk-call">{x.mode === 'high' ? 'მაღალი' : 'დაბალი'}{x.suit ? <Suit s={x.suit} /> : null}</em>}
            </span>
          ))}
          {ghost && state.lastTrick && state.phase === 'play' && <small className="took">წაიღო: {name(state.lastTrick.winner)}</small>}
        </div>
      </div>
      {badge(seat)}

      {state.phase === 'trump' && state.turn === seat && canMove && (
        <div className="jk-panel">
          <p>პირველი სამი კარტით აირჩიე კოზირი</p>
          <div className="suit-pick">
            {SUITS.map((s) => (
              <button key={s} className="btn btn-outline" onClick={() => onMove({ trump: s }, () => joker.chooseTrump(state, s))} aria-label={SUIT_NAME[s]}>
                <Suit s={s} /><span>{SUIT_NAME[s]}</span>
              </button>
            ))}
            <button className="btn btn-outline wide" onClick={() => onMove({ trump: null }, () => joker.chooseTrump(state, null))}>უკოზიროდ</button>
          </div>
        </div>
      )}
      {state.phase === 'bid' && state.turn === seat && canMove && (
        <div className="jk-panel">
          <p>რამდენს წაიღებ? <span className="muted">უკვე უთხრეს {bidSum} / {state.n}</span></p>
          <div className="bid-pick">
            {Array.from({ length: state.n + 1 }, (_, k) => (
              <button key={k} className="btn btn-outline" disabled={k === forbidden} onClick={() => onMove({ bid: k }, () => joker.bid(state, k))}
                title={k === forbidden ? 'დამრიგებელი ჯამს ვერ გაუტოლებს' : undefined}>{k === 0 ? 'პასი' : k}</button>
            ))}
          </div>
          {forbidden != null && <p className="xs muted">დამრიგებელი ვერ იტყვის {forbidden}-ს: შეკვეთების ჯამი კარტების რაოდენობას არ უნდა გაუტოლდეს.</p>}
        </div>
      )}

      <Fan cards={hand} size="md" legal={legal} onPick={legal ? playCard : null} label="შენი კარტები" />

      {jk && (
        <Sheet title="ჯოკერი" onClose={() => setJk(null)}>
          <div className="sheet-body vstack jk-declare">
            {leading ? (
              <>
                <p className="muted small">მაღალი: ყველამ ამ მასტის უმაღლესი უნდა დადოს, ჯოკერი იღებს (თუ არავინ მოჭრის კოზირით).</p>
                <div className="suit-pick">{SUITS.map((s) => <button key={s} className="btn btn-accent" onClick={() => playJoker('high', s)}><Suit s={s} />მაღალი</button>)}</div>
                <p className="muted small">დაბალი („წაიღოს“): ჯოკერი ამ მასტის უდაბლესია, ხელს სხვა წაიღებს.</p>
                <div className="suit-pick">{SUITS.map((s) => <button key={s} className="btn btn-outline" onClick={() => playJoker('low', s)}><Suit s={s} />დაბალი</button>)}</div>
              </>
            ) : (
              <>
                <button className="btn btn-accent lg block" onClick={() => playJoker('high')}>მაღალი — ვიღებ</button>
                <button className="btn btn-outline lg block" onClick={() => playJoker('low')}>დაბალი — ვაგდებ</button>
              </>
            )}
          </div>
        </Sheet>
      )}
      {sheet && <ScoreSheet state={state} players={players} seat={seat} onClose={() => setSheet(false)} />}
    </div>
  )
}

export function ScoreSheet({ state, players, seat, onClose }) {
  const name = (s) => (s === seat ? 'შენ' : shortName(players[s], s.toUpperCase()))
  const rows = []
  let lastSet = -1
  for (const r of state.sheet) {
    if (r.set !== lastSet && !r.bonus) { rows.push({ head: `პულკა ${r.set + 1}` }); lastSet = r.set }
    rows.push(r)
  }
  return (
    <Sheet title="ტაბულა" onClose={onClose}>
      <div className="score-sheet">
        <table>
          <thead>
            <tr><th />{SEATS.map((s) => <th key={s} className={s === seat ? 'me' : ''}>{name(s)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted small">ჯერ არცერთი დარიგება არ დამთავრებულა</td></tr>}
            {rows.map((r, i) => r.head ? (
              <tr key={i} className="set-row"><td colSpan={5}>{r.head}</td></tr>
            ) : r.bonus ? (
              <tr key={i} className="bonus-row"><td>პრემია</td>{SEATS.map((s) => <td key={s}>{r.points[s] ? `+${r.points[s]}` : ''}</td>)}</tr>
            ) : (
              <tr key={i}>
                <td className="n">{r.n}{r.trumpSuit ? <Suit s={r.trumpSuit} /> : null}</td>
                {SEATS.map((s) => (
                  <td key={s} className={r.points[s] < 0 ? 'neg' : r.bids[s] === r.taken[s] ? 'ok' : ''}>
                    <b>{r.points[s]}</b><small>{r.bids[s] === 0 ? 'პ' : r.bids[s]}/{r.taken[s]}</small>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td>ჯამი</td>{SEATS.map((s) => <td key={s}><b>{state.scores[s]}</b></td>)}</tr>
          </tfoot>
        </table>
      </div>
    </Sheet>
  )
}
