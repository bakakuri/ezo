import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as bura from '../src/games/bura.js'
import * as loto from '../src/games/loto.js'
import { buraBot } from '../src/games/bots.js'
import { applyAction, publicState, handsOf } from '../src/games/server.js'
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
const base = (over = {}) => ({
  hands: { a: ['9h', 'Ts', 'Kd'], b: ['6s', 'Ah', 'Jc'] }, stock: ['7c', '8c', '6d', 'Qd'], trump: 'Qd', trumpSuit: 'd',
  leader: 'a', turn: 'a', phase: 'lead', lead: [], points: { a: 0, b: 0 }, taken: { a: 0, b: 0 }, trick: 1, last: null, winner: null, draw: false, bura: null, ...over,
})

// ================= ბურა
test('bura: deal, trump at the bottom, 3 cards each, points total 120', () => {
  const s = bura.initState(seeded(4))
  assert.equal(s.hands.a.length, 3)
  assert.equal(s.hands.b.length, 3)
  assert.equal(s.stock.length, 30)
  assert.equal(s.trump, s.stock[29])
  assert.equal(bura.sumPoints([...s.hands.a, ...s.hands.b, ...s.stock]), 120)
})

test('bura: multi-card lead only of one suit; respond must match the count', () => {
  const s = base({ hands: { a: ['9h', 'Th', 'Kd'], b: ['6s', 'Ah', 'Jc'] } })
  assert.ok(bura.canLead(s, ['9h', 'Th']))
  assert.ok(!bura.canLead(s, ['9h', 'Kd']))
  const t = bura.lead(s, ['9h', 'Th'])
  assert.equal(t.turn, 'b')
  assert.throws(() => bura.respond(t, ['6s']))
})

test('bura: beating every card takes the trick; failing gives it to the leader', () => {
  // b სჭრის 9♥-ს ტუზით: იღებს 11 ქულას და შემდეგი სვლა მისია
  let s = bura.lead(base(), ['9h'])
  s = bura.respond(s, ['Ah'])
  assert.equal(s.leader, 'b')
  assert.equal(s.points.b, 11)
  assert.equal(s.hands.a.length, 3)
  assert.equal(s.hands.b.length, 3)
  // b ვერ სჭრის: 10♠ რჩება მსვლელს (a), 6♠-ის მიუხედავად
  let u = bura.lead(base(), ['Ts'])
  u = bura.respond(u, ['6s'])
  assert.equal(u.leader, 'a')
  assert.equal(u.points.a, 10)
  assert.equal(u.last.beat, false)
})

test('bura: two-card response must beat both (any pairing), trumps beat other suits', () => {
  const s = base({ hands: { a: ['9h', 'Th', 'Kd'], b: ['6d', 'Ah', 'Jc'] } })
  const led = bura.lead(s, ['9h', 'Th'])
  const r = bura.respond(led, ['6d', 'Ah'])
  assert.equal(r.last.beat, true)
  assert.equal(r.points.b, 10 + 11)
  const r2 = bura.respond(led, ['Ah', 'Jc'])
  assert.equal(r2.last.beat, false)
  assert.equal(r2.points.a, 10 + 11 + 2)
})

test('bura: three trumps in hand is an instant win', () => {
  const s = base({ hands: { a: ['9h', 'Ts', 'Kd'], b: ['6s', 'Ah', 'Jc'] }, stock: ['Ad', 'Td', '6c', '7c', 'Qd'] })
  let t = bura.lead(s, ['Ts'])
  t = bura.respond(t, ['6s']) // a იღებს ხელს, პირველი იღებს Ad, b — Td
  assert.equal(t.phase, 'lead')
  // a: 9h Kd Ad — ჯერ არა; ბურა მოგვიანებით
  const u = bura.respond(bura.lead({ ...t, hands: { a: ['Kd', 'Ad', '9h'], b: ['Ah', 'Jc', 'Td'] }, stock: ['7d', '6c', 'Qd'] }, ['9h']), ['Jc'])
  assert.equal(u.hands.a.length, 3)
  assert.equal(u.phase, 'over')
  assert.equal(u.winner, 'a')
  assert.equal(u.bura, 'a')
  assert.equal(outcome('bura', u).result, 'bura')
})

