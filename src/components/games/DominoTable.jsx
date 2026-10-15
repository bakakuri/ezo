import { useEffect, useState } from 'react'
import { domino } from '../../games/index.js'

const PIPS = { 0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }

export function Tile({ a, b, v = false, big = false, fresh = false }) {
  return (
    <span className={`tile ${v ? 'v' : 'h'}${big ? ' big' : ''}${fresh ? ' fresh' : ''}`} aria-label={`${a}:${b}`}>
      {[a, b].map((n, k) => (
        <span className="half" key={k}>{Array.from({ length: 9 }, (_, i) => <i key={i} className={PIPS[n].includes(i) ? 'on' : ''} />)}</span>
      ))}
    </span>
  )
}

export default function DominoTable({ state, seat = 'a', canMove, onMove }) {
  const [picked, setPicked] = useState(null)
  const hand = state.hands[seat] || []
  const oppSeat = domino.otherSeat(seat)
  const options = canMove ? domino.playable(state, seat) : []
  const playableIdx = new Set(options.map((o) => o.i))
  const ends = domino.ends(state)

  useEffect(() => { setPicked(null) }, [state])

  const tapTile = (i) => {
    if (!canMove || !playableIdx.has(i)) return
    const sides = options.filter((o) => o.i === i).map((o) => o.side)
    const sameEnds = ends && ends[0] === ends[1]
    if (sides.length === 1 || sameEnds) {
      onMove({ play: hand[i], side: sides[0] }, () => domino.play(state, i, sides[0]))
      return
    }
    setPicked(picked === i ? null : i)
  }
  const lastTile = state.last?.tile
  const isFresh = (t) => lastTile && ((t[0] === lastTile[0] && t[1] === lastTile[1]) || (t[0] === lastTile[1] && t[1] === lastTile[0]))

  return (
    <div className="vstack" style={{ alignItems: 'center', gap: 0, width: '100%' }}>
      <div className="felt">
        <div className="opp-hand" aria-label={`მოწინააღმდეგეს აქვს ${state.hands[oppSeat].length} ქვა`}>
          {state.hands[oppSeat].map((_, k) => <i key={k} />)}
        </div>
        <div className="boneyard" aria-label="ბაზარი">ბაზარი: {state.boneyard.length}</div>
        <div className="chain">
          {picked !== null && <button className="end-btn" onClick={() => onMove({ play: hand[picked], side: 'L' }, () => domino.play(state, picked, 'L'))}>აქ</button>}
          {state.chain.length === 0 && <span className="empty-hint">{canMove ? 'დადე ნებისმიერი ქვა' : 'ველოდებით პირველ სვლას'}</span>}
          {state.chain.map((t, k) => <Tile key={k} a={t[0]} b={t[1]} v={t[0] === t[1]} fresh={isFresh(t)} />)}
          {picked !== null && <button className="end-btn" onClick={() => onMove({ play: hand[picked], side: 'R' }, () => domino.play(state, picked, 'R'))}>აქ</button>}
        </div>
      </div>
      <div className="my-hand" aria-label={hand.some((t) => !t) ? `${hand.length} დამალული ქვა` : 'შენი ქვები'}>
        {/* მაყურებელი და ჩანაწერი: ხელი დამალულია — მხოლოდ ზურგი ჩანს */}
        {hand.map((t, i) => !t ? <i key={`x${i}`} className="back" /> : (
          <button key={`${t[0]}${t[1]}`} onClick={() => tapTile(i)}
            className={canMove ? (picked === i ? 'picked' : playableIdx.has(i) ? 'can' : 'no') : ''}
            aria-label={`${t[0]}:${t[1]}`}>
            <Tile a={t[0]} b={t[1]} v big />
          </button>
        ))}
      </div>
      {canMove && (
        <div className="hstack" style={{ padding: '8px 0' }}>
          {domino.canDraw(state) && <button className="btn btn-primary" onClick={() => onMove({ draw: true }, () => domino.drawTile(state))}>ბაზრიდან აღება</button>}
          {domino.mustPass(state) && <button className="btn btn-outline" onClick={() => onMove({ pass: true }, () => domino.pass(state))}>პასი</button>}
        </div>
      )}
    </div>
  )
}
