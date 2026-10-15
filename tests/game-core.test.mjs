import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handle, HttpError } from '../supabase/functions-src/game-core.js'
import { chess, domino, joker, bura, loto } from '../src/games/index.js'
import { jokerBot, buraBot } from '../src/games/bots.js'

// ყალბი ბაზა, რომელიც SQL ფუნქციების ქცევას იმეორებს
function fakeDb() {
  const games = new Map()
  const priv = new Map()
  const hands = new Map()
  const notes = []
  let seq = 0
  const seat = (state) => (['w', 'a'].includes(state.turn) ? 'a' : 'b')
  const tournaments = new Map()
  const tplayers = new Set()
  return {
    games, priv, hands, notes, banned: new Set(), tournaments, tplayers, finished: [],
    async canAct(u) { return !this.banned.has(u) },
    async getGame(id) { return games.get(id) && structuredClone(games.get(id)) },
    async getPrivate(id) { return structuredClone(priv.get(id)) },
    async insertGame(row) { const id = `g${++seq}`; games.set(id, { id, move_no: 0, player_b: null, player_c: null, player_d: null, turn: null, updated_at: new Date().toISOString(), ...row }); return id },
    async updateGame(id, patch, mv, status = 'active') { const g = games.get(id); if (g.move_no !== mv || g.status !== status) return false; Object.assign(g, patch); return true },
    async setPrivate(id, s) { priv.set(id, s) },
    async setHands(id, rows) { for (const r of rows) hands.set(`${id}:${r.seat}`, r) },
    async claim(u, type, tc = null, tournament = null) {
      const g = [...games.values()].find((x) => x.type === type && x.status === 'waiting' && x.is_public && x.player_a !== u && (x.tc || null) === tc && (x.tournament_id || null) === tournament)
      if (!g) return null
      g.player_b = u; g.status = 'active'; g.turn = seat(g.state) === 'a' ? g.player_a : u
      const h = hands.get(`${g.id}:b`); if (h) h.user_id = u
      return g.id
    },
    async myWaiting(u, type, tc = null, tournament = null) { return [...games.values()].find((x) => x.type === type && x.status === 'waiting' && x.player_a === u && (x.tc || null) === tc && (x.tournament_id || null) === tournament)?.id ?? null },
    async takeSeat(u, id) {
      const g = games.get(id)
      if (g.status !== 'waiting') throw new HttpError(409, 'started')
      if (!g.is_public && !(g.invites || []).includes(u)) throw new HttpError(409, 'no invite')
      if (['a', 'b', 'c', 'd'].some((x) => g[`player_${x}`] === u)) return
      const free = ['b', 'c', 'd'].find((x) => !g[`player_${x}`])
      if (!free) throw new HttpError(409, 'full')
      g[`player_${free}`] = u; g.move_no++
      const h = hands.get(`${id}:${free}`); if (h) h.user_id = u
      if (['b', 'c', 'd'].every((x) => g[`player_${x}`])) { g.status = 'active'; g.turn = g[`player_${g.state.turn}`] }
    },
    async takeAnySeat(u, type) {
      const g = [...games.values()].find((x) => x.type === type && x.status === 'waiting' && x.is_public && x.seats > 2 && !['a', 'b', 'c', 'd'].some((s) => x[`player_${s}`] === u))
      if (!g) return null
      await this.takeSeat(u, g.id)
      return g.id
    },
    async leaveSeat(u, id) { const g = games.get(id); for (const x of ['b', 'c', 'd']) if (g[`player_${x}`] === u) { g[`player_${x}`] = null; g.move_no++ } },
    async finishTable(id, winner, result, scores) { const g = games.get(id); g.status = 'finished'; g.winner = winner; g.result = result; g.turn = null; this.finished.push({ id, winner, result, scores }) },
    async getTournament(id) { return tournaments.get(id) || null },
    async isTournamentPlayer(t, u) { return tplayers.has(`${t}:${u}`) },
    async myActiveInTournament(u, t) { return [...games.values()].find((x) => x.tournament_id === t && x.status === 'active' && (x.player_a === u || x.player_b === u))?.id ?? null },
    async join(u, id) {
      const g = games.get(id)
      if (g.status !== 'waiting') throw new HttpError(409, 'started')
      if (!g.is_public && g.invited !== u) throw new HttpError(409, 'no invite')
      g.player_b = u; g.status = 'active'; g.turn = seat(g.state) === 'a' ? g.player_a : u
    },
    async finish(id, winner, result) { const g = games.get(id); if (g.status === 'waiting' || result === 'abort') { g.status = 'cancelled'; g.result = result; return } g.status = 'finished'; g.winner = winner; g.result = result; g.turn = null },
    async notify(row) { notes.push(row) },
  }
}

