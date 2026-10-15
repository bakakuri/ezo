// პარტიის ჩანაწერი: სვლების ტექსტი (ჭადრაკის ჩანაწერი, ნარდი, ხუთი რიგში, დომინო, შაშკი)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as chess from '../src/games/chess.js'
import * as c9 from '../src/games/chess960.js'
import * as nardi from '../src/games/nardi.js'
import * as gomoku from '../src/games/gomoku.js'
import * as domino from '../src/games/domino.js'
import * as checkers from '../src/games/checkers.js'
import { applyAction } from '../src/games/server.js'
import { describeFrames, describeMove, chessSan } from '../src/games/notation.js'
import { REPLAYABLE, HIDDEN } from '../src/games/hidden.js'

const sq = chess.sqIndex
const state = (fen) => ({ fen, turn: fen.split(' ')[1], last: null, count: 0 })
const play = (type, s, from, to, promo) => applyAction(type, s, { from: sq(from), to: sq(to), promo })
const san = (fen, from, to, promo, type = 'chess') => {
  const s = state(fen)
  return chessSan(type, s, play(type, s, from, to, promo))
}

test('ჭადრაკი: ბავშვური მათი სრულად', () => {
  let s = chess.initState()
  const states = [s]
  for (const [f, t] of [['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'], ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7']]) {
    s = play('chess', s, f, t)
    states.push(s)
  }
  const frames = describeFrames('chess', states)
  assert.deepEqual(frames.map((f) => f.text), ['e4', 'e5', '♝c4', '♞c6', '♛h5', '♞f6', '♛xf7#'])
  assert.deepEqual(frames.map((f) => f.no), [1, 1, 2, 2, 3, 3, 4])
  assert.deepEqual(frames.map((f) => f.seat), ['a', 'b', 'a', 'b', 'a', 'b', 'a'])
})

test('ჭადრაკი: გარჩევა, როქი, გადაქცევა, გავლით აყვანა', () => {
  assert.equal(san('4k3/8/8/8/8/8/8/1N1K1N2 w - - 0 1', 'b1', 'd2'), '♞bd2')
  assert.equal(san('4k3/8/8/R7/8/8/8/R3K3 w - - 0 1', 'a1', 'a3'), '♜1a3')
  assert.equal(san('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1', 'g1'), 'O-O')
  assert.equal(san('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1', 'c1'), 'O-O-O')
  assert.equal(san('1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7', 'b8', 'q'), 'axb8=♛+')
  assert.equal(san('1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7', 'b8', 'n'), 'axb8=♞')
  assert.equal(san('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5', 'd6'), 'exd6')
  assert.equal(san('4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'e1', 'e2'), '♚e2')
})

test('ჭადრაკი 960: როქი და მეფის ნაბიჯი ერთსა და იმავე უჯრაზე — ჩანაწერი განასხვავებს', () => {
  const fen = '4k3/8/8/8/8/8/8/5K1R w H - 0 1'
  const s = state(fen)
  const castle = c9.legalMoves(chess.fromFEN(fen)).find((m) => m.flag === 'castle960' && m.to === m.rook)
  assert.ok(castle)
  const castled = c9.applyToState(s, castle)
  const step = play('chess960', s, 'f1', 'g1')
  assert.deepEqual(castled.last, step.last) // დაფაზე ორივე ერთნაირად ჩანს: f1 → g1
  assert.equal(chessSan('chess960', s, castled), 'O-O')
  assert.equal(chessSan('chess960', s, step), '♚g1')
})

test('ნარდი: გაგორება და სვლები; ხუთი რიგში; დომინო; შაშკი', () => {
  let s = nardi.initState()
  const rolled = nardi.applyRoll(s, [6, 5])
  const m = nardi.findMove(rolled, 23, 17)
  const moved = nardi.applyMove(rolled, m)
  const f = describeFrames('nardi', [s, rolled, moved])
  assert.deepEqual(f.map((x) => [x.kind, x.text, x.no, x.seat]), [['roll', '6:5', 1, 'a'], ['move', '24→18', 1, 'a']])

  const g0 = gomoku.initState()
  const g1 = gomoku.play(g0, 112)
  assert.equal(describeMove('gomoku', g0, g1).text, 'H8')
  assert.equal(describeMove('gomoku', g1, gomoku.play(g1, 0)).text, 'A15')

  const d0 = domino.initState(() => 0.3)
  const opts = domino.playable(d0)
  const d1 = domino.play(d0, opts[0].i, opts[0].side)
  assert.match(describeMove('domino', d0, d1).text, /^\d\|\d$/)

  const k0 = checkers.initState()
  const mv = checkers.legalMoves(k0)[0]
  const k1 = checkers.applyMove(k0, mv)
  assert.match(describeMove('checkers', k0, k1).text, /^[a-h][1-8]–[a-h][1-8]$/)
})

test('ჩანაწერი ინახება მხოლოდ ღია თამაშებისთვის; დომინოს ხელები დამალულია', () => {
  for (const t of ['durak', 'joker', 'bura', 'loto']) assert.ok(!REPLAYABLE.includes(t), t)
  assert.ok(REPLAYABLE.includes('domino') && HIDDEN.has('domino'))
  // SQL ტრიგერის სია იგივეა, რაც კლიენტის
  const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
  const m = sql.match(/if new\.type not in \(([^)]+)\) then return null/)
  assert.ok(m, 'record_game_move სია ვერ ვიპოვე')
  assert.deepEqual(m[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort(), [...REPLAYABLE].sort())
})
