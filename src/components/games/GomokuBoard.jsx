import { useState } from 'react'
import { gomoku } from '../../games/index.js'

// ხუთი რიგში: 15×15 გადაკვეთები ხის დაფაზე. თითით/მაუსით, კლავიატურით — ისრები და Enter.
const N = gomoku.N
const PAD = 12
const STEP = 20
const SIZE = PAD * 2 + STEP * (N - 1)
const STARS = [3, 7, 11]
const xy = (i) => [PAD + (i % N) * STEP, PAD + Math.floor(i / N) * STEP]
const COLS = 'ABCDEFGHJKLMNOP'

export default function GomokuBoard({ state, canMove, onMove }) {
  const [hover, setHover] = useState(null)
  const [cursor, setCursor] = useState(112)
  const [kbd, setKbd] = useState(false)
  const win = new Set(state.line || [])

  const pick = (e) => {
    const svg = e.currentTarget
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM().inverse())
    const c = Math.round((p.x - PAD) / STEP)
    const r = Math.round((p.y - PAD) / STEP)
    return r >= 0 && r < N && c >= 0 && c < N ? r * N + c : null
  }
  const place = (i) => {
    if (!canMove || i === null || state.board[i] !== '.') return
    onMove({ at: i }, () => gomoku.play(state, i))
  }
  const onKey = (e) => {
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -N, ArrowDown: N }[e.key]
    if (d) {
      e.preventDefault()
      setKbd(true)
      setCursor((c) => {
        const n = c + d
        if (n < 0 || n >= N * N || (Math.abs(d) === 1 && Math.floor(n / N) !== Math.floor(c / N))) return c
        return n
      })
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      place(cursor)
    }
  }
  const label = `ხუთი რიგში, ${COLS[cursor % N]}${N - Math.floor(cursor / N)}${state.board[cursor] === 'a' ? ', შავი ქვა' : state.board[cursor] === 'b' ? ', თეთრი ქვა' : ', ცარიელი'}`

  return (
    <div className="gomoku-wrap">
      <svg className={`gomoku${canMove ? ' live' : ''}`} viewBox={`0 0 ${SIZE} ${SIZE}`} role="grid" tabIndex={0} aria-label={label}
        onClick={(e) => place(pick(e))} onPointerMove={(e) => { setKbd(false); setHover(pick(e)) }} onPointerLeave={() => setHover(null)}
        onKeyDown={onKey} onFocus={() => setKbd(true)} onBlur={() => setKbd(false)}>
        <defs>
          <radialGradient id="gk-black" cx="35%" cy="30%" r="70%"><stop offset="0" stopColor="#5b5560" /><stop offset="1" stopColor="#0f0c12" /></radialGradient>
          <radialGradient id="gk-white" cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#d8d2c8" /></radialGradient>
        </defs>
        {Array.from({ length: N }, (_, k) => (
          <g key={k} className="gk-line">
            <line x1={PAD} x2={SIZE - PAD} y1={PAD + k * STEP} y2={PAD + k * STEP} />
            <line y1={PAD} y2={SIZE - PAD} x1={PAD + k * STEP} x2={PAD + k * STEP} />
          </g>
        ))}
        {STARS.flatMap((r) => STARS.map((c) => <circle key={`${r}-${c}`} cx={PAD + c * STEP} cy={PAD + r * STEP} r="2.2" className="gk-star" />))}
        {[...state.board].map((v, i) => {
          if (v === '.') return null
          const [x, y] = xy(i)
          return (
            <g key={i} className={`gk-stone ${v}${win.has(i) ? ' win' : ''}`}>
              <circle cx={x} cy={y} r="8.7" fill={v === 'a' ? 'url(#gk-black)' : 'url(#gk-white)'} />
              {state.last === i && <circle cx={x} cy={y} r="2.6" className="gk-last" />}
            </g>
          )
        })}
        {canMove && hover !== null && state.board[hover] === '.' && !kbd && (
          <circle cx={xy(hover)[0]} cy={xy(hover)[1]} r="8.7" className={`gk-ghost ${state.turn}`} />
        )}
        {kbd && <circle cx={xy(cursor)[0]} cy={xy(cursor)[1]} r="10" className="gk-cursor" />}
      </svg>
    </div>
  )
}
