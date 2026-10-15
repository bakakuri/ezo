import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as ln from '../src/games/longnardi.js'
import * as durak from '../src/games/durak.js'
import * as joker from '../src/games/joker.js'
import { longnardiBot, durakBot, jokerBot } from '../src/games/bots.js'
import { applyAction, publicState, handsOf, initFor } from '../src/games/server.js'
import { outcome } from '../src/games/index.js'

function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ================= გრძელი ნარდი
test('longnardi: start on heads, one checker from head per turn', () => {
  let s = ln.initState()
  assert.equal(s.points[23], 15)
  assert.equal(s.points[11], -15)
  s = ln.applyRoll(s, [5, 2])
  const fromHead = ln.legalMoves(s).filter((m) => m.from === 23)
  assert.ok(fromHead.length)
  s = ln.applyMove(s, ln.findMove(s, 23, 18))
  // მეორე ქვა თავიდან აღარ შეიძლება — მხოლოდ იმავე ქვის გაგრძელება
  assert.deepEqual(ln.legalMoves(s).map((m) => m.from), [18])
})

test('longnardi: first-turn 6-6 allows two checkers off the head', () => {
  let s = ln.applyRoll(ln.initState(), [6, 6])
  s = ln.applyMove(s, ln.findMove(s, 23, 17))
  assert.ok(ln.findMove(s, 23, 17), 'second head checker allowed')
  s = ln.applyMove(s, ln.findMove(s, 23, 17))
  // 17 → 11 შავის თავია (დაკეტილი), ამიტომ სვლა მთავრდება
  assert.equal(s.turn, 'b')
  assert.equal(s.points[17], 2)
  assert.equal(s.points[23], 13)
})

test('longnardi: no hitting — opponent single checker blocks a point', () => {
  const s0 = ln.initState()
  const points = s0.points.slice()
  points[11] = -14; points[20] = -1 // შავის ერთი ქვა თეთრის გზაზე
  const s = ln.applyRoll({ ...s0, points }, [3, 1])
  assert.ok(!ln.legalMoves(s).some((m) => m.to === 20))
})

test('longnardi: six-point prime is forbidden when no opponent checker is ahead of it', () => {
  // თეთრი: 5 ზედიზედ პუნქტი 13..17 + ქვა 19-ზე, რომელიც 18-ზე გადავა და ღობეს შეკრავს
  const pts = Array(24).fill(0)
  for (const i of [13, 14, 15, 16, 17]) pts[i] = 2
  pts[19] = 1; pts[23] = 4
  pts[11] = -15 // შავის ყველა ქვა თავზე: ღობის უკან
  let s = { ...ln.initState(), points: pts, turns: { w: 5, b: 5 } }
  assert.equal(ln.illegalPrime(pts, 'w'), false)
  s = ln.applyRoll(s, [1, 2])
  assert.ok(!ln.legalMoves(s).some((m) => m.from === 19 && m.to === 18), 'closing the prime is illegal')
  // თუ შავის ერთი ქვა უკვე ღობის წინაა (შავის გზაზე შორს) — დასაშვებია
  const pts2 = pts.slice(); pts2[11] = -14; pts2[12] = -1 // შავის გზაზე q=23 — ღობის (q 17–22) წინ
  const s2 = ln.applyRoll({ ...ln.initState(), points: pts2, turns: { w: 5, b: 5 } }, [1, 2])
  assert.ok(ln.legalMoves(s2).some((m) => m.from === 19 && m.to === 18))
})

test('longnardi: bear off and mars', () => {
  const pts = Array(24).fill(0)
  pts[0] = 1; pts[11] = -15
  let s = { ...ln.initState(), points: pts, off: { w: 14, b: 0 }, turns: { w: 20, b: 20 } }
  s = ln.applyRoll(s, [6, 5])
  s = ln.applyMove(s, ln.findMove(s, 0, 'off'))
  assert.equal(s.phase, 'over')
  assert.equal(s.winner, 'w')
  assert.equal(s.score, 2)
})

