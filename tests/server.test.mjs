import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyAction, publicState, initFor, IllegalMove, withMyHand } from '../src/games/server.js'
import { chess, domino, nardi } from '../src/games/index.js'

test('chess: legal action applies, illegal rejected', () => {
  const s = initFor('chess')
  const e2 = chess.sqIndex('e2')
  const e4 = chess.sqIndex('e4')
  const n = applyAction('chess', s, { from: e2, to: e4 })
  assert.equal(n.turn, 'b')
  assert.throws(() => applyAction('chess', s, { from: e2, to: chess.sqIndex('e5') }), IllegalMove)
  assert.throws(() => applyAction('chess', n, { from: e2, to: e4 }), IllegalMove)
})

test('checkers: path must match a legal move', () => {
  const s = initFor('checkers')
  assert.throws(() => applyAction('checkers', s, { path: [40, 25] }), IllegalMove)
  const ok = applyAction('checkers', s, { path: [5 * 8 + 2, 4 * 8 + 3] })
  assert.equal(ok.turn, 'b')
})

test('nardi: server rolls dice, client cannot choose them', () => {
  const s = initFor('nardi')
  const rolled = applyAction('nardi', s, { roll: true, dice: [6, 6] }, () => 0) // rand=0 → 1-1
  assert.deepEqual(rolled.rolled, [1, 1])
  assert.throws(() => applyAction('nardi', rolled, { roll: true }), IllegalMove)
  assert.throws(() => applyAction('nardi', rolled, { from: 23, to: 10 }), IllegalMove)
})

test('domino: hidden hands, play/draw/pass validated', () => {
  const s = initFor('domino')
  const pub = publicState('domino', s)
  assert.ok(pub.hands.a.every((t) => t === null))
  assert.equal(pub.boneyard.length, 14)
  assert.equal(JSON.stringify(pub).includes('"boneyard":[[') , false)
  const seat = s.turn
  const tile = s.hands[seat][0]
  const next = applyAction('domino', s, { play: tile, side: 'R' })
  assert.equal(next.chain.length, 1)
  assert.throws(() => applyAction('domino', next, { play: tile, side: 'R' }), IllegalMove)
  assert.throws(() => applyAction('domino', next, { pass: true }), IllegalMove)
  const merged = withMyHand('domino', publicState('domino', next), next.turn, next.hands[next.turn])
  assert.equal(merged.hands[next.turn].length, 7)
  assert.ok(domino.playable(merged).length >= 0)
})

test('domino: full game through actions only', () => {
  for (let g = 0; g < 50; g++) {
    let s = initFor('domino')
    let guard = 0
    while (!domino.isOver(s) && guard++ < 400) {
      const p = domino.playable(s)
      if (p.length) s = applyAction('domino', s, { play: s.hands[s.turn][p[0].i], side: p[0].side })
      else if (domino.canDraw(s)) s = applyAction('domino', s, { draw: true })
      else s = applyAction('domino', s, { pass: true })
    }
    assert.ok(domino.isOver(s))
  }
})

test('nardi: full game through actions only', () => {
  let s = initFor('nardi')
  let guard = 0
  while (s.phase !== 'over' && guard++ < 3000) {
    if (s.phase === 'roll') s = applyAction('nardi', s, { roll: true })
    else {
      const m = nardi.legalMoves(s)[0]
      s = applyAction('nardi', s, { from: m.from, to: m.to })
    }
  }
  assert.equal(s.phase, 'over')
})
