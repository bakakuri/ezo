// გრძელი ნარდი. ორივე მოთამაშე ერთი მიმართულებით დადის, ცემა არ არის:
// პუნქტი, სადაც მოწინააღმდეგის თუნდაც ერთი ქვა დგას, დაკეტილია.
// თავიდან (სტარტის პუნქტიდან) ერთ სვლაში მხოლოდ ერთი ქვის აღება შეიძლება —
// გამონაკლისი: პირველ სვლაზე 6-6, 4-4 ან 3-3 — ორი ქვა.
// ექვსი ზედიზედ დაკეტილი პუნქტი („ღობე“) აკრძალულია, თუ მის წინ მოწინააღმდეგის არც ერთი ქვა არ დგას.
// ორივე კამათლის გამოყენება სავალდებულოა; თუ მხოლოდ ერთი შეიძლება — დიდი. მარსი = 2 ქულა.
//
// points[i]: დადებითი = თეთრი, უარყოფითი = შავი. თეთრის გზა: 23 → 0, სახლი 0–5.
// შავის გზა: 11 → 0 → 23 → 12, სახლი 12–17. pos(c, i) = გზაზე პოზიცია 0..23 (0 = თავი).

const other = (c) => (c === 'w' ? 'b' : 'w')
const sign = (c) => (c === 'w' ? 1 : -1)
const count = (v, c) => (v * sign(c) > 0 ? Math.abs(v) : 0)

export const idx = (c, p) => (c === 'w' ? 23 - p : (35 - p) % 24)
export const pos = (c, i) => (c === 'w' ? 23 - i : (35 - i) % 24)
const HEAD = { w: 23, b: 11 }

export function initState() {
  const points = Array(24).fill(0)
  points[HEAD.w] = 15
  points[HEAD.b] = -15
  return {
    variant: 'long',
    points,
    bar: null,
    off: { w: 0, b: 0 },
    turn: 'w',
    phase: 'roll',
    dice: [],
    rolled: null,
    last: [],
    headTaken: 0,
    headLimit: 1,
    turns: { w: 0, b: 0 },
    winner: null,
    score: 0,
  }
}

export function rollDice(rand = Math.random) {
  return [1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6)]
}

function allHome(s, c) {
  for (let i = 0; i < 24; i++) if (count(s.points[i], c) && pos(c, i) < 18) return false
  return true
}

// ღობე: მოწინააღმდეგის გზაზე 6+ ზედიზედ ჩემი პუნქტი, და მის წინ მოწინააღმდეგის ქვა არ დგას
export function illegalPrime(points, c) {
  const o = other(c)
  let run = 0
  let farthestOpp = -1
  for (let q = 0; q < 24; q++) if (count(points[idx(o, q)], o)) farthestOpp = q
  for (let q = 0; q < 24; q++) {
    run = count(points[idx(o, q)], c) ? run + 1 : 0
    if (run >= 6 && farthestOpp <= q) return true
  }
  return false
}

export function singleMoves(s, die) {
  const c = s.turn
  const moves = []
  const canBearOff = allHome(s, c)
  for (let i = 0; i < 24; i++) {
    if (!count(s.points[i], c)) continue
    const p = pos(c, i)
    if (p === 0 && s.headTaken >= s.headLimit) continue
    const tp = p + die
    if (tp <= 23) {
      const to = idx(c, tp)
      if (!count(s.points[to], other(c))) moves.push({ from: i, to, die })
    } else if (canBearOff) {
      let farther = false
      if (tp > 24) for (let q = 18; q < p; q++) if (count(s.points[idx(c, q)], c)) { farther = true; break }
      if (!farther) moves.push({ from: i, to: 'off', die })
    }
  }
  return moves.filter((m) => !illegalPrime(applySingle(s, m).points, c))
}

export function applySingle(s, m) {
  const c = s.turn
  const points = s.points.slice()
  const off = { ...s.off }
  points[m.from] -= sign(c)
  if (m.to === 'off') off[c]++
  else points[m.to] += sign(c)
  const dice = s.dice.slice()
  dice.splice(dice.indexOf(m.die), 1)
  const headTaken = s.headTaken + (m.from === HEAD[c] ? 1 : 0)
  return { ...s, points, off, dice, headTaken, last: [...s.last, { ...m }] }
}

const keyOf = (s) => `${s.points.join(',')}|${s.off.w},${s.off.b}|${s.headTaken}|${[...s.dice].sort().join('')}`

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
  return { ...s, turns: { ...s.turns, [s.turn]: s.turns[s.turn] + 1 }, turn: other(s.turn), phase: 'roll', dice: [] }
}

export function applyRoll(s, roll) {
  const [a, b] = roll
  const dice = a === b ? [a, a, a, a] : [a, b]
  const first = s.turns[s.turn] === 0
  const headLimit = first && a === b && [6, 4, 3].includes(a) ? 2 : 1
  const next = { ...s, phase: 'move', dice, rolled: [a, b], last: [], headTaken: 0, headLimit, noMoves: false }
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

export function findMove(s, from, to) {
  return legalMoves(s)
    .filter((m) => m.from === from && m.to === to)
    .sort((x, y) => x.die - y.die)[0]
}

export const pipCount = (s, c) => {
  let n = 0
  for (let i = 0; i < 24; i++) n += count(s.points[i], c) * (24 - pos(c, i))
  return n
}
