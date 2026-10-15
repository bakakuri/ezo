// ჭადრაკი 960 (ფიშერის ჭადრაკი): ფიგურები პირველ ჰორიზონტალზე შემთხვევით რიგშია — კუები სხვადასხვა ფერზე,
// მეფე ეტლებს შორის, შავები სარკისებურად. სხვა წესები ჩვეულებრივია; როქის შემდეგ მეფე და ეტლი იგივე
// უჯრებზე დგება, რაც ჩვეულებრივ ჭადრაკში (g/c და f/d).
// როქის უფლება ინახება ეტლის ხაზის ასოთი (Shredder-FEN): თეთრი — დიდი (მაგ. „HB“), შავი — პატარა („hb“).
// როქის სვლა: მეფე → საკუთარი ეტლის უჯრა (ან, თუ ცალსახაა, მეფის ბოლო უჯრა).
import * as chess from './chess.js'

const FILES = 'abcdefgh'
const KNIGHTS = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]]

// საწყისი რიგი ნომრით 0–959 (518 = ჩვეულებრივი ჭადრაკი)
export function backRank(n) {
  const pos = Array(8).fill(null)
  let k = n
  pos[(k % 4) * 2 + 1] = 'B'; k = Math.floor(k / 4)
  pos[(k % 4) * 2] = 'B'; k = Math.floor(k / 4)
  const free = () => pos.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0)
  pos[free()[k % 6]] = 'Q'; k = Math.floor(k / 6)
  const [n1, n2] = KNIGHTS[k]
  const f = free()
  pos[f[n1]] = 'N'
  pos[f[n2]] = 'N'
  const [r1, kk, r2] = free()
  pos[r1] = 'R'; pos[kk] = 'K'; pos[r2] = 'R'
  return pos.join('')
}

export function startFEN(n) {
  const w = backRank(n)
  const rooks = [...w].map((p, i) => (p === 'R' ? FILES[i] : '')).join('')
  const castle = rooks.split('').reverse().join('').toUpperCase() + rooks.split('').reverse().join('')
  return `${w.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${w} w ${castle} - 0 1`
}

export function initState(rand = Math.random) {
  const n = Math.floor(rand() * 960) % 960
  return { fen: startFEN(n), turn: 'w', last: null, count: 0, n }
}

const backRow = (color) => (color === 'w' ? 7 : 0)
const rightsOf = (castling, color) => [...(castling || '')].filter((c) => (color === 'w' ? c === c.toUpperCase() : c === c.toLowerCase()))

function castleMoves(s) {
  const color = s.turn
  const enemy = color === 'w' ? 'b' : 'w'
  const row = backRow(color)
  const K = color === 'w' ? 'K' : 'k'
  const R = color === 'w' ? 'R' : 'r'
  const kSq = s.board.indexOf(K)
  if (kSq < 0 || kSq >> 3 !== row || chess.inCheck(s, color)) return []
  const kf = kSq & 7
  const out = []
  for (const letter of rightsOf(s.castling, color)) {
    const rf = FILES.indexOf(letter.toLowerCase())
    const rSq = row * 8 + rf
    if (s.board[rSq] !== R) continue
    const kingSide = rf > kf
    const kt = kingSide ? 6 : 2
    const rt = kingSide ? 5 : 3
    // ყველა უჯრა მეფისა და ეტლის გზაზე (და დანიშნულებაზე) ცარიელი უნდა იყოს — ამ ორის გარდა
    const lo = Math.min(kf, kt, rf, rt)
    const hi = Math.max(kf, kt, rf, rt)
    let clear = true
    for (let f = lo; f <= hi; f++) {
      const sq = row * 8 + f
      if (sq !== kSq && sq !== rSq && s.board[sq]) { clear = false; break }
    }
    if (!clear) continue
    // მეფის გზა შეტევის ქვეშ არ უნდა იყოს (მეფე და ეტლი დაფიდან მოხსნილია — სხვას არ ეფარება)
    const board = s.board.slice()
    board[kSq] = null
    board[rSq] = null
    let safe = true
    for (let f = Math.min(kf, kt); f <= Math.max(kf, kt); f++) {
      if (chess.isAttacked(board, row * 8 + f, enemy)) { safe = false; break }
    }
    if (!safe) continue
    // საბოლოო პოზიციაში მეფე შახში არ რჩება
    board[row * 8 + kt] = K
    board[row * 8 + rt] = R
    if (chess.isAttacked(board, row * 8 + kt, enemy)) continue
    out.push({ from: kSq, to: rSq, flag: 'castle960', rook: rSq, kingTo: row * 8 + kt, rookTo: row * 8 + rt })
  }
  return out
}

