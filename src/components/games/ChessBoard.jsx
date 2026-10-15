import { useEffect, useMemo, useState } from 'react'
import { chess, chess960 } from '../../games/index.js'

// საკუთარი ფიგურების ნაკრები (SVG, 50×50)
export function Piece({ p, className = 'piece' }) {
  const white = p === p.toUpperCase()
  const F = white ? '#f6ecd8' : '#2a1a10'
  const S = white ? '#2a1a10' : '#d9c8a6'
  const t = p.toLowerCase()
  const common = { fill: F, stroke: S, strokeWidth: 1.6, strokeLinejoin: 'round' }
  const line = { fill: 'none', stroke: S, strokeWidth: 1.6, strokeLinecap: 'round' }
  return (
    <svg viewBox="0 0 50 50" className={className} aria-hidden="true">
      {t === 'p' && <>
        <path d="M17 40Q18 30 21.5 27.5h7Q32 30 33 40z" {...common} />
        <rect x="18" y="25" width="14" height="3.2" rx="1.6" {...common} />
        <circle cx="25" cy="19" r="6.5" {...common} />
        <rect x="12" y="40" width="26" height="5" rx="2" {...common} />
      </>}
      {t === 'r' && <>
        <path d="M15.5 40 17 21h16l1.5 19z" {...common} />
        <path d="M14 21v-10h4.5v3.5h4.5V11h4v3.5h4.5V11H36v10z" {...common} />
        <path d="M17.5 25h15M17.2 36h15.6" {...line} />
        <rect x="11" y="40" width="28" height="5" rx="2" {...common} />
      </>}
      {t === 'n' && <>
        <path d="M14 40c0-8 5-11 7-15-3 1-6 2-7.5-.5S17 16 20 13l1-4.5 3 3.5c7 0 12 6 12 15 0 6-1 10-1.5 13z" {...common} />
        <circle cx="22.5" cy="17" r="1.6" fill={S} />
        <path d="M30 15c2 4 2.5 9 1.5 14" {...line} />
        <rect x="11" y="40" width="28" height="5" rx="2" {...common} />
      </>}
      {t === 'b' && <>
        <path d="M16 40q2-8 5-10h8q3 2 5 10z" {...common} />
        <rect x="18.5" y="27.5" width="13" height="3.2" rx="1.6" {...common} />
        <path d="M25 9c6 4 8 10 6 15-1 2.5-3 3.5-6 3.5s-5-1-6-3.5c-2-5 0-11 6-15z" {...common} />
        <path d="M27.8 15.5l-4.3 5" {...line} />
        <circle cx="25" cy="7" r="2.3" {...common} />
        <rect x="12" y="40" width="26" height="5" rx="2" {...common} />
      </>}
      {t === 'q' && <>
        <path d="M13 40 10 16l5 10 2.5-13.5 4 12.5L25 11l3.5 14 4-12.5L35 26l5-10-3 24z" {...common} />
        {[[10, 15], [17.5, 11.5], [25, 9.5], [32.5, 11.5], [40, 15]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="2.3" {...common} />)}
        <path d="M14.2 34.5h21.6" {...line} />
        <rect x="10" y="40" width="30" height="5" rx="2" {...common} />
      </>}
      {t === 'k' && <>
        <path d="M13 40c-1-10-2-16 2-19 3-2 7 0 10 4 3-4 7-6 10-4 4 3 3 9 2 19z" {...common} />
        <path d="M21.5 21.5 23 15h4l1.5 6.5" {...common} />
        <path d="M25 4v10M21 8h8" stroke={white ? S : F} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M14.5 34.5h21" {...line} />
        <rect x="10" y="40" width="30" height="5" rx="2" {...common} />
      </>}
    </svg>
  )
}

const FILES = 'abcdefgh'

// variant="960" — ჭადრაკი 960: როქი — მეფე, მერე საკუთარი ეტლი (ან მეფის ბოლო უჯრა)
export default function ChessBoard({ state, orientation = 'a', canMove, onMove, variant }) {
  const rules = variant === '960' ? chess960 : chess
  const s = useMemo(() => chess.fromFEN(state.fen), [state.fen])
  const legal = useMemo(() => (canMove ? rules.legalMoves(s) : []), [s, canMove, rules])
  const [sel, setSel] = useState(null)
  const [promo, setPromo] = useState(null)
  const flipped = orientation === 'b'
  useEffect(() => { setSel(null); setPromo(null) }, [state.fen])
  const checkSq = chess.inCheck(s) ? s.board.indexOf(s.turn === 'w' ? 'K' : 'k') : -1
  const targets = sel === null ? [] : legal.filter((m) => m.from === sel)

  const click = (sq) => {
    if (!canMove) return
    const t = targets.filter((m) => m.to === sq)
    if (t.length) {
      if (t.some((m) => m.promo)) { setPromo(t); return }
      play(t[0])
      return
    }
    const p = s.board[sq]
    if (p && chess.colorOf(p) === s.turn && legal.some((m) => m.from === sq)) setSel(sq === sel ? null : sq)
    else setSel(null)
  }
  const play = (m) => {
    setSel(null)
    setPromo(null)
    onMove({ from: m.from, to: m.to, promo: m.promo }, () => rules.applyToState(state, m))
  }

  const order = Array.from({ length: 64 }, (_, i) => (flipped ? 63 - i : i))
  return (
    <div className="cboard" role="grid" aria-label="ჭადრაკის დაფა">
      {order.map((sq, i) => {
        const r = sq >> 3
        const f = sq & 7
        const p = s.board[sq]
        const tgt = targets.find((m) => m.to === sq)
        const cls = [
          'sq', (r + f) % 2 ? 'd' : 'l',
          state.last?.includes(sq) ? 'last' : '',
          sel === sq ? 'sel' : '',
          checkSq === sq ? 'check' : '',
        ].join(' ')
        return (
          <button key={sq} className={cls} onClick={() => click(sq)} aria-label={`${FILES[f]}${8 - r}${p ? ` ${p}` : ''}`}>
            {i % 8 === 0 && <span className="coord r">{8 - r}</span>}
            {i >= 56 && <span className="coord f">{FILES[f]}</span>}
            {p && <Piece p={p} />}
            {tgt && (p || tgt.flag === 'ep' || tgt.flag === 'castle960' ? <span className={`ring${tgt.flag === 'castle960' ? ' castle' : ''}`} /> : <span className="dot" />)}
          </button>
        )
      })}
      {promo && (
        <div className="promo" onClick={() => setPromo(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            {['q', 'r', 'b', 'n'].map((k) => (
              <button key={k} onClick={() => play(promo.find((m) => m.promo === k))} aria-label={k}>
                <Piece p={s.turn === 'w' ? k.toUpperCase() : k} className="" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// პატარა დაფა გადახედვისთვის (არაინტერაქტიული)
export function MiniBoard({ fen, flipped = false }) {
  const s = useMemo(() => chess.fromFEN(fen), [fen])
  const order = Array.from({ length: 64 }, (_, i) => (flipped ? 63 - i : i))
  return (
    <span className="mini-board" aria-hidden="true">
      {order.map((sq) => {
        const p = s.board[sq]
        return <span key={sq} className={((sq >> 3) + (sq & 7)) % 2 ? 'd' : 'l'}>{p && <Piece p={p} className="" />}</span>
      })}
    </span>
  )
}