test('longnardi: bot vs bot games terminate, checkers conserved, no illegal primes', () => {
  for (let g = 0; g < 12; g++) {
    let s = ln.initState()
    let n = 0
    while (s.phase !== 'over' && n++ < 3000) {
      s = longnardiBot(s)
      const w = s.points.reduce((a, v) => a + (v > 0 ? v : 0), 0) + s.off.w
      const b = s.points.reduce((a, v) => a + (v < 0 ? -v : 0), 0) + s.off.b
      assert.equal(w, 15); assert.equal(b, 15)
    }
    assert.equal(s.phase, 'over', `game ${g} finished`)
    assert.equal(s.off[s.winner], 15)
    assert.equal(outcome('longnardi', s).over, true)
  }
})

// ================= დურაკი
const total = (s) => s.hands.a.length + s.hands.b.length + s.stock.length + s.table.reduce((n, p) => n + 1 + (p.d ? 1 : 0), 0) + s.discard

test('durak: deal, trump and first attacker', () => {
  const s = durak.initState(seeded(7))
  assert.equal(s.hands.a.length, 6)
  assert.equal(s.hands.b.length, 6)
  assert.equal(s.stock.length, 24)
  assert.equal(s.trump, s.stock[23])
  assert.equal(total(s), 36)
  const low = (h) => Math.min(99, ...h.filter((c) => c[1] === s.trumpSuit).map((c) => '6789TJQKA'.indexOf(c[0])))
  if (low(s.hands.b) < low(s.hands.a)) assert.equal(s.attacker, 'b')
  else assert.equal(s.attacker, 'a')
})

test('durak: beats', () => {
  assert.ok(durak.beats('Qh', 'Th', 's'))
  assert.ok(!durak.beats('9h', 'Th', 's'))
  assert.ok(durak.beats('6s', 'Ah', 's'))
  assert.ok(!durak.beats('Ah', '6s', 's'))
  assert.ok(!durak.beats('Kd', 'Th', 's'))
})

test('durak: bout — attack, beat, throw-in by rank, bita swaps roles and refills', () => {
  const base = {
    hands: { a: ['7h', '7d', 'Kc', '9s', 'Jd', '6c'], b: ['9h', 'Ad', 'Qc', 'Th', '8c', '6d'] },
    stock: ['8h', '8d', 'As', 'Ks'], trump: 'Ks', trumpSuit: 's', table: [], attacker: 'a', turn: 'a',
    phase: 'attack', limit: 6, discard: 0, winner: null, draw: false, last: null, bout: 1,
  }
  let s = durak.attack(base, '7h')
  assert.equal(s.turn, 'b')
  assert.throws(() => durak.defend(s, '6d', 0))
  s = durak.defend(s, '9h', 0)
  assert.equal(s.turn, 'a')
  assert.deepEqual(durak.attackOptions(s).sort(), ['7d', '9s'])
  s = durak.attack(s, '7d')
  s = durak.defend(s, 'Ad', 1)
  assert.equal(s.phase, 'attack')
  s = durak.done(s)
  assert.equal(s.attacker, 'b')
  assert.equal(s.discard, 4)
  assert.equal(s.hands.a.length, 6) // ორი აიღო დასტიდან
  assert.equal(s.hands.b.length, 6)
  assert.equal(total(s), 16) // ხელით აწყობილი ნაკრები: 12 ხელში + 4 დასტაში
})

