// ჭადრაკი — სრული წესები: როქი, ან-პასანი, გარდაქმნა, მატი/პატი, 50 სვლა.
// დაფა: 64 უჯრა, index = row*8 + file, row 0 = მე-8 ჰორიზონტალი (შავების მხარე).

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const FILES = 'abcdefgh'
export const sqName = (i) => FILES[i % 8] + (8 - Math.floor(i / 8))
export const sqIndex = (n) => (8 - Number(n[1])) * 8 + FILES.indexOf(n[0])
export const colorOf = (p) => (p ? (p === p.toUpperCase() ? 'w' : 'b') : null)

const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]]
const inside = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8

export function fromFEN(fen) {
  const [placement, turn = 'w', castling = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/)
  const board = Array(64).fill(null)
  let r = 0
  let f = 0
  for (const ch of placement) {
    if (ch === '/') { r++; f = 0; continue }
    if (/\d/.test(ch)) { f += Number(ch); continue }
    board[r * 8 + f] = ch
    f++
  }
  return {
    board,
    turn,
    castling: castling === '-' ? '' : castling,
    ep: ep === '-' ? null : sqIndex(ep),
    half: Number(half) || 0,
    full: Number(full) || 1,
  }
}

export function toFEN(s) {
  let out = ''
  for (let r = 0; r < 8; r++) {
    let empty = 0
    for (let f = 0; f < 8; f++) {
      const p = s.board[r * 8 + f]
      if (!p) { empty++; continue }
      if (empty) { out += empty; empty = 0 }
      out += p
    }
    if (empty) out += empty
    if (r < 7) out += '/'
  }
  return `${out} ${s.turn} ${s.castling || '-'} ${s.ep == null ? '-' : sqName(s.ep)} ${s.half} ${s.full}`
}

export function isAttacked(board, sq, by) {
  const r = sq >> 3
  const f = sq & 7
  const pr = by === 'w' ? r + 1 : r - 1
  const pawn = by === 'w' ? 'P' : 'p'
  for (const df of [-1, 1]) {
    if (inside(pr, f + df) && board[pr * 8 + f + df] === pawn) return true
  }
  const kn = by === 'w' ? 'N' : 'n'
  for (const [dr, df] of KN) if (inside(r + dr, f + df) && board[(r + dr) * 8 + f + df] === kn) return true
  const kg = by === 'w' ? 'K' : 'k'
  for (const [dr, df] of KG) if (inside(r + dr, f + df) && board[(r + dr) * 8 + f + df] === kg) return true
  const [B, R, Q] = by === 'w' ? ['B', 'R', 'Q'] : ['b', 'r', 'q']
  for (const [dirs, a] of [[DIAG, B], [ORTH, R]]) {
    for (const [dr, df] of dirs) {
      let rr = r + dr
      let ff = f + df
      while (inside(rr, ff)) {
        const p = board[rr * 8 + ff]
        if (p) { if (p === a || p === Q) return true; break }
        rr += dr
        ff += df
      }
    }
  }
  return false
}

const kingSq = (board, color) => board.indexOf(color === 'w' ? 'K' : 'k')
export const inCheck = (s, color = s.turn) => isAttacked(s.board, kingSq(s.board, color), color === 'w' ? 'b' : 'w')

