// კომპიუტერი-მოწინააღმდეგე ოთხივე თამაშისთვის.
// ჭადრაკი/შაშკი: 2 სვლის სიღრმე მატერიალზე; ნარდი: ევრისტიკა; დომინო: ხარბი.
import * as chess from './chess.js'
import * as chess960 from './chess960.js'
import * as gomoku from './gomoku.js'
import * as checkers from './checkers.js'
import * as nardi from './nardi.js'
import * as domino from './domino.js'
import * as longnardi from './longnardi.js'
import * as durak from './durak.js'
import * as joker from './joker.js'
import * as bura from './bura.js'
import { rankOf, suitOf, isJoker, SUITS } from './cards.js'
import { cryptoRand } from './index.js'

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }
const CENTER = new Set([27, 28, 35, 36])

function material(s, color) {
  let v = 0
  s.board.forEach((p, i) => {
    if (!p) return
    const val = VAL[p.toLowerCase()] + (CENTER.has(i) ? 12 : 0)
    v += chess.colorOf(p) === color ? val : -val
  })
  return v
}

// ჭადრაკი და ჭადრაკი 960: იგივე ალგორითმი, სვლების წესები — ძრავიდან
const CHESS_RULES = { legalMoves: chess.legalMoves, makeMove: chess.makeMove, applyToState: chess.applyToState }
const C960_RULES = {
  legalMoves: (s) => chess960.legalMoves(s).filter((m) => !(m.flag === 'castle960' && m.to !== m.rook)),
  makeMove: chess960.makeMove,
  applyToState: chess960.applyToState,
}
function chessLike(state, R) {
  const s = chess.fromFEN(state.fen)
  const me = s.turn
  let best = null
  let bestScore = -Infinity
  for (const m of R.legalMoves(s)) {
    if (m.promo && m.promo !== 'q') continue
    const n = R.makeMove(s, m)
    const replies = R.legalMoves(n)
    let score
    if (!replies.length) score = chess.inCheck(n) ? 1e6 : -50
    else {
      score = Infinity
      for (const r of replies) score = Math.min(score, material(R.makeMove(n, r), me))
      if (chess.inCheck(n)) score += 15
    }
    score += cryptoRand() * 10
    if (score > bestScore) { bestScore = score; best = m }
  }
  return best ? R.applyToState(state, best) : state
}
export const chessBot = (state) => chessLike(state, CHESS_RULES)
export const chess960Bot = (state) => chessLike(state, C960_RULES)
export function gomokuBot(state, rand = cryptoRand) {
  const i = gomoku.bestMove(state, rand)
  return i >= 0 ? gomoku.play(state, i) : state
}

function ckEval(s, color) {
  let v = 0
  for (const p of s.board) {
    if (!p) continue
    const val = p === p.toUpperCase() ? 3 : 1
    v += p.toLowerCase() === color ? val : -val
  }
  return v
}

export function checkersBot(state) {
  const me = state.turn
  let best = null
  let bestScore = -Infinity
  for (const m of checkers.legalMoves(state)) {
    const n = checkers.applyMove(state, m)
    const replies = checkers.legalMoves(n)
    let score
    if (!replies.length) score = 1e6
    else {
      score = Infinity
      for (const r of replies) score = Math.min(score, ckEval(checkers.applyMove(n, r), me))
    }
    // წინსვლა და ცენტრი
    const to = m.path[m.path.length - 1]
    const row = to >> 3
    score += (me === 'w' ? 7 - row : row) * 0.05 + ((to & 7) > 1 && (to & 7) < 6 ? 0.05 : 0)
    score += cryptoRand() * 0.2
    if (score > bestScore) { bestScore = score; best = m }
  }
  return best ? checkers.applyMove(state, best) : state
}

function nardiScore(s, m) {
  const c = s.turn
  const sign = c === 'w' ? 1 : -1
  const next = nardi.applySingle(s, m)
  let score = cryptoRand() * 0.6 + m.die * 0.1
  const last = next.last[next.last.length - 1]
  if (last.hit) score += 4
  if (m.to === 'off') score += 5
  else {
    const n = next.points[m.to] * sign
    if (n === 2) score += 3
    if (n === 1) score -= 1.5
  }
  if (m.from !== 'bar' && next.points[m.from] * sign === 1) score -= 2
  return score
}

export function nardiBot(state) {
  let s = state
  const seat = s.turn
  if (s.phase === 'roll') s = nardi.applyRoll(s, nardi.rollDice(cryptoRand))
  let guard = 0
  while (s.turn === seat && s.phase === 'move' && guard++ < 8) {
    const moves = nardi.legalMoves(s)
    if (!moves.length) break
    let best = moves[0]
    let bestScore = -Infinity
    for (const m of moves) {
      const v = nardiScore(s, m)
      if (v > bestScore) { bestScore = v; best = m }
    }
    s = nardi.applyMove(s, best)
  }
  return s
}