test('bura: reaching 61 ends the game; empty hands end by points', () => {
  const s = base({ points: { a: 55, b: 20 } })
  const t = bura.respond(bura.lead(s, ['Ts']), ['6s'])
  assert.equal(t.phase, 'over')
  assert.equal(t.winner, 'a')
  const end = base({ hands: { a: ['Ts'], b: ['6s'] }, stock: [], points: { a: 40, b: 55 } })
  const e = bura.respond(bura.lead(end, ['Ts']), ['6s'])
  assert.equal(e.phase, 'over')
  assert.equal(e.winner, 'b')
})

test('bura: bots play full games to the end; server hides hands and stock', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rand = seeded(seed)
    let s = bura.initState(rand)
    let guard = 0
    while (s.phase !== 'over' && guard++ < 200) s = buraBot(s)
    assert.equal(s.phase, 'over', `seed ${seed}`)
    const o = outcome('bura', s)
    assert.ok(o.over)
  }
  const s = bura.initState(seeded(9))
  const pub = publicState('bura', s)
  assert.deepEqual(pub.hands.a, [null, null, null])
  assert.ok(pub.stock.every((x) => x === null))
  assert.equal(pub.trump, s.trump)
  assert.deepEqual(handsOf('bura', s).a, s.hands.a)
  const seat = s.turn
  const next = applyAction('bura', s, { lead: [s.hands[seat][0]] })
  assert.equal(next.phase, 'respond')
  assert.throws(() => applyAction('bura', next, { lead: [next.hands[next.turn][0]] }))
})

// ================= ლოტო
test('loto: tickets have 15 numbers, 5 per row, every column used, column ranges', () => {
  const rand = seeded(3)
  for (let i = 0; i < 200; i++) {
    const t = loto.makeTicket(rand)
    assert.equal(loto.numbersOf(t).length, 15)
    for (const row of t) assert.equal(row.filter((n) => n !== null).length, 5)
    for (let c = 0; c < 9; c++) {
      const col = t.map((r) => r[c]).filter((n) => n !== null)
      assert.ok(col.length >= 1 && col.length <= 3)
      for (const n of col) assert.ok(c === 0 ? n >= 1 && n <= 9 : c === 8 ? n >= 80 && n <= 90 : Math.floor(n / 10) === c)
      assert.deepEqual(col, [...col].sort((a, b) => a - b))
    }
  }
})

test('loto: first call starts the clock, draws only when due, line mode finishes on a full row', () => {
  let s = loto.initState(seeded(11), 'line', 4)
  assert.equal(s.bag.length, 90)
  s = loto.draw(s, 1000)
  assert.equal(s.drawn.length, 0)
  assert.throws(() => loto.draw(s, 1200))
  let t = 2500
  while (s.phase === 'play') { s = loto.draw(s, t); t += s.interval }
  assert.ok(s.drawn.length >= 5 && s.drawn.length < 90)
  const set = new Set(s.drawn)
  for (const w of s.winners) assert.ok(loto.rowsLeft(s.tickets[w], set).some((n) => n === 0))
  const o = outcome('loto', s)
  assert.ok(o.over)
  assert.equal(o.result, s.draw ? 'lotodraw' : 'loto')
  // full mode takes longer
  let f = loto.initState(seeded(11), 'full', 2)
  f = loto.draw(f, 0)
  let tt = 2000
  while (f.phase === 'play') { f = loto.draw(f, tt); tt += f.interval }
  assert.ok(f.drawn.length > s.drawn.length)
  for (const w of f.winners) assert.ok(loto.rowsLeft(f.tickets[w], new Set(f.drawn)).every((n) => n === 0))
})
