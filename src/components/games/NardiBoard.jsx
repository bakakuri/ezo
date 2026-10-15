import { useEffect, useMemo, useState } from 'react'
import { nardi, longnardi, cryptoRand } from '../../games/index.js'
import { Icon } from '../Icon.jsx'

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }

export function Die({ n, used, rolling }) {
  return (
    <span className={`die${used ? ' used' : ''}${rolling ? ' roll' : ''}`} aria-label={`კამათელი ${n}`}>
      {Array.from({ length: 9 }, (_, i) => <i key={i} className={PIPS[n]?.includes(i) ? 'on' : ''} />)}
    </span>
  )
}

const LAYOUT = {
  a: { tl: [12, 13, 14, 15, 16, 17], tr: [18, 19, 20, 21, 22, 23], bl: [11, 10, 9, 8, 7, 6], br: [5, 4, 3, 2, 1, 0] },
  b: { tl: [11, 10, 9, 8, 7, 6], tr: [5, 4, 3, 2, 1, 0], bl: [12, 13, 14, 15, 16, 17], br: [18, 19, 20, 21, 22, 23] },
}
// გრძელ ნარდში შავისთვის სარკისებური ხედი: თავი ზემოთ მარჯვნივ, სახლი ქვემოთ მარჯვნივ (გაყვანის ყუთთან)
const LAYOUT_LONG = {
  a: LAYOUT.a,
  b: { tl: [0, 1, 2, 3, 4, 5], tr: [6, 7, 8, 9, 10, 11], bl: [23, 22, 21, 20, 19, 18], br: [17, 16, 15, 14, 13, 12] },
}

