import { useEffect, useMemo, useState } from 'react'
import { checkers } from '../../games/index.js'

const Crown = ({ color }) => (
  <svg className="crown" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 17 2 7l5 4 5-7 5 7 5-4-1 10z" fill={color} />
    <rect x="3" y="18" width="18" height="2.6" rx="1.2" fill={color} />
  </svg>
)

export default function CheckersBoard({ state, orientation = 'a', canMove, onMove }) {
  const legal = useMemo(() => (canMove ? checkers.legalMoves(state) : []), [state, canMove])
  const [path, setPath] = useState([])
  const flipped = orientation === 'b'
  useEffect(() => { setPath([]) }, [state])
  const mustCapture = legal.length > 0 && legal[0].caps.length > 0
  const matching = path.length ? legal.filter((m) => path.every((sq, i) => m.path[i] === sq)) : []
  const nextSquares = new Set(matching.map((m) => m.path[path.length]).filter((x) => x !== undefined))
  const movable = new Set(legal.map((m) => m.path[0]))

  const click = (sq) => {
    if (!canMove) return
    if (path.length && nextSquares.has(sq)) {
      const np = [...path, sq]
      const done = legal.find((m) => m.path.length === np.length && m.path.every((x, i) => x === np[i]))
      if (done) { setPath([]); onMove({ path: done.path }, () => checkers.applyMove(state, done)); return }
      setPath(np)
      return
    }
    if (movable.has(sq)) setPath(path[0] === sq && path.length === 1 ? [] : [sq])
    else setPath([])
  }

  const order = Array.from({ length: 64 }, (_, i) => (flipped ? 63 - i : i))
  const caps = new Set(matching.flatMap((m) => m.caps.slice(0, path.length - 1)))
  return (
    <div className="cboard" role="grid" aria-label="შაშკის დაფა">
      {order.map((sq) => {
        const r = sq >> 3
        const f = sq & 7
        const dark = (r + f) % 2 === 1
        const p = state.board[sq]
        const atPath = path.indexOf(sq)
        const shownPiece = atPath > 0 ? null : p
        const cls = ['sq', dark ? 'd' : 'l', state.last?.includes(sq) ? 'last' : '', path[0] === sq ? 'sel' : '', mustCapture && !path.length && movable.has(sq) ? 'must' : ''].join(' ')
        return (
          <button key={sq} className={cls} onClick={() => click(sq)} disabled={!dark} aria-label={dark ? `${'abcdefgh'[f]}${8 - r}` : undefined}>
            {shownPiece && (
              <span className={`disc ${shownPiece.toLowerCase()}`} style={caps.has(sq) ? { opacity: 0.35 } : undefined}>
                {shownPiece === shownPiece.toUpperCase() && <Crown color={shownPiece === 'W' ? '#9e1b32' : '#d6aa3c'} />}
              </span>
            )}
            {atPath > 0 && <span className={`disc ${state.board[path[0]].toLowerCase()}`} style={{ opacity: 0.55 }} />}
            {nextSquares.has(sq) && <span className="dot" />}
          </button>
        )
      })}
    </div>
  )
}