test('durak: take — attacker may throw in more, then defender collects all', () => {
  const base = {
    hands: { a: ['7h', '7d', '7c', '9s', 'Jd', '6c'], b: ['9h', 'Ad', 'Qc', '8c', '6d', 'Th'] },
    stock: [], trump: 'Ks', trumpSuit: 's', table: [], attacker: 'a', turn: 'a',
    phase: 'attack', limit: 6, discard: 0, winner: null, draw: false, last: null, bout: 1,
  }
  let s = durak.attack(base, '7h')
  s = durak.take(s)
  assert.equal(s.phase, 'take')
  assert.equal(s.turn, 'a')
  s = durak.attack(s, '7d')
  s = durak.attack(s, '7c') // სხვა 7 აღარ აქვს → ავტომატურად მთავრდება
  assert.equal(s.phase, 'attack')
  assert.equal(s.attacker, 'a')
  assert.equal(s.hands.b.length, 9)
})

test('durak: throw-in limited by defender hand size at bout start', () => {
  const base = {
    hands: { a: ['7h', '7d', '7c', '7s', 'Jd', '6c'], b: ['9h', 'Ad'] },
    stock: [], trump: 'Ks', trumpSuit: 's', table: [], attacker: 'a', turn: 'a',
    phase: 'attack', limit: 2, discard: 0, winner: null, draw: false, last: null, bout: 1,
  }
  let s = durak.attack(base, '7h')
  s = durak.take(s)
  s = durak.attack(s, '7d')
  // ლიმიტი 2 → მეტი ვეღარ, მაგიდა აღებულია
  assert.equal(s.hands.b.length, 4)
  assert.equal(s.table.length, 0)
})

test('durak: bot games terminate, 36 cards conserved, winner or draw', () => {
  for (let g = 0; g < 40; g++) {
    let s = durak.initState(seeded(100 + g))
    let n = 0
    while (s.phase !== 'over' && n++ < 2000) {
      s = durakBot(s)
      assert.equal(total(s), 36)
    }
    assert.equal(s.phase, 'over', `game ${g} over`)
    const o = outcome('durak', s)
    assert.ok(o.over)
    if (s.winner) assert.equal(s.hands[s.winner].length, 0)
  }
})

test('durak: server hides hands and stock, keeps trump visible', () => {
  const full = initFor('durak', seeded(3))
  const pub = publicState('durak', full)
  assert.ok(pub.hands.a.every((x) => x === null))
  assert.ok(pub.stock.every((x) => x === null))
  assert.equal(pub.trump, full.trump)
  assert.deepEqual(handsOf('durak', full).a, full.hands.a)
  const card = full.hands[full.attacker][0]
  const next = applyAction('durak', full, { attack: card })
  assert.equal(next.table[0].a, card)
  assert.throws(() => applyAction('durak', next, { attack: next.hands[next.attacker][0] }), /სვლა|კარტ/)
})

// ================= ჯოკერი
test('joker: deck has 36 cards, two jokers, no black sixes', () => {
  const d = joker.jokerDeck()
  assert.equal(d.length, 36)
  assert.equal(new Set(d).size, 36)
  assert.ok(d.includes('X1') && d.includes('X2'))
  assert.ok(!d.includes('6s') && !d.includes('6c'))
  assert.ok(d.includes('6h') && d.includes('6d'))
})

test('joker: scoring table (pagat examples)', () => {
  assert.equal(joker.handPoints(4, 0, 0, false), 50)
  assert.equal(joker.handPoints(4, 0, 2, false), 20)
  assert.equal(joker.handPoints(4, 3, 3, false), 200)
  assert.equal(joker.handPoints(4, 3, 4, false), 40)
  assert.equal(joker.handPoints(4, 4, 3, false), 30)
  assert.equal(joker.handPoints(4, 4, 4, false), 400)
  assert.equal(joker.handPoints(4, 2, 0, false), -200)
  assert.equal(joker.handPoints(9, 2, 0, true), -500)
  assert.equal(joker.handPoints(1, 1, 1, false), 100)
})