export function legalMoves(s) {
  // ჩვეულებრივი სვლები (chess.js Shredder-ასოებს ვერ ცნობს, ამიტომ ჩვეულებრივ როქს არ ქმნის)
  const normal = chess.legalMoves(s)
  const castles = castleMoves(s)
  const aliases = castles
    .filter((c) => c.kingTo !== c.from && c.kingTo !== c.rook && !normal.some((m) => m.from === c.from && m.to === c.kingTo))
    .map((c) => ({ ...c, to: c.kingTo }))
  return [...normal, ...castles, ...aliases]
}

export function makeMove(s, m) {
  const color = s.turn
  const enemy = color === 'w' ? 'b' : 'w'
  let next
  if (m.flag === 'castle960') {
    const board = s.board.slice()
    const K = board[m.from]
    const R = board[m.rook]
    board[m.from] = null
    board[m.rook] = null
    board[m.kingTo] = K
    board[m.rookTo] = R
    next = { board, turn: enemy, castling: s.castling, ep: null, half: s.half + 1, full: color === 'b' ? s.full + 1 : s.full }
  } else {
    next = chess.makeMove(s, m)
  }
  // როქის უფლებები: მეფემ გაიარა — ორივე; ეტლი წავიდა ან მოკლეს საწყის უჯრაზე — ის ერთი
  let castling = s.castling || ''
  const piece = s.board[m.from]
  if (piece && piece.toLowerCase() === 'k') castling = [...castling].filter((c) => !rightsOf(castling, color).includes(c)).join('')
  for (const sq of [m.from, m.to]) {
    const row = sq >> 3
    for (const c of ['w', 'b']) {
      if (row !== backRow(c)) continue
      const letter = c === 'w' ? FILES[sq & 7].toUpperCase() : FILES[sq & 7]
      if (castling.includes(letter) && s.board[sq] && s.board[sq].toLowerCase() === 'r' && chess.colorOf(s.board[sq]) === c) castling = castling.replace(letter, '')
    }
  }
  return { ...next, castling }
}

function insufficient(board) {
  const rest = board.filter((p) => p && p.toLowerCase() !== 'k')
  if (rest.length === 0) return true
  return rest.length === 1 && ['n', 'b'].includes(rest[0].toLowerCase())
}

export function status(s) {
  const check = chess.inCheck(s)
  const moves = legalMoves(s)
  if (!moves.length) {
    return check ? { over: true, result: 'checkmate', winner: s.turn === 'w' ? 'b' : 'w', check } : { over: true, result: 'stalemate', winner: null, check }
  }
  if (s.half >= 100) return { over: true, result: 'fifty', winner: null, check }
  if (insufficient(s.board)) return { over: true, result: 'material', winner: null, check }
  return { over: false, result: null, winner: null, check }
}

export function perft(s, depth) {
  if (depth === 0) return 1
  let n = 0
  // ფსევდონიმები (მეფის უჯრაზე როქი) ერთსა და იმავე სვლას ორჯერ არ დავთვლით
  for (const m of legalMoves(s).filter((x) => !(x.flag === 'castle960' && x.to !== x.rook))) n += perft(makeMove(s, m), depth - 1)
  return n
}

export function applyToState(state, move) {
  const next = makeMove(chess.fromFEN(state.fen), move)
  const shown = move.flag === 'castle960' ? [move.from, move.kingTo] : [move.from, move.to]
  return { ...state, fen: chess.toFEN(next), turn: next.turn, last: shown, count: state.count + 1 }
}
