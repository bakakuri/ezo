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
import * as loto from './loto.js'

// თამაშების კატალოგი. seat 'a' = თამაშის შემქმნელი (თეთრები / პირველი ადგილი).
export const GAMES = {
  nardi: {
    type: 'nardi',
    title: 'ნარდი',
    blurb: 'კამათელი, ცემა და მარსი',
    init: () => nardi.initState(),
    seatOf: (state) => (state.turn === 'w' ? 'a' : 'b'),
  },
  chess: {
    type: 'chess',
    title: 'ჭადრაკი',
    blurb: 'სრული წესები, როქით და ან-პასანით',
    init: () => chess.initState(),
    seatOf: (state) => (state.turn === 'w' ? 'a' : 'b'),
  },
  chess960: {
    type: 'chess960',
    title: 'ჭადრაკი 960',
    blurb: 'ფიგურები შემთხვევით რიგში — თეორია აღარ გეხმარება',
    init: (rand = cryptoRand) => chess960.initState(rand),
    seatOf: (state) => (state.turn === 'w' ? 'a' : 'b'),
  },
  gomoku: {
    type: 'gomoku',
    title: 'ხუთი რიგში',
    blurb: '15×15 დაფა — ააწყვე ხუთი ქვა ერთ ხაზზე',
    init: () => gomoku.initState(),
    seatOf: (state) => state.turn,
  },
  checkers: {
    type: 'checkers',
    title: 'შაშკი',
    blurb: 'რუსული წესები, მოჭრა სავალდებულოა',
    init: () => checkers.initState(),
    seatOf: (state) => (state.turn === 'w' ? 'a' : 'b'),
  },
  domino: {
    type: 'domino',
    title: 'დომინო',
    blurb: 'ბაზრით, ორი მოთამაშე',
    init: () => domino.initState(cryptoRand),
    seatOf: (state) => state.turn,
  },
  longnardi: {
    type: 'longnardi',
    title: 'გრძელი ნარდი',
    blurb: 'ცემის გარეშე, ერთი მიმართულებით',
    init: () => longnardi.initState(),
    seatOf: (state) => (state.turn === 'w' ? 'a' : 'b'),
  },
  durak: {
    type: 'durak',
    title: 'დურაკი',
    blurb: 'ჩამატებითი, 36 კარტი',
    hidden: true,
    init: (rand = cryptoRand) => durak.initState(rand),
    seatOf: (state) => state.turn,
  },
  joker: {
    type: 'joker',
    title: 'ჯოკერი',
    blurb: 'ოთხნი მაგიდასთან, ხიშტით',
    hidden: true,
    seats: 4,
    modes: joker.MODES,
    defaultMode: 'quick',
    modeNote: (k) => joker.totalHands(k),
    init: (rand = cryptoRand, opts = {}) => joker.initState(rand, opts.mode),
    seatOf: (state) => state.turn,
  },
  bura: {
    type: 'bura',
    title: 'ბურა',
    blurb: 'სამი კარტი, კოზირი და 61 ქულა',
    hidden: true,
    init: (rand = cryptoRand) => bura.initState(rand),
    seatOf: (state) => state.turn,
  },
  loto: {
    type: 'loto',
    title: 'ლოტო',
    blurb: '90 კასრი — ვის ბილეთი შეივსება პირველი',
    seats: 4,
    modes: loto.MODES,
    defaultMode: 'line',
    modeNote: (k) => loto.MODES[k].sub,
    turnless: true,
    init: (rand = cryptoRand, opts = {}) => loto.initState(rand, opts.mode),
    seatOf: () => null,
  },
}

export const seatsOf = (type) => GAMES[type]?.seats || 2
export const SEAT_LETTERS = ['a', 'b', 'c', 'd']

export const GAME_LIST = ['nardi', 'longnardi', 'joker', 'bura', 'durak', 'loto', 'chess', 'chess960', 'checkers', 'gomoku', 'domino'].map((k) => GAMES[k])