test('joker: trick winner rules', () => {
  const W = (trick, ts) => trick[joker.trickWinner(trick, ts)].seat
  // ჩვეულებრივი: კოზირი სჯობს
  assert.equal(W([{ seat: 'a', card: 'Ah' }, { seat: 'b', card: '7s' }, { seat: 'c', card: 'Kh' }, { seat: 'd', card: '9s' }], 's'), 'd')
  // მასტი, კოზირის გარეშე
  assert.equal(W([{ seat: 'a', card: 'Th' }, { seat: 'b', card: 'Ah' }, { seat: 'c', card: 'Kd' }, { seat: 'd', card: '6h' }], 's'), 'b')
  // შემოსული მაღალი ჯოკერი არაკოზირ მასტზე — კოზირით მოიჭრება
  assert.equal(W([{ seat: 'a', card: 'X1', mode: 'high', suit: 'h' }, { seat: 'b', card: 'Ah' }, { seat: 'c', card: '7s' }, { seat: 'd', card: 'Kh' }], 's'), 'c')
  // შემოსული მაღალი ჯოკერი კოზირზე — იგებს
  assert.equal(W([{ seat: 'a', card: 'X1', mode: 'high', suit: 's' }, { seat: 'b', card: 'As' }, { seat: 'c', card: '7s' }, { seat: 'd', card: 'Kh' }], 's'), 'a')
  // მეორე მაღალი ჯოკერი პირველს სჯობს
  assert.equal(W([{ seat: 'a', card: 'X1', mode: 'high', suit: 'h' }, { seat: 'b', card: 'X2', mode: 'high' }, { seat: 'c', card: '7s' }, { seat: 'd', card: 'Kh' }], 's'), 'b')
  // მომყოლი მაღალი ჯოკერი კოზირსაც სჯობს
  assert.equal(W([{ seat: 'a', card: 'Ah' }, { seat: 'b', card: '7s' }, { seat: 'c', card: 'X2', mode: 'high' }, { seat: 'd', card: 'As' }], 's'), 'c')
  // დაბალი ჯოკერი აგებს
  assert.equal(W([{ seat: 'a', card: '7h' }, { seat: 'b', card: 'X2', mode: 'low' }, { seat: 'c', card: '6h' }, { seat: 'd', card: '8d' }], 's'), 'a')
  // შემოსული დაბალი ჯოკერი — თუ არავინ აჰყვა და კოზირიც არ დადეს, ჯოკერი იგებს
  assert.equal(W([{ seat: 'a', card: 'X1', mode: 'low', suit: 'c' }, { seat: 'b', card: 'Ah' }, { seat: 'c', card: '6h' }, { seat: 'd', card: '8d' }], 's'), 'a')
  assert.equal(W([{ seat: 'a', card: 'X1', mode: 'low', suit: 'c' }, { seat: 'b', card: '7c' }, { seat: 'c', card: '6h' }, { seat: 'd', card: '8d' }], 's'), 'b')
  // უკოზიროდ
  assert.equal(W([{ seat: 'a', card: '7d' }, { seat: 'b', card: 'As' }, { seat: 'c', card: '9d' }, { seat: 'd', card: '8d' }], null), 'c')
})

test('joker: following rules — highest on high joker, must trump, joker always legal', () => {
  const s = {
    phase: 'play', turn: 'b', trumpSuit: 's',
    hands: { b: ['7h', 'Qh', '9h', 'As', 'X2'] },
    trick: [{ seat: 'a', card: 'X1', mode: 'high', suit: 'h' }],
  }
  assert.deepEqual(joker.legalCards(s).sort(), ['Qh', 'X2'].sort())
  const s2 = { ...s, hands: { b: ['7d', 'As', '6s', 'Kc'] }, trick: [{ seat: 'a', card: 'Th' }] }
  assert.deepEqual(joker.legalCards(s2).sort(), ['6s', 'As'])
  const s3 = { ...s, hands: { b: ['7d', 'Kc', 'X2'] }, trick: [{ seat: 'a', card: 'Th' }] }
  assert.deepEqual(joker.legalCards(s3).sort(), ['7d', 'Kc', 'X2'].sort())
  // დაბალი ჯოკერი — ნებისმიერი ამ მასტისა
  const s4 = { ...s, hands: { b: ['7h', 'Qh', 'As'] }, trick: [{ seat: 'a', card: 'X1', mode: 'low', suit: 'h' }] }
  assert.deepEqual(joker.legalCards(s4).sort(), ['7h', 'Qh'])
})

