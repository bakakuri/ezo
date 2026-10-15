// ჯოკერი — 4 მოთამაშე, 36 კარტი (შავი ექვსიანების ნაცვლად ორი ჯოკერი).
// წესები pagat.com/exact/joker.html-ის მიხედვით, ქართული ჩვეულებით:
// • 9-კარტიან დარიგებაზე კოზირს ირჩევს დამრიგებლის მარცხნივ მჯდომი, პირველი 3 კარტის ნახვის შემდეგ (ან „უკოზიროდ“).
// • ნაკლებ კარტიანზე კოზირი — დასტიდან ამობრუნებული კარტი; ჯოკერი თუ ამოვიდა — უკოზიროდ.
// • დამრიგებელი ბოლოს აცხადებს და ისე ვერ იტყვის, რომ შეკვეთების ჯამი კარტების რაოდენობას გაუტოლდეს.
// • მასტის აყოლა სავალდებულოა, თუ არ გაქვს — კოზირი; ჯოკერი ყოველთვის შეიძლება.
// • ჯოკერი: „მაღალი“ (იღებს) ან „დაბალი“ (აგდებს). შემოსვლისას — მასტსაც ასახელებს:
//   „მაღალი“ — ყველამ ამ მასტის უმაღლესი უნდა დადოს (კოზირის დასახელებისას — ნებისმიერი);
//   „დაბალი“ (წაიღოს) — ჯოკერი ამ მასტის უდაბლესია.
// • ქულები: შეკვეთა ზუსტად — 50×შეკვეთა+50 (პასი = 50), ყველა აიღო, რაც უთხრა = 100×კარტი;
//   ვერ შეასრულა — 10 ყოველ აღებულზე; ხიშტი (უთხრა და ვერაფერი აიღო) = −200 (1–8 კარტზე) / −500 (9 კარტზე).
//   პულკის პრემია: ვინც პულკაში ყველა შეკვეთა შეასრულა, მიიღებს პულკის საუკეთესო შედეგს კიდევ ერთხელ.
import { deck36, shuffle, rankOf, suitOf, isJoker, SUITS } from './cards.js'

export const SEATS = ['a', 'b', 'c', 'd']
export const nextSeat = (s) => SEATS[(SEATS.indexOf(s) + 1) % 4]

export const MODES = {
  standard: { title: 'სტანდარტული', sets: [[1, 2, 3, 4, 5, 6, 7, 8], [9, 9, 9, 9], [8, 7, 6, 5, 4, 3, 2, 1], [9, 9, 9, 9]] },
  nines: { title: 'ცხრიანები', sets: [[9, 9, 9, 9], [9, 9, 9, 9], [9, 9, 9, 9], [9, 9, 9, 9]] },
  quick: { title: 'სწრაფი', sets: [[9, 9, 9, 9]] },
}

export function jokerDeck() {
  return [...deck36().filter((c) => c !== '6s' && c !== '6c'), 'X1', 'X2']
}

const zero = () => ({ a: 0, b: 0, c: 0, d: 0 })
const empty = () => ({ a: null, b: null, c: null, d: null })

export function initState(rand = Math.random, mode = 'standard') {
  const s = {
    mode: MODES[mode] ? mode : 'standard', set: 0, hand: 0, dealer: 'd',
    n: 0, hands: { a: [], b: [], c: [], d: [] }, trump: null, trumpSuit: null,
    phase: 'bid', turn: 'a', bids: empty(), taken: zero(), trick: [], leader: 'a',
    lastTrick: null, scores: zero(), sheet: [], winner: null, draw: false,
  }
  return deal(s, rand)
}

export const handSize = (s) => MODES[s.mode].sets[s.set][s.hand]
export const totalHands = (mode) => MODES[mode].sets.reduce((n, x) => n + x.length, 0)

function deal(s, rand) {
  const n = handSize(s)
  const cards = shuffle(jokerDeck(), rand)
  const hands = {}
  SEATS.forEach((seat, k) => { hands[seat] = cards.slice(k * n, k * n + n) })
  const first = nextSeat(s.dealer)
  const base = { ...s, n, hands, bids: empty(), taken: zero(), trick: [], leader: first, turn: first, lastTrick: s.lastTrick }
  if (n === 9) return { ...base, trump: null, trumpSuit: null, phase: 'trump' }
  const trump = cards[4 * n]
  return { ...base, trump, trumpSuit: suitOf(trump), phase: 'bid' }
}

// ხილული ხელი: კოზირის არჩევისას — მხოლოდ პირველი 3 კარტი
export function visibleHand(s, seat) {
  return s.phase === 'trump' ? s.hands[seat].slice(0, 3) : s.hands[seat]
}

export function chooseTrump(s, suit) {
  if (s.phase !== 'trump') throw new Error('კოზირი უკვე არჩეულია')
  if (suit !== null && !SUITS.includes(suit)) throw new Error('ასეთი მასტი არ არსებობს')
  return { ...s, trumpSuit: suit, trump: null, phase: 'bid', turn: nextSeat(s.dealer) }
}

export function forbiddenBid(s) {
  if (s.turn !== s.dealer) return null
  const sum = SEATS.reduce((n, x) => n + (s.bids[x] ?? 0), 0)
  const f = s.n - sum
  return f >= 0 ? f : null
}

export function bidOptions(s) {
  if (s.phase !== 'bid') return []
  const f = forbiddenBid(s)
  return Array.from({ length: s.n + 1 }, (_, k) => k).filter((k) => k !== f)
}

export function bid(s, k) {
  if (!bidOptions(s).includes(k)) throw new Error('ამ რაოდენობას ვერ იტყვი')
  const bids = { ...s.bids, [s.turn]: k }
  const done = s.turn === s.dealer
  return { ...s, bids, turn: done ? nextSeat(s.dealer) : nextSeat(s.turn), phase: done ? 'play' : 'bid' }
}

