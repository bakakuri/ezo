import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as chess from '../src/games/chess.js'
import { PUZZLES, puzzleFor, dayIndex } from '../src/games/puzzles.js'

const uci = (m) => chess.sqName(m.from) + chess.sqName(m.to) + (m.promo || '')
const isMate = (s) => chess.status(s).result === 'checkmate'
function forcedMate(s, n) {
  for (const m of chess.legalMoves(s)) {
    const a = chess.makeMove(s, m)
    if (isMate(a)) return true
    if (n > 1 && !chess.status(a).over && chess.legalMoves(a).every((r) => forcedMate(chess.makeMove(a, r), n - 1))) return true
  }
  return false
}
function winningFirstMoves(s, n) {
  return chess.legalMoves(s).filter((m) => {
    const a = chess.makeMove(s, m)
    if (isMate(a)) return true
    return n > 1 && !chess.status(a).over && chess.legalMoves(a).every((r) => forcedMate(chess.makeMove(a, r), n - 1))
  }).map(uci)
}

test('puzzles match the database seed', () => {
  const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
  const block = sql.slice(sql.indexOf('insert into public.chess_puzzles'), sql.indexOf('on conflict (id) do update set title = excluded.title, fen'))
  const rows = [...block.matchAll(/\((\d+), '([^']+)', '([^']+)', array\[([^\]]+)\]\)/g)]
    .map(([, id, title, fen, sol]) => ({ id: +id, title, fen, solution: sol.split(',').map((x) => x.trim().replace(/'/g, '')) }))
  assert.deepEqual(rows, PUZZLES)
  assert.deepEqual(PUZZLES.map((p) => p.id), PUZZLES.map((_, i) => i + 1))
})

test('every puzzle: legal line, unique solution, ends in mate, no shorter mate', () => {
  for (const p of PUZZLES) {
    let s = chess.fromFEN(p.fen)
    const n = Math.ceil(p.solution.length / 2)
    assert.ok(!chess.status(s).over, p.title)
    assert.deepEqual(winningFirstMoves(s, n), [p.solution[0]], `${p.title}: first move must be the only win`)
    if (n > 1) assert.deepEqual(winningFirstMoves(s, n - 1), [], `${p.title}: shorter mate`)
    p.solution.forEach((mv, i) => {
      const m = chess.legalMoves(s).find((x) => uci(x) === mv)
      assert.ok(m, `${p.title}: ${mv} legal`)
      if (i === p.solution.length - 1) {
        const mates = chess.legalMoves(s).filter((x) => isMate(chess.makeMove(s, x))).map(uci)
        assert.deepEqual(mates, [mv], `${p.title}: final mate unique`)
      }
      s = chess.makeMove(s, m)
    })
    assert.ok(isMate(s), `${p.title}: mate`)
  }
})

test('puzzle of the day rotates like the database', () => {
  assert.equal(puzzleFor('2026-01-01').id, 1)
  assert.equal(puzzleFor('2026-01-15').id, 1)
  assert.equal(puzzleFor('2025-12-31').id, 14)
  assert.equal(dayIndex('2026-10-15'), 287)
  assert.equal(puzzleFor('2026-10-15').id, (287 % 14) + 1)
})