test('random matchmaking pairs two players and enforces turns', async () => {
  const db = fakeDb()
  const { id } = await handle({ op: 'random', type: 'chess' }, { userId: 'A', db })
  assert.equal(db.games.get(id).status, 'waiting')
  const again = await handle({ op: 'random', type: 'chess' }, { userId: 'A', db })
  assert.equal(again.id, id, 'same waiting game returned')
  const joined = await handle({ op: 'random', type: 'chess' }, { userId: 'B', db })
  assert.equal(joined.id, id)
  assert.equal(db.games.get(id).turn, 'A')
  const e2e4 = { from: chess.sqIndex('e2'), to: chess.sqIndex('e4') }
  await assert.rejects(handle({ op: 'move', id, action: e2e4 }, { userId: 'B', db }), /რიგი/)
  await assert.rejects(handle({ op: 'move', id, action: { from: 52, to: 20 } }, { userId: 'A', db }), (e) => e.status === 400)
  await assert.rejects(handle({ op: 'move', id, action: e2e4 }, { userId: 'C', db }), (e) => e.status === 403)
  const r = await handle({ op: 'move', id, action: e2e4, move_no: 0 }, { userId: 'A', db })
  assert.equal(r.move_no, 1)
  assert.equal(db.games.get(id).turn, 'B')
  await assert.rejects(handle({ op: 'move', id, action: e2e4, move_no: 0 }, { userId: 'B', db }), (e) => e.status === 409)
})

test('fool\'s mate finishes the game with a winner', async () => {
  const db = fakeDb()
  const { id } = await handle({ op: 'create', type: 'chess', invite: 'B' }, { userId: 'A', db })
  assert.equal(db.notes[0].type, 'game_invite')
  await handle({ op: 'join', id }, { userId: 'B', db })
  const seq = [['A', 'f2', 'f3'], ['B', 'e7', 'e5'], ['A', 'g2', 'g4'], ['B', 'd8', 'h4']]
  for (const [u, f, t] of seq) await handle({ op: 'move', id, action: { from: chess.sqIndex(f), to: chess.sqIndex(t) } }, { userId: u, db })
  const g = db.games.get(id)
  assert.equal(g.status, 'finished')
  assert.equal(g.winner, 'B')
  assert.equal(g.result, 'checkmate')
})

test('domino: private state stays on server, hands per player', async () => {
  const db = fakeDb()
  const { id } = await handle({ op: 'create', type: 'domino' }, { userId: 'A', db })
  const pub = db.games.get(id).state
  assert.ok(pub.hands.a.every((t) => t === null) && pub.boneyard.every((t) => t === null))
  await handle({ op: 'random', type: 'domino' }, { userId: 'B', db })
  assert.equal(db.hands.get(`${id}:b`).user_id, 'B')
  // ორივე მხარე თამაშობს ბოლომდე მხოლოდ საკუთარი ხელის ცოდნით
  let guard = 0
  while (db.games.get(id).status === 'active' && guard++ < 300) {
    const g = db.games.get(id)
    const user = g.turn
    const seat = user === 'A' ? 'a' : 'b'
    const mine = db.hands.get(`${id}:${seat}`).tiles
    const view = { ...g.state, hands: { ...g.state.hands, [seat]: mine } }
    const opts = domino.playable(view, seat)
    const action = opts.length ? { play: mine[opts[0].i], side: opts[0].side } : domino.canDraw(view) ? { draw: true } : { pass: true }
    await handle({ op: 'move', id, action }, { userId: user, db })
  }
  assert.equal(db.games.get(id).status, 'finished')
})