// რა მასტი უნდა აყვეს და სავალდებულოა თუ არა უმაღლესი
function demand(s) {
  if (!s.trick.length) return null
  const lead = s.trick[0]
  if (isJoker(lead.card)) return { suit: lead.suit, highest: lead.mode === 'high' && lead.suit !== s.trumpSuit }
  return { suit: suitOf(lead.card), highest: false }
}

export function legalCards(s, seat = s.turn) {
  const hand = s.hands[seat]
  const d = demand(s)
  if (!d) return hand.slice()
  const jokers = hand.filter(isJoker)
  const follow = hand.filter((c) => !isJoker(c) && suitOf(c) === d.suit)
  if (follow.length) {
    if (!d.highest) return [...follow, ...jokers]
    const top = Math.max(...follow.map(rankOf))
    return [...follow.filter((c) => rankOf(c) === top), ...jokers]
  }
  const trumps = s.trumpSuit ? hand.filter((c) => !isJoker(c) && suitOf(c) === s.trumpSuit) : []
  if (trumps.length) return [...trumps, ...jokers]
  return hand.slice()
}

// ხრიკის მომგები (ინდექსი trick-ში)
export function trickWinner(trick, trumpSuit) {
  const highs = trick.map((x, i) => (isJoker(x.card) && x.mode === 'high' ? i : -1)).filter((i) => i >= 0)
  const lead = trick[0]
  const best = (filter) => {
    let bi = -1
    trick.forEach((x, i) => { if (!isJoker(x.card) && filter(x.card) && (bi < 0 || rankOf(x.card) > rankOf(trick[bi].card))) bi = i })
    return bi
  }
  if (highs.length) {
    const last = highs[highs.length - 1]
    if (last > 0) return last
    if (trumpSuit && lead.suit !== trumpSuit) {
      const t = best((c) => suitOf(c) === trumpSuit)
      if (t >= 0) return t
    }
    return 0
  }
  if (trumpSuit) {
    const t = best((c) => suitOf(c) === trumpSuit)
    if (t >= 0) return t
  }
  const ls = isJoker(lead.card) ? lead.suit : suitOf(lead.card)
  const f = best((c) => suitOf(c) === ls)
  return f >= 0 ? f : 0
}

export function handPoints(n, b, t, nineSet) {
  if (b === t) return b === n ? 100 * n : 50 * b + 50
  if (b > 0 && t === 0) return nineSet ? -500 : -200
  return 10 * t
}

function scoreHand(s, rand) {
  const nine = s.n === 9
  const points = {}
  for (const x of SEATS) points[x] = handPoints(s.n, s.bids[x], s.taken[x], nine)
  const sheet = [...s.sheet, { set: s.set, n: s.n, bids: s.bids, taken: s.taken, points, trumpSuit: s.trumpSuit }]
  const scores = { ...s.scores }
  for (const x of SEATS) scores[x] += points[x]
  const setLen = MODES[s.mode].sets[s.set].length
  let next = { ...s, sheet, scores }
  if (s.hand + 1 >= setLen) {
    // პულკის პრემია
    const rows = sheet.filter((r) => r.set === s.set && !r.bonus)
    const bonus = {}
    for (const x of SEATS) {
      const allMade = rows.every((r) => r.bids[x] === r.taken[x])
      bonus[x] = allMade ? Math.max(...rows.map((r) => r.points[x])) : 0
      scores[x] += bonus[x]
    }
    if (SEATS.some((x) => bonus[x])) next.sheet = [...sheet, { set: s.set, bonus: true, points: bonus }]
    next.scores = scores
    if (s.set + 1 >= MODES[s.mode].sets.length) {
      const top = Math.max(...SEATS.map((x) => scores[x]))
      const leaders = SEATS.filter((x) => scores[x] === top)
      return { ...next, phase: 'over', turn: null, winner: leaders.length === 1 ? leaders[0] : null, draw: leaders.length > 1, hands: { a: [], b: [], c: [], d: [] } }
    }
    next = { ...next, set: s.set + 1, hand: 0 }
  } else {
    next = { ...next, hand: s.hand + 1 }
  }
  next.dealer = nextSeat(s.dealer)
  return deal(next, rand)
}

export function play(s, card, opts = {}, rand = Math.random) {
  if (s.phase !== 'play') throw new Error('ახლა კარტის დადება არ შეიძლება')
  const seat = s.turn
  if (!legalCards(s, seat).includes(card)) throw new Error('ამ კარტს ვერ დადებ')
  const entry = { seat, card }
  if (isJoker(card)) {
    if (opts.mode !== 'high' && opts.mode !== 'low') throw new Error('ჯოკერი: მაღალი თუ დაბალი?')
    entry.mode = opts.mode
    if (!s.trick.length) {
      if (!SUITS.includes(opts.suit)) throw new Error('ჯოკერით შემოსვლისას მასტი დაასახელე')
      entry.suit = opts.suit
    }
  }
  const trick = [...s.trick, entry]
  const hands = { ...s.hands, [seat]: s.hands[seat].filter((c) => c !== card) }
  if (trick.length < 4) return { ...s, hands, trick, turn: nextSeat(seat) }
  const w = trick[trickWinner(trick, s.trumpSuit)].seat
  const taken = { ...s.taken, [w]: s.taken[w] + 1 }
  const next = { ...s, hands, trick: [], taken, leader: w, turn: w, lastTrick: { cards: trick, winner: w } }
  if (hands[seat].length === 0) return scoreHand(next, rand)
  return next
}

export const isOver = (s) => s.phase === 'over'
