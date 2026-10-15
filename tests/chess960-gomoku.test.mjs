// ჭადრაკი 960 და ხუთი რიგში: წესები, როქი, მოგება, კომპიუტერი, სერვერული სვლა
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as chess from '../src/games/chess.js'
import * as c9 from '../src/games/chess960.js'
import * as gomoku from '../src/games/gomoku.js'
import { applyAction, initFor } from '../src/games/server.js'
import { outcome } from '../src/games/index.js'
import { BOTS } from '../src/games/bots.js'

test('960: ყველა საწყისი პოზიცია სწორია, 518 — ჩვეულებრივი', () => {
  const seen = new Set()
  for (let n = 0; n < 960; n++) {
    const r = c9.backRank(n)
    seen.add(r)
    assert.notEqual(r.indexOf('B') % 2, r.lastIndexOf('B') % 2, `bishops ${n}`)
    const k = r.indexOf('K')
    assert.ok(r.indexOf('R') < k && r.lastIndexOf('R') > k, `king between rooks ${n}`)
  }
  assert.equal(seen.size, 960)
  assert.equal(c9.backRank(518), 'RNBQKBNR')
})

test('960: perft ცნობილ პოზიციებზე', () => {
  const p = (fen, d) => c9.perft(chess.fromFEN(fen), d)
  assert.equal(p(c9.startFEN(518), 3), 8902)
  assert.deepEqual([1, 2, 3].map((d) => p('bqnb1rkr/pp3ppp/3ppn2/2p5/5P2/P2P4/NPP1P1PP/BQ1BNRKR w HFhf - 2 9', d)), [21, 528, 12189])
  assert.deepEqual([1, 2, 3].map((d) => p('2nnrbkr/p1qppppp/8/1ppb4/6PP/3PP3/PPP2P2/BQNNRBKR w HEhe - 1 9', d)), [21, 807, 18002])
})

test('960: როქი — მეფე g/c-ზე, ეტლი f/d-ზე, უფლებები იკარგება; შეტევის ქვეშ — არა', () => {
  // მეფე b1-ზე, ეტლები a1 და h1-ზე, შუა ცარიელი
  const s = chess.fromFEN('rk5r/8/8/8/8/8/8/RK5R w HAha - 0 1')
  const castles = c9.legalMoves(s).filter((m) => m.flag === 'castle960' && m.to === m.rook)
  assert.equal(castles.length, 2)
  const kingSide = castles.find((m) => m.rook === chess.sqIndex('h1'))
  const after = c9.makeMove(s, kingSide)
  assert.equal(after.board[chess.sqIndex('g1')], 'K')
  assert.equal(after.board[chess.sqIndex('f1')], 'R')
  assert.equal(after.board[chess.sqIndex('b1')], null)
  assert.equal(after.castling, 'ha')
  // ფსევდონიმი: მეფის უჯრაზე დაჭერაც (g1) იგივე როქია
  assert.ok(c9.legalMoves(s).some((m) => m.flag === 'castle960' && m.to === chess.sqIndex('g1')))
  // e1 შეტევის ქვეშაა (შავი ეტლი e8-ზე) — მოკლე როქი აკრძალულია (მეფე e1-ზე გადის)
  const attacked = chess.fromFEN('rk2r3/8/8/8/8/8/8/RK5R w HA - 0 1')
  assert.ok(!c9.legalMoves(attacked).some((m) => m.flag === 'castle960' && m.rook === chess.sqIndex('h1')))
  // ეტლის სვლა — მხოლოდ ის ერთი უფლება იკარგება
  const rookMove = c9.legalMoves(s).find((m) => m.from === chess.sqIndex('a1') && m.to === chess.sqIndex('a2'))
  assert.equal(c9.makeMove(s, rookMove).castling, 'Hha')
})

test('960: სერვერი და კომპიუტერი', () => {
  let st = initFor('chess960', () => 0.5)
  assert.match(st.fen, / w [A-H]{2}[a-h]{2} /)
  for (let i = 0; i < 6; i++) st = BOTS.chess960(st)
  assert.equal(st.count, 6)
  assert.throws(() => applyAction('chess960', st, { from: 0, to: 63 }))
})

test('ხუთი რიგში: ჰორიზონტალი, დიაგონალი, ექვსი, დაკავებული უჯრა', () => {
  let s = gomoku.initState()
  const N = gomoku.N
  // a: 0..4 ჰორიზონტალზე, b: მეორე ხაზზე
  for (let k = 0; k < 4; k++) { s = gomoku.play(s, k); s = gomoku.play(s, N + k) }
  assert.ok(!gomoku.isOver(s))
  s = gomoku.play(s, 4)
  assert.equal(s.winner, 'a')
  assert.deepEqual(s.line, [0, 1, 2, 3, 4])
  assert.throws(() => gomoku.play(s, 100))
  // დიაგონალი b-სთვის
  let d = gomoku.initState()
  const diag = [0, 16, 32, 48, 64].map((x) => x + 5)
  const junk = [200, 202, 204, 206, 208]
  for (let k = 0; k < 5; k++) { d = gomoku.play(d, junk[k]); if (!gomoku.isOver(d)) d = gomoku.play(d, diag[k]) }
  assert.equal(d.winner, 'b')
  assert.equal(outcome('gomoku', d).winner, 'b')
  // ექვსი რიგში — თავისუფალ წესებში მოგებაა
  let six = gomoku.initState()
  for (const k of [0, 1, 2, 4, 5]) { six = gomoku.play(six, 3 * N + k); six = gomoku.play(six, 10 * N + k * 2) }
  six = gomoku.play(six, 3 * N + 3)
  assert.equal(six.winner, 'a')
  assert.equal(six.line.length, 6)
  assert.throws(() => gomoku.play(gomoku.initState(), -1))
})

test('ხუთი რიგში: კომპიუტერი იგებს, როცა შეუძლია, და ბლოკავს ღია ოთხს', () => {
  const N = gomoku.N
  let s = gomoku.initState()
  // a-ს ოთხი ქვა 7-ე ხაზზე, b-ს რიგია და b-საც ოთხი აქვს — b იგებს
  for (let k = 0; k < 4; k++) { s = gomoku.play(s, 7 * N + 3 + k); s = gomoku.play(s, 2 * N + 3 + k) }
  // ახლა a-ს რიგია: a იგებს
  const a = BOTS.gomoku(s, () => 0.5)
  assert.equal(a.winner, 'a')
  // დაბლოკვა: a-ს ღია სამი + ერთი ზედმეტი, b-ს რიგი
  let t = gomoku.initState()
  t = gomoku.play(t, 7 * N + 5); t = gomoku.play(t, 0)
  t = gomoku.play(t, 7 * N + 6); t = gomoku.play(t, 14)
  t = gomoku.play(t, 7 * N + 7); t = gomoku.play(t, 210)
  t = gomoku.play(t, 7 * N + 8)
  const b = BOTS.gomoku(t, () => 0.5)
  assert.ok([7 * N + 4, 7 * N + 9].includes(b.last), `blocked at ${b.last}`)
  // სრული თამაში კომპიუტერი კომპიუტერთან მთავრდება
  let g = gomoku.initState()
  for (let i = 0; i < 225 && !gomoku.isOver(g); i++) g = BOTS.gomoku(g)
  assert.ok(gomoku.isOver(g))
  assert.throws(() => applyAction('gomoku', gomoku.initState(), { at: 'x' }))
  assert.equal(applyAction('gomoku', gomoku.initState(), { at: 112 }).board[112], 'a')
})