export function dominoBot(state) {
  let s = state
  const seat = s.turn
  let guard = 0
  while (s.turn === seat && !domino.isOver(s) && guard++ < 30) {
    const options = domino.playable(s)
    if (options.length) {
      let best = options[0]
      let bestScore = -1
      for (const o of options) {
        const [x, y] = s.hands[seat][o.i]
        const v = x + y + (x === y ? 4 : 0) + cryptoRand()
        if (v > bestScore) { bestScore = v; best = o }
      }
      s = domino.play(s, best.i, best.side)
    } else if (domino.canDraw(s)) s = domino.drawTile(s)
    else s = domino.pass(s)
  }
  return s
}

// ---- გრძელი ნარდი: წინსვლა, თავიდან დროულად გამოსვლა, პუნქტების დაკავება მოწინააღმდეგის გზაზე
function longScore(s, m) {
  const c = s.turn
  const next = longnardi.applySingle(s, m)
  let score = cryptoRand() * 0.5 + m.die * 0.15
  if (m.to === 'off') return score + 6
  const sign = c === 'w' ? 1 : -1
  const stack = next.points[m.to] * sign
  if (stack === 1) score += 1.2 // ახალი პუნქტი
  if (stack > 4) score -= 0.4 * (stack - 4)
  if (m.from === (c === 'w' ? 23 : 11)) score += s.turns[c] < 6 ? 2 : 0.8
  const p = longnardi.pos(c, m.to)
  if (p >= 12 && p < 18) score += 0.6 // მოწინააღმდეგის სახლის წინ ბლოკი
  if (p >= 18) score += 0.4
  return score
}

export function longnardiBot(state) {
  let s = state
  const seat = s.turn
  if (s.phase === 'roll') s = longnardi.applyRoll(s, longnardi.rollDice(cryptoRand))
  let guard = 0
  while (s.turn === seat && s.phase === 'move' && guard++ < 8) {
    const moves = longnardi.legalMoves(s)
    if (!moves.length) break
    let best = moves[0]
    let bestScore = -Infinity
    for (const m of moves) {
      const v = longScore(s, m)
      if (v > bestScore) { bestScore = v; best = m }
    }
    s = longnardi.applyMove(s, best)
  }
  return s
}

// ---- დურაკი: იაფი კარტით შეტევა, კოზირების დაზოგვა, ძვირად მოგერიებას აღება სჯობს
export function durakBot(s) {
  const me = s.turn
  const ts = s.trumpSuit
  const cost = (c) => rankOf(c) + (suitOf(c) === ts ? 20 : 0)
  const byCost = (a, b) => cost(a) - cost(b)
  if (me === s.attacker) {
    const opts = durak.attackOptions(s).sort(byCost)
    if (!s.table.length) {
      // ორი ერთნაირი რანგი — ჯერ ის, რომ მერე ჩამატება შევძლოთ
      const hand = s.hands[me]
      const paired = opts.filter((c) => suitOf(c) !== ts && hand.filter((x) => rankOf(x) === rankOf(c)).length > 1)
      return durak.attack(s, (paired[0] && cost(paired[0]) <= cost(opts[0]) + 3) ? paired[0] : opts[0])
    }
    const late = s.stock.length <= 2
    const cand = opts.filter((c) => (suitOf(c) !== ts || late) && (rankOf(c) <= 11 || late))
    if (cand.length) return durak.attack(s, cand[0])
    return durak.done(s)
  }
  const open = s.table.findIndex((p) => !p.d)
  if (open < 0) return s
  const target = s.table[open].a
  const beaters = s.hands[me].filter((c) => durak.beats(c, target, ts)).sort(byCost)
  if (!beaters.length) return durak.take(s)
  const c = beaters[0]
  if (suitOf(c) === ts && suitOf(target) !== ts && rankOf(c) >= 12 && s.stock.length > 8 && rankOf(target) <= 10) return durak.take(s)
  return durak.defend(s, c, open)
}

// ---- ჯოკერი
function estimateTricks(hand, ts, n) {
  let e = 0
  const count = (suit) => hand.filter((c) => !isJoker(c) && suitOf(c) === suit).length
  for (const c of hand) {
    if (isJoker(c)) { e += 0.95; continue }
    const r = rankOf(c)
    if (ts && suitOf(c) === ts) e += r === 14 ? 0.95 : r === 13 ? 0.8 : r === 12 ? 0.6 : r === 11 ? 0.45 : n >= 6 ? 0.3 : 0.15
    else if (r === 14) e += n <= 3 ? 0.85 : 0.7
    else if (r === 13 && count(suitOf(c)) >= 2) e += n <= 4 ? 0.3 : 0.4
  }
  return e
}

function pickTrump(hand) {
  let best = null
  let bestW = 0
  for (const suit of SUITS) {
    const w = hand.filter((c) => !isJoker(c) && suitOf(c) === suit).reduce((n, c) => n + Math.max(1, rankOf(c) - 10), 0)
    if (w > bestW) { bestW = w; best = suit }
  }
  return bestW >= 4 ? best : null
}