test('banned user cannot start games; resign and cancel work', async () => {
  const db = fakeDb()
  db.banned.add('X')
  await assert.rejects(handle({ op: 'random', type: 'nardi' }, { userId: 'X', db }), (e) => e.status === 403)
  const { id } = await handle({ op: 'create', type: 'nardi' }, { userId: 'A', db })
  await handle({ op: 'resign', id }, { userId: 'A', db })
  assert.equal(db.games.get(id).status, 'cancelled')
  const g2 = await handle({ op: 'create', type: 'checkers', invite: 'B' }, { userId: 'A', db })
  await assert.rejects(handle({ op: 'join', id: g2.id }, { userId: 'C', db }))
  await handle({ op: 'join', id: g2.id }, { userId: 'B', db })
  await handle({ op: 'resign', id: g2.id }, { userId: 'B', db })
  assert.equal(db.games.get(g2.id).winner, 'A')
})

// ---------------- ჯოკერი: 4-ადგილიანი მაგიდა
test('joker table: invites, start with bots, human sees only own hand, plays to the end', async () => {
  const db = fakeDb()
  const { id } = await handle({ op: 'create', type: 'joker', mode: 'quick', invites: ['B'] }, { userId: 'A', db })
  const g0 = db.games.get(id)
  assert.equal(g0.seats, 4)
  assert.equal(g0.is_public, false)
  assert.equal(db.notes.length, 1)
  await assert.rejects(handle({ op: 'join', id }, { userId: 'C', db }), /invite/)
  await handle({ op: 'join', id }, { userId: 'B', db })
  assert.equal(db.games.get(id).player_b, 'B')
  await assert.rejects(handle({ op: 'start', id }, { userId: 'B', db }), (e) => e.status === 403)
  await handle({ op: 'start', id }, { userId: 'A', db })
  const g = db.games.get(id)
  assert.equal(g.status, 'active')
  assert.deepEqual(g.bots, ['c', 'd'])
  assert.ok(Object.values(g.state.hands).every((h) => h.every((x) => x === null)))
  assert.equal(db.hands.get(`${id}:c`).user_id, null)
  // ადამიანები თამაშობენ ბოლომდე — მხოლოდ საკუთარი ხელის ცოდნით (ბოტის ლოგიკით)
  let guard = 0
  while (db.games.get(id).status === 'active' && guard++ < 400) {
    const cur = db.games.get(id)
    const user = cur.turn
    const seat = ['a', 'b'].find((x) => cur[`player_${x}`] === user)
    assert.ok(seat, 'turn always belongs to a human')
    const mine = db.hands.get(`${id}:${seat}`).tiles
    const view = { ...cur.state, hands: { ...cur.state.hands, [seat]: mine } }
    const before = view
    const after = jokerBot(view, Math.random)
    let action
    if (before.phase === 'trump') action = { trump: after.trumpSuit }
    else if (before.phase === 'bid') action = { bid: after.bids[seat] }
    else {
      const played = before.hands[seat].find((c) => !after.hands[seat]?.includes(c) || after.phase !== 'play' || after.set !== before.set || after.hand !== before.hand)
      const entry = (after.trick.length ? after.trick : after.lastTrick.cards).find((x) => x.seat === seat)
      action = { play: entry?.card ?? played, mode: entry?.mode, suit: entry?.suit }
    }
    await handle({ op: 'move', id, action }, { userId: user, db })
  }
  const end = db.games.get(id)
  assert.equal(end.status, 'finished')
  assert.equal(db.finished.length, 1)
  assert.deepEqual(Object.keys(db.finished[0].scores).sort(), ['A', 'B'])
})

test('joker table fills by random seats and starts by itself when full', async () => {
  const db = fakeDb()
  const { id } = await handle({ op: 'random', type: 'joker', mode: 'quick' }, { userId: 'A', db })
  assert.equal(db.games.get(id).status, 'waiting')
  for (const u of ['B', 'C']) assert.equal((await handle({ op: 'random', type: 'joker' }, { userId: u, db })).id, id)
  assert.equal(db.games.get(id).status, 'waiting')
  await handle({ op: 'resign', id }, { userId: 'C', db })
  assert.equal(db.games.get(id).player_c, null, 'left the waiting table')
  for (const u of ['C', 'D']) await handle({ op: 'random', type: 'joker' }, { userId: u, db })
  const g = db.games.get(id)
  assert.equal(g.status, 'active')
  assert.equal(g.turn, 'A')
  assert.equal(db.hands.get(`${id}:d`).user_id, 'D')
})

