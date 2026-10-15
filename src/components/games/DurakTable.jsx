import { useMemo } from 'react'
import { durak } from '../../games/index.js'
import { sortHand, SUIT_NAME } from '../../games/cards.js'
import { Card, Suit } from './Card.jsx'

// ხელი ვეერად: კარტები ერთმანეთზე, რომ 6–20 კარტი ერთ რიგში დაეტიოს
export function Fan({ cards, size = 'md', legal, onPick, picked, pickedSet, label }) {
  const n = cards.length
  return (
    <div className={`fan n${Math.min(n, 12)}`} style={{ '--n': n }} aria-label={label}>
      {cards.map((c, i) => {
        const ok = legal ? legal.has(c) : true
        return (
          <button key={c || i} className={`fan-card${legal ? (ok ? ' ok' : ' no') : ''}${picked === c || pickedSet?.has(c) ? ' picked' : ''}`}
            style={{ '--i': i }} disabled={!onPick || !ok} onClick={() => onPick?.(c)}>
            <Card c={c} size={size} />
          </button>
        )
      })}
    </div>
  )
}

export function Backs({ n, size = 'sm', label }) {
  return (
    <div className="backs" style={{ '--n': n }} aria-label={label}>
      {Array.from({ length: n }, (_, i) => <Card key={i} c={null} size={size} style={{ '--i': i }} />)}
    </div>
  )
}

export default function DurakTable({ state, seat = 'a', canMove, onMove }) {
  const opp = durak.otherSeat(seat)
  const iAttack = state.attacker === seat
  const hand = useMemo(() => sortHand(state.hands[seat] || [], state.trumpSuit), [state, seat])
  const ts = state.trumpSuit
  const open = state.table.findIndex((p) => !p.d)

  const legal = useMemo(() => {
    if (!canMove) return new Set()
    if (iAttack) return new Set(durak.attackOptions(state))
    return new Set(hand.filter((c) => durak.defendOptions(state, c).length))
  }, [state, canMove, iAttack, hand])

  const pick = (c) => {
    if (iAttack) onMove({ attack: c }, () => durak.attack(state, c))
    else {
      const target = durak.defendOptions(state, c)[0]
      onMove({ beat: c, target }, () => durak.defend(state, c, target))
    }
  }
  const lastCard = state.last?.card
  const canBita = canMove && iAttack && state.phase === 'attack' && state.table.length > 0 && durak.allBeaten(state)
  const canGive = canMove && iAttack && state.phase === 'take'
  const canTake = canMove && !iAttack && state.phase === 'defend'

  return (
    <div className="card-table durak" aria-label="დურაკის მაგიდა">
      <div className="felt-cards">
        <div className="opp-row">
          <Backs n={state.hands[opp].length} size="xs" label={`მოწინააღმდეგეს აქვს ${state.hands[opp].length} კარტი`} />
          {state.phase === 'take' && <span className="pill-note">იღებს</span>}
        </div>

        <div className="mid-row">
          <div className="stock" aria-label={`დასტაში ${state.stock.length} კარტი, კოზირი ${SUIT_NAME[ts]}`}>
            {state.stock.length > 0 ? (
              <>
                <Card c={state.trump} size="sm" className="trump-card" />
                {state.stock.length > 1 && <Card c={null} size="sm" className="stock-top" />}
                <b className="count">{state.stock.length}</b>
              </>
            ) : (
              <span className="trump-only"><Suit s={ts} /><small>კოზირი</small></span>
            )}
          </div>

          <div className="battle" aria-live="polite">
            {state.table.length === 0 && (
              <p className="hint">{state.phase === 'over' ? '' : iAttack && canMove ? 'დადე ნებისმიერი კარტი' : ''}</p>
            )}
            {state.table.map((p, i) => (
              <div key={i} className={`pair${i === open && !iAttack && canMove ? ' target' : ''}`}>
                <Card c={p.a} size="md" className={lastCard === p.a ? 'fresh' : ''} />
                {p.d && <Card c={p.d} size="md" className={`cover${lastCard === p.d ? ' fresh' : ''}`} />}
              </div>
            ))}
          </div>

          <div className="discard" aria-label={`ბიტაში ${state.discard} კარტი`}>
            {state.discard > 0 && (
              <>
                <Card c={null} size="xs" className="d1" />
                <Card c={null} size="xs" className="d2" />
                <small>ბიტა {state.discard}</small>
              </>
            )}
          </div>
        </div>
      </div>

      <Fan cards={hand} legal={canMove ? legal : null} onPick={canMove ? pick : null} label="შენი კარტები" />

      <div className="table-actions">
        {canTake && <button className="btn btn-outline lg" onClick={() => onMove({ take: true }, () => durak.take(state))}>აღება</button>}
        {canBita && <button className="btn btn-accent lg" onClick={() => onMove({ done: true }, () => durak.done(state))}>ბიტა</button>}
        {canGive && <button className="btn btn-accent lg" onClick={() => onMove({ done: true }, () => durak.done(state))}>მიეცი — აიღოს</button>}
      </div>
    </div>
  )
}