// კრიპტოგრაფიულად სანდო შემთხვევითი რიცხვი [0, 1)
export function cryptoRand() {
  const a = new Uint32Array(1)
  globalThis.crypto.getRandomValues(a)
  return a[0] / 2 ** 32
}

// თამაშის შედეგი: { over, winner: 'a'|'b'|null, result }
export function outcome(type, state) {
  if (!state) return { over: false }
  if (type === 'chess') {
    const st = chess.status(chess.fromFEN(state.fen))
    if (!st.over) return { over: false, check: st.check }
    return { over: true, winner: st.winner ? (st.winner === 'w' ? 'a' : 'b') : null, result: st.result }
  }
  if (type === 'chess960') {
    const st = chess960.status(chess.fromFEN(state.fen))
    if (!st.over) return { over: false, check: st.check }
    return { over: true, winner: st.winner ? (st.winner === 'w' ? 'a' : 'b') : null, result: st.result }
  }
  if (type === 'gomoku') {
    if (!gomoku.isOver(state)) return { over: false }
    return { over: true, winner: state.winner || null, result: state.winner ? 'five' : 'gomokudraw' }
  }
  if (type === 'checkers') {
    const st = checkers.status(state)
    return st.over ? { over: true, winner: st.winner === 'w' ? 'a' : 'b', result: 'nomoves' } : { over: false }
  }
  if (type === 'nardi' || type === 'longnardi') {
    if (state.phase !== 'over') return { over: false }
    return { over: true, winner: state.winner === 'w' ? 'a' : 'b', result: state.score === 2 ? 'mars' : 'win' }
  }
  if (type === 'domino') {
    if (!domino.isOver(state)) return { over: false }
    return { over: true, winner: state.winner || null, result: state.blocked ? 'blocked' : 'domino' }
  }
  if (type === 'durak') {
    if (state.phase !== 'over') return { over: false }
    return { over: true, winner: state.winner || null, result: state.draw ? 'durakdraw' : 'durak' }
  }
  if (type === 'joker') {
    if (state.phase !== 'over') return { over: false }
    return { over: true, winner: state.winner || null, result: state.draw ? 'jokerdraw' : 'joker' }
  }
  if (type === 'bura') {
    if (state.phase !== 'over') return { over: false }
    return { over: true, winner: state.winner || null, result: state.bura ? 'bura' : state.draw ? 'buradraw' : 'burapoints' }
  }
  if (type === 'loto') {
    if (state.phase !== 'over') return { over: false }
    return { over: true, winner: state.winner || null, result: state.draw ? 'lotodraw' : 'loto' }
  }
  return { over: false }
}

export const RESULT_TEXT = {
  checkmate: 'მატი',
  stalemate: 'პატი — ფრე',
  fifty: '50 სვლა ცემის გარეშე — ფრე',
  material: 'მატისთვის ფიგურები აღარ კმარა — ფრე',
  mars: 'მარსი! ორმაგი მოგება',
  win: 'ყველა ქვა გაყვანილია',
  resign: 'მოწინააღმდეგე დანებდა',
  blocked: 'თამაში ჩაიკეტა — ქულებით',
  domino: 'ყველა ქვა დადებულია',
  nomoves: 'სვლა აღარ დარჩა',
  durak: 'მოწინააღმდეგე დურაკად დარჩა',
  durakdraw: 'ორივემ ერთად დაცალა ხელი',
  joker: 'ყველაზე მეტი ქულა',
  jokerdraw: 'ქულები გაუთანაბრდა',
  bura: 'ბურა! სამი კოზირი ხელში',
  burapoints: '61 ქულა ან მეტი ქულა ბოლოს',
  buradraw: 'ქულები გაუთანაბრდა',
  loto: 'ბილეთი შეივსო',
  lotodraw: 'რამდენიმემ ერთდროულად შეავსო',
  timeout: 'დრო ამოიწურა',
  five: 'ხუთი ქვა ერთ ხაზზე',
  gomokudraw: 'დაფა შეივსო — ფრე',
  abort: 'თამაში არ დაწყებულა',
}

export { chess, chess960, gomoku, checkers, nardi, domino, longnardi, durak, joker, bura, loto }
