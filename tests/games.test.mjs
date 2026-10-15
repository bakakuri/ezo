import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as chess from '../src/games/chess.js'
import * as ck from '../src/games/checkers.js'
import * as nardi from '../src/games/nardi.js'
import * as dom from '../src/games/domino.js'

// ---- ჭადრაკი: perft სტანდარტული პოზიციებიდან (chessprogramming.org)
const PERFT = [
  [chess.START_FEN, [20, 400, 8902, 197281]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
]
for (const [fen, counts] of PERFT) {
  test(`chess perft ${fen.slice(0, 20)}`, () => {
    const s = chess.fromFEN(fen)
    counts.forEach((n, i) => assert.equal(chess.perft(s, i + 1), n, `depth ${i + 1}`))
  })
}

test('chess fen roundtrip + fool\'s mate', () => {
  assert.equal(chess.toFEN(chess.fromFEN(chess.START_FEN)), chess.START_FEN)
  let s = chess.fromFEN(chess.START_FEN)
  for (const [a, b] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) {
    const m = chess.legalMoves(s).find((x) => x.from === chess.sqIndex(a) && x.to === chess.sqIndex(b))
    assert.ok(m, `${a}${b}`)
    s = chess.makeMove(s, m)
  }
  assert.deepEqual(chess.status(s), { over: true, result: 'checkmate', winner: 'b', check: true })
})

// ---- შაშკი
test('checkers opening has 7 moves', () => {
  assert.equal(ck.legalMoves(ck.initState()).length, 7)
})

test('checkers capture is mandatory and multi-jump completes', () => {
  const s = ck.initState()
  s.board.fill(null)
  // თეთრი ქვა f2-ზე (row 6, col 5), შავები e3 (5,4) და c5 (3,2) — ორმაგი ჭრა
  s.board[6 * 8 + 5] = 'w'
  s.board[5 * 8 + 4] = 'b'
  s.board[3 * 8 + 2] = 'b'
  s.board[7 * 8 + 0] = 'w'
  const moves = ck.legalMoves(s)
  assert.equal(moves.length, 1)
  assert.deepEqual(moves[0].caps.sort(), [5 * 8 + 4, 3 * 8 + 2].sort())
  const n = ck.applyMove(s, moves[0])
  assert.equal(ck.countPieces(n, 'b'), 0)
  assert.deepEqual(ck.status(n), { over: true, winner: 'w' })
})

test('checkers man captures backwards; king flies', () => {
  const s = ck.initState()
  s.board.fill(null)
  s.board[3 * 8 + 2] = 'w'
  s.board[4 * 8 + 3] = 'b' // უკან, ქვემოთ
  let moves = ck.legalMoves(s)
  assert.equal(moves.length, 1)
  assert.equal(moves[0].path[1], 5 * 8 + 4)
  s.board.fill(null)
  s.board[7 * 8 + 0] = 'W'
  s.board[3 * 8 + 4] = 'b'
  moves = ck.legalMoves(s)
  // a1-დან დიაგონალზე შორს მდგომი შავი ქვის ჭრა, დაჯდომა f6/g7/h8-ზე
  assert.equal(moves.length, 3)
  assert.ok(moves.every((m) => m.caps[0] === 3 * 8 + 4))
})

test('checkers man promotes on last row mid-capture and continues as king', () => {
  const s = ck.initState()
  s.board.fill(null)
  s.board[2 * 8 + 1] = 'w' // b6
  s.board[1 * 8 + 2] = 'b' // c7 → დაჯდება d8-ზე (0,3) და ხდება დამკა
  s.board[1 * 8 + 4] = 'b' // e7 — d8-ზე დამკად ქცეული ჭრის e7-ს
  const moves = ck.legalMoves(s)
  assert.ok(moves.length >= 1)
  assert.ok(moves.every((m) => m.caps.length === 2 && m.promote))
})

// ---- ნარდი
test('nardi opening 3-1 has legal moves and ends turn after both dice', () => {
  let s = nardi.applyRoll(nardi.initState(), [3, 1])
  assert.equal(s.phase, 'move')
  const first = nardi.findMove(s, 7, 4)
  assert.ok(first)
  s = nardi.applyMove(s, first)
  const second = nardi.findMove(s, 5, 4)
  assert.ok(second)
  s = nardi.applyMove(s, second)
  assert.equal(s.turn, 'b')
  assert.equal(s.phase, 'roll')
  assert.equal(s.points[4], 2)
})

test('nardi doubles give four moves', () => {
  const s = nardi.applyRoll(nardi.initState(), [6, 6])
  assert.equal(s.dice.length, 4)
})

test('nardi bar entry blocked → auto pass', () => {
  const s = nardi.initState()
  s.points.fill(0)
  for (let i = 18; i < 24; i++) s.points[i] = -2 // შავის სახლი სრულად დაკეტილი
  s.bar.w = 1
  s.points[0] = 3
  const r = nardi.applyRoll(s, [2, 5])
  assert.equal(r.noMoves, true)
  assert.equal(r.turn, 'b')
})

test('nardi hit sends checker to bar', () => {
  const s = nardi.initState()
  s.points.fill(0)
  s.points[10] = 1
  s.points[7] = -1
  s.points[0] = -14
  s.points[23] = 14
  let r = nardi.applyRoll(s, [3, 1])
  const m = nardi.findMove(r, 10, 7)
  assert.ok(m)
  r = nardi.applySingle(r, m)
  assert.equal(r.bar.b, 1)
})

test('nardi must use larger die when only one playable', () => {
  const s = nardi.initState()
  s.points.fill(0)
  s.points[12] = 1
  s.points[0] = -14
  s.points[23] = 14
  // 6 → 6 ღიაა; 5 → 7 დაკეტილი; 6-ის შემდეგ 5 → 1 დაკეტილი; 5-ის მერე 6 არ შეიძლება
  s.points[7] = -2
  s.points[1] = -2
  s.points[0] = -10
  const r = nardi.applyRoll(s, [5, 6])
  const moves = nardi.legalMoves(r).filter((m) => m.from === 12)
  assert.ok(moves.every((m) => m.die === 6))
})

test('nardi bear off wins with mars', () => {
  const s = nardi.initState()
  s.points.fill(0)
  s.points[0] = 1
  s.off.w = 14
  s.points[20] = -15
  let r = nardi.applyRoll(s, [1, 2])
  r = nardi.applyMove(r, nardi.findMove(r, 0, 'off'))
  assert.equal(r.winner, 'w')
  assert.equal(r.score, 2)
})

// ---- დომინო
test('domino deal and full random game terminates', () => {
  for (let g = 0; g < 200; g++) {
    let s = dom.initState()
    assert.equal(s.hands.a.length + s.hands.b.length + s.boneyard.length, 28)
    let guard = 0
    while (!dom.isOver(s) && guard++ < 500) {
      const p = dom.playable(s)
      if (p.length) s = dom.play(s, p[0].i, p[0].side)
      else if (dom.canDraw(s)) s = dom.drawTile(s)
      else s = dom.pass(s)
    }
    assert.ok(dom.isOver(s), 'game ended')
    const total = s.hands.a.length + s.hands.b.length + s.boneyard.length + s.chain.length
    assert.equal(total, 28)
    for (let i = 1; i < s.chain.length; i++) assert.equal(s.chain[i - 1][1], s.chain[i][0])
  }
})

// ---- ნარდის შემთხვევითი თამაშები ბოლომდე
test('nardi random games terminate with 15 off', () => {
  for (let g = 0; g < 30; g++) {
    let s = nardi.initState()
    let guard = 0
    while (s.phase !== 'over' && guard++ < 3000) {
      if (s.phase === 'roll') s = nardi.applyRoll(s, nardi.rollDice())
      else {
        const ms = nardi.legalMoves(s)
        s = nardi.applyMove(s, ms[Math.floor(Math.random() * ms.length)])
      }
      const wTotal = s.points.reduce((n, v) => n + (v > 0 ? v : 0), 0) + s.bar.w + s.off.w
      const bTotal = s.points.reduce((n, v) => n + (v < 0 ? -v : 0), 0) + s.bar.b + s.off.b
      assert.equal(wTotal, 15)
      assert.equal(bTotal, 15)
    }
    assert.equal(s.phase, 'over')
  }
})

test('checkers random games terminate', () => {
  for (let g = 0; g < 50; g++) {
    let s = ck.initState()
    let guard = 0
    while (!ck.status(s).over && guard++ < 400) {
      const ms = ck.legalMoves(s)
      s = ck.applyMove(s, ms[Math.floor(Math.random() * ms.length)])
    }
  }
})
