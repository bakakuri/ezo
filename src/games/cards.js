// კარტები: 'As' = ყვავის ტუზი (rank + suit). 'X1', 'X2' = ჯოკერები.
// მასტები: s ყვავი ♠, c ჯვარი ♣, h გული ♥, d აგური ♦
export const SUITS = ['s', 'h', 'c', 'd']
export const SUIT_SYMBOL = { s: '♠', h: '♥', c: '♣', d: '♦' }
export const SUIT_NAME = { s: 'ყვავი', h: 'გული', c: 'ჯვარი', d: 'აგური' }
export const RANKS = '6789TJQKA'
export const RANK_LABEL = { 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }

export const isJoker = (c) => typeof c === 'string' && c[0] === 'X'
export const rankOf = (c) => RANKS.indexOf(c[0]) + 6
export const suitOf = (c) => (isJoker(c) ? null : c[1])
export const isRed = (c) => c[1] === 'h' || c[1] === 'd'

export function deck36() {
  const out = []
  for (const s of SUITS) for (const r of RANKS) out.push(r + s)
  return out
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ხელის დალაგება: მასტებით, შიგნით — სიძლიერით. trump ბოლოში.
export function sortHand(hand, trump = null) {
  const order = (c) => {
    if (isJoker(c)) return 1000
    const s = suitOf(c)
    const so = s === trump ? 4 : SUITS.indexOf(s)
    return so * 20 + rankOf(c)
  }
  return hand.slice().sort((a, b) => order(a) - order(b))
}