export default function NardiBoard({ state, orientation = 'a', canMove, onMove, variant = 'short' }) {
  const long = variant === 'long'
  const engine = long ? longnardi : nardi
  const me = orientation === 'a' ? 'w' : 'b'
  const opp = me === 'w' ? 'b' : 'w'
  const legal = useMemo(() => (canMove && state.phase === 'move' ? engine.legalMoves(state) : []), [state, canMove, engine])
  const sources = useMemo(() => new Set(legal.map((m) => m.from)), [legal])
  const [sel, setSel] = useState(null)
  const [rolling, setRolling] = useState(false)

  useEffect(() => {
    if (sources.size === 1 && sources.has('bar')) setSel('bar')
    else if (sel !== null && !sources.has(sel)) setSel(null)
  }, [sources]) // eslint-disable-line react-hooks/exhaustive-deps

  const targets = new Set(sel === null ? [] : legal.filter((m) => m.from === sel).map((m) => m.to))
  const L = (long ? LAYOUT_LONG : LAYOUT)[orientation]

  const tapPoint = (i) => {
    if (!canMove || state.phase !== 'move') return
    if (sel !== null && targets.has(i)) { move(sel, i); return }
    if (sources.has(i)) setSel(sel === i ? null : i)
    else setSel(null)
  }
  const move = (from, to) => {
    const m = engine.findMove(state, from, to)
    if (!m) return
    setSel(null)
    onMove({ from: m.from, to: m.to }, () => engine.applyMove(state, m))
  }
  const roll = () => {
    setRolling(true)
    setTimeout(() => setRolling(false), 520)
    onMove({ roll: true }, () => engine.applyRoll(state, engine.rollDice(cryptoRand)))
  }

  const renderPoint = (i, pos, bottom) => {
    const v = state.points[i]
    const n = Math.abs(v)
    const color = v > 0 ? 'w' : 'b'
    const shown = Math.min(n, 5)
    const isSrc = sources.has(i) && canMove
    return (
      <div key={i} className={`pt c${pos % 2}${sel === i ? ' src' : ''}${targets.has(i) ? ' target' : ''}`}
        data-src={isSrc || undefined} data-tgt={targets.has(i) || undefined}
        onClick={() => tapPoint(i)} role="button" aria-label={`პუნქტი ${i + 1}: ${n ? `${n} ${color === 'w' ? 'თეთრი' : 'შავი'}` : 'ცარიელი'}`}>
        <span className="tri" />
        {Array.from({ length: shown }, (_, k) => {
          const top = k === shown - 1
          return (
            <span key={k} className={`chk ${color}${top && sel === i ? ' lift' : ''}`} style={isSrc && top && sel !== i ? { boxShadow: '0 0 0 2px rgba(61,220,132,.75)' } : undefined}>
              {top && n > 5 && <span className="n">{n}</span>}
            </span>
          )
        })}
        {bottom}
      </div>
    )
  }

  const dice = state.rolled
  const doubles = dice && dice[0] === dice[1]
  const mover = state.phase === 'move' ? state.turn : state.turn === 'w' ? 'b' : 'w'
  const diceEls = dice ? (
    <div className={`dice-zone ${mover === me ? 'right' : 'left'}`}>
      {doubles
        ? <><Die n={dice[0]} rolling={rolling} used={state.phase !== 'move'} /><Die n={dice[1]} rolling={rolling} used={state.phase !== 'move'} />{state.phase === 'move' && <b style={{ color: 'var(--bone)', alignSelf: 'center' }}>×{state.dice.length}</b>}</>
        : dice.map((d, k) => <Die key={k} n={d} rolling={rolling} used={state.phase !== 'move' || !state.dice.includes(d)} />)}
    </div>
  ) : null

  return (
    <div className="vstack" style={{ alignItems: 'center', gap: 0 }}>
      <div className={`nardi${long ? ' long' : ''}`} aria-label={long ? 'გრძელი ნარდის დაფა' : 'ნარდის დაფა'}>
        <div className="half">
          <div className="row">{L.tl.map((i, k) => renderPoint(i, k, false))}</div>
          <div className="row bottom">{L.bl.map((i, k) => renderPoint(i, k + 1, true))}</div>
        </div>
        <div className="bar">
          {state.bar && (
            <>
              <div className="stack">{Array.from({ length: state.bar[opp] }, (_, k) => <span key={k} className={`chk ${opp}`} />)}</div>
              <div className={`stack${sel === 'bar' ? ' src' : ''}`} data-src={sources.has('bar') || undefined} onClick={() => sources.has('bar') && setSel('bar')} role="button" aria-label="ბარი">
                {Array.from({ length: state.bar[me] }, (_, k) => <span key={k} className={`chk ${me}`} />)}
              </div>
            </>
          )}
        </div>
        <div className="half">
          <div className="row">{L.tr.map((i, k) => renderPoint(i, k, false))}</div>
          <div className="row bottom">{L.br.map((i, k) => renderPoint(i, k + 1, true))}</div>
        </div>
        <div className={`tray${targets.has('off') ? ' target' : ''}`} data-tgt={targets.has('off') || undefined} onClick={() => targets.has('off') && move(sel, 'off')} role="button" aria-label="გაყვანა">
          <div className="off">{Array.from({ length: state.off[opp] }, (_, k) => <i key={k} className={opp} />)}</div>
          <div className="off bot">{Array.from({ length: state.off[me] }, (_, k) => <i key={k} className={me} />)}</div>
        </div>
        {diceEls}
        {canMove && state.phase === 'roll' && (
          <button className="btn btn-accent lg roll-btn" onClick={roll}>
            <Icon name="dice" size={22} />გაგორება
          </button>
        )}
      </div>
      <div className="nardi-info">
        <span>{opp === 'w' ? 'თეთრი' : 'შავი'}: {engine.pipCount(state, opp)} ქულა გზაში</span>
        {long && state.phase === 'move' && state.headLimit > 1 && <span>თავიდან ორი ქვა შეიძლება</span>}
        <span>{me === 'w' ? 'თეთრი' : 'შავი'}: {engine.pipCount(state, me)}</span>
      </div>
    </div>
  )
}