export function jokerBot(s, rand = cryptoRand) {
  const me = s.turn
  if (s.phase === 'trump') return joker.chooseTrump(s, pickTrump(joker.visibleHand(s, me)))
  if (s.phase === 'bid') {
    const opts = joker.bidOptions(s)
    const e = estimateTricks(s.hands[me], s.trumpSuit, s.n)
    let want = Math.max(0, Math.min(s.n, Math.round(e)))
    if (!opts.includes(want)) want = e < want ? want - 1 : want + 1
    if (!opts.includes(want)) want = opts.reduce((a, b) => (Math.abs(b - e) < Math.abs(a - e) ? b : a))
    return joker.bid(s, want)
  }
  if (s.phase !== 'play') return s
  const ts = s.trumpSuit
  const legal = joker.legalCards(s, me)
  const need = s.bids[me] - s.taken[me]
  const wantWin = need > 0
  const cost = (c) => (isJoker(c) ? 100 : rankOf(c) + (suitOf(c) === ts ? 12 : 0))
  const asc = legal.slice().sort((a, b) => cost(a) - cost(b))
  const regular = asc.filter((c) => !isJoker(c))
  const jk = asc.find(isJoker)

  if (!s.trick.length) {
    if (wantWin) {
      const ace = regular.filter((c) => rankOf(c) === 14 && suitOf(c) !== ts)[0]
      if (ace) return joker.play(s, ace, {}, rand)
      const topTrump = regular.filter((c) => suitOf(c) === ts).pop()
      if (topTrump && rankOf(topTrump) >= 13) return joker.play(s, topTrump, {}, rand)
      if (jk) {
        const suit = ts || SUITS.find((x) => !s.hands[me].some((c) => suitOf(c) === x)) || 's'
        return joker.play(s, jk, { mode: 'high', suit }, rand)
      }
      return joker.play(s, regular[regular.length - 1], {}, rand)
    }
    const low = regular.filter((c) => suitOf(c) !== ts)[0] || regular[0]
    if (low) return joker.play(s, low, {}, rand)
    return joker.play(s, jk, { mode: 'low', suit: SUITS[Math.floor(rand() * 4)] }, rand)
  }

  const wins = (card, mode) => joker.trickWinner([...s.trick, { seat: me, card, mode }], ts) === s.trick.length
  if (wantWin) {
    const winner = regular.find((c) => wins(c))
    if (winner) return joker.play(s, winner, {}, rand)
    if (jk) return joker.play(s, jk, { mode: 'high' }, rand)
    return joker.play(s, regular[0], {}, rand)
  }
  const losers = regular.filter((c) => !wins(c))
  if (losers.length) return joker.play(s, losers[losers.length - 1], {}, rand)
  if (jk) return joker.play(s, jk, { mode: 'low' }, rand)
  return joker.play(s, regular[0], {}, rand)
}

// ---- ბურა: იაფი კარტით სვლა, ძვირი ხელის მოჭრა, კოზირების დაზოგვა
function combos(arr, k) {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [x, ...rest] = arr
  return [...combos(rest, k - 1).map((c) => [x, ...c]), ...combos(rest, k)]
}
export function buraBot(s) {
  const ts = s.trumpSuit
  const isT = (c) => suitOf(c) === ts
  if (s.phase === 'lead') {
    const hand = s.hands[s.leader]
    const max = bura.maxLead(s)
    let best = null
    let bestScore = -Infinity
    for (let k = 1; k <= max; k++) {
      for (const c of combos(hand, k)) {
        if (!bura.canLead(s, c)) continue
        // ტუზ-კოზირი თითქმის არ იჭრება; დანარჩენი — რაც ნაკლები ქულა გავა, მით უკეთესი
        const safe = c.every((x) => isT(x) && rankOf(x) >= 13)
        const score = (safe ? bura.sumPoints(c) : -bura.sumPoints(c)) - c.filter(isT).length * (safe ? 0 : 7) + (k - 1) * 2 - c.reduce((n, x) => n + rankOf(x), 0) * 0.05
        if (score > bestScore) { bestScore = score; best = c }
      }
    }
    return bura.lead(s, best)
  }
  const seat = bura.otherSeat(s.leader)
  const leadPts = bura.sumPoints(s.lead)
  let best = null
  let bestScore = -Infinity
  for (const c of combos(s.hands[seat], s.lead.length)) {
    const own = bura.sumPoints(c)
    const win = bura.beatsAll(c, s.lead, ts)
    const trumps = c.filter(isT).length
    const score = win ? leadPts + own - trumps * (leadPts >= 10 ? 3 : 8) : -(leadPts + own) - trumps * 6
    if (score > bestScore) { bestScore = score; best = c }
  }
  return bura.respond(s, best)
}

export const BOTS = {
  chess: chessBot, chess960: chess960Bot, gomoku: gomokuBot, checkers: checkersBot, nardi: nardiBot, domino: dominoBot,
  longnardi: longnardiBot, durak: durakBot, joker: jokerBot, bura: buraBot,
  loto: (s) => s,
}
