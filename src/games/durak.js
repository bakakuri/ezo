// დურაკი (ჩამატებითი), 2 მოთამაშე, 36 კარტი, 6-6 კარტი ხელში.
// კოზირი — დასტის ბოლო (ღია) კარტი. პირველი უტევს, ვისაც ყველაზე დაბალი კოზირი აქვს.
// შეტევა ერთ-ერთზე: მომგერიებელი იგერიებს ან იღებს. ჩამატება — მხოლოდ მაგიდაზე არსებული რანგით,
// ბაუტში არაუმეტეს 6 კარტისა და არაუმეტეს მომგერიებლის კარტების რაოდენობისა (ბაუტის დასაწყისში).
// „ბიტა“ — ყველა მოგერიებულია, როლები იცვლება. „აიღე“ — მომტევეს კიდევ შეუძლია ჩაუმატოს, შემდეგ ყველაფერს იღებს.
// დასტა რომ დამთავრდება, ვინც პირველი დაცლის ხელს, ის იგებს. ვისაც კარტები დარჩება — დურაკია.
import { deck36, shuffle, rankOf, suitOf } from './cards.js'

export const otherSeat = (s) => (s === 'a' ? 'b' : 'a')

export function initState(rand = Math.random) {
  const deck = shuffle(deck36(), rand)
  const hands = { a: deck.slice(0, 6), b: deck.slice(6, 12) }
  const stock = deck.slice(12)
  const trump = stock[stock.length - 1]
  const ts = suitOf(trump)
  const low = (h) => Math.min(99, ...h.filter((c) => suitOf(c) === ts).map(rankOf))
  const attacker = low(hands.b) < low(hands.a) ? 'b' : 'a'
  return {
    hands, stock, trump, trumpSuit: ts, table: [], attacker, turn: attacker, phase: 'attack',
    limit: Math.min(6, hands[otherSeat(attacker)].length), discard: 0, winner: null, draw: false, last: null, bout: 1,
  }
}

export const beats = (card, target, ts) =>
  (suitOf(card) === suitOf(target) && rankOf(card) > rankOf(target)) || (suitOf(card) === ts && suitOf(target) !== ts)

const tableRanks = (s) => new Set(s.table.flatMap((p) => [p.a, p.d]).filter(Boolean).map(rankOf))
export const allBeaten = (s) => s.table.every((p) => p.d)

// რომელი კარტით შეუძლია მომტევეს ახლა სვლა
export function attackOptions(s) {
  if (s.phase !== 'attack' && s.phase !== 'take') return []
  const hand = s.hands[s.attacker]
  if (!s.table.length) return s.phase === 'attack' ? hand.slice() : []
  if (s.phase === 'attack' && !allBeaten(s)) return []
  if (s.table.length >= s.limit) return []
  const ranks = tableRanks(s)
  return hand.filter((c) => ranks.has(rankOf(c)))
}

export function defendOptions(s, card) {
  const open = s.table.findIndex((p) => !p.d)
  if (s.phase !== 'defend' || open < 0) return []
  return s.table.map((p, i) => (!p.d && beats(card, p.a, s.trumpSuit) ? i : -1)).filter((i) => i >= 0)
}

export const canDefend = (s) => s.hands[otherSeat(s.attacker)].some((c) => defendOptions(s, c).length)

function refill(s) {
  const hands = { ...s.hands }
  const stock = s.stock.slice()
  for (const seat of [s.attacker, otherSeat(s.attacker)]) {
    const h = hands[seat].slice()
    while (h.length < 6 && stock.length) h.push(stock.shift())
    hands[seat] = h
  }
  return { ...s, hands, stock }
}

function endBout(s, kind) {
  const def = otherSeat(s.attacker)
  let next
  if (kind === 'beaten') {
    next = { ...s, table: [], discard: s.discard + s.table.length * 2, last: { seat: s.attacker, kind: 'bita' } }
    next = refill(next)
    next.attacker = def
  } else {
    const cards = s.table.flatMap((p) => [p.a, p.d]).filter(Boolean)
    next = { ...s, table: [], hands: { ...s.hands, [def]: [...s.hands[def], ...cards] }, last: { seat: def, kind: 'took', n: cards.length } }
    next = refill(next)
  }
  next.bout = s.bout + 1
  if (!next.stock.length) {
    const ea = !next.hands.a.length
    const eb = !next.hands.b.length
    if (ea && eb) return { ...next, phase: 'over', turn: null, draw: true, winner: null }
    if (ea || eb) return { ...next, phase: 'over', turn: null, winner: ea ? 'a' : 'b' }
  }
  return { ...next, phase: 'attack', turn: next.attacker, limit: Math.min(6, next.hands[otherSeat(next.attacker)].length) }
}

// ავტომატური გადასვლები: თუ მომტევეს ჩასამატებელი არაფერი აქვს, ბაუტი თავისით მთავრდება
function settle(s) {
  if (s.phase === 'attack' && s.table.length && allBeaten(s) && !attackOptions(s).length) return endBout(s, 'beaten')
  if (s.phase === 'take' && !attackOptions(s).length) return endBout(s, 'taken')
  return s
}

export function attack(s, card) {
  if (!attackOptions(s).includes(card)) throw new Error('ამ კარტით სვლა არ შეიძლება')
  const hand = s.hands[s.attacker].filter((c) => c !== card)
  const table = [...s.table, { a: card, d: null }]
  const take = s.phase === 'take'
  const next = {
    ...s, hands: { ...s.hands, [s.attacker]: hand }, table,
    phase: take ? 'take' : 'defend', turn: take ? s.attacker : otherSeat(s.attacker),
    last: { seat: s.attacker, kind: 'attack', card },
  }
  return settle(next)
}

export function defend(s, card, target) {
  const def = otherSeat(s.attacker)
  if (s.turn !== def || !s.hands[def].includes(card) || !defendOptions(s, card).includes(target)) throw new Error('ამ კარტით ვერ მოიგერიებ')
  const table = s.table.map((p, i) => (i === target ? { ...p, d: card } : p))
  const next = {
    ...s, hands: { ...s.hands, [def]: s.hands[def].filter((c) => c !== card) }, table,
    phase: table.every((p) => p.d) ? 'attack' : 'defend',
    last: { seat: def, kind: 'beat', card },
  }
  next.turn = next.phase === 'attack' ? s.attacker : def
  return settle(next)
}

export function take(s) {
  if (s.phase !== 'defend') throw new Error('ახლა აღება არ შეიძლება')
  return settle({ ...s, phase: 'take', turn: s.attacker, last: { seat: otherSeat(s.attacker), kind: 'take' } })
}

// მომტევე: „ბიტა“ (ყველა მოგერიებულია) ან „აიღოს“ (მომგერიებელმა აიღო)
export function done(s) {
  if (s.phase === 'take') return endBout(s, 'taken')
  if (s.phase === 'attack' && s.table.length && allBeaten(s)) return endBout(s, 'beaten')
  throw new Error('ახლა ამის გაკეთება არ შეიძლება')
}

export const isOver = (s) => s.phase === 'over'