function pseudoMoves(s) {
  const { board, turn } = s
  const enemy = turn === 'w' ? 'b' : 'w'
  const moves = []
  const up = turn === 'w' ? -1 : 1
  const startRow = turn === 'w' ? 6 : 1
  const promoRow = turn === 'w' ? 0 : 7
  const push = (from, to, flag) => {
    if (board[from].toLowerCase() === 'p' && to >> 3 === promoRow) {
      for (const promo of ['q', 'r', 'b', 'n']) moves.push({ from, to, promo, flag })
    } else moves.push({ from, to, flag })
  }
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq]
    if (!p || colorOf(p) !== turn) continue
    const r = sq >> 3
    const f = sq & 7
    const t = p.toLowerCase()
    if (t === 'p') {
      const r1 = r + up
      if (inside(r1, f) && !board[r1 * 8 + f]) {
        push(sq, r1 * 8 + f)
        const r2 = r + 2 * up
        if (r === startRow && !board[r2 * 8 + f]) moves.push({ from: sq, to: r2 * 8 + f, flag: 'double' })
      }
      for (const df of [-1, 1]) {
        if (!inside(r1, f + df)) continue
        const to = r1 * 8 + f + df
        if (board[to] && colorOf(board[to]) === enemy) push(sq, to, 'capture')
        else if (to === s.ep) moves.push({ from: sq, to, flag: 'ep' })
      }
    } else if (t === 'n' || t === 'k') {
      for (const [dr, df] of t === 'n' ? KN : KG) {
        if (!inside(r + dr, f + df)) continue
        const to = (r + dr) * 8 + f + df
        if (!board[to] || colorOf(board[to]) === enemy) moves.push({ from: sq, to })
      }
      if (t === 'k') {
        const home = turn === 'w' ? 60 : 4
        const [kSide, qSide] = turn === 'w' ? ['K', 'Q'] : ['k', 'q']
        if (sq === home && !isAttacked(board, home, enemy)) {
          if (s.castling.includes(kSide) && !board[home + 1] && !board[home + 2] &&
            !isAttacked(board, home + 1, enemy) && !isAttacked(board, home + 2, enemy)) {
            moves.push({ from: sq, to: home + 2, flag: 'castle' })
          }
          if (s.castling.includes(qSide) && !board[home - 1] && !board[home - 2] && !board[home - 3] &&
            !isAttacked(board, home - 1, enemy) && !isAttacked(board, home - 2, enemy)) {
            moves.push({ from: sq, to: home - 2, flag: 'castle' })
          }
        }
      }
    } else {
      const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : [...DIAG, ...ORTH]
      for (const [dr, df] of dirs) {
        let rr = r + dr
        let ff = f + df
        while (inside(rr, ff)) {
          const to = rr * 8 + ff
          if (board[to]) {
            if (colorOf(board[to]) === enemy) moves.push({ from: sq, to })
            break
          }
          moves.push({ from: sq, to })
          rr += dr
          ff += df
        }
      }
    }
  }
  return moves
}

const ROOK_HOME = { 56: 'Q', 63: 'K', 0: 'q', 7: 'k' }

export function makeMove(s, m) {
  const board = s.board.slice()
  const piece = board[m.from]
  const captured = board[m.to]
  board[m.to] = piece
  board[m.from] = null
  if (m.flag === 'ep') board[(m.from >> 3) * 8 + (m.to & 7)] = null
  if (m.promo) board[m.to] = s.turn === 'w' ? m.promo.toUpperCase() : m.promo.toLowerCase()
  if (m.flag === 'castle') {
    const kingSide = m.to > m.from
    const rookFrom = kingSide ? m.from + 3 : m.from - 4
    const rookTo = kingSide ? m.from + 1 : m.from - 1
    board[rookTo] = board[rookFrom]
    board[rookFrom] = null
  }
  let castling = s.castling
  if (piece === 'K') castling = castling.replace(/[KQ]/g, '')
  if (piece === 'k') castling = castling.replace(/[kq]/g, '')
  for (const sq of [m.from, m.to]) if (ROOK_HOME[sq]) castling = castling.replace(ROOK_HOME[sq], '')
  const isPawn = piece.toLowerCase() === 'p'
  return {
    board,
    turn: s.turn === 'w' ? 'b' : 'w',
    castling,
    ep: m.flag === 'double' ? (m.from + m.to) / 2 : null,
    half: isPawn || captured || m.flag === 'ep' ? 0 : s.half + 1,
    full: s.turn === 'b' ? s.full + 1 : s.full,
  }
}

export function legalMoves(s) {
  return pseudoMoves(s).filter((m) => !inCheck(makeMove(s, m), s.turn))
}

function insufficient(board) {
  const rest = board.filter((p) => p && p.toLowerCase() !== 'k')
  if (rest.length === 0) return true
  return rest.length === 1 && ['n', 'b'].includes(rest[0].toLowerCase())
}

// { over, result: 'checkmate'|'stalemate'|'fifty'|'material', winner: 'w'|'b'|null, check }
export function status(s) {
  const check = inCheck(s)
  const moves = legalMoves(s)
  if (moves.length === 0) {
    return check
      ? { over: true, result: 'checkmate', winner: s.turn === 'w' ? 'b' : 'w', check }
      : { over: true, result: 'stalemate', winner: null, check }
  }
  if (s.half >= 100) return { over: true, result: 'fifty', winner: null, check }
  if (insufficient(s.board)) return { over: true, result: 'material', winner: null, check }
  return { over: false, result: null, winner: null, check }
}

export function perft(s, depth) {
  if (depth === 0) return 1
  let n = 0
  for (const m of legalMoves(s)) n += perft(makeMove(s, m), depth - 1)
  return n
}

// ონლაინ თამაშის მდგომარეობა (DB-ში ინახება JSON-ად)
export function initState() {
  return { fen: START_FEN, turn: 'w', last: null, count: 0 }
}

export function applyToState(state, move) {
  const next = makeMove(fromFEN(state.fen), move)
  return { fen: toFEN(next), turn: next.turn, last: [move.from, move.to], count: state.count + 1 }
}
