// დომინო — ორი მოთამაშე, 0–6 ნაკრები (28 ქვა), თითოს 7, დანარჩენი ბაზარში.
// ვინც ვერ დადებს, იღებს ბაზრიდან; ბაზარი თუ ცარიელია — პასი.
// იგებს, ვინც პირველი დაცლის ხელს; ჩაკეტვისას — ვისაც ნაკლები ქულა აქვს.
// ადგილები: 'a' (თამაშის შემქმნელი) და 'b'.

export const otherSeat = (s) => (s === 'a' ? 'b' : 'a')
export const pips = (hand) => hand.reduce((n, [x, y]) => n + x + y, 0)

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function fullSet() {
  const tiles = []
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) tiles.push([a, b])
  return tiles
}

export function initState(rand = Math.random) {
  const tiles = shuffle(fullSet(), rand)
  const hands = { a: tiles.slice(0, 7), b: tiles.slice(7, 14) }
  const boneyard = tiles.slice(14)
  // იწყებს, ვისაც უდიდესი დუბლი აქვს, თორემ — უდიდესი ქვა
  const best = (h) => {
    const doubles = h.filter(([x, y]) => x === y).map(([x]) => 100 + x)
    return Math.max(...doubles, ...h.map(([x, y]) => x + y))
  }
  const turn = best(hands.a) >= best(hands.b) ? 'a' : 'b'
  return { hands, boneyard, chain: [], turn, passes: 0, winner: null, draw: false, last: null, count: 0 }
}

export const ends = (s) => (s.chain.length ? [s.chain[0][0], s.chain[s.chain.length - 1][1]] : null)

export function playable(s, seat = s.turn) {
  const e = ends(s)
  const out = []
  s.hands[seat].forEach(([x, y], i) => {
    if (!e) { out.push({ i, side: 'R' }); return }
    if (x === e[0] || y === e[0]) out.push({ i, side: 'L' })
    if (x === e[1] || y === e[1]) out.push({ i, side: 'R' })
  })
  return out
}

function finish(s) {
  const seat = s.turn
  if (!s.hands[seat].length) {
    return { ...s, winner: seat, score: pips(s.hands[otherSeat(seat)]) }
  }
  return { ...s, turn: otherSeat(seat) }
}

export function play(s, i, side) {
  const seat = s.turn
  const hand = s.hands[seat].slice()
  const [tile] = hand.splice(i, 1)
  const [x, y] = tile
  const chain = s.chain.slice()
  const e = ends(s)
  if (!e) chain.push([x, y])
  else if (side === 'L') {
    if (y === e[0]) chain.unshift([x, y])
    else if (x === e[0]) chain.unshift([y, x])
    else throw new Error('ქვა არ ერგება')
  } else {
    if (x === e[1]) chain.push([x, y])
    else if (y === e[1]) chain.push([y, x])
    else throw new Error('ქვა არ ერგება')
  }
  return finish({
    ...s,
    hands: { ...s.hands, [seat]: hand },
    chain,
    passes: 0,
    last: { seat, tile, side },
    count: s.count + 1,
  })
}

export function drawTile(s) {
  if (!s.boneyard.length) throw new Error('ბაზარი ცარიელია')
  const seat = s.turn
  const [t, ...rest] = s.boneyard
  return { ...s, hands: { ...s.hands, [seat]: [...s.hands[seat], t] }, boneyard: rest, last: { seat, drew: true } }
}

export function pass(s) {
  const passes = s.passes + 1
  if (passes >= 2) {
    const a = pips(s.hands.a)
    const b = pips(s.hands.b)
    if (a === b) return { ...s, passes, draw: true, winner: null, blocked: true }
    const winner = a < b ? 'a' : 'b'
    return { ...s, passes, winner, blocked: true, score: pips(s.hands[otherSeat(winner)]) }
  }
  return { ...s, passes, turn: otherSeat(s.turn), last: { seat: s.turn, passed: true } }
}

export const canDraw = (s) => !playable(s).length && s.boneyard.length > 0
export const mustPass = (s) => !playable(s).length && s.boneyard.length === 0
export const isOver = (s) => Boolean(s.winner || s.draw)
