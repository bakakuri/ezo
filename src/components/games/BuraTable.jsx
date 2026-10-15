import { useEffect, useMemo, useState } from 'react'
import { bura } from '../../games/index.js'
import { sortHand, suitOf, SUIT_NAME } from '../../games/cards.js'
import { Card, Suit } from './Card.jsx'
import { Fan, Backs } from './DurakTable.jsx'

// ქულების ზოლი 61-მდე
function Score({ label, pts, mine }) {
  const pct = Math.min(1, pts / bura.WIN_AT)
  return (
    <div className={`bura-score${mine ? ' mine' : ''}`} aria-label={`${label}: ${pts} ქულა`}>
      <span className="nm">{label}</span>
      <span className="bar"><i style={{ width: `${pct * 100}%` }} /></span>
      <b>{pts}</b>
    </div>
  )
}

export default function BuraTable({ state, seat = 'a', canMove, onMove, players }) {
  const opp = bura.otherSeat(seat)
  const ts = state.trumpSuit
  const hand = useMemo(() => sortHand((state.hands[seat] || []).filter(Boolean), ts), [state, seat, ts])
  const [sel, setSel] = useState([])
  useEffect(() => setSel([]), [state.trick, state.phase, canMove])
  const leading = state.phase === 'lead' && state.leader === seat
  const responding = state.phase === 'respond' && state.leader !== seat
  const need = responding ? state.lead.length : bura.maxLead(state)

  const legal = useMemo(() => (canMove ? new Set(hand) : new Set()), [canMove, hand])

  const toggle = (c) => {
    setSel((cur) => {
      if (cur.includes(c)) return cur.filter((x) => x !== c)
      // სვლისას რამდენიმე კარტი მხოლოდ ერთი მასტისაა — სხვა მასტი არჩევანს თავიდან იწყებს
      if (!responding && cur.length && suitOf(cur[0]) !== suitOf(c)) return [c]
      if (cur.length >= need) return [...cur.slice(1), c]
      return [...cur, c]
    })
  }
  const ready = canMove && (responding ? sel.length === need : sel.length >= 1 && bura.canLead(state, sel))
  const beatsNow = responding && sel.length === need && bura.beatsAll(sel, state.lead, ts)
  const go = () => {
    if (!ready) return
    if (responding) onMove({ respond: sel }, () => bura.respond(state, sel))
    else onMove({ lead: sel }, () => bura.lead(state, sel))
  }
  const name = (s) => (s === seat ? 'შენ' : (players?.[s]?.full_name || 'მოწინააღმდეგე').split(' ')[0])
  const last = state.last
  const showLast = state.phase === 'lead' && last && !state.lead.length

  return (
    <div className="card-table bura" aria-label="ბურის მაგიდა">
      <div className="bura-scores">
        <Score label={name(seat)} pts={state.points[seat]} mine />
        <Score label={name(opp)} pts={state.points[opp]} />
      </div>
      <div className="felt-cards">
        <div className="opp-row">
          <Backs n={state.hands[opp].length} size="xs" label={`მოწინააღმდეგეს აქვს ${state.hands[opp].length} კარტი`} />
        </div>
        <div className="mid-row">
          <div className="stock" aria-label={`დასტაში ${state.stock.length} კარტი, კოზირი ${SUIT_NAME[ts]}`}>
            {state.stock.length > 0 ? (
              <>
                <Card c={state.trump} size="sm" className="trump-card" />
                {state.stock.length > 1 && <Card c={null} size="sm" className="stock-top" />}
                <b className="count">{state.stock.length}</b>
              </>
            ) : <span className="trump-only"><Suit s={ts} /><small>კოზირი</small></span>}
          </div>

          <div className="battle bura-battle" aria-live="polite">
            {state.lead.length > 0 && (
              <div className="trick">
                <small>{name(state.leader)} დადო</small>
                <div className="row">{state.lead.map((c) => <Card key={c} c={c} size="md" className="fresh" />)}</div>
              </div>
            )}
            {showLast && (
              <div className={`trick last ${last.winner === seat ? 'won' : 'lost'}`}>
                <div className="row">
                  {last.lead.map((c) => <Card key={c} c={c} size="sm" />)}
                  <span className="vs">{last.beat ? 'მოიჭრა' : 'ვერ მოიჭრა'}</span>
                  {last.resp.map((c) => <Card key={c} c={c} size="sm" />)}
                </div>
                <small><b>{name(last.winner)}</b> {last.winner === seat ? 'აიღე' : 'აიღო'} +{last.pts}</small>
              </div>
            )}
            {state.phase === 'over' && state.bura && <div className="bura-shout">ბურა!</div>}
            {!state.lead.length && !showLast && state.phase !== 'over' && <p className="hint">{leading && canMove ? 'დადე 1–3 ერთი მასტის კარტი' : ''}</p>}
          </div>
          <div className="discard" aria-label={`აღებული: შენ ${state.taken[seat]}, მოწინააღმდეგე ${state.taken[opp]}`}>
            <small>ხელები</small><b>{Math.max(0, state.trick - 1)}</b>
          </div>
        </div>
      </div>

      <Fan cards={hand} legal={canMove ? legal : null} onPick={canMove ? toggle : null} pickedSet={new Set(sel)} label="შენი კარტები" />

      <div className="table-actions bura-actions">
        {canMove && responding && sel.length === need && (
          <span className={`verdict ${beatsNow ? 'ok' : 'no'}`}>{beatsNow ? 'მოიჭრება — ხელი შენია' : 'ვერ მოიჭრება — ხელს ის აიღებს'}</span>
        )}
        {canMove && responding && sel.length < need && <span className="verdict">აირჩიე {need} კარტი</span>}
        {canMove && <button className="btn btn-accent lg" disabled={!ready} onClick={go}>{responding ? 'პასუხი' : sel.length > 1 ? `სვლა (${sel.length})` : 'სვლა'}</button>}
      </div>
    </div>
  )
}