test('joker: dealer cannot make bids sum to hand size; 9-card trump choice sees 3 cards', () => {
  let s = joker.initState(seeded(11), 'quick')
  assert.equal(s.n, 9)
  assert.equal(s.phase, 'trump')
  assert.equal(s.turn, 'a')
  assert.equal(joker.visibleHand(s, 'a').length, 3)
  assert.ok(publicState('joker', s).hands.b.every((x) => x === null))
  assert.equal(publicState('joker', s).hands.b.length, 3)
  s = joker.chooseTrump(s, 'h')
  s = joker.bid(s, 3); s = joker.bid(s, 2); s = joker.bid(s, 3)
  assert.equal(s.turn, 'd')
  assert.ok(!joker.bidOptions(s).includes(1))
  assert.throws(() => joker.bid(s, 1))
  s = joker.bid(s, 0)
  assert.equal(s.phase, 'play')
  assert.equal(s.turn, 'a')
})

test('joker: standard schedule deals 1..8, 9×4, 8..1, 9×4 with turned trump', () => {
  const s = joker.initState(seeded(5), 'standard')
  assert.equal(s.n, 1)
  assert.equal(s.phase, 'bid')
  assert.ok(s.trump)
  assert.equal(joker.totalHands('standard'), 24)
  assert.equal(joker.totalHands('quick'), 4)
})

function playOut(mode, seed) {
  const rand = seeded(seed)
  let s = joker.initState(rand, mode)
  let n = 0
  let lastHand = -1
  while (s.phase !== 'over' && n++ < 5000) {
    if (s.phase === 'play' && s.trick.length === 0 && s.hands.a.length === s.n && `${s.set}:${s.hand}` !== lastHand) {
      lastHand = `${s.set}:${s.hand}`
      const all = [...s.hands.a, ...s.hands.b, ...s.hands.c, ...s.hands.d]
      assert.equal(new Set(all).size, 4 * s.n, 'no duplicate cards')
    }
    s = jokerBot(s, rand)
  }
  return s
}

test('joker: full quick and standard games with bots finish; totals match the score sheet', () => {
  for (const [mode, seed] of [['quick', 1], ['quick', 2], ['standard', 3], ['nines', 4]]) {
    const s = playOut(mode, seed)
    assert.equal(s.phase, 'over', `${mode} finished`)
    for (const x of joker.SEATS) assert.equal(s.scores[x], s.sheet.reduce((n, r) => n + r.points[x], 0))
    assert.equal(s.sheet.filter((r) => !r.bonus).length, joker.totalHands(mode))
    const o = outcome('joker', s)
    assert.ok(o.over)
    if (o.winner) assert.equal(Math.max(...joker.SEATS.map((x) => s.scores[x])), s.scores[o.winner])
  }
})

test('joker: server actions — illegal card and wrong joker declaration are rejected', () => {
  let s = initFor('joker', seeded(21), { mode: 'quick' })
  s = applyAction('joker', s, { trump: null })
  assert.equal(s.trumpSuit, null)
  for (const k of [2, 2, 2]) s = applyAction('joker', s, { bid: k })
  assert.throws(() => applyAction('joker', s, { bid: 3 }))
  s = applyAction('joker', s, { bid: 1 })
  const hand = s.hands[s.turn]
  const jk = hand.find((c) => c[0] === 'X')
  if (jk) assert.throws(() => applyAction('joker', s, { play: jk }), /ჯოკერი/)
  assert.throws(() => applyAction('joker', s, { play: 'Zz' }))
  const reg = hand.find((c) => c[0] !== 'X')
  const next = applyAction('joker', s, { play: reg })
  assert.equal(next.trick.length, 1)
})
