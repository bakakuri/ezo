// Edge Function „game“-ის ბირთვი. სუფთა ლოგიკაა: მონაცემთა ბაზასთან მუშაობს db ადაპტერით,
// ამიტომ Node-ის ტესტებში ყალბი ადაპტერით მოწმდება.
// ოპერაციები: create, random, join, start (4-ადგილიანი მაგიდა კომპიუტერებით), move, resign, flag (დროის ამოწურვა),
// tick (ლოტო: შემდეგი კასრი, როცა დრო მოვა)
import { applyAction, publicState, handsOf, initFor, seatToMove, outcome, IllegalMove, HIDDEN } from '../../src/games/server.js'
import { GAMES, seatsOf, SEAT_LETTERS, cryptoRand, chess, loto } from '../../src/games/index.js'
import { BOTS } from '../../src/games/bots.js'

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

// ბლიცი: საათი ჭადრაკსა და შაშკში
export const TIME_CONTROLS = { '1+0': [1, 0], '3+0': [3, 0], '3+2': [3, 2], '5+0': [5, 0], '10+0': [10, 0] }
const CLOCK_GAMES = new Set(['chess', 'chess960', 'checkers'])
export const ABORT_AFTER = 60_000

const seatsIn = (g) => SEAT_LETTERS.slice(0, g.seats || 2)
const playerAt = (g, seat) => g[`player_${seat}`] ?? null
const seatOfUser = (g, uid) => seatsIn(g).find((s) => playerAt(g, s) === uid && !(g.bots || []).includes(s)) || null
const isBot = (g, seat) => (g.bots || []).includes(seat)

