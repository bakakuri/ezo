// შაშკი — რუსული წესები: მოჭრა სავალდებულოა, უბრალო ქვა უკანაც ჭრის,
// დამკა ("ქალი") შორს დადის და შორიდან ჭრის, ჯაჭვი ბოლომდე უნდა დასრულდეს,
// ნაჭერი ქვები სვლის ბოლოს იხსნება (ერთის ორჯერ ჭრა არ შეიძლება).
// დაფა: 64 უჯრა, row 0 ზემოთ. 'w'/'b' ქვა, 'W'/'B' დამკა. თეთრები ქვემოთ, მიდიან ზემოთ.

const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
const inside = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8
export const isDark = (sq) => ((sq >> 3) + (sq & 7)) % 2 === 1
const colorOf = (p) => (p ? p.toLowerCase() : null)
const isKing = (p) => p === 'W' || p === 'B'

export function initState() {
  const board = Array(64).fill(null)
  for (let sq = 0; sq < 64; sq++) {
    if (!isDark(sq)) continue
    const r = sq >> 3
    if (r < 3) board[sq] = 'b'
    else if (r > 4) board[sq] = 'w'
  }
  return { board, turn: 'w', last: null, count: 0 }
}

// ჭრის ყველა ჯაჭვი ერთი ქვიდან
function captureChains(board, origin, color, king, from, taken, path) {
  const r = from >> 3
  const f = from & 7
  const empty = (sq) => sq === origin || !board[sq]
  const promoRow = color === 'w' ? 0 : 7
  const results = []
  for (const [dr, df] of DIRS) {
    if (!king) {
      const mr = r + dr
      const mf = f + df
      const lr = r + 2 * dr
      const lf = f + 2 * df
      if (!inside(lr, lf)) continue
      const mid = mr * 8 + mf
      const land = lr * 8 + lf
      const mp = board[mid]
      if (!mp || mp === null || colorOf(mp) === color || taken.includes(mid) || mid === origin) continue
      if (!empty(land)) continue
      const nowKing = lr === promoRow
      const nextTaken = [...taken, mid]
      const nextPath = [...path, land]
      const more = captureChains(board, origin, color, nowKing, land, nextTaken, nextPath)
      if (more.length) results.push(...more)
      else results.push({ path: nextPath, caps: nextTaken, promote: nowKing })
    } else {
      let rr = r + dr
      let ff = f + df
      while (inside(rr, ff) && empty(rr * 8 + ff)) { rr += dr; ff += df }
      if (!inside(rr, ff)) continue
      const mid = rr * 8 + ff
      const mp = board[mid]
      if (colorOf(mp) === color || taken.includes(mid)) continue
      const landings = []
      let lr = rr + dr
      let lf = ff + df
      while (inside(lr, lf) && empty(lr * 8 + lf)) { landings.push(lr * 8 + lf); lr += dr; lf += df }
      if (!landings.length) continue
      const nextTaken = [...taken, mid]
      const withMore = []
      const ends = []
      for (const land of landings) {
        const more = captureChains(board, origin, color, true, land, nextTaken, [...path, land])
        if (more.length) withMore.push(...more)
        else ends.push({ path: [...path, land], caps: nextTaken, promote: false })
      }
      results.push(...(withMore.length ? withMore : ends))
    }
  }
  return results
}

export function legalMoves(state, color = state.turn) {
  const { board } = state
  const captures = []
  const quiet = []
  const forward = color === 'w' ? -1 : 1
  const promoRow = color === 'w' ? 0 : 7
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq]
    if (!p || colorOf(p) !== color) continue
    const king = isKing(p)
    for (const c of captureChains(board, sq, color, king, sq, [], [sq])) {
      captures.push({ ...c, promote: !king && (c.promote || c.path.some((x) => x >> 3 === promoRow)) })
    }
    if (captures.length) continue
    const r = sq >> 3
    const f = sq & 7
    for (const [dr, df] of DIRS) {
      if (!king && dr !== forward) continue
      let rr = r + dr
      let ff = f + df
      while (inside(rr, ff) && !board[rr * 8 + ff]) {
        quiet.push({ path: [sq, rr * 8 + ff], caps: [], promote: !king && rr === promoRow })
        if (!king) break
        rr += dr
        ff += df
      }
    }
  }
  return captures.length ? captures : quiet
}

export function applyMove(state, move) {
  const board = state.board.slice()
  const from = move.path[0]
  const to = move.path[move.path.length - 1]
  let piece = board[from]
  board[from] = null
  for (const c of move.caps) board[c] = null
  if (move.promote) piece = piece.toUpperCase()
  board[to] = piece
  return { board, turn: state.turn === 'w' ? 'b' : 'w', last: move.path, count: state.count + 1 }
}

export function status(state) {
  const moves = legalMoves(state)
  if (moves.length === 0) return { over: true, winner: state.turn === 'w' ? 'b' : 'w' }
  return { over: false, winner: null }
}

export const countPieces = (state, color) => state.board.filter((p) => colorOf(p) === color).length
