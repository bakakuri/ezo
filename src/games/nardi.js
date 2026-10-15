// ნარდი (მოკლე ნარდი / ბექგემონი) — სრული წესები:
// ცემა და ბარიდან შემოსვლა, დუბლი = 4 სვლა, ორივე ქვის გამოყენება სავალდებულოა,
// თუ მხოლოდ ერთი შეიძლება — დიდი; გაყვანა სახლიდან; მარსი (გამონი) = 2 ქულა.
// points[i]: დადებითი = თეთრის ქვები, უარყოფითი = შავის. თეთრი მიდის 23 → 0 (სახლი 0-5),
// შავი მიდის 0 → 23 (სახლი 18-23).

const other = (c) => (c === 'w' ? 'b' : 'w')
const sign = (c) => (c === 'w' ? 1 : -1)
const own = (v, c) => v * sign(c) > 0
const count = (v, c) => (own(v, c) ? Math.abs(v) : 0)

export function initState() {
  const points = Array(24).fill(0)
  points[23] = 2; points[12] = 5; points[7] = 3; points[5] = 5
  points[0] = -2; points[11] = -5; points[16] = -3; points[18] = -5
  return {
    points,
    bar: { w: 0, b: 0 },
    off: { w: 0, b: 0 },
    turn: 'w',
    phase: 'roll',
    dice: [],
    rolled: null,
    last: [],
    winner: null,
    score: 0,
  }
}

export function rollDice(rand = Math.random) {
  return [1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6)]
}

const allHome = (s, c) => {
  if (s.bar[c]) return false
  for (let i = 0; i < 24; i++) {
    const home = c === 'w' ? i <= 5 : i >= 18
    if (!home && count(s.points[i], c)) return false
  }
  return true
}

// ერთი ქვის ერთი სვლა კონკრეტული კამათლით
export function singleMoves(s, die) {
  const c = s.turn
  const moves = []
  const open = (i) => !(s.points[i] * sign(c) <= -2)
  if (s.bar[c]) {
    const to = c === 'w' ? 24 - die : die - 1
    if (open(to)) moves.push({ from: 'bar', to, die })
    return moves
  }
  const canBearOff = allHome(s, c)
  for (let i = 0; i < 24; i++) {
    if (!count(s.points[i], c)) continue
    const to = c === 'w' ? i - die : i + die
    if (to >= 0 && to <= 23) {
      if (open(to)) moves.push({ from: i, to, die })
    } else if (canBearOff) {
      const exact = c === 'w' ? to === -1 : to === 24
      if (exact) moves.push({ from: i, to: 'off', die })
      else {
        // ზედმეტი ქულით გაყვანა მხოლოდ მაშინ, თუ უფრო შორს ქვა აღარ დგას
        let farther = false
        if (c === 'w') { for (let j = i + 1; j <= 5; j++) if (count(s.points[j], c)) farther = true }
        else { for (let j = 18; j < i; j++) if (count(s.points[j], c)) farther = true }
        if (!farther) moves.push({ from: i, to: 'off', die })
      }
    }
  }
  return moves
}

export function applySingle(s, m) {
  const c = s.turn
  const points = s.points.slice()
  const bar = { ...s.bar }
  const off = { ...s.off }
  if (m.from === 'bar') bar[c]--
  else points[m.from] -= sign(c)
  let hit = false
  if (m.to === 'off') off[c]++
  else {
    if (points[m.to] * sign(c) === -1) { points[m.to] = 0; bar[other(c)]++; hit = true }
    points[m.to] += sign(c)
  }
  const dice = s.dice.slice()
  dice.splice(dice.indexOf(m.die), 1)
  return { ...s, points, bar, off, dice, last: [...s.last, { ...m, hit }] }
}

const keyOf = (s) => `${s.points.join(',')}|${s.bar.w},${s.bar.b}|${s.off.w},${s.off.b}|${[...s.dice].sort().join('')}`

function maxDepth(s, memo) {
  if (!s.dice.length || s.off[s.turn] === 15) return 0
  const k = keyOf(s)
  if (memo.has(k)) return memo.get(k)
  let best = 0
  for (const die of new Set(s.dice)) {
    for (const m of singleMoves(s, die)) {
      best = Math.max(best, 1 + maxDepth(applySingle(s, m), memo))
      if (best === s.dice.length) break
    }
    if (best === s.dice.length) break
  }
  memo.set(k, best)
  return best
}

// სვლები, რომლებიც ახლა დაშვებულია (წესების გათვალისწინებით)
export function legalMoves(s) {
  if (s.phase !== 'move' || !s.dice.length) return []
  const memo = new Map()
  const md = maxDepth(s, memo)
  if (md === 0) return []
  let cands = []
  for (const die of new Set(s.dice)) {
    for (const m of singleMoves(s, die)) {
      if (1 + maxDepth(applySingle(s, m), memo) === md) cands.push(m)
    }
  }
  const [a, b] = s.dice
  if (s.dice.length === 2 && a !== b && md === 1) {
    const hi = Math.max(a, b)
    if (cands.some((m) => m.die === hi)) cands = cands.filter((m) => m.die === hi)
  }
  return cands
}

function endTurn(s) {
  return { ...s, turn: other(s.turn), phase: 'roll', dice: [] }
}

// კამათლის გაგორება; თუ სვლა არ არის, სვლა ავტომატურად გადადის
export function applyRoll(s, roll) {
  const [a, b] = roll
  const dice = a === b ? [a, a, a, a] : [a, b]
  const next = { ...s, phase: 'move', dice, rolled: [a, b], last: [], noMoves: false }
  if (!legalMoves(next).length) return { ...endTurn(next), rolled: [a, b], noMoves: true, passedBy: s.turn }
  return next
}

export function applyMove(s, m) {
  let next = applySingle(s, m)
  if (next.off[s.turn] === 15) {
    const loser = other(s.turn)
    return { ...next, phase: 'over', dice: [], winner: s.turn, score: next.off[loser] === 0 ? 2 : 1 }
  }
  if (!next.dice.length || !legalMoves(next).length) next = endTurn(next)
  return next
}

// სვლა წყაროდან დანიშნულებამდე (UI-სთვის). რამდენიმე კამათელი თუ ემთხვევა — უმცირესი.
export function findMove(s, from, to) {
  return legalMoves(s)
    .filter((m) => m.from === from && m.to === to)
    .sort((x, y) => x.die - y.die)[0]
}

export const pipCount = (s, c) => {
  let n = s.bar[c] * 25
  for (let i = 0; i < 24; i++) n += count(s.points[i], c) * (c === 'w' ? i + 1 : 24 - i)
  return n
}