export async function handle(body, { userId, db, rand = cryptoRand, now = Date.now }) {
  if (!userId) throw new HttpError(401, 'შესვლა საჭიროა')
  const op = body?.op
  const type = body?.type

  if (['create', 'random', 'join', 'start', 'move'].includes(op) && !(await db.canAct(userId))) {
    throw new HttpError(403, 'ანგარიში დროებით შეზღუდულია')
  }

  async function saveHidden(id, g, full) {
    if (!HIDDEN.has(g.type)) return
    await db.setPrivate(id, full)
    const hands = handsOf(g.type, full)
    await db.setHands(id, seatsIn(g).map((seat) => ({
      seat, user_id: isBot(g, seat) ? null : playerAt(g, seat), tiles: hands[seat],
    })))
  }

  // კომპიუტერები თამაშობენ, სანამ რიგი ადამიანს არ მიადგება
  function runBots(g, state) {
    let s = state
    let guard = 0
    while (!outcome(g.type, s).over && isBot(g, seatToMove(g.type, s)) && guard++ < 400) {
      s = BOTS[g.type](s, rand)
    }
    return s
  }

  async function create(t, opts = {}) {
    if (!GAMES[t]) throw new HttpError(400, 'უცნობი თამაში')
    const seats = seatsOf(t)
    const invites = [...new Set([...(opts.invites || []), ...(opts.invite ? [opts.invite] : [])])].filter(Boolean)
    if (invites.includes(userId)) throw new HttpError(400, 'საკუთარ თავს ვერ მოიწვევ')
    if (invites.length > seats - 1) throw new HttpError(400, `მაქსიმუმ ${seats - 1} მოწვევა`)
    let tc = null
    if (opts.tc) {
      if (!TIME_CONTROLS[opts.tc] || !CLOCK_GAMES.has(t)) throw new HttpError(400, 'ასეთი დროის კონტროლი არ არის')
      tc = opts.tc
    }
    const full = initFor(t, rand, { mode: opts.mode })
    const row = {
      type: t, state: publicState(t, full), player_a: userId, seats,
      invited: seats === 2 ? invites[0] || null : null, invites,
      is_public: opts.public ?? !invites.length, status: 'waiting',
      options: opts.mode ? { mode: opts.mode } : {}, tc, tournament_id: opts.tournament || null,
      clock: tc ? { a: TIME_CONTROLS[tc][0] * 60_000, b: TIME_CONTROLS[tc][0] * 60_000, inc: TIME_CONTROLS[tc][1] * 1000, at: null } : null,
      bots: [],
    }
    const id = await db.insertGame(row)
    await saveHidden(id, { ...row, id }, full)
    for (const u of invites) await db.notify({ user_id: u, actor_id: userId, type: 'game_invite', game_id: id })
    return { id }
  }

  async function finish(g, state, o) {
    if (g.seats > 2) {
      const scores = {}
      for (const seat of seatsIn(g)) {
        const uid = playerAt(g, seat)
        if (!uid) continue
        // თამაშიდან წასული (ადგილი კომპიუტერს გადაეცა) — ბოლო ადგილი
        scores[uid] = isBot(g, seat) ? -1e6 : (state.scores?.[seat] ?? 0)
      }
      const winner = o.winner && !isBot(g, o.winner) ? playerAt(g, o.winner) : null
      await db.finishTable(g.id, winner, o.result, scores)
      return
    }
    const winner = o.winner === 'a' ? g.player_a : o.winner === 'b' ? g.player_b : null
    await db.finish(g.id, winner, o.result)
  }

  const load = async (id) => {
    const g = await db.getGame(id)
    if (!g) throw new HttpError(404, 'თამაში ვერ მოიძებნა')
    g.seats = g.seats || 2
    g.bots = g.bots || []
    return g
  }

  switch (op) {
    case 'create':
      if (body.tournament) throw new HttpError(400, 'ტურნირის თამაში მხოლოდ შემთხვევითი მეტოქით')
      return create(type, { invite: body.invite, invites: body.invites, mode: body.mode, tc: body.tc, public: body.public })

    case 'random': {
      if (!GAMES[type]) throw new HttpError(400, 'უცნობი თამაში')
      if (seatsOf(type) > 2) {
        const id = await db.takeAnySeat(userId, type)
        if (id) return { id }
        const mine = await db.myWaiting(userId, type, null, null)
        if (mine) return { id: mine }
        return create(type, { mode: body.mode || 'standard', public: true })
      }
      let tc = body.tc || null
      let tournament = null
      if (body.tournament) {
        const t = await db.getTournament(body.tournament)
        if (!t) throw new HttpError(404, 'ტურნირი ვერ მოიძებნა')
        if (t.type !== type) throw new HttpError(400, 'სხვა თამაშის ტურნირია')
        const n = now()
        if (n < Date.parse(t.starts_at)) throw new HttpError(409, 'ტურნირი ჯერ არ დაწყებულა')
        if (n >= Date.parse(t.ends_at)) throw new HttpError(409, 'ტურნირი დასრულდა')
        if (!(await db.isTournamentPlayer(t.id, userId))) throw new HttpError(403, 'ჯერ შეუერთდი ტურნირს')
        const active = await db.myActiveInTournament(userId, t.id)
        if (active) return { id: active }
        tc = t.tc || null
        tournament = t.id
      }
      if (tc && !TIME_CONTROLS[tc]) throw new HttpError(400, 'ასეთი დროის კონტროლი არ არის')
      const claimed = await db.claim(userId, type, tc, tournament)
      if (claimed) return { id: claimed }
      const waiting = await db.myWaiting(userId, type, tc, tournament)
      if (waiting) return { id: waiting }
      return create(type, { tc, tournament, public: true })
    }

    case 'join': {
      const g = await load(body.id)
      if (g.seats > 2) {
        await db.takeSeat(userId, g.id)
        return { id: g.id }
      }
      await db.join(userId, body.id)
      return { id: body.id }
    }

    // 4-ადგილიანი მაგიდა: შემქმნელი იწყებს, თავისუფალ ადგილებს კომპიუტერი იკავებს
    case 'start': {
      const g = await load(body.id)
      if (g.seats <= 2) throw new HttpError(400, 'ეს თამაში ორ მოთამაშეზეა')
      if (g.player_a !== userId) throw new HttpError(403, 'მაგიდას მხოლოდ შემქმნელი იწყებს')
      if (g.status !== 'waiting') throw new HttpError(409, 'თამაში უკვე დაწყებულია')
      const bots = seatsIn(g).filter((s) => !playerAt(g, s))
      const live = { ...g, bots }
      const full = HIDDEN.has(g.type) ? await db.getPrivate(g.id) : g.state
      const next = runBots(live, full)
      const patch = {
        status: 'active', bots, state: publicState(g.type, next), move_no: g.move_no + 1, updated_at: new Date(now()).toISOString(),
        turn: playerAt(g, seatToMove(g.type, next)),
      }
      const ok = await db.updateGame(g.id, patch, g.move_no, 'waiting')
      if (!ok) throw new HttpError(409, 'მაგიდა განახლდა — სცადე ხელახლა')
      await saveHidden(g.id, live, next)
      return { move_no: patch.move_no }
    }

    case 'move': {
      const g = await load(body.id)
      if (g.status !== 'active') throw new HttpError(409, 'თამაში აქტიური არ არის')
      const seat = seatOfUser(g, userId)
      if (!seat) throw new HttpError(403, 'ამ თამაშის მონაწილე არ ხარ')
      if (typeof body.move_no === 'number' && body.move_no !== g.move_no) throw new HttpError(409, 'დაფა განახლდა — სცადე ხელახლა')
      const full = HIDDEN.has(g.type) ? await db.getPrivate(g.id) : g.state
      if (!full) throw new HttpError(500, 'თამაშის მდგომარეობა ვერ მოიძებნა')
      if (seatToMove(g.type, full) !== seat) throw new HttpError(409, 'შენი რიგი არ არის')

      // საათი: სვლამდე ვამოწმებთ, ხომ არ ამოეწურა დრო
      let clock = g.clock ? { ...g.clock } : null
      if (clock) {
        const t = now()
        if (clock.at != null) {
          const left = clock[seat] - (t - clock.at)
          if (left <= 0) {
            await finishOnTime(g, seat)
            return { over: true, timeout: true }
          }
          clock[seat] = left + clock.inc
        }
        clock.at = t
      }

      let next
      try { next = applyAction(g.type, full, body.action, rand) } catch (e) {
        if (e instanceof IllegalMove) throw new HttpError(400, e.message)
        throw e
      }
      next = runBots(g, next)
      const o = outcome(g.type, next)
      const patch = { state: publicState(g.type, next), move_no: g.move_no + 1, updated_at: new Date(now()).toISOString() }
      if (clock) patch.clock = clock
      if (!o.over) patch.turn = playerAt(g, seatToMove(g.type, next))
      const ok = await db.updateGame(g.id, patch, g.move_no)
      if (!ok) throw new HttpError(409, 'დაფა განახლდა — სცადე ხელახლა')
      await saveHidden(g.id, g, next)
      if (o.over) await finish(g, next, o)
      return { move_no: patch.move_no, state: patch.state, over: o.over }
    }

    // ლოტო: კასრს იღებს ნებისმიერი მონაწილის მოთხოვნა, ოღონდ მხოლოდ დროზე და მხოლოდ ერთხელ (move_no)
    case 'tick': {
      const g = await load(body.id)
      if (g.type !== 'loto' || g.status !== 'active') return { ok: false }
      if (!seatOfUser(g, userId)) throw new HttpError(403, 'ამ თამაშის მონაწილე არ ხარ')
      const t = now()
      if (!loto.due(g.state, t)) return { ok: false, wait: g.state.next_at - t }
      const next = loto.draw(g.state, t)
      const o = outcome(g.type, next)
      const patch = { state: next, move_no: g.move_no + 1, updated_at: new Date(t).toISOString() }
      if (!(await db.updateGame(g.id, patch, g.move_no))) return { ok: false }
      if (o.over) await finish(g, next, o)
      return { ok: true, move_no: patch.move_no, over: o.over }
    }

    case 'flag': {
      const g = await load(body.id)
      if (g.status !== 'active' || !g.clock) return { ok: false }
      if (!seatOfUser(g, userId)) throw new HttpError(403, 'ამ თამაშის მონაწილე არ ხარ')
      const t = now()
      if (g.clock.at == null) {
        if (t - Date.parse(g.updated_at) < ABORT_AFTER) throw new HttpError(409, 'პირველი სვლის დრო ჯერ არ ამოწურულა')
        await db.finish(g.id, null, 'abort')
        return { ok: true, aborted: true }
      }
      const seat = seatToMove(g.type, g.state)
      if (g.clock[seat] - (t - g.clock.at) > 0) throw new HttpError(409, 'დრო ჯერ არ ამოწურულა')
      await finishOnTime(g, seat)
      return { ok: true }
    }

    case 'resign': {
      const g = await load(body.id)
      if (g.status === 'waiting') {
        if (g.player_a === userId) { await db.finish(g.id, null, 'cancel'); return { ok: true } }
        if (g.seats > 2 && seatOfUser(g, userId)) { await db.leaveSeat(userId, g.id); return { ok: true } }
        throw new HttpError(403, 'მხოლოდ შემქმნელს შეუძლია გაუქმება')
      }
      if (g.status !== 'active') return { ok: true }
      const seat = seatOfUser(g, userId)
      if (!seat) throw new HttpError(403, 'ამ თამაშის მონაწილე არ ხარ')
      if (g.seats > 2) {
        // მაგიდას ტოვებს: ადგილს კომპიუტერი იკავებს, თამაში გრძელდება
        const live = { ...g, bots: [...g.bots, seat] }
        const humansLeft = seatsIn(g).filter((s) => !isBot(live, s))
        const full = HIDDEN.has(g.type) ? await db.getPrivate(g.id) : g.state
        if (!humansLeft.length) {
          await finish(live, full, { winner: null, result: 'resign' })
          return { ok: true }
        }
        const next = runBots(live, full)
        const o = outcome(g.type, next)
        const patch = { bots: live.bots, state: publicState(g.type, next), move_no: g.move_no + 1, updated_at: new Date(now()).toISOString() }
        if (!o.over) patch.turn = playerAt(g, seatToMove(g.type, next))
        const ok = await db.updateGame(g.id, patch, g.move_no)
        if (!ok) throw new HttpError(409, 'მაგიდა განახლდა — სცადე ხელახლა')
        await saveHidden(g.id, live, next)
        if (o.over) await finish(live, next, o)
        return { ok: true }
      }
      await db.finish(g.id, userId === g.player_a ? g.player_b : g.player_a, 'resign')
      return { ok: true }
    }

    default:
      throw new HttpError(400, 'უცნობი ოპერაცია')
  }

  async function finishOnTime(g, loserSeat) {
    const winSeat = loserSeat === 'a' ? 'b' : 'a'
    // ჭადრაკი: თუ მომგებს მხოლოდ მეფე დარჩა — ფრე
    if (g.type === 'chess' || g.type === 'chess960') {
      const color = winSeat === 'a' ? 'w' : 'b'
      const pieces = chess.fromFEN(g.state.fen).board.filter((p) => p && chess.colorOf(p) === color)
      if (pieces.length === 1) { await db.finish(g.id, null, 'timeout'); return }
    }
    await db.finish(g.id, playerAt(g, winSeat), 'timeout')
  }
}
