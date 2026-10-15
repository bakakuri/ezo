// პარტიის ჩანაწერის ტექსტი: ორი მომდევნო მდგომარეობიდან — რა სვლა გაკეთდა.
// ჭადრაკი — მოკლე ალგებრული ჩანაწერი ფიგურებით (♞f3, exd5, O-O, e8=♛#), დანარჩენი — მარტივი აღწერა.
import * as chess from './chess.js'
import * as chess960 from './chess960.js'
import { N as GN } from './gomoku.js'
import { GAMES } from './index.js'

// შევსებული ფიგურები — პატარა ზომაზეც კარგად იკითხება
const FIG = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' }
const placement = (fen) => fen.split(' ')[0]

export function chessSan(type, prev, next) {
  const last = next.last
  if (!last || !prev?.fen) return ''
  const rules = type === 'chess960' ? chess960 : chess
  const s = chess.fromFEN(prev.fen)
  const legal = rules.legalMoves(s)
  const [from, to] = last
  const cands = legal.filter((m) => m.from === from && (m.to === to || m.kingTo === to))
  // მეფის ერთი ნაბიჯი თუ როქი, ან რომელ ფიგურად გადაიქცა — ამას შემდეგი პოზიცია წყვეტს
  const m = cands.find((x) => placement(chess.toFEN(rules.makeMove(s, x))) === placement(next.fen)) || cands[0]
  if (!m) return ''
  const after = rules.makeMove(s, m)
  const st = rules.status(after)
  const tail = st.result === 'checkmate' ? '#' : st.check ? '+' : ''
  if (m.flag === 'castle') return (m.to > m.from ? 'O-O' : 'O-O-O') + tail
  if (m.flag === 'castle960') return ((m.kingTo & 7) === 6 ? 'O-O' : 'O-O-O') + tail
  const piece = s.board[m.from]
  const kind = piece.toUpperCase()
  const capture = Boolean(s.board[m.to]) || m.flag === 'ep'
  const dest = chess.sqName(m.to)
  if (kind === 'P') {
    return (capture ? chess.sqName(m.from)[0] + 'x' : '') + dest + (m.promo ? '=' + FIG[m.promo.toUpperCase()] : '') + tail
  }
  const rivals = legal.filter((x) => x.from !== m.from && x.to === m.to && s.board[x.from] === piece && !String(x.flag).startsWith('castle'))
  let dis = ''
  if (rivals.length) {
    const f = chess.sqName(m.from)
    if (!rivals.some((x) => (x.from & 7) === (m.from & 7))) dis = f[0]
    else if (!rivals.some((x) => x.from >> 3 === m.from >> 3)) dis = f[1]
    else dis = f
  }
  return FIG[kind] + dis + (capture ? 'x' : '') + dest + tail
}

const nardiPoint = (type, seat, i) => {
  if (i === 'bar') return 'ბარი'
  if (i === 'off') return 'გარეთ'
  if (type === 'longnardi') return seat === 'w' ? i + 1 : ((i + 12) % 24) + 1
  return seat === 'w' ? i + 1 : 24 - i
}

const pieces = (board, c) => board.filter((p) => p && p.toLowerCase() === c).length

// ერთი სვლის ტექსტი; kind: 'move' | 'roll' | 'info'
export function describeMove(type, prev, next) {
  switch (type) {
    case 'chess':
    case 'chess960':
      return { text: chessSan(type, prev, next), kind: 'move' }
    case 'checkers': {
      const path = next.last || []
      const foe = prev.turn === 'w' ? 'b' : 'w'
      const took = pieces(prev.board, foe) - pieces(next.board, foe)
      return { text: path.map((sq) => chess.sqName(sq)).join(took ? ':' : '–'), kind: 'move' }
    }
    case 'gomoku': {
      const i = next.last
      if (i == null) return { text: '', kind: 'move' }
      return { text: 'ABCDEFGHJKLMNOP'[i % GN] + (GN - Math.floor(i / GN)), kind: 'move' }
    }
    case 'nardi':
    case 'longnardi': {
      const step = (m) => `${nardiPoint(type, prev.turn, m.from)}→${nardiPoint(type, prev.turn, m.to)}${m.hit ? '×' : ''}`
      if (prev.phase === 'roll' && next.rolled) {
        // კომპიუტერი გაგორებას და სვლებს ერთად აკეთებს — მაშინ ყველა სვლა ერთ ჩანაწერშია
        const [a, b] = next.rolled
        const moves = (next.last || []).map(step).join(' ')
        return { text: `${a}:${b}${next.noMoves ? ', სვლა არ არის' : moves ? ` ${moves}` : ''}`, kind: 'roll' }
      }
      const m = next.last?.at(-1)
      if (!m) return { text: '', kind: 'move' }
      return { text: step(m), kind: 'move' }
    }
    case 'domino': {
      const l = next.last
      if (!l) return { text: '', kind: 'move' }
      if (l.drew) return { text: 'ბაზრიდან აიღო', kind: 'info' }
      if (l.passed) return { text: 'პასი', kind: 'info' }
      const [x, y] = l.tile
      return { text: `${x}|${y}${next.chain?.length > 1 ? (l.side === 'L' ? ' მარცხნივ' : ' მარჯვნივ') : ''}`, kind: 'move' }
    }
    default:
      return { text: '', kind: 'move' }
  }
}

// ჩანაწერის ყველა კადრი: [{ n, seat, text, kind, no }] — no = სვლის ნომერი (ჭადრაკში წყვილებად)
export function describeFrames(type, states) {
  const out = []
  let no = 0
  for (let k = 1; k < states.length; k++) {
    const prev = states[k - 1]
    const next = states[k]
    const seat = GAMES[type]?.seatOf(prev) || null
    let d
    try { d = describeMove(type, prev, next) } catch { d = { text: '', kind: 'move' } }
    if (type === 'chess' || type === 'chess960') no = Number(prev.fen?.split(' ')[5]) || no + 1
    else if (d.kind === 'roll' || !['nardi', 'longnardi'].includes(type)) no++
    out.push({ k, seat, no, ...d })
  }
  return out
}
