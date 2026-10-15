// სერვერული თამაშის ლოგიკა: კლიენტი აგზავნის მოქმედებას (action), სერვერი ამოწმებს და ასრულებს.
// იყენებს Edge Function „game“ და დემო რეჟიმი — ერთი და იგივე კოდი.
import * as chess from './chess.js'
import * as checkers from './checkers.js'
import * as nardi from './nardi.js'
import * as domino from './domino.js'
import * as longnardi from './longnardi.js'
import * as durak from './durak.js'
import * as joker from './joker.js'
import * as bura from './bura.js'
import * as loto from './loto.js'
import { GAMES, outcome, cryptoRand } from './index.js'

export class IllegalMove extends Error {
  constructor(msg = 'ეს სვლა არ შეიძლება') { super(msg); this.code = 'illegal' }
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

export const HIDDEN = new Set(['domino', 'durak', 'joker', 'bura'])

export function initFor(type, rand = cryptoRand, opts = {}) {
  if (type === 'domino') return domino.initState(rand)
  if (type === 'durak') return durak.initState(rand)
  if (type === 'joker') return joker.initState(rand, opts.mode)
  if (type === 'bura') return bura.initState(rand)
  if (type === 'loto') return loto.initState(rand, opts.mode)
  if (!GAMES[type]) throw new IllegalMove('უცნობი თამაში')
  return GAMES[type].init()
}

const guard = (fn) => {
  try { return fn() } catch (e) { throw e instanceof IllegalMove ? e : new IllegalMove(e.message) }
}

// action-ის ფორმატი:
//   chess    { from, to, promo? }
//   checkers { path: [..] }
//   nardi    { roll: true } | { from, to }
//   domino   { play: [x, y], side: 'L'|'R' } | { draw: true } | { pass: true }
//   longnardi { roll: true } | { from, to }
//   durak    { attack: card } | { beat: card, target } | { take: true } | { done: true }
//   joker    { trump: suit|null } | { bid: n } | { play: card, mode?, suit? }
//   bura     { lead: [cards] } | { respond: [cards] }
//   loto     — სვლა არ აქვს: კასრს სერვერი იღებს (game-core: op 'tick')
export function applyAction(type, state, action, rand = cryptoRand) {
  if (!action || typeof action !== 'object') throw new IllegalMove()
  switch (type) {
    case 'chess': {
      const s = chess.fromFEN(state.fen)
      const m = chess.legalMoves(s).find((x) => x.from === action.from && x.to === action.to && (x.promo || null) === (action.promo || null))
      if (!m) throw new IllegalMove()
      return chess.applyToState(state, m)
    }
    case 'checkers': {
      if (!Array.isArray(action.path)) throw new IllegalMove()
      const m = checkers.legalMoves(state).find((x) => same(x.path, action.path))
      if (!m) throw new IllegalMove()
      return checkers.applyMove(state, m)
    }
    case 'nardi': {
      if (action.roll) {
        if (state.phase !== 'roll') throw new IllegalMove('კამათელი უკვე გაგორებულია')
        return nardi.applyRoll(state, nardi.rollDice(rand))
      }
      const m = nardi.findMove(state, action.from, action.to)
      if (!m) throw new IllegalMove()
      return nardi.applyMove(state, m)
    }
    case 'domino': {
      if (action.draw) {
        if (!domino.canDraw(state)) throw new IllegalMove('ბაზრიდან აღება ახლა არ შეიძლება')
        return domino.drawTile(state)
      }
      if (action.pass) {
        if (!domino.mustPass(state)) throw new IllegalMove('პასი ახლა არ შეიძლება')
        return domino.pass(state)
      }
      if (!Array.isArray(action.play)) throw new IllegalMove()
      const [x, y] = action.play
      const i = state.hands[state.turn].findIndex((t) => t[0] === x && t[1] === y)
      if (i < 0 || !domino.playable(state).some((o) => o.i === i && o.side === action.side)) throw new IllegalMove()
      return domino.play(state, i, action.side)
    }
    case 'longnardi': {
      if (action.roll) {
        if (state.phase !== 'roll') throw new IllegalMove('კამათელი უკვე გაგორებულია')
        return longnardi.applyRoll(state, longnardi.rollDice(rand))
      }
      const m = longnardi.findMove(state, action.from, action.to)
      if (!m) throw new IllegalMove()
      return longnardi.applyMove(state, m)
    }
    case 'durak': {
      if (typeof action.attack === 'string') return guard(() => durak.attack(state, action.attack))
      if (typeof action.beat === 'string') return guard(() => durak.defend(state, action.beat, Number(action.target)))
      if (action.take) return guard(() => durak.take(state))
      if (action.done) return guard(() => durak.done(state))
      throw new IllegalMove()
    }
    case 'joker': {
      if ('trump' in action) return guard(() => joker.chooseTrump(state, action.trump ?? null))
      if (typeof action.bid === 'number') return guard(() => joker.bid(state, action.bid))
      if (typeof action.play === 'string') return guard(() => joker.play(state, action.play, { mode: action.mode, suit: action.suit }, rand))
      throw new IllegalMove()
    }
    case 'bura': {
      if (Array.isArray(action.lead)) return guard(() => bura.lead(state, action.lead))
      if (Array.isArray(action.respond)) return guard(() => bura.respond(state, action.respond))
      throw new IllegalMove()
    }
    default:
      throw new IllegalMove('უცნობი თამაში')
  }
}

const mask = (list) => list.map(() => null)

// რას ხედავს ყველა (games.state): ხელები, ბაზარი და დასტა დამალულია, რჩება მხოლოდ რაოდენობა
export function publicState(type, state) {
  if (!HIDDEN.has(type)) return state
  if (type === 'domino') {
    const over = domino.isOver(state)
    return {
      ...state,
      hands: over ? state.hands : { a: mask(state.hands.a), b: mask(state.hands.b) },
      boneyard: mask(state.boneyard),
    }
  }
  if (type === 'durak') {
    const over = durak.isOver(state)
    return { ...state, hands: over ? state.hands : { a: mask(state.hands.a), b: mask(state.hands.b) }, stock: mask(state.stock) }
  }
  if (type === 'bura') {
    const over = bura.isOver(state)
    return { ...state, hands: over ? state.hands : { a: mask(state.hands.a), b: mask(state.hands.b) }, stock: mask(state.stock) }
  }
  const hands = {}
  for (const seat of joker.SEATS) hands[seat] = mask(joker.visibleHand(state, seat))
  return { ...state, hands }
}

// თითოეული ადგილის ხილული ხელი (game_hands ცხრილისთვის)
export function handsOf(type, state) {
  if (!HIDDEN.has(type)) return null
  if (type === 'joker') return Object.fromEntries(joker.SEATS.map((seat) => [seat, joker.visibleHand(state, seat)]))
  return state.hands
}

// კლიენტზე: საჯარო მდგომარეობას ჩემს ხელს ვუმატებთ
export function withMyHand(type, state, seat, tiles) {
  if (!HIDDEN.has(type) || !seat || !tiles) return state
  return { ...state, hands: { ...state.hands, [seat]: tiles } }
}

export const seatToMove = (type, state) => GAMES[type].seatOf(state)
export { outcome }
