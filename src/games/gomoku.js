// ხუთი რიგში (გომოკუ, თავისუფალი წესები): 15×15 დაფა, ქვას დებ გადაკვეთაზე; ვინც პირველი ააწყობს
// ხუთ (ან მეტ) ქვას ერთ ხაზზე — ჰორიზონტალურად, ვერტიკალურად ან დიაგონალზე — იგებს. სავსე დაფა — ფრე.
// ადგილები: 'a' — შავები (იწყებს), 'b' — თეთრები. დაფა ინახება 225-სიმბოლოიან სტრიქონად: '.', 'a', 'b'.

export const N = 15
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]]
const other = (s) => (s === 'a' ? 'b' : 'a')

export function initState() {
  return { board: '.'.repeat(N * N), turn: 'a', last: null, count: 0, line: null, winner: null }
}

const at = (board, r, c) => (r >= 0 && r < N && c >= 0 && c < N ? board[r * N + c] : null)

// ხაზი იმ უჯრიდან, სადაც ქვა დაიდო (5+ — მოგება)
function lineThrough(board, i) {
  const p = board[i]
  const r0 = Math.floor(i / N)
  const c0 = i % N
  for (const [dr, dc] of DIRS) {
    const cells = [i]
    for (const sgn of [1, -1]) {
      let r = r0 + dr * sgn
      let c = c0 + dc * sgn
      while (at(board, r, c) === p) { cells.push(r * N + c); r += dr * sgn; c += dc * sgn }
    }
    if (cells.length >= 5) return cells.sort((a, b) => a - b)
  }
  return null
}

export const isOver = (state) => Boolean(state.winner) || state.draw === true

export function play(state, i) {
  if (isOver(state)) throw new Error('თამაში დასრულებულია')
  if (!Number.isInteger(i) || i < 0 || i >= N * N || state.board[i] !== '.') throw new Error('ეს უჯრა დაკავებულია')
  const board = state.board.slice(0, i) + state.turn + state.board.slice(i + 1)
  const line = lineThrough(board, i)
  const full = !board.includes('.')
  return {
    board, turn: line || full ? state.turn : other(state.turn), last: i, count: state.count + 1,
    line, winner: line ? state.turn : null, draw: !line && full,
  }
}

// ---- კომპიუტერი: ყოველ თავისუფალ უჯრას (ქვების ახლოს) ვაფასებთ თავდასხმითაც და დაცვითაც
const SCORE = { five: 1e7, open4: 2e5, four: 2e4, open3: 8e3, three: 600, open2: 300, two: 40, one: 6 }

function patternScore(board, i, p) {
  const r0 = Math.floor(i / N)
  const c0 = i % N
  let total = 0
  for (const [dr, dc] of DIRS) {
    let count = 1
    let open = 0
    for (const sgn of [1, -1]) {
      let r = r0 + dr * sgn
      let c = c0 + dc * sgn
      while (at(board, r, c) === p) { count++; r += dr * sgn; c += dc * sgn }
      if (at(board, r, c) === '.') open++
    }
    if (count >= 5) total += SCORE.five
    else if (count === 4) total += open === 2 ? SCORE.open4 : open === 1 ? SCORE.four : 0
    else if (count === 3) total += open === 2 ? SCORE.open3 : open === 1 ? SCORE.three : 0
    else if (count === 2) total += open === 2 ? SCORE.open2 : open === 1 ? SCORE.two : 0
    else if (open) total += SCORE.one * open
  }
  return total
}

export function candidates(board, radius = 2) {
  const out = []
  if (!board.includes('a') && !board.includes('b')) return [Math.floor((N * N) / 2)]
  for (let i = 0; i < N * N; i++) {
    if (board[i] !== '.') continue
    const r = Math.floor(i / N)
    const c = i % N
    let near = false
    for (let dr = -radius; dr <= radius && !near; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const v = at(board, r + dr, c + dc)
        if (v && v !== '.') { near = true; break }
      }
    }
    if (near) out.push(i)
  }
  return out
}

export function bestMove(state, rand = Math.random) {
  const me = state.turn
  const foe = other(me)
  let best = -1
  let bestScore = -Infinity
  for (const i of candidates(state.board)) {
    const mine = patternScore(state.board, i, me)
    const theirs = patternScore(state.board, i, foe)
    // საკუთარი მოგება პირველია, მერე მეტოქის მოგების დაბლოკვა, მერე ბალანსი
    const score = (mine >= SCORE.five ? 1e9 : 0) + (theirs >= SCORE.five ? 5e8 : 0) + mine * 1.1 + theirs + rand() * 3
    if (score > bestScore) { bestScore = score; best = i }
  }
  return best
}
