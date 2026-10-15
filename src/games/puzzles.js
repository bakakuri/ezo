// დღის ჭადრაკის ამოცანები. ამონახსნი — UCI სვლები (მოთამაშე, პასუხი, მოთამაშე…).
// ყველა ამოცანა შემოწმებულია ძრავით (tests/puzzles.test.mjs): მატი ერთადერთი გზით, უფრო მოკლე მატი არ არსებობს.
// ⚠️ იგივე სია უნდა იყოს supabase/schema.sql-ის chess_puzzles ცხრილში (ტესტი ამოწმებს).
export const PUZZLES = [
  { id: 1, title: 'უკანა რიგი', fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', solution: ['d1d8'] },
  { id: 2, title: 'სკოლის მატი', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1', solution: ['f3f7'] },
  { id: 3, title: 'ფილიდორის მემკვიდრეობა', fen: 'r6k/6pp/7N/8/8/1Q6/6PP/6K1 w - - 0 1', solution: ['b3g8', 'a8g8', 'h6f7'] },
  { id: 4, title: 'უსწრაფესი მატი', fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2', solution: ['d8h4'] },
  { id: 5, title: 'არაბული მატი', fen: '7k/R7/5N2/8/8/8/8/6K1 w - - 0 1', solution: ['a7h7'] },
  { id: 6, title: 'ჩახრჩობილი მეფე', fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', solution: ['g5f7'] },
  { id: 7, title: 'შავების ჯერია: უკანა რიგი', fen: '3r2k1/8/8/8/8/8/5PPP/6K1 b - - 0 1', solution: ['d8d1'] },
  { id: 8, title: 'ეპოლეტები', fen: '3rkr2/8/8/8/2Q5/8/8/4K3 w - - 0 1', solution: ['c4e6'] },
  { id: 9, title: 'დერეფანი', fen: '6k1/5ppp/8/8/8/8/8/K3Q3 w - - 0 1', solution: ['e1e8'] },
  { id: 10, title: 'ფილიდორი შავებით', fen: '6k1/6pp/1q6/8/8/7n/6PP/R6K b - - 0 1', solution: ['b6g1', 'a1g1', 'h3f2'] },
  { id: 11, title: 'მეფე და ეტლი', fen: 'k7/8/1K6/8/8/8/8/7R w - - 0 1', solution: ['h1h8'] },
  { id: 12, title: 'ცხენის ხაფანგი', fen: '6k1/8/8/8/8/3n4/6PP/6RK b - - 0 1', solution: ['d3f2'] },
  { id: 13, title: 'ოპოზიცია', fen: '4k3/8/4K3/8/8/8/8/R7 w - - 0 1', solution: ['a1a8'] },
  { id: 14, title: 'სკოლის მატი, მეორე ვარიანტი', fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1', solution: ['f3f7'] },
]

// თბილისის დღე → ამოცანა (2026-01-01-დან რიგრიგობით)
export const EPOCH = Date.UTC(2026, 0, 1)
export const tbilisiDate = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Tbilisi' })
export const dayIndex = (date) => Math.round((Date.parse(`${date}T00:00:00Z`) - EPOCH) / 864e5)
export const puzzleFor = (date) => PUZZLES[((dayIndex(date) % PUZZLES.length) + PUZZLES.length) % PUZZLES.length]
export const sideToMove = (fen) => fen.split(' ')[1]
export const playerMoves = (p) => Math.ceil(p.solution.length / 2)