test('joker: leaving an active table hands the seat to the computer', async () => {
  const db = fakeDb()
  const { id } = await handle({ op: 'create', type: 'joker', mode: 'quick', invites: ['B'] }, { userId: 'A', db })
  await handle({ op: 'join', id }, { userId: 'B', db })
  await handle({ op: 'start', id }, { userId: 'A', db })
  await handle({ op: 'resign', id }, { userId: 'A', db })
  const g = db.games.get(id)
  assert.ok(g.bots.includes('a'))
  assert.equal(g.status, 'active')
  assert.equal(g.turn, 'B', 'bot played A\'s turn, now B')
  await handle({ op: 'resign', id }, { userId: 'B', db })
  assert.equal(db.games.get(id).status, 'finished')
})

// ---------------- ბლიცი
test('blitz: clock runs on the server, increment applies, timeout by flag', async () => {
  const db = fakeDb()
  let t = 1_000_000
  const now = () => t
  const { id } = await handle({ op: 'random', type: 'chess', tc: '3+2' }, { userId: 'A', db, now })
  const other = await handle({ op: 'random', type: 'chess' }, { userId: 'B', db, now })
  assert.notEqual(other.id, id, 'different time control is not matched')
  await handle({ op: 'resign', id: other.id }, { userId: 'B', db, now })
  await handle({ op: 'random', type: 'chess', tc: '3+2' }, { userId: 'B', db, now })
  const mv = (f, to) => ({ from: chess.sqIndex(f), to: chess.sqIndex(to) })
  await handle({ op: 'move', id, action: mv('e2', 'e4') }, { userId: 'A', db, now })
  let g = db.games.get(id)
  assert.equal(g.clock.a, 180_000, 'first move is free')
  t += 10_000
  await handle({ op: 'move', id, action: mv('e7', 'e5') }, { userId: 'B', db, now })
  g = db.games.get(id)
  assert.equal(g.clock.b, 180_000 - 10_000 + 2_000)
  t += 5_000
  await assert.rejects(handle({ op: 'flag', id }, { userId: 'B', db, now }), (e) => e.status === 409)
  t += 200_000
  await handle({ op: 'flag', id }, { userId: 'B', db, now })
  g = db.games.get(id)
  assert.equal(g.status, 'finished')
  assert.equal(g.winner, 'B')
  assert.equal(g.result, 'timeout')
})

test('blitz: move after time ran out loses on time; no first move aborts', async () => {
  const db = fakeDb()
  let t = 5_000_000
  const now = () => t
  const { id } = await handle({ op: 'create', type: 'checkers', invite: 'B', tc: '1+0' }, { userId: 'A', db, now })
  await handle({ op: 'join', id }, { userId: 'B', db, now })
  db.games.get(id).updated_at = new Date(t).toISOString()
  t += 61_000
  await handle({ op: 'flag', id }, { userId: 'B', db, now })
  assert.equal(db.games.get(id).status, 'cancelled')
  assert.equal(db.games.get(id).result, 'abort')

  const g2 = await handle({ op: 'create', type: 'chess', invite: 'B', tc: '1+0' }, { userId: 'A', db, now })
  await handle({ op: 'join', id: g2.id }, { userId: 'B', db, now })
  await handle({ op: 'move', id: g2.id, action: { from: chess.sqIndex('d2'), to: chess.sqIndex('d4') } }, { userId: 'A', db, now })
  t += 61_000
  const r = await handle({ op: 'move', id: g2.id, action: { from: chess.sqIndex('d7'), to: chess.sqIndex('d5') } }, { userId: 'B', db, now })
  assert.equal(r.timeout, true)
  assert.equal(db.games.get(g2.id).winner, 'A')
  await assert.rejects(handle({ op: 'create', type: 'nardi', tc: '3+2' }, { userId: 'A', db, now }), (e) => e.status === 400)
})

