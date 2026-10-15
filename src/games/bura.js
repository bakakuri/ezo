// ბურა — 2 მოთამაშე, 36 კარტი, ხელში 3 კარტი. კოზირი — დასტის ბოლო (ღია) კარტი, ბოლოს აიღება.
// სვლა: 1–3 ერთი მასტის კარტი. მოპასუხე ამდენივე კარტს დებს: თუ თითოეული მათგანი ცალკე „სჭრის“
// თითო შესულ კარტს (უფროსი იმავე მასტისა ან კოზირი) — ხელი მისია, თუ არა — ხელს იღებს მსვლელი.
// ქულები: ტუზი 11, ათიანი 10, მეფე 4, ქალი 3, ვალეტი 2 (სულ 120). ვინც 61-ს მიაღწევს — იგებს.
// „ბურა“: სამი კოზირი ხელში — მყისიერი მოგება.
import { deck36, shuffle, rankOf, suitOf } from './cards.js'

export const otherSeat = (s) => (s === 'a' ? 'b' : 'a')
const VALUE = { A: 11, T: 10, K: 4, Q: 3, J: 2 }
export const cardPoints = (c) => VALUE[c[0]] || 0
export const sumPoints = (cards) => cards.reduce((n, c) => n + cardPoints(c), 0)
export const WIN_AT = 61

export const beats = (card, target, ts) =>
  (suitOf(card) === suitOf(target) && rankOf(card) > rankOf(target)) || (suitOf(card) === ts && suitOf(target) !== ts)

function permutations(a) {
  if (a.length <= 1) return [a]
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]))
}
// პასუხის კარტები თითო-თითოდ სჭრის შესულებს?
export const beatsAll = (resp, lead, ts) => resp.length === lead.length && permutations(resp).some((p) => p.every((c, i) => beats(c, lead[i], ts)))

const isBura = (hand, ts) => hand.length === 3 && hand.every((c) => suitOf(c) === ts)

function checkBura(s, order) {
  for (const seat of order) {
    if (isBura(s.hands[seat], s.trumpSuit)) return { ...s, phase: 'over', turn: null, winner: seat, bura: seat }
  }
  return s
}

export function initState(rand = Math.random) {
  const deck = shuffle(deck36(), rand)
  const leader = rand() < 0.5 ? 'a' : 'b'
  const stock = deck.slice(6)
  const trump = stock[stock.length - 1]
  const s = {
    hands: { a: deck.slice(0, 3), b: deck.slice(3, 6) }, stock, trump, trumpSuit: suitOf(trump),
    leader, turn: leader, phase: 'lead', lead: [], points: { a: 0, b: 0 }, taken: { a: 0, b: 0 },
    trick: 1, last: null, winner: null, draw: false, bura: null,
  }
  return checkBura(s, [leader, otherSeat(leader)])
}

// რამდენი კარტით შეიძლება სვლა: მოპასუხეს იმდენი უნდა ჰქონდეს
export const maxLead = (s) => Math.min(3, s.hands[s.leader].length, s.hands[otherSeat(s.leader)].length)

export function canLead(s, cards) {
  if (s.phase !== 'lead' || !Array.isArray(cards) || !cards.length || cards.length > maxLead(s)) return false
  if (new Set(cards).size !== cards.length || !cards.every((c) => s.hands[s.leader].includes(c))) return false
  return cards.every((c) => suitOf(c) === suitOf(cards[0]))
}

export function lead(s, cards) {
  if (!canLead(s, cards)) throw new Error('ასე სვლა არ შეიძლება — რამდენიმე კარტი მხოლოდ ერთი მასტისა')
  return {
    ...s, lead: cards.slice(), phase: 'respond', turn: otherSeat(s.leader),
    hands: { ...s.hands, [s.leader]: s.hands[s.leader].filter((c) => !cards.includes(c)) },
  }
}

function finishByPoints(s) {
  const { a, b } = s.points
  return { ...s, phase: 'over', turn: null, winner: a === b ? null : a > b ? 'a' : 'b', draw: a === b }
}

export function respond(s, cards) {
  const seat = otherSeat(s.leader)
  if (s.phase !== 'respond' || !Array.isArray(cards) || cards.length !== s.lead.length) throw new Error(`დადე ${s.lead.length} კარტი`)
  if (new Set(cards).size !== cards.length || !cards.every((c) => s.hands[seat].includes(c))) throw new Error('ეს კარტი ხელში არ გაქვს')
  const beat = beatsAll(cards, s.lead, s.trumpSuit)
  const winner = beat ? seat : s.leader
  const loser = otherSeat(winner)
  const pts = sumPoints([...s.lead, ...cards])
  const hands = { ...s.hands, [seat]: s.hands[seat].filter((c) => !cards.includes(c)) }
  const points = { ...s.points, [winner]: s.points[winner] + pts }
  const taken = { ...s.taken, [winner]: s.taken[winner] + cards.length * 2 }
  let next = {
    ...s, hands, points, taken, lead: [], last: { leader: s.leader, lead: s.lead, resp: cards, winner, beat, pts },
  }
  if (points[winner] >= WIN_AT) return { ...next, phase: 'over', turn: null, winner }
  // აღება: ჯერ ხელის მომგები, მერე მეორე
  const stock = next.stock.slice()
  for (const x of [winner, loser]) {
    const h = next.hands[x].slice()
    while (h.length < 3 && stock.length) h.push(stock.shift())
    next.hands = { ...next.hands, [x]: h }
  }
  next.stock = stock
  next = checkBura(next, [winner, loser])
  if (next.phase === 'over') return next
  if (!next.hands.a.length || !next.hands.b.length) {
    // ვინც ბოლოს დარჩა კარტით, ის ქულებსაც იტოვებს
    const pointsEnd = { a: next.points.a + sumPoints(next.hands.a), b: next.points.b + sumPoints(next.hands.b) }
    return finishByPoints({ ...next, points: pointsEnd })
  }
  return { ...next, phase: 'lead', leader: winner, turn: winner, trick: s.trick + 1 }
}

export const isOver = (s) => s.phase === 'over'
