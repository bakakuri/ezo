// ლოტო — 90 კასრი, თითო მოთამაშეს ბილეთი 3 რიგით, თითო რიგში 5 რიცხვი (სვეტი = ათეული).
// კასრს თამაში თვითონ იღებს ყოველ ~3 წამში; რიცხვები ბილეთზე თავისით აღინიშნება.
// „ხაზი“ — ვინც პირველი შეავსებს ერთ რიგს, იგებს; „სრული“ — მთელ ბილეთს. ერთდროულად — ფრე.
import { shuffle } from './cards.js'

export const SEATS = ['a', 'b', 'c', 'd']
export const INTERVAL = 3200
export const MODES = { line: { title: 'ხაზი', sub: 'ერთი სრული რიგი' }, full: { title: 'სრული', sub: 'მთელი ბილეთი' } }

const colRange = (c) => (c === 0 ? [1, 9] : c === 8 ? [80, 90] : [c * 10, c * 10 + 9])

// ბილეთი: 3 × 9, null — ცარიელი უჯრა
export function makeTicket(rand = Math.random) {
  let rows
  for (;;) {
    rows = [0, 1, 2].map(() => shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8], rand).slice(0, 5))
    const used = new Set(rows.flat())
    if (used.size === 9) break
  }
  const grid = [0, 1, 2].map(() => Array(9).fill(null))
  for (let c = 0; c < 9; c++) {
    const inRows = [0, 1, 2].filter((r) => rows[r].includes(c))
    const [lo, hi] = colRange(c)
    const pool = shuffle(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), rand).slice(0, inRows.length).sort((x, y) => x - y)
    inRows.forEach((r, i) => { grid[r][c] = pool[i] })
  }
  return grid
}

export const numbersOf = (ticket) => ticket.flat().filter((n) => n !== null)
// თითო რიგში რამდენი დარჩა
export const rowsLeft = (ticket, drawn) => {
  const set = drawn instanceof Set ? drawn : new Set(drawn)
  return ticket.map((row) => row.filter((n) => n !== null && !set.has(n)).length)
}
export const coveredCount = (ticket, drawn) => {
  const set = drawn instanceof Set ? drawn : new Set(drawn)
  return numbersOf(ticket).filter((n) => set.has(n)).length
}
const done = (ticket, set, mode) => {
  const left = rowsLeft(ticket, set)
  return mode === 'full' ? left.every((n) => n === 0) : left.some((n) => n === 0)
}

export function initState(rand = Math.random, mode = 'line', seats = 4) {
  const list = SEATS.slice(0, seats)
  return {
    bag: shuffle(Array.from({ length: 90 }, (_, i) => i + 1), rand),
    drawn: [], tickets: Object.fromEntries(list.map((s) => [s, makeTicket(rand)])),
    mode: MODES[mode] ? mode : 'line', phase: 'play', next_at: null, interval: INTERVAL,
    winner: null, winners: [], draw: false, scores: Object.fromEntries(list.map((s) => [s, 0])), last: null,
  }
}

export const due = (s, now) => s.phase === 'play' && (s.next_at === null || now >= s.next_at)

// შემდეგი კასრი (პირველი გამოძახება მხოლოდ საათს რთავს)
export function draw(s, now = Date.now()) {
  if (s.phase !== 'play') throw new Error('თამაში დასრულებულია')
  if (s.next_at === null) return { ...s, next_at: now + 1500 }
  if (now < s.next_at) throw new Error('შემდეგი კასრი ჯერ არ არის')
  const n = s.bag[0]
  const drawn = [...s.drawn, n]
  const set = new Set(drawn)
  const seats = Object.keys(s.tickets)
  const winners = seats.filter((seat) => done(s.tickets[seat], set, s.mode))
  const scores = Object.fromEntries(seats.map((seat) => [seat, coveredCount(s.tickets[seat], set) + (winners.includes(seat) ? 100 : 0)]))
  const next = { ...s, bag: s.bag.slice(1), drawn, last: n, scores, next_at: now + s.interval }
  if (!winners.length) return next
  return { ...next, phase: 'over', next_at: null, winners, winner: winners.length === 1 ? winners[0] : null, draw: winners.length > 1 }
}

export const isOver = (s) => s.phase === 'over'

// ხალხური სახელები ზოგიერთ რიცხვს
export const NICK = { 1: 'კოლი', 11: 'ჯოხები', 22: 'იხვები', 69: 'წინ და უკან', 77: 'ცულები', 90: 'ბაბუა' }