// ---------------- ტურნირი (არენა)
test('arena: must join, only during the window, pairs within the tournament', async () => {
  const db = fakeDb()
  const t0 = Date.parse('2026-10-16T18:00:00Z')
  db.tournaments.set('T1', { id: 'T1', type: 'chess', tc: '3+2', starts_at: new Date(t0).toISOString(), ends_at: new Date(t0 + 3_600_000).toISOString() })
  let t = t0 - 60_000
  const now = () => t
  await assert.rejects(handle({ op: 'random', type: 'chess', tournament: 'T1' }, { userId: 'A', db, now }), /დაწყებულა/)
  t = t0 + 1000
  await assert.rejects(handle({ op: 'random', type: 'chess', tournament: 'T1' }, { userId: 'A', db, now }), (e) => e.status === 403)
  db.tplayers.add('T1:A'); db.tplayers.add('T1:B')
  // ჩვეულებრივი 3+2 თამაში ტურნირისას არ უნდა შეერიოს
  const casual = await handle({ op: 'random', type: 'chess', tc: '3+2' }, { userId: 'C', db, now })
  const { id } = await handle({ op: 'random', type: 'chess', tournament: 'T1' }, { userId: 'A', db, now })
  assert.notEqual(id, casual.id)
  assert.equal(db.games.get(id).tournament_id, 'T1')
  assert.equal(db.games.get(id).tc, '3+2')
  const b = await handle({ op: 'random', type: 'chess', tournament: 'T1' }, { userId: 'B', db, now })
  assert.equal(b.id, id)
  const again = await handle({ op: 'random', type: 'chess', tournament: 'T1' }, { userId: 'B', db, now })
  assert.equal(again.id, id, 'active tournament game is returned')
  t = t0 + 3_600_000
  await assert.rejects(handle({ op: 'random', type: 'chess', tournament: 'T1' }, { userId: 'A', db, now }), /დასრულდა/)
})

// ---------------- ბურა და ლოტო
test('bura online: hidden hands, each side plays from its own hand to the end', async () => {
  const db = fakeDb()
  const { id } = await handle({ op: 'random', type: 'bura' }, { userId: 'A', db })
  await handle({ op: 'random', type: 'bura' }, { userId: 'B', db })
  const g0 = db.games.get(id)
  assert.equal(g0.status, 'active')
  assert.ok(g0.state.hands.a.every((c) => c === null))
  let guard = 0
  while (db.games.get(id).status === 'active' && guard++ < 200) {
    const g = db.games.get(id)
    const seat = g.state.turn
    const user = seat === 'a' ? g.player_a : g.player_b
    assert.equal(g.turn, user)
    const mine = db.hands.get(`${id}:${seat}`).tiles
    assert.ok(mine.every(Boolean), 'own hand is visible')
    // მხოლოდ საკუთარი ხელით: ვდივართ ერთი კარტით, ვპასუხობთ პირველი n კარტით
    const act = g.state.phase === 'lead' ? { lead: [mine[0]] } : { respond: mine.slice(0, g.state.lead.length) }
    await handle({ op: 'move', id, action: act }, { userId: user, db })
  }
  const g = db.games.get(id)
  assert.equal(g.status, 'finished')
  assert.ok(['bura', 'burapoints', 'buradraw'].includes(g.result))
})

test('loto table: only participants tick, only when due, game finishes with scores', async () => {
  const db = fakeDb()
  let t = 1_000_000
  const now = () => t
  const { id } = await handle({ op: 'create', type: 'loto', mode: 'line' }, { userId: 'A', db, now })
  await handle({ op: 'start', id }, { userId: 'A', db, now })
  const g = db.games.get(id)
  assert.equal(g.status, 'active')
  assert.deepEqual(g.bots, ['b', 'c', 'd'])
  await assert.rejects(handle({ op: 'tick', id }, { userId: 'Z', db, now }), (e) => e.status === 403)
  assert.equal((await handle({ op: 'tick', id }, { userId: 'A', db, now })).ok, true) // საათი ჩაირთო
  assert.equal(db.games.get(id).state.drawn.length, 0)
  assert.equal((await handle({ op: 'tick', id }, { userId: 'A', db, now })).ok, false)
  let guard = 0
  while (db.games.get(id).status === 'active' && guard++ < 100) {
    t += 4000
    const r = await handle({ op: 'tick', id }, { userId: 'A', db, now })
    assert.equal(r.ok, true)
  }
  const fin = db.finished.find((f) => f.id === id)
  assert.ok(fin)
  assert.equal(fin.result, db.games.get(id).state.draw ? 'lotodraw' : 'loto')
  assert.ok(fin.scores.A >= 0)
  await assert.rejects(handle({ op: 'move', id, action: { x: 1 } }, { userId: 'A', db, now }), (e) => e.status === 409)
})
