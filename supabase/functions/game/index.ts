// ავტომატურად აწყობილი ფაილი — წყარო: supabase/functions-src/game.ts (npm run build:functions)
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// supabase/functions-src/game.ts
import { createClient } from "npm:@supabase/supabase-js@2";

// src/games/chess.js
var chess_exports = {};
__export(chess_exports, {
  START_FEN: () => START_FEN,
  applyToState: () => applyToState,
  colorOf: () => colorOf,
  fromFEN: () => fromFEN,
  inCheck: () => inCheck,
  initState: () => initState,
  isAttacked: () => isAttacked,
  legalMoves: () => legalMoves,
  makeMove: () => makeMove,
  perft: () => perft,
  sqIndex: () => sqIndex,
  sqName: () => sqName,
  status: () => status,
  toFEN: () => toFEN
});
var START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
var FILES = "abcdefgh";
var sqName = (i) => FILES[i % 8] + (8 - Math.floor(i / 8));
var sqIndex = (n) => (8 - Number(n[1])) * 8 + FILES.indexOf(n[0]);
var colorOf = (p) => p ? p === p.toUpperCase() ? "w" : "b" : null;
var KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
var KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
var DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
var ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
var inside = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8;
function fromFEN(fen) {
  const [placement, turn = "w", castling = "-", ep = "-", half = "0", full = "1"] = fen.trim().split(/\s+/);
  const board = Array(64).fill(null);
  let r = 0;
  let f = 0;
  for (const ch of placement) {
    if (ch === "/") {
      r++;
      f = 0;
      continue;
    }
    if (/\d/.test(ch)) {
      f += Number(ch);
      continue;
    }
    board[r * 8 + f] = ch;
    f++;
  }
  return {
    board,
    turn,
    castling: castling === "-" ? "" : castling,
    ep: ep === "-" ? null : sqIndex(ep),
    half: Number(half) || 0,
    full: Number(full) || 1
  };
}
function toFEN(s) {
  let out = "";
  for (let r = 0; r < 8; r++) {
    let empty2 = 0;
    for (let f = 0; f < 8; f++) {
      const p = s.board[r * 8 + f];
      if (!p) {
        empty2++;
        continue;
      }
      if (empty2) {
        out += empty2;
        empty2 = 0;
      }
      out += p;
    }
    if (empty2) out += empty2;
    if (r < 7) out += "/";
  }
  return `${out} ${s.turn} ${s.castling || "-"} ${s.ep == null ? "-" : sqName(s.ep)} ${s.half} ${s.full}`;
}
function isAttacked(board, sq, by) {
  const r = sq >> 3;
  const f = sq & 7;
  const pr = by === "w" ? r + 1 : r - 1;
  const pawn = by === "w" ? "P" : "p";
  for (const df of [-1, 1]) {
    if (inside(pr, f + df) && board[pr * 8 + f + df] === pawn) return true;
  }
  const kn = by === "w" ? "N" : "n";
  for (const [dr, df] of KN) if (inside(r + dr, f + df) && board[(r + dr) * 8 + f + df] === kn) return true;
  const kg = by === "w" ? "K" : "k";
  for (const [dr, df] of KG) if (inside(r + dr, f + df) && board[(r + dr) * 8 + f + df] === kg) return true;
  const [B, R, Q] = by === "w" ? ["B", "R", "Q"] : ["b", "r", "q"];
  for (const [dirs, a] of [[DIAG, B], [ORTH, R]]) {
    for (const [dr, df] of dirs) {
      let rr = r + dr;
      let ff = f + df;
      while (inside(rr, ff)) {
        const p = board[rr * 8 + ff];
        if (p) {
          if (p === a || p === Q) return true;
          break;
        }
        rr += dr;
        ff += df;
      }
    }
  }
  return false;
}
var kingSq = (board, color) => board.indexOf(color === "w" ? "K" : "k");
var inCheck = (s, color = s.turn) => isAttacked(s.board, kingSq(s.board, color), color === "w" ? "b" : "w");
function pseudoMoves(s) {
  const { board, turn } = s;
  const enemy = turn === "w" ? "b" : "w";
  const moves = [];
  const up = turn === "w" ? -1 : 1;
  const startRow = turn === "w" ? 6 : 1;
  const promoRow = turn === "w" ? 0 : 7;
  const push = (from, to, flag) => {
    if (board[from].toLowerCase() === "p" && to >> 3 === promoRow) {
      for (const promo of ["q", "r", "b", "n"]) moves.push({ from, to, promo, flag });
    } else moves.push({ from, to, flag });
  };
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (!p || colorOf(p) !== turn) continue;
    const r = sq >> 3;
    const f = sq & 7;
    const t = p.toLowerCase();
    if (t === "p") {
      const r1 = r + up;
      if (inside(r1, f) && !board[r1 * 8 + f]) {
        push(sq, r1 * 8 + f);
        const r2 = r + 2 * up;
        if (r === startRow && !board[r2 * 8 + f]) moves.push({ from: sq, to: r2 * 8 + f, flag: "double" });
      }
      for (const df of [-1, 1]) {
        if (!inside(r1, f + df)) continue;
        const to = r1 * 8 + f + df;
        if (board[to] && colorOf(board[to]) === enemy) push(sq, to, "capture");
        else if (to === s.ep) moves.push({ from: sq, to, flag: "ep" });
      }
    } else if (t === "n" || t === "k") {
      for (const [dr, df] of t === "n" ? KN : KG) {
        if (!inside(r + dr, f + df)) continue;
        const to = (r + dr) * 8 + f + df;
        if (!board[to] || colorOf(board[to]) === enemy) moves.push({ from: sq, to });
      }
      if (t === "k") {
        const home = turn === "w" ? 60 : 4;
        const [kSide, qSide] = turn === "w" ? ["K", "Q"] : ["k", "q"];
        if (sq === home && !isAttacked(board, home, enemy)) {
          if (s.castling.includes(kSide) && !board[home + 1] && !board[home + 2] && !isAttacked(board, home + 1, enemy) && !isAttacked(board, home + 2, enemy)) {
            moves.push({ from: sq, to: home + 2, flag: "castle" });
          }
          if (s.castling.includes(qSide) && !board[home - 1] && !board[home - 2] && !board[home - 3] && !isAttacked(board, home - 1, enemy) && !isAttacked(board, home - 2, enemy)) {
            moves.push({ from: sq, to: home - 2, flag: "castle" });
          }
        }
      }
    } else {
      const dirs = t === "b" ? DIAG : t === "r" ? ORTH : [...DIAG, ...ORTH];
      for (const [dr, df] of dirs) {
        let rr = r + dr;
        let ff = f + df;
        while (inside(rr, ff)) {
          const to = rr * 8 + ff;
          if (board[to]) {
            if (colorOf(board[to]) === enemy) moves.push({ from: sq, to });
            break;
          }
          moves.push({ from: sq, to });
          rr += dr;
          ff += df;
        }
      }
    }
  }
  return moves;
}
var ROOK_HOME = { 56: "Q", 63: "K", 0: "q", 7: "k" };
function makeMove(s, m) {
  const board = s.board.slice();
  const piece = board[m.from];
  const captured = board[m.to];
  board[m.to] = piece;
  board[m.from] = null;
  if (m.flag === "ep") board[(m.from >> 3) * 8 + (m.to & 7)] = null;
  if (m.promo) board[m.to] = s.turn === "w" ? m.promo.toUpperCase() : m.promo.toLowerCase();
  if (m.flag === "castle") {
    const kingSide = m.to > m.from;
    const rookFrom = kingSide ? m.from + 3 : m.from - 4;
    const rookTo = kingSide ? m.from + 1 : m.from - 1;
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }
  let castling = s.castling;
  if (piece === "K") castling = castling.replace(/[KQ]/g, "");
  if (piece === "k") castling = castling.replace(/[kq]/g, "");
  for (const sq of [m.from, m.to]) if (ROOK_HOME[sq]) castling = castling.replace(ROOK_HOME[sq], "");
  const isPawn = piece.toLowerCase() === "p";
  return {
    board,
    turn: s.turn === "w" ? "b" : "w",
    castling,
    ep: m.flag === "double" ? (m.from + m.to) / 2 : null,
    half: isPawn || captured || m.flag === "ep" ? 0 : s.half + 1,
    full: s.turn === "b" ? s.full + 1 : s.full
  };
}
function legalMoves(s) {
  return pseudoMoves(s).filter((m) => !inCheck(makeMove(s, m), s.turn));
}
function insufficient(board) {
  const rest = board.filter((p) => p && p.toLowerCase() !== "k");
  if (rest.length === 0) return true;
  return rest.length === 1 && ["n", "b"].includes(rest[0].toLowerCase());
}
function status(s) {
  const check = inCheck(s);
  const moves = legalMoves(s);
  if (moves.length === 0) {
    return check ? { over: true, result: "checkmate", winner: s.turn === "w" ? "b" : "w", check } : { over: true, result: "stalemate", winner: null, check };
  }
  if (s.half >= 100) return { over: true, result: "fifty", winner: null, check };
  if (insufficient(s.board)) return { over: true, result: "material", winner: null, check };
  return { over: false, result: null, winner: null, check };
}
function perft(s, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of legalMoves(s)) n += perft(makeMove(s, m), depth - 1);
  return n;
}
function initState() {
  return { fen: START_FEN, turn: "w", last: null, count: 0 };
}
function applyToState(state, move) {
  const next = makeMove(fromFEN(state.fen), move);
  return { fen: toFEN(next), turn: next.turn, last: [move.from, move.to], count: state.count + 1 };
}

// src/games/chess960.js
var FILES2 = "abcdefgh";
var KNIGHTS = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]];
function backRank(n) {
  const pos2 = Array(8).fill(null);
  let k = n;
  pos2[k % 4 * 2 + 1] = "B";
  k = Math.floor(k / 4);
  pos2[k % 4 * 2] = "B";
  k = Math.floor(k / 4);
  const free = () => pos2.map((p, i) => p ? -1 : i).filter((i) => i >= 0);
  pos2[free()[k % 6]] = "Q";
  k = Math.floor(k / 6);
  const [n1, n2] = KNIGHTS[k];
  const f = free();
  pos2[f[n1]] = "N";
  pos2[f[n2]] = "N";
  const [r1, kk, r2] = free();
  pos2[r1] = "R";
  pos2[kk] = "K";
  pos2[r2] = "R";
  return pos2.join("");
}
function startFEN(n) {
  const w = backRank(n);
  const rooks = [...w].map((p, i) => p === "R" ? FILES2[i] : "").join("");
  const castle = rooks.split("").reverse().join("").toUpperCase() + rooks.split("").reverse().join("");
  return `${w.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${w} w ${castle} - 0 1`;
}
function initState2(rand = Math.random) {
  const n = Math.floor(rand() * 960) % 960;
  return { fen: startFEN(n), turn: "w", last: null, count: 0, n };
}
var backRow = (color) => color === "w" ? 7 : 0;
var rightsOf = (castling, color) => [...castling || ""].filter((c) => color === "w" ? c === c.toUpperCase() : c === c.toLowerCase());
function castleMoves(s) {
  const color = s.turn;
  const enemy = color === "w" ? "b" : "w";
  const row = backRow(color);
  const K = color === "w" ? "K" : "k";
  const R = color === "w" ? "R" : "r";
  const kSq = s.board.indexOf(K);
  if (kSq < 0 || kSq >> 3 !== row || inCheck(s, color)) return [];
  const kf = kSq & 7;
  const out = [];
  for (const letter of rightsOf(s.castling, color)) {
    const rf = FILES2.indexOf(letter.toLowerCase());
    const rSq = row * 8 + rf;
    if (s.board[rSq] !== R) continue;
    const kingSide = rf > kf;
    const kt = kingSide ? 6 : 2;
    const rt = kingSide ? 5 : 3;
    const lo = Math.min(kf, kt, rf, rt);
    const hi = Math.max(kf, kt, rf, rt);
    let clear = true;
    for (let f = lo; f <= hi; f++) {
      const sq = row * 8 + f;
      if (sq !== kSq && sq !== rSq && s.board[sq]) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    const board = s.board.slice();
    board[kSq] = null;
    board[rSq] = null;
    let safe = true;
    for (let f = Math.min(kf, kt); f <= Math.max(kf, kt); f++) {
      if (isAttacked(board, row * 8 + f, enemy)) {
        safe = false;
        break;
      }
    }
    if (!safe) continue;
    board[row * 8 + kt] = K;
    board[row * 8 + rt] = R;
    if (isAttacked(board, row * 8 + kt, enemy)) continue;
    out.push({ from: kSq, to: rSq, flag: "castle960", rook: rSq, kingTo: row * 8 + kt, rookTo: row * 8 + rt });
  }
  return out;
}
function legalMoves2(s) {
  const normal = legalMoves(s);
  const castles = castleMoves(s);
  const aliases = castles.filter((c) => c.kingTo !== c.from && c.kingTo !== c.rook && !normal.some((m) => m.from === c.from && m.to === c.kingTo)).map((c) => ({ ...c, to: c.kingTo }));
  return [...normal, ...castles, ...aliases];
}
function makeMove2(s, m) {
  const color = s.turn;
  const enemy = color === "w" ? "b" : "w";
  let next;
  if (m.flag === "castle960") {
    const board = s.board.slice();
    const K = board[m.from];
    const R = board[m.rook];
    board[m.from] = null;
    board[m.rook] = null;
    board[m.kingTo] = K;
    board[m.rookTo] = R;
    next = { board, turn: enemy, castling: s.castling, ep: null, half: s.half + 1, full: color === "b" ? s.full + 1 : s.full };
  } else {
    next = makeMove(s, m);
  }
  let castling = s.castling || "";
  const piece = s.board[m.from];
  if (piece && piece.toLowerCase() === "k") castling = [...castling].filter((c) => !rightsOf(castling, color).includes(c)).join("");
  for (const sq of [m.from, m.to]) {
    const row = sq >> 3;
    for (const c of ["w", "b"]) {
      if (row !== backRow(c)) continue;
      const letter = c === "w" ? FILES2[sq & 7].toUpperCase() : FILES2[sq & 7];
      if (castling.includes(letter) && s.board[sq] && s.board[sq].toLowerCase() === "r" && colorOf(s.board[sq]) === c) castling = castling.replace(letter, "");
    }
  }
  return { ...next, castling };
}
function insufficient2(board) {
  const rest = board.filter((p) => p && p.toLowerCase() !== "k");
  if (rest.length === 0) return true;
  return rest.length === 1 && ["n", "b"].includes(rest[0].toLowerCase());
}
function status2(s) {
  const check = inCheck(s);
  const moves = legalMoves2(s);
  if (!moves.length) {
    return check ? { over: true, result: "checkmate", winner: s.turn === "w" ? "b" : "w", check } : { over: true, result: "stalemate", winner: null, check };
  }
  if (s.half >= 100) return { over: true, result: "fifty", winner: null, check };
  if (insufficient2(s.board)) return { over: true, result: "material", winner: null, check };
  return { over: false, result: null, winner: null, check };
}
function applyToState2(state, move) {
  const next = makeMove2(fromFEN(state.fen), move);
  const shown = move.flag === "castle960" ? [move.from, move.kingTo] : [move.from, move.to];
  return { ...state, fen: toFEN(next), turn: next.turn, last: shown, count: state.count + 1 };
}

// src/games/gomoku.js
var N = 15;
var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
var other = (s) => s === "a" ? "b" : "a";
function initState3() {
  return { board: ".".repeat(N * N), turn: "a", last: null, count: 0, line: null, winner: null };
}
var at = (board, r, c) => r >= 0 && r < N && c >= 0 && c < N ? board[r * N + c] : null;
function lineThrough(board, i) {
  const p = board[i];
  const r0 = Math.floor(i / N);
  const c0 = i % N;
  for (const [dr, dc] of DIRS) {
    const cells = [i];
    for (const sgn of [1, -1]) {
      let r = r0 + dr * sgn;
      let c = c0 + dc * sgn;
      while (at(board, r, c) === p) {
        cells.push(r * N + c);
        r += dr * sgn;
        c += dc * sgn;
      }
    }
    if (cells.length >= 5) return cells.sort((a, b) => a - b);
  }
  return null;
}
var isOver = (state) => Boolean(state.winner) || state.draw === true;
function play(state, i) {
  if (isOver(state)) throw new Error("\u10D7\u10D0\u10DB\u10D0\u10E8\u10D8 \u10D3\u10D0\u10E1\u10E0\u10E3\u10DA\u10D4\u10D1\u10E3\u10DA\u10D8\u10D0");
  if (!Number.isInteger(i) || i < 0 || i >= N * N || state.board[i] !== ".") throw new Error("\u10D4\u10E1 \u10E3\u10EF\u10E0\u10D0 \u10D3\u10D0\u10D9\u10D0\u10D5\u10D4\u10D1\u10E3\u10DA\u10D8\u10D0");
  const board = state.board.slice(0, i) + state.turn + state.board.slice(i + 1);
  const line = lineThrough(board, i);
  const full = !board.includes(".");
  return {
    board,
    turn: line || full ? state.turn : other(state.turn),
    last: i,
    count: state.count + 1,
    line,
    winner: line ? state.turn : null,
    draw: !line && full
  };
}
var SCORE = { five: 1e7, open4: 2e5, four: 2e4, open3: 8e3, three: 600, open2: 300, two: 40, one: 6 };
function patternScore(board, i, p) {
  const r0 = Math.floor(i / N);
  const c0 = i % N;
  let total = 0;
  for (const [dr, dc] of DIRS) {
    let count3 = 1;
    let open = 0;
    for (const sgn of [1, -1]) {
      let r = r0 + dr * sgn;
      let c = c0 + dc * sgn;
      while (at(board, r, c) === p) {
        count3++;
        r += dr * sgn;
        c += dc * sgn;
      }
      if (at(board, r, c) === ".") open++;
    }
    if (count3 >= 5) total += SCORE.five;
    else if (count3 === 4) total += open === 2 ? SCORE.open4 : open === 1 ? SCORE.four : 0;
    else if (count3 === 3) total += open === 2 ? SCORE.open3 : open === 1 ? SCORE.three : 0;
    else if (count3 === 2) total += open === 2 ? SCORE.open2 : open === 1 ? SCORE.two : 0;
    else if (open) total += SCORE.one * open;
  }
  return total;
}
function candidates(board, radius = 2) {
  const out = [];
  if (!board.includes("a") && !board.includes("b")) return [Math.floor(N * N / 2)];
  for (let i = 0; i < N * N; i++) {
    if (board[i] !== ".") continue;
    const r = Math.floor(i / N);
    const c = i % N;
    let near = false;
    for (let dr = -radius; dr <= radius && !near; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const v = at(board, r + dr, c + dc);
        if (v && v !== ".") {
          near = true;
          break;
        }
      }
    }
    if (near) out.push(i);
  }
  return out;
}
function bestMove(state, rand = Math.random) {
  const me = state.turn;
  const foe = other(me);
  let best = -1;
  let bestScore = -Infinity;
  for (const i of candidates(state.board)) {
    const mine = patternScore(state.board, i, me);
    const theirs = patternScore(state.board, i, foe);
    const score = (mine >= SCORE.five ? 1e9 : 0) + (theirs >= SCORE.five ? 5e8 : 0) + mine * 1.1 + theirs + rand() * 3;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

// src/games/checkers.js
var DIRS2 = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
var inside2 = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8;
var isDark = (sq) => ((sq >> 3) + (sq & 7)) % 2 === 1;
var colorOf2 = (p) => p ? p.toLowerCase() : null;
var isKing = (p) => p === "W" || p === "B";
function initState4() {
  const board = Array(64).fill(null);
  for (let sq = 0; sq < 64; sq++) {
    if (!isDark(sq)) continue;
    const r = sq >> 3;
    if (r < 3) board[sq] = "b";
    else if (r > 4) board[sq] = "w";
  }
  return { board, turn: "w", last: null, count: 0 };
}
function captureChains(board, origin, color, king, from, taken, path) {
  const r = from >> 3;
  const f = from & 7;
  const empty2 = (sq) => sq === origin || !board[sq];
  const promoRow = color === "w" ? 0 : 7;
  const results = [];
  for (const [dr, df] of DIRS2) {
    if (!king) {
      const mr = r + dr;
      const mf = f + df;
      const lr = r + 2 * dr;
      const lf = f + 2 * df;
      if (!inside2(lr, lf)) continue;
      const mid = mr * 8 + mf;
      const land = lr * 8 + lf;
      const mp = board[mid];
      if (!mp || mp === null || colorOf2(mp) === color || taken.includes(mid) || mid === origin) continue;
      if (!empty2(land)) continue;
      const nowKing = lr === promoRow;
      const nextTaken = [...taken, mid];
      const nextPath = [...path, land];
      const more = captureChains(board, origin, color, nowKing, land, nextTaken, nextPath);
      if (more.length) results.push(...more);
      else results.push({ path: nextPath, caps: nextTaken, promote: nowKing });
    } else {
      let rr = r + dr;
      let ff = f + df;
      while (inside2(rr, ff) && empty2(rr * 8 + ff)) {
        rr += dr;
        ff += df;
      }
      if (!inside2(rr, ff)) continue;
      const mid = rr * 8 + ff;
      const mp = board[mid];
      if (colorOf2(mp) === color || taken.includes(mid)) continue;
      const landings = [];
      let lr = rr + dr;
      let lf = ff + df;
      while (inside2(lr, lf) && empty2(lr * 8 + lf)) {
        landings.push(lr * 8 + lf);
        lr += dr;
        lf += df;
      }
      if (!landings.length) continue;
      const nextTaken = [...taken, mid];
      const withMore = [];
      const ends2 = [];
      for (const land of landings) {
        const more = captureChains(board, origin, color, true, land, nextTaken, [...path, land]);
        if (more.length) withMore.push(...more);
        else ends2.push({ path: [...path, land], caps: nextTaken, promote: false });
      }
      results.push(...withMore.length ? withMore : ends2);
    }
  }
  return results;
}
function legalMoves3(state, color = state.turn) {
  const { board } = state;
  const captures = [];
  const quiet = [];
  const forward = color === "w" ? -1 : 1;
  const promoRow = color === "w" ? 0 : 7;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (!p || colorOf2(p) !== color) continue;
    const king = isKing(p);
    for (const c of captureChains(board, sq, color, king, sq, [], [sq])) {
      captures.push({ ...c, promote: !king && (c.promote || c.path.some((x) => x >> 3 === promoRow)) });
    }
    if (captures.length) continue;
    const r = sq >> 3;
    const f = sq & 7;
    for (const [dr, df] of DIRS2) {
      if (!king && dr !== forward) continue;
      let rr = r + dr;
      let ff = f + df;
      while (inside2(rr, ff) && !board[rr * 8 + ff]) {
        quiet.push({ path: [sq, rr * 8 + ff], caps: [], promote: !king && rr === promoRow });
        if (!king) break;
        rr += dr;
        ff += df;
      }
    }
  }
  return captures.length ? captures : quiet;
}
function applyMove(state, move) {
  const board = state.board.slice();
  const from = move.path[0];
  const to = move.path[move.path.length - 1];
  let piece = board[from];
  board[from] = null;
  for (const c of move.caps) board[c] = null;
  if (move.promote) piece = piece.toUpperCase();
  board[to] = piece;
  return { board, turn: state.turn === "w" ? "b" : "w", last: move.path, count: state.count + 1 };
}
function status3(state) {
  const moves = legalMoves3(state);
  if (moves.length === 0) return { over: true, winner: state.turn === "w" ? "b" : "w" };
  return { over: false, winner: null };
}

// src/games/nardi.js
var other2 = (c) => c === "w" ? "b" : "w";
var sign = (c) => c === "w" ? 1 : -1;
var own = (v, c) => v * sign(c) > 0;
var count = (v, c) => own(v, c) ? Math.abs(v) : 0;
function initState5() {
  const points = Array(24).fill(0);
  points[23] = 2;
  points[12] = 5;
  points[7] = 3;
  points[5] = 5;
  points[0] = -2;
  points[11] = -5;
  points[16] = -3;
  points[18] = -5;
  return {
    points,
    bar: { w: 0, b: 0 },
    off: { w: 0, b: 0 },
    turn: "w",
    phase: "roll",
    dice: [],
    rolled: null,
    last: [],
    winner: null,
    score: 0
  };
}
function rollDice(rand = Math.random) {
  return [1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6)];
}
var allHome = (s, c) => {
  if (s.bar[c]) return false;
  for (let i = 0; i < 24; i++) {
    const home = c === "w" ? i <= 5 : i >= 18;
    if (!home && count(s.points[i], c)) return false;
  }
  return true;
};
function singleMoves(s, die) {
  const c = s.turn;
  const moves = [];
  const open = (i) => !(s.points[i] * sign(c) <= -2);
  if (s.bar[c]) {
    const to = c === "w" ? 24 - die : die - 1;
    if (open(to)) moves.push({ from: "bar", to, die });
    return moves;
  }
  const canBearOff = allHome(s, c);
  for (let i = 0; i < 24; i++) {
    if (!count(s.points[i], c)) continue;
    const to = c === "w" ? i - die : i + die;
    if (to >= 0 && to <= 23) {
      if (open(to)) moves.push({ from: i, to, die });
    } else if (canBearOff) {
      const exact = c === "w" ? to === -1 : to === 24;
      if (exact) moves.push({ from: i, to: "off", die });
      else {
        let farther = false;
        if (c === "w") {
          for (let j = i + 1; j <= 5; j++) if (count(s.points[j], c)) farther = true;
        } else {
          for (let j = 18; j < i; j++) if (count(s.points[j], c)) farther = true;
        }
        if (!farther) moves.push({ from: i, to: "off", die });
      }
    }
  }
  return moves;
}
function applySingle(s, m) {
  const c = s.turn;
  const points = s.points.slice();
  const bar = { ...s.bar };
  const off = { ...s.off };
  if (m.from === "bar") bar[c]--;
  else points[m.from] -= sign(c);
  let hit = false;
  if (m.to === "off") off[c]++;
  else {
    if (points[m.to] * sign(c) === -1) {
      points[m.to] = 0;
      bar[other2(c)]++;
      hit = true;
    }
    points[m.to] += sign(c);
  }
  const dice = s.dice.slice();
  dice.splice(dice.indexOf(m.die), 1);
  return { ...s, points, bar, off, dice, last: [...s.last, { ...m, hit }] };
}
var keyOf = (s) => `${s.points.join(",")}|${s.bar.w},${s.bar.b}|${s.off.w},${s.off.b}|${[...s.dice].sort().join("")}`;
function maxDepth(s, memo) {
  if (!s.dice.length || s.off[s.turn] === 15) return 0;
  const k = keyOf(s);
  if (memo.has(k)) return memo.get(k);
  let best = 0;
  for (const die of new Set(s.dice)) {
    for (const m of singleMoves(s, die)) {
      best = Math.max(best, 1 + maxDepth(applySingle(s, m), memo));
      if (best === s.dice.length) break;
    }
    if (best === s.dice.length) break;
  }
  memo.set(k, best);
  return best;
}
function legalMoves4(s) {
  if (s.phase !== "move" || !s.dice.length) return [];
  const memo = /* @__PURE__ */ new Map();
  const md = maxDepth(s, memo);
  if (md === 0) return [];
  let cands = [];
  for (const die of new Set(s.dice)) {
    for (const m of singleMoves(s, die)) {
      if (1 + maxDepth(applySingle(s, m), memo) === md) cands.push(m);
    }
  }
  const [a, b] = s.dice;
  if (s.dice.length === 2 && a !== b && md === 1) {
    const hi = Math.max(a, b);
    if (cands.some((m) => m.die === hi)) cands = cands.filter((m) => m.die === hi);
  }
  return cands;
}
function endTurn(s) {
  return { ...s, turn: other2(s.turn), phase: "roll", dice: [] };
}
function applyRoll(s, roll) {
  const [a, b] = roll;
  const dice = a === b ? [a, a, a, a] : [a, b];
  const next = { ...s, phase: "move", dice, rolled: [a, b], last: [], noMoves: false };
  if (!legalMoves4(next).length) return { ...endTurn(next), rolled: [a, b], noMoves: true, passedBy: s.turn };
  return next;
}
function applyMove2(s, m) {
  let next = applySingle(s, m);
  if (next.off[s.turn] === 15) {
    const loser = other2(s.turn);
    return { ...next, phase: "over", dice: [], winner: s.turn, score: next.off[loser] === 0 ? 2 : 1 };
  }
  if (!next.dice.length || !legalMoves4(next).length) next = endTurn(next);
  return next;
}
function findMove(s, from, to) {
  return legalMoves4(s).filter((m) => m.from === from && m.to === to).sort((x, y) => x.die - y.die)[0];
}

// src/games/domino.js
var otherSeat = (s) => s === "a" ? "b" : "a";
var pips = (hand) => hand.reduce((n, [x, y]) => n + x + y, 0);
function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function fullSet() {
  const tiles = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) tiles.push([a, b]);
  return tiles;
}
function initState6(rand = Math.random) {
  const tiles = shuffle(fullSet(), rand);
  const hands = { a: tiles.slice(0, 7), b: tiles.slice(7, 14) };
  const boneyard = tiles.slice(14);
  const best = (h) => {
    const doubles = h.filter(([x, y]) => x === y).map(([x]) => 100 + x);
    return Math.max(...doubles, ...h.map(([x, y]) => x + y));
  };
  const turn = best(hands.a) >= best(hands.b) ? "a" : "b";
  return { hands, boneyard, chain: [], turn, passes: 0, winner: null, draw: false, last: null, count: 0 };
}
var ends = (s) => s.chain.length ? [s.chain[0][0], s.chain[s.chain.length - 1][1]] : null;
function playable(s, seat = s.turn) {
  const e = ends(s);
  const out = [];
  s.hands[seat].forEach(([x, y], i) => {
    if (!e) {
      out.push({ i, side: "R" });
      return;
    }
    if (x === e[0] || y === e[0]) out.push({ i, side: "L" });
    if (x === e[1] || y === e[1]) out.push({ i, side: "R" });
  });
  return out;
}
function finish(s) {
  const seat = s.turn;
  if (!s.hands[seat].length) {
    return { ...s, winner: seat, score: pips(s.hands[otherSeat(seat)]) };
  }
  return { ...s, turn: otherSeat(seat) };
}
function play2(s, i, side) {
  const seat = s.turn;
  const hand = s.hands[seat].slice();
  const [tile] = hand.splice(i, 1);
  const [x, y] = tile;
  const chain = s.chain.slice();
  const e = ends(s);
  if (!e) chain.push([x, y]);
  else if (side === "L") {
    if (y === e[0]) chain.unshift([x, y]);
    else if (x === e[0]) chain.unshift([y, x]);
    else throw new Error("\u10E5\u10D5\u10D0 \u10D0\u10E0 \u10D4\u10E0\u10D2\u10D4\u10D1\u10D0");
  } else {
    if (x === e[1]) chain.push([x, y]);
    else if (y === e[1]) chain.push([y, x]);
    else throw new Error("\u10E5\u10D5\u10D0 \u10D0\u10E0 \u10D4\u10E0\u10D2\u10D4\u10D1\u10D0");
  }
  return finish({
    ...s,
    hands: { ...s.hands, [seat]: hand },
    chain,
    passes: 0,
    last: { seat, tile, side },
    count: s.count + 1
  });
}
function drawTile(s) {
  if (!s.boneyard.length) throw new Error("\u10D1\u10D0\u10D6\u10D0\u10E0\u10D8 \u10EA\u10D0\u10E0\u10D8\u10D4\u10DA\u10D8\u10D0");
  const seat = s.turn;
  const [t, ...rest] = s.boneyard;
  return { ...s, hands: { ...s.hands, [seat]: [...s.hands[seat], t] }, boneyard: rest, last: { seat, drew: true } };
}
function pass(s) {
  const passes = s.passes + 1;
  if (passes >= 2) {
    const a = pips(s.hands.a);
    const b = pips(s.hands.b);
    if (a === b) return { ...s, passes, draw: true, winner: null, blocked: true };
    const winner = a < b ? "a" : "b";
    return { ...s, passes, winner, blocked: true, score: pips(s.hands[otherSeat(winner)]) };
  }
  return { ...s, passes, turn: otherSeat(s.turn), last: { seat: s.turn, passed: true } };
}
var canDraw = (s) => !playable(s).length && s.boneyard.length > 0;
var mustPass = (s) => !playable(s).length && s.boneyard.length === 0;
var isOver2 = (s) => Boolean(s.winner || s.draw);

// src/games/longnardi.js
var other3 = (c) => c === "w" ? "b" : "w";
var sign2 = (c) => c === "w" ? 1 : -1;
var count2 = (v, c) => v * sign2(c) > 0 ? Math.abs(v) : 0;
var idx = (c, p) => c === "w" ? 23 - p : (35 - p) % 24;
var pos = (c, i) => c === "w" ? 23 - i : (35 - i) % 24;
var HEAD = { w: 23, b: 11 };
function initState7() {
  const points = Array(24).fill(0);
  points[HEAD.w] = 15;
  points[HEAD.b] = -15;
  return {
    variant: "long",
    points,
    bar: null,
    off: { w: 0, b: 0 },
    turn: "w",
    phase: "roll",
    dice: [],
    rolled: null,
    last: [],
    headTaken: 0,
    headLimit: 1,
    turns: { w: 0, b: 0 },
    winner: null,
    score: 0
  };
}
function rollDice2(rand = Math.random) {
  return [1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6)];
}
function allHome2(s, c) {
  for (let i = 0; i < 24; i++) if (count2(s.points[i], c) && pos(c, i) < 18) return false;
  return true;
}
function illegalPrime(points, c) {
  const o = other3(c);
  let run = 0;
  let farthestOpp = -1;
  for (let q = 0; q < 24; q++) if (count2(points[idx(o, q)], o)) farthestOpp = q;
  for (let q = 0; q < 24; q++) {
    run = count2(points[idx(o, q)], c) ? run + 1 : 0;
    if (run >= 6 && farthestOpp <= q) return true;
  }
  return false;
}
function singleMoves2(s, die) {
  const c = s.turn;
  const moves = [];
  const canBearOff = allHome2(s, c);
  for (let i = 0; i < 24; i++) {
    if (!count2(s.points[i], c)) continue;
    const p = pos(c, i);
    if (p === 0 && s.headTaken >= s.headLimit) continue;
    const tp = p + die;
    if (tp <= 23) {
      const to = idx(c, tp);
      if (!count2(s.points[to], other3(c))) moves.push({ from: i, to, die });
    } else if (canBearOff) {
      let farther = false;
      if (tp > 24) {
        for (let q = 18; q < p; q++) if (count2(s.points[idx(c, q)], c)) {
          farther = true;
          break;
        }
      }
      if (!farther) moves.push({ from: i, to: "off", die });
    }
  }
  return moves.filter((m) => !illegalPrime(applySingle2(s, m).points, c));
}
function applySingle2(s, m) {
  const c = s.turn;
  const points = s.points.slice();
  const off = { ...s.off };
  points[m.from] -= sign2(c);
  if (m.to === "off") off[c]++;
  else points[m.to] += sign2(c);
  const dice = s.dice.slice();
  dice.splice(dice.indexOf(m.die), 1);
  const headTaken = s.headTaken + (m.from === HEAD[c] ? 1 : 0);
  return { ...s, points, off, dice, headTaken, last: [...s.last, { ...m }] };
}
var keyOf2 = (s) => `${s.points.join(",")}|${s.off.w},${s.off.b}|${s.headTaken}|${[...s.dice].sort().join("")}`;
function maxDepth2(s, memo) {
  if (!s.dice.length || s.off[s.turn] === 15) return 0;
  const k = keyOf2(s);
  if (memo.has(k)) return memo.get(k);
  let best = 0;
  for (const die of new Set(s.dice)) {
    for (const m of singleMoves2(s, die)) {
      best = Math.max(best, 1 + maxDepth2(applySingle2(s, m), memo));
      if (best === s.dice.length) break;
    }
    if (best === s.dice.length) break;
  }
  memo.set(k, best);
  return best;
}
function legalMoves5(s) {
  if (s.phase !== "move" || !s.dice.length) return [];
  const memo = /* @__PURE__ */ new Map();
  const md = maxDepth2(s, memo);
  if (md === 0) return [];
  let cands = [];
  for (const die of new Set(s.dice)) {
    for (const m of singleMoves2(s, die)) {
      if (1 + maxDepth2(applySingle2(s, m), memo) === md) cands.push(m);
    }
  }
  const [a, b] = s.dice;
  if (s.dice.length === 2 && a !== b && md === 1) {
    const hi = Math.max(a, b);
    if (cands.some((m) => m.die === hi)) cands = cands.filter((m) => m.die === hi);
  }
  return cands;
}
function endTurn2(s) {
  return { ...s, turns: { ...s.turns, [s.turn]: s.turns[s.turn] + 1 }, turn: other3(s.turn), phase: "roll", dice: [] };
}
function applyRoll2(s, roll) {
  const [a, b] = roll;
  const dice = a === b ? [a, a, a, a] : [a, b];
  const first = s.turns[s.turn] === 0;
  const headLimit = first && a === b && [6, 4, 3].includes(a) ? 2 : 1;
  const next = { ...s, phase: "move", dice, rolled: [a, b], last: [], headTaken: 0, headLimit, noMoves: false };
  if (!legalMoves5(next).length) return { ...endTurn2(next), rolled: [a, b], noMoves: true, passedBy: s.turn };
  return next;
}
function applyMove3(s, m) {
  let next = applySingle2(s, m);
  if (next.off[s.turn] === 15) {
    const loser = other3(s.turn);
    return { ...next, phase: "over", dice: [], winner: s.turn, score: next.off[loser] === 0 ? 2 : 1 };
  }
  if (!next.dice.length || !legalMoves5(next).length) next = endTurn2(next);
  return next;
}
function findMove2(s, from, to) {
  return legalMoves5(s).filter((m) => m.from === from && m.to === to).sort((x, y) => x.die - y.die)[0];
}

// src/games/cards.js
var SUITS = ["s", "h", "c", "d"];
var RANKS = "6789TJQKA";
var isJoker = (c) => typeof c === "string" && c[0] === "X";
var rankOf = (c) => RANKS.indexOf(c[0]) + 6;
var suitOf = (c) => isJoker(c) ? null : c[1];
function deck36() {
  const out = [];
  for (const s of SUITS) for (const r of RANKS) out.push(r + s);
  return out;
}
function shuffle2(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// src/games/durak.js
var otherSeat2 = (s) => s === "a" ? "b" : "a";
function initState8(rand = Math.random) {
  const deck = shuffle2(deck36(), rand);
  const hands = { a: deck.slice(0, 6), b: deck.slice(6, 12) };
  const stock = deck.slice(12);
  const trump = stock[stock.length - 1];
  const ts = suitOf(trump);
  const low = (h) => Math.min(99, ...h.filter((c) => suitOf(c) === ts).map(rankOf));
  const attacker = low(hands.b) < low(hands.a) ? "b" : "a";
  return {
    hands,
    stock,
    trump,
    trumpSuit: ts,
    table: [],
    attacker,
    turn: attacker,
    phase: "attack",
    limit: Math.min(6, hands[otherSeat2(attacker)].length),
    discard: 0,
    winner: null,
    draw: false,
    last: null,
    bout: 1
  };
}
var beats = (card, target, ts) => suitOf(card) === suitOf(target) && rankOf(card) > rankOf(target) || suitOf(card) === ts && suitOf(target) !== ts;
var tableRanks = (s) => new Set(s.table.flatMap((p) => [p.a, p.d]).filter(Boolean).map(rankOf));
var allBeaten = (s) => s.table.every((p) => p.d);
function attackOptions(s) {
  if (s.phase !== "attack" && s.phase !== "take") return [];
  const hand = s.hands[s.attacker];
  if (!s.table.length) return s.phase === "attack" ? hand.slice() : [];
  if (s.phase === "attack" && !allBeaten(s)) return [];
  if (s.table.length >= s.limit) return [];
  const ranks = tableRanks(s);
  return hand.filter((c) => ranks.has(rankOf(c)));
}
function defendOptions(s, card) {
  const open = s.table.findIndex((p) => !p.d);
  if (s.phase !== "defend" || open < 0) return [];
  return s.table.map((p, i) => !p.d && beats(card, p.a, s.trumpSuit) ? i : -1).filter((i) => i >= 0);
}
function refill(s) {
  const hands = { ...s.hands };
  const stock = s.stock.slice();
  for (const seat of [s.attacker, otherSeat2(s.attacker)]) {
    const h = hands[seat].slice();
    while (h.length < 6 && stock.length) h.push(stock.shift());
    hands[seat] = h;
  }
  return { ...s, hands, stock };
}
function endBout(s, kind) {
  const def = otherSeat2(s.attacker);
  let next;
  if (kind === "beaten") {
    next = { ...s, table: [], discard: s.discard + s.table.length * 2, last: { seat: s.attacker, kind: "bita" } };
    next = refill(next);
    next.attacker = def;
  } else {
    const cards = s.table.flatMap((p) => [p.a, p.d]).filter(Boolean);
    next = { ...s, table: [], hands: { ...s.hands, [def]: [...s.hands[def], ...cards] }, last: { seat: def, kind: "took", n: cards.length } };
    next = refill(next);
  }
  next.bout = s.bout + 1;
  if (!next.stock.length) {
    const ea = !next.hands.a.length;
    const eb = !next.hands.b.length;
    if (ea && eb) return { ...next, phase: "over", turn: null, draw: true, winner: null };
    if (ea || eb) return { ...next, phase: "over", turn: null, winner: ea ? "a" : "b" };
  }
  return { ...next, phase: "attack", turn: next.attacker, limit: Math.min(6, next.hands[otherSeat2(next.attacker)].length) };
}
function settle(s) {
  if (s.phase === "attack" && s.table.length && allBeaten(s) && !attackOptions(s).length) return endBout(s, "beaten");
  if (s.phase === "take" && !attackOptions(s).length) return endBout(s, "taken");
  return s;
}
function attack(s, card) {
  if (!attackOptions(s).includes(card)) throw new Error("\u10D0\u10DB \u10D9\u10D0\u10E0\u10E2\u10D8\u10D7 \u10E1\u10D5\u10DA\u10D0 \u10D0\u10E0 \u10E8\u10D4\u10D8\u10EB\u10DA\u10D4\u10D1\u10D0");
  const hand = s.hands[s.attacker].filter((c) => c !== card);
  const table = [...s.table, { a: card, d: null }];
  const take2 = s.phase === "take";
  const next = {
    ...s,
    hands: { ...s.hands, [s.attacker]: hand },
    table,
    phase: take2 ? "take" : "defend",
    turn: take2 ? s.attacker : otherSeat2(s.attacker),
    last: { seat: s.attacker, kind: "attack", card }
  };
  return settle(next);
}
function defend(s, card, target) {
  const def = otherSeat2(s.attacker);
  if (s.turn !== def || !s.hands[def].includes(card) || !defendOptions(s, card).includes(target)) throw new Error("\u10D0\u10DB \u10D9\u10D0\u10E0\u10E2\u10D8\u10D7 \u10D5\u10D4\u10E0 \u10DB\u10DD\u10D8\u10D2\u10D4\u10E0\u10D8\u10D4\u10D1");
  const table = s.table.map((p, i) => i === target ? { ...p, d: card } : p);
  const next = {
    ...s,
    hands: { ...s.hands, [def]: s.hands[def].filter((c) => c !== card) },
    table,
    phase: table.every((p) => p.d) ? "attack" : "defend",
    last: { seat: def, kind: "beat", card }
  };
  next.turn = next.phase === "attack" ? s.attacker : def;
  return settle(next);
}
function take(s) {
  if (s.phase !== "defend") throw new Error("\u10D0\u10EE\u10DA\u10D0 \u10D0\u10E6\u10D4\u10D1\u10D0 \u10D0\u10E0 \u10E8\u10D4\u10D8\u10EB\u10DA\u10D4\u10D1\u10D0");
  return settle({ ...s, phase: "take", turn: s.attacker, last: { seat: otherSeat2(s.attacker), kind: "take" } });
}
function done(s) {
  if (s.phase === "take") return endBout(s, "taken");
  if (s.phase === "attack" && s.table.length && allBeaten(s)) return endBout(s, "beaten");
  throw new Error("\u10D0\u10EE\u10DA\u10D0 \u10D0\u10DB\u10D8\u10E1 \u10D2\u10D0\u10D9\u10D4\u10D7\u10D4\u10D1\u10D0 \u10D0\u10E0 \u10E8\u10D4\u10D8\u10EB\u10DA\u10D4\u10D1\u10D0");
}
var isOver3 = (s) => s.phase === "over";

// src/games/joker.js
var SEATS = ["a", "b", "c", "d"];
var nextSeat = (s) => SEATS[(SEATS.indexOf(s) + 1) % 4];
var MODES = {
  standard: { title: "\u10E1\u10E2\u10D0\u10DC\u10D3\u10D0\u10E0\u10E2\u10E3\u10DA\u10D8", sets: [[1, 2, 3, 4, 5, 6, 7, 8], [9, 9, 9, 9], [8, 7, 6, 5, 4, 3, 2, 1], [9, 9, 9, 9]] },
  nines: { title: "\u10EA\u10EE\u10E0\u10D8\u10D0\u10DC\u10D4\u10D1\u10D8", sets: [[9, 9, 9, 9], [9, 9, 9, 9], [9, 9, 9, 9], [9, 9, 9, 9]] },
  quick: { title: "\u10E1\u10EC\u10E0\u10D0\u10E4\u10D8", sets: [[9, 9, 9, 9]] }
};
function jokerDeck() {
  return [...deck36().filter((c) => c !== "6s" && c !== "6c"), "X1", "X2"];
}
var zero = () => ({ a: 0, b: 0, c: 0, d: 0 });
var empty = () => ({ a: null, b: null, c: null, d: null });
function initState9(rand = Math.random, mode = "standard") {
  const s = {
    mode: MODES[mode] ? mode : "standard",
    set: 0,
    hand: 0,
    dealer: "d",
    n: 0,
    hands: { a: [], b: [], c: [], d: [] },
    trump: null,
    trumpSuit: null,
    phase: "bid",
    turn: "a",
    bids: empty(),
    taken: zero(),
    trick: [],
    leader: "a",
    lastTrick: null,
    scores: zero(),
    sheet: [],
    winner: null,
    draw: false
  };
  return deal(s, rand);
}
var handSize = (s) => MODES[s.mode].sets[s.set][s.hand];
var totalHands = (mode) => MODES[mode].sets.reduce((n, x) => n + x.length, 0);
function deal(s, rand) {
  const n = handSize(s);
  const cards = shuffle2(jokerDeck(), rand);
  const hands = {};
  SEATS.forEach((seat, k) => {
    hands[seat] = cards.slice(k * n, k * n + n);
  });
  const first = nextSeat(s.dealer);
  const base = { ...s, n, hands, bids: empty(), taken: zero(), trick: [], leader: first, turn: first, lastTrick: s.lastTrick };
  if (n === 9) return { ...base, trump: null, trumpSuit: null, phase: "trump" };
  const trump = cards[4 * n];
  return { ...base, trump, trumpSuit: suitOf(trump), phase: "bid" };
}
function visibleHand(s, seat) {
  return s.phase === "trump" ? s.hands[seat].slice(0, 3) : s.hands[seat];
}
function chooseTrump(s, suit) {
  if (s.phase !== "trump") throw new Error("\u10D9\u10DD\u10D6\u10D8\u10E0\u10D8 \u10E3\u10D9\u10D5\u10D4 \u10D0\u10E0\u10E9\u10D4\u10E3\u10DA\u10D8\u10D0");
  if (suit !== null && !SUITS.includes(suit)) throw new Error("\u10D0\u10E1\u10D4\u10D7\u10D8 \u10DB\u10D0\u10E1\u10E2\u10D8 \u10D0\u10E0 \u10D0\u10E0\u10E1\u10D4\u10D1\u10DD\u10D1\u10E1");
  return { ...s, trumpSuit: suit, trump: null, phase: "bid", turn: nextSeat(s.dealer) };
}
function forbiddenBid(s) {
  if (s.turn !== s.dealer) return null;
  const sum = SEATS.reduce((n, x) => n + (s.bids[x] ?? 0), 0);
  const f = s.n - sum;
  return f >= 0 ? f : null;
}
function bidOptions(s) {
  if (s.phase !== "bid") return [];
  const f = forbiddenBid(s);
  return Array.from({ length: s.n + 1 }, (_, k) => k).filter((k) => k !== f);
}
function bid(s, k) {
  if (!bidOptions(s).includes(k)) throw new Error("\u10D0\u10DB \u10E0\u10D0\u10DD\u10D3\u10D4\u10DC\u10DD\u10D1\u10D0\u10E1 \u10D5\u10D4\u10E0 \u10D8\u10E2\u10E7\u10D5\u10D8");
  const bids = { ...s.bids, [s.turn]: k };
  const done3 = s.turn === s.dealer;
  return { ...s, bids, turn: done3 ? nextSeat(s.dealer) : nextSeat(s.turn), phase: done3 ? "play" : "bid" };
}
function demand(s) {
  if (!s.trick.length) return null;
  const lead2 = s.trick[0];
  if (isJoker(lead2.card)) return { suit: lead2.suit, highest: lead2.mode === "high" && lead2.suit !== s.trumpSuit };
  return { suit: suitOf(lead2.card), highest: false };
}
function legalCards(s, seat = s.turn) {
  const hand = s.hands[seat];
  const d = demand(s);
  if (!d) return hand.slice();
  const jokers = hand.filter(isJoker);
  const follow = hand.filter((c) => !isJoker(c) && suitOf(c) === d.suit);
  if (follow.length) {
    if (!d.highest) return [...follow, ...jokers];
    const top = Math.max(...follow.map(rankOf));
    return [...follow.filter((c) => rankOf(c) === top), ...jokers];
  }
  const trumps = s.trumpSuit ? hand.filter((c) => !isJoker(c) && suitOf(c) === s.trumpSuit) : [];
  if (trumps.length) return [...trumps, ...jokers];
  return hand.slice();
}
function trickWinner(trick, trumpSuit) {
  const highs = trick.map((x, i) => isJoker(x.card) && x.mode === "high" ? i : -1).filter((i) => i >= 0);
  const lead2 = trick[0];
  const best = (filter) => {
    let bi = -1;
    trick.forEach((x, i) => {
      if (!isJoker(x.card) && filter(x.card) && (bi < 0 || rankOf(x.card) > rankOf(trick[bi].card))) bi = i;
    });
    return bi;
  };
  if (highs.length) {
    const last = highs[highs.length - 1];
    if (last > 0) return last;
    if (trumpSuit && lead2.suit !== trumpSuit) {
      const t = best((c) => suitOf(c) === trumpSuit);
      if (t >= 0) return t;
    }
    return 0;
  }
  if (trumpSuit) {
    const t = best((c) => suitOf(c) === trumpSuit);
    if (t >= 0) return t;
  }
  const ls = isJoker(lead2.card) ? lead2.suit : suitOf(lead2.card);
  const f = best((c) => suitOf(c) === ls);
  return f >= 0 ? f : 0;
}
function handPoints(n, b, t, nineSet) {
  if (b === t) return b === n ? 100 * n : 50 * b + 50;
  if (b > 0 && t === 0) return nineSet ? -500 : -200;
  return 10 * t;
}
function scoreHand(s, rand) {
  const nine = s.n === 9;
  const points = {};
  for (const x of SEATS) points[x] = handPoints(s.n, s.bids[x], s.taken[x], nine);
  const sheet = [...s.sheet, { set: s.set, n: s.n, bids: s.bids, taken: s.taken, points, trumpSuit: s.trumpSuit }];
  const scores = { ...s.scores };
  for (const x of SEATS) scores[x] += points[x];
  const setLen = MODES[s.mode].sets[s.set].length;
  let next = { ...s, sheet, scores };
  if (s.hand + 1 >= setLen) {
    const rows = sheet.filter((r) => r.set === s.set && !r.bonus);
    const bonus = {};
    for (const x of SEATS) {
      const allMade = rows.every((r) => r.bids[x] === r.taken[x]);
      bonus[x] = allMade ? Math.max(...rows.map((r) => r.points[x])) : 0;
      scores[x] += bonus[x];
    }
    if (SEATS.some((x) => bonus[x])) next.sheet = [...sheet, { set: s.set, bonus: true, points: bonus }];
    next.scores = scores;
    if (s.set + 1 >= MODES[s.mode].sets.length) {
      const top = Math.max(...SEATS.map((x) => scores[x]));
      const leaders = SEATS.filter((x) => scores[x] === top);
      return { ...next, phase: "over", turn: null, winner: leaders.length === 1 ? leaders[0] : null, draw: leaders.length > 1, hands: { a: [], b: [], c: [], d: [] } };
    }
    next = { ...next, set: s.set + 1, hand: 0 };
  } else {
    next = { ...next, hand: s.hand + 1 };
  }
  next.dealer = nextSeat(s.dealer);
  return deal(next, rand);
}
function play3(s, card, opts = {}, rand = Math.random) {
  if (s.phase !== "play") throw new Error("\u10D0\u10EE\u10DA\u10D0 \u10D9\u10D0\u10E0\u10E2\u10D8\u10E1 \u10D3\u10D0\u10D3\u10D4\u10D1\u10D0 \u10D0\u10E0 \u10E8\u10D4\u10D8\u10EB\u10DA\u10D4\u10D1\u10D0");
  const seat = s.turn;
  if (!legalCards(s, seat).includes(card)) throw new Error("\u10D0\u10DB \u10D9\u10D0\u10E0\u10E2\u10E1 \u10D5\u10D4\u10E0 \u10D3\u10D0\u10D3\u10D4\u10D1");
  const entry = { seat, card };
  if (isJoker(card)) {
    if (opts.mode !== "high" && opts.mode !== "low") throw new Error("\u10EF\u10DD\u10D9\u10D4\u10E0\u10D8: \u10DB\u10D0\u10E6\u10D0\u10DA\u10D8 \u10D7\u10E3 \u10D3\u10D0\u10D1\u10D0\u10DA\u10D8?");
    entry.mode = opts.mode;
    if (!s.trick.length) {
      if (!SUITS.includes(opts.suit)) throw new Error("\u10EF\u10DD\u10D9\u10D4\u10E0\u10D8\u10D7 \u10E8\u10D4\u10DB\u10DD\u10E1\u10D5\u10DA\u10D8\u10E1\u10D0\u10E1 \u10DB\u10D0\u10E1\u10E2\u10D8 \u10D3\u10D0\u10D0\u10E1\u10D0\u10EE\u10D4\u10DA\u10D4");
      entry.suit = opts.suit;
    }
  }
  const trick = [...s.trick, entry];
  const hands = { ...s.hands, [seat]: s.hands[seat].filter((c) => c !== card) };
  if (trick.length < 4) return { ...s, hands, trick, turn: nextSeat(seat) };
  const w = trick[trickWinner(trick, s.trumpSuit)].seat;
  const taken = { ...s.taken, [w]: s.taken[w] + 1 };
  const next = { ...s, hands, trick: [], taken, leader: w, turn: w, lastTrick: { cards: trick, winner: w } };
  if (hands[seat].length === 0) return scoreHand(next, rand);
  return next;
}

// src/games/bura.js
var otherSeat3 = (s) => s === "a" ? "b" : "a";
var VALUE = { A: 11, T: 10, K: 4, Q: 3, J: 2 };
var cardPoints = (c) => VALUE[c[0]] || 0;
var sumPoints = (cards) => cards.reduce((n, c) => n + cardPoints(c), 0);
var WIN_AT = 61;
var beats2 = (card, target, ts) => suitOf(card) === suitOf(target) && rankOf(card) > rankOf(target) || suitOf(card) === ts && suitOf(target) !== ts;
function permutations(a) {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
}
var beatsAll = (resp, lead2, ts) => resp.length === lead2.length && permutations(resp).some((p) => p.every((c, i) => beats2(c, lead2[i], ts)));
var isBura = (hand, ts) => hand.length === 3 && hand.every((c) => suitOf(c) === ts);
function checkBura(s, order) {
  for (const seat of order) {
    if (isBura(s.hands[seat], s.trumpSuit)) return { ...s, phase: "over", turn: null, winner: seat, bura: seat };
  }
  return s;
}
function initState10(rand = Math.random) {
  const deck = shuffle2(deck36(), rand);
  const leader = rand() < 0.5 ? "a" : "b";
  const stock = deck.slice(6);
  const trump = stock[stock.length - 1];
  const s = {
    hands: { a: deck.slice(0, 3), b: deck.slice(3, 6) },
    stock,
    trump,
    trumpSuit: suitOf(trump),
    leader,
    turn: leader,
    phase: "lead",
    lead: [],
    points: { a: 0, b: 0 },
    taken: { a: 0, b: 0 },
    trick: 1,
    last: null,
    winner: null,
    draw: false,
    bura: null
  };
  return checkBura(s, [leader, otherSeat3(leader)]);
}
var maxLead = (s) => Math.min(3, s.hands[s.leader].length, s.hands[otherSeat3(s.leader)].length);
function canLead(s, cards) {
  if (s.phase !== "lead" || !Array.isArray(cards) || !cards.length || cards.length > maxLead(s)) return false;
  if (new Set(cards).size !== cards.length || !cards.every((c) => s.hands[s.leader].includes(c))) return false;
  return cards.every((c) => suitOf(c) === suitOf(cards[0]));
}
function lead(s, cards) {
  if (!canLead(s, cards)) throw new Error("\u10D0\u10E1\u10D4 \u10E1\u10D5\u10DA\u10D0 \u10D0\u10E0 \u10E8\u10D4\u10D8\u10EB\u10DA\u10D4\u10D1\u10D0 \u2014 \u10E0\u10D0\u10DB\u10D3\u10D4\u10DC\u10D8\u10DB\u10D4 \u10D9\u10D0\u10E0\u10E2\u10D8 \u10DB\u10EE\u10DD\u10DA\u10DD\u10D3 \u10D4\u10E0\u10D7\u10D8 \u10DB\u10D0\u10E1\u10E2\u10D8\u10E1\u10D0");
  return {
    ...s,
    lead: cards.slice(),
    phase: "respond",
    turn: otherSeat3(s.leader),
    hands: { ...s.hands, [s.leader]: s.hands[s.leader].filter((c) => !cards.includes(c)) }
  };
}
function finishByPoints(s) {
  const { a, b } = s.points;
  return { ...s, phase: "over", turn: null, winner: a === b ? null : a > b ? "a" : "b", draw: a === b };
}
function respond(s, cards) {
  const seat = otherSeat3(s.leader);
  if (s.phase !== "respond" || !Array.isArray(cards) || cards.length !== s.lead.length) throw new Error(`\u10D3\u10D0\u10D3\u10D4 ${s.lead.length} \u10D9\u10D0\u10E0\u10E2\u10D8`);
  if (new Set(cards).size !== cards.length || !cards.every((c) => s.hands[seat].includes(c))) throw new Error("\u10D4\u10E1 \u10D9\u10D0\u10E0\u10E2\u10D8 \u10EE\u10D4\u10DA\u10E8\u10D8 \u10D0\u10E0 \u10D2\u10D0\u10E5\u10D5\u10E1");
  const beat = beatsAll(cards, s.lead, s.trumpSuit);
  const winner = beat ? seat : s.leader;
  const loser = otherSeat3(winner);
  const pts = sumPoints([...s.lead, ...cards]);
  const hands = { ...s.hands, [seat]: s.hands[seat].filter((c) => !cards.includes(c)) };
  const points = { ...s.points, [winner]: s.points[winner] + pts };
  const taken = { ...s.taken, [winner]: s.taken[winner] + cards.length * 2 };
  let next = {
    ...s,
    hands,
    points,
    taken,
    lead: [],
    last: { leader: s.leader, lead: s.lead, resp: cards, winner, beat, pts }
  };
  if (points[winner] >= WIN_AT) return { ...next, phase: "over", turn: null, winner };
  const stock = next.stock.slice();
  for (const x of [winner, loser]) {
    const h = next.hands[x].slice();
    while (h.length < 3 && stock.length) h.push(stock.shift());
    next.hands = { ...next.hands, [x]: h };
  }
  next.stock = stock;
  next = checkBura(next, [winner, loser]);
  if (next.phase === "over") return next;
  if (!next.hands.a.length || !next.hands.b.length) {
    const pointsEnd = { a: next.points.a + sumPoints(next.hands.a), b: next.points.b + sumPoints(next.hands.b) };
    return finishByPoints({ ...next, points: pointsEnd });
  }
  return { ...next, phase: "lead", leader: winner, turn: winner, trick: s.trick + 1 };
}
var isOver4 = (s) => s.phase === "over";

// src/games/loto.js
var loto_exports = {};
__export(loto_exports, {
  INTERVAL: () => INTERVAL,
  MODES: () => MODES2,
  NICK: () => NICK,
  SEATS: () => SEATS2,
  coveredCount: () => coveredCount,
  draw: () => draw,
  due: () => due,
  initState: () => initState11,
  isOver: () => isOver5,
  makeTicket: () => makeTicket,
  numbersOf: () => numbersOf,
  rowsLeft: () => rowsLeft
});
var SEATS2 = ["a", "b", "c", "d"];
var INTERVAL = 3200;
var MODES2 = { line: { title: "\u10EE\u10D0\u10D6\u10D8", sub: "\u10D4\u10E0\u10D7\u10D8 \u10E1\u10E0\u10E3\u10DA\u10D8 \u10E0\u10D8\u10D2\u10D8" }, full: { title: "\u10E1\u10E0\u10E3\u10DA\u10D8", sub: "\u10DB\u10D7\u10D4\u10DA\u10D8 \u10D1\u10D8\u10DA\u10D4\u10D7\u10D8" } };
var colRange = (c) => c === 0 ? [1, 9] : c === 8 ? [80, 90] : [c * 10, c * 10 + 9];
function makeTicket(rand = Math.random) {
  let rows;
  for (; ; ) {
    rows = [0, 1, 2].map(() => shuffle2([0, 1, 2, 3, 4, 5, 6, 7, 8], rand).slice(0, 5));
    const used = new Set(rows.flat());
    if (used.size === 9) break;
  }
  const grid = [0, 1, 2].map(() => Array(9).fill(null));
  for (let c = 0; c < 9; c++) {
    const inRows = [0, 1, 2].filter((r) => rows[r].includes(c));
    const [lo, hi] = colRange(c);
    const pool = shuffle2(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), rand).slice(0, inRows.length).sort((x, y) => x - y);
    inRows.forEach((r, i) => {
      grid[r][c] = pool[i];
    });
  }
  return grid;
}
var numbersOf = (ticket) => ticket.flat().filter((n) => n !== null);
var rowsLeft = (ticket, drawn) => {
  const set = drawn instanceof Set ? drawn : new Set(drawn);
  return ticket.map((row) => row.filter((n) => n !== null && !set.has(n)).length);
};
var coveredCount = (ticket, drawn) => {
  const set = drawn instanceof Set ? drawn : new Set(drawn);
  return numbersOf(ticket).filter((n) => set.has(n)).length;
};
var done2 = (ticket, set, mode) => {
  const left = rowsLeft(ticket, set);
  return mode === "full" ? left.every((n) => n === 0) : left.some((n) => n === 0);
};
function initState11(rand = Math.random, mode = "line", seats = 4) {
  const list = SEATS2.slice(0, seats);
  return {
    bag: shuffle2(Array.from({ length: 90 }, (_, i) => i + 1), rand),
    drawn: [],
    tickets: Object.fromEntries(list.map((s) => [s, makeTicket(rand)])),
    mode: MODES2[mode] ? mode : "line",
    phase: "play",
    next_at: null,
    interval: INTERVAL,
    winner: null,
    winners: [],
    draw: false,
    scores: Object.fromEntries(list.map((s) => [s, 0])),
    last: null
  };
}
var due = (s, now) => s.phase === "play" && (s.next_at === null || now >= s.next_at);
function draw(s, now = Date.now()) {
  if (s.phase !== "play") throw new Error("\u10D7\u10D0\u10DB\u10D0\u10E8\u10D8 \u10D3\u10D0\u10E1\u10E0\u10E3\u10DA\u10D4\u10D1\u10E3\u10DA\u10D8\u10D0");
  if (s.next_at === null) return { ...s, next_at: now + 1500 };
  if (now < s.next_at) throw new Error("\u10E8\u10D4\u10DB\u10D3\u10D4\u10D2\u10D8 \u10D9\u10D0\u10E1\u10E0\u10D8 \u10EF\u10D4\u10E0 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1");
  const n = s.bag[0];
  const drawn = [...s.drawn, n];
  const set = new Set(drawn);
  const seats = Object.keys(s.tickets);
  const winners = seats.filter((seat) => done2(s.tickets[seat], set, s.mode));
  const scores = Object.fromEntries(seats.map((seat) => [seat, coveredCount(s.tickets[seat], set) + (winners.includes(seat) ? 100 : 0)]));
  const next = { ...s, bag: s.bag.slice(1), drawn, last: n, scores, next_at: now + s.interval };
  if (!winners.length) return next;
  return { ...next, phase: "over", next_at: null, winners, winner: winners.length === 1 ? winners[0] : null, draw: winners.length > 1 };
}
var isOver5 = (s) => s.phase === "over";
var NICK = { 1: "\u10D9\u10DD\u10DA\u10D8", 11: "\u10EF\u10DD\u10EE\u10D4\u10D1\u10D8", 22: "\u10D8\u10EE\u10D5\u10D4\u10D1\u10D8", 69: "\u10EC\u10D8\u10DC \u10D3\u10D0 \u10E3\u10D9\u10D0\u10DC", 77: "\u10EA\u10E3\u10DA\u10D4\u10D1\u10D8", 90: "\u10D1\u10D0\u10D1\u10E3\u10D0" };

// src/games/index.js
var GAMES = {
  nardi: {
    type: "nardi",
    title: "\u10DC\u10D0\u10E0\u10D3\u10D8",
    blurb: "\u10D9\u10D0\u10DB\u10D0\u10D7\u10D4\u10DA\u10D8, \u10EA\u10D4\u10DB\u10D0 \u10D3\u10D0 \u10DB\u10D0\u10E0\u10E1\u10D8",
    init: () => initState5(),
    seatOf: (state) => state.turn === "w" ? "a" : "b"
  },
  chess: {
    type: "chess",
    title: "\u10ED\u10D0\u10D3\u10E0\u10D0\u10D9\u10D8",
    blurb: "\u10E1\u10E0\u10E3\u10DA\u10D8 \u10EC\u10D4\u10E1\u10D4\u10D1\u10D8, \u10E0\u10DD\u10E5\u10D8\u10D7 \u10D3\u10D0 \u10D0\u10DC-\u10DE\u10D0\u10E1\u10D0\u10DC\u10D8\u10D7",
    init: () => initState(),
    seatOf: (state) => state.turn === "w" ? "a" : "b"
  },
  chess960: {
    type: "chess960",
    title: "\u10ED\u10D0\u10D3\u10E0\u10D0\u10D9\u10D8 960",
    blurb: "\u10E4\u10D8\u10D2\u10E3\u10E0\u10D4\u10D1\u10D8 \u10E8\u10D4\u10DB\u10D7\u10EE\u10D5\u10D4\u10D5\u10D8\u10D7 \u10E0\u10D8\u10D2\u10E8\u10D8 \u2014 \u10D7\u10D4\u10DD\u10E0\u10D8\u10D0 \u10D0\u10E6\u10D0\u10E0 \u10D2\u10D4\u10EE\u10DB\u10D0\u10E0\u10D4\u10D1\u10D0",
    init: (rand = cryptoRand) => initState2(rand),
    seatOf: (state) => state.turn === "w" ? "a" : "b"
  },
  gomoku: {
    type: "gomoku",
    title: "\u10EE\u10E3\u10D7\u10D8 \u10E0\u10D8\u10D2\u10E8\u10D8",
    blurb: "15\xD715 \u10D3\u10D0\u10E4\u10D0 \u2014 \u10D0\u10D0\u10EC\u10E7\u10D5\u10D4 \u10EE\u10E3\u10D7\u10D8 \u10E5\u10D5\u10D0 \u10D4\u10E0\u10D7 \u10EE\u10D0\u10D6\u10D6\u10D4",
    init: () => initState3(),
    seatOf: (state) => state.turn
  },
  checkers: {
    type: "checkers",
    title: "\u10E8\u10D0\u10E8\u10D9\u10D8",
    blurb: "\u10E0\u10E3\u10E1\u10E3\u10DA\u10D8 \u10EC\u10D4\u10E1\u10D4\u10D1\u10D8, \u10DB\u10DD\u10ED\u10E0\u10D0 \u10E1\u10D0\u10D5\u10D0\u10DA\u10D3\u10D4\u10D1\u10E3\u10DA\u10DD\u10D0",
    init: () => initState4(),
    seatOf: (state) => state.turn === "w" ? "a" : "b"
  },
  domino: {
    type: "domino",
    title: "\u10D3\u10DD\u10DB\u10D8\u10DC\u10DD",
    blurb: "\u10D1\u10D0\u10D6\u10E0\u10D8\u10D7, \u10DD\u10E0\u10D8 \u10DB\u10DD\u10D7\u10D0\u10DB\u10D0\u10E8\u10D4",
    init: () => initState6(cryptoRand),
    seatOf: (state) => state.turn
  },
  longnardi: {
    type: "longnardi",
    title: "\u10D2\u10E0\u10EB\u10D4\u10DA\u10D8 \u10DC\u10D0\u10E0\u10D3\u10D8",
    blurb: "\u10EA\u10D4\u10DB\u10D8\u10E1 \u10D2\u10D0\u10E0\u10D4\u10E8\u10D4, \u10D4\u10E0\u10D7\u10D8 \u10DB\u10D8\u10DB\u10D0\u10E0\u10D7\u10E3\u10DA\u10D4\u10D1\u10D8\u10D7",
    init: () => initState7(),
    seatOf: (state) => state.turn === "w" ? "a" : "b"
  },
  durak: {
    type: "durak",
    title: "\u10D3\u10E3\u10E0\u10D0\u10D9\u10D8",
    blurb: "\u10E9\u10D0\u10DB\u10D0\u10E2\u10D4\u10D1\u10D8\u10D7\u10D8, 36 \u10D9\u10D0\u10E0\u10E2\u10D8",
    hidden: true,
    init: (rand = cryptoRand) => initState8(rand),
    seatOf: (state) => state.turn
  },
  joker: {
    type: "joker",
    title: "\u10EF\u10DD\u10D9\u10D4\u10E0\u10D8",
    blurb: "\u10DD\u10D7\u10EE\u10DC\u10D8 \u10DB\u10D0\u10D2\u10D8\u10D3\u10D0\u10E1\u10D7\u10D0\u10DC, \u10EE\u10D8\u10E8\u10E2\u10D8\u10D7",
    hidden: true,
    seats: 4,
    modes: MODES,
    defaultMode: "quick",
    modeNote: (k) => totalHands(k),
    init: (rand = cryptoRand, opts = {}) => initState9(rand, opts.mode),
    seatOf: (state) => state.turn
  },
  bura: {
    type: "bura",
    title: "\u10D1\u10E3\u10E0\u10D0",
    blurb: "\u10E1\u10D0\u10DB\u10D8 \u10D9\u10D0\u10E0\u10E2\u10D8, \u10D9\u10DD\u10D6\u10D8\u10E0\u10D8 \u10D3\u10D0 61 \u10E5\u10E3\u10DA\u10D0",
    hidden: true,
    init: (rand = cryptoRand) => initState10(rand),
    seatOf: (state) => state.turn
  },
  loto: {
    type: "loto",
    title: "\u10DA\u10DD\u10E2\u10DD",
    blurb: "90 \u10D9\u10D0\u10E1\u10E0\u10D8 \u2014 \u10D5\u10D8\u10E1 \u10D1\u10D8\u10DA\u10D4\u10D7\u10D8 \u10E8\u10D4\u10D8\u10D5\u10E1\u10D4\u10D1\u10D0 \u10DE\u10D8\u10E0\u10D5\u10D4\u10DA\u10D8",
    seats: 4,
    modes: MODES2,
    defaultMode: "line",
    modeNote: (k) => MODES2[k].sub,
    turnless: true,
    init: (rand = cryptoRand, opts = {}) => initState11(rand, opts.mode),
    seatOf: () => null
  }
};
var seatsOf = (type) => GAMES[type]?.seats || 2;
var SEAT_LETTERS = ["a", "b", "c", "d"];
var GAME_LIST = ["nardi", "longnardi", "joker", "bura", "durak", "loto", "chess", "chess960", "checkers", "gomoku", "domino"].map((k) => GAMES[k]);
function cryptoRand() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}
function outcome(type, state) {
  if (!state) return { over: false };
  if (type === "chess") {
    const st = status(fromFEN(state.fen));
    if (!st.over) return { over: false, check: st.check };
    return { over: true, winner: st.winner ? st.winner === "w" ? "a" : "b" : null, result: st.result };
  }
  if (type === "chess960") {
    const st = status2(fromFEN(state.fen));
    if (!st.over) return { over: false, check: st.check };
    return { over: true, winner: st.winner ? st.winner === "w" ? "a" : "b" : null, result: st.result };
  }
  if (type === "gomoku") {
    if (!isOver(state)) return { over: false };
    return { over: true, winner: state.winner || null, result: state.winner ? "five" : "gomokudraw" };
  }
  if (type === "checkers") {
    const st = status3(state);
    return st.over ? { over: true, winner: st.winner === "w" ? "a" : "b", result: "nomoves" } : { over: false };
  }
  if (type === "nardi" || type === "longnardi") {
    if (state.phase !== "over") return { over: false };
    return { over: true, winner: state.winner === "w" ? "a" : "b", result: state.score === 2 ? "mars" : "win" };
  }
  if (type === "domino") {
    if (!isOver2(state)) return { over: false };
    return { over: true, winner: state.winner || null, result: state.blocked ? "blocked" : "domino" };
  }
  if (type === "durak") {
    if (state.phase !== "over") return { over: false };
    return { over: true, winner: state.winner || null, result: state.draw ? "durakdraw" : "durak" };
  }
  if (type === "joker") {
    if (state.phase !== "over") return { over: false };
    return { over: true, winner: state.winner || null, result: state.draw ? "jokerdraw" : "joker" };
  }
  if (type === "bura") {
    if (state.phase !== "over") return { over: false };
    return { over: true, winner: state.winner || null, result: state.bura ? "bura" : state.draw ? "buradraw" : "burapoints" };
  }
  if (type === "loto") {
    if (state.phase !== "over") return { over: false };
    return { over: true, winner: state.winner || null, result: state.draw ? "lotodraw" : "loto" };
  }
  return { over: false };
}

// src/games/hidden.js
var HIDDEN = /* @__PURE__ */ new Set(["domino", "durak", "joker", "bura"]);

// src/games/server.js
var IllegalMove = class extends Error {
  constructor(msg = "\u10D4\u10E1 \u10E1\u10D5\u10DA\u10D0 \u10D0\u10E0 \u10E8\u10D4\u10D8\u10EB\u10DA\u10D4\u10D1\u10D0") {
    super(msg);
    this.code = "illegal";
  }
};
var same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function initFor(type, rand = cryptoRand, opts = {}) {
  if (type === "chess960") return initState2(rand);
  if (type === "domino") return initState6(rand);
  if (type === "durak") return initState8(rand);
  if (type === "joker") return initState9(rand, opts.mode);
  if (type === "bura") return initState10(rand);
  if (type === "loto") return initState11(rand, opts.mode);
  if (!GAMES[type]) throw new IllegalMove("\u10E3\u10EA\u10DC\u10DD\u10D1\u10D8 \u10D7\u10D0\u10DB\u10D0\u10E8\u10D8");
  return GAMES[type].init();
}
var guard = (fn) => {
  try {
    return fn();
  } catch (e) {
    throw e instanceof IllegalMove ? e : new IllegalMove(e.message);
  }
};
function applyAction(type, state, action, rand = cryptoRand) {
  if (!action || typeof action !== "object") throw new IllegalMove();
  switch (type) {
    case "chess": {
      const s = fromFEN(state.fen);
      const m = legalMoves(s).find((x) => x.from === action.from && x.to === action.to && (x.promo || null) === (action.promo || null));
      if (!m) throw new IllegalMove();
      return applyToState(state, m);
    }
    case "chess960": {
      const s = fromFEN(state.fen);
      const m = legalMoves2(s).find((x) => x.from === action.from && x.to === action.to && (x.promo || null) === (action.promo || null));
      if (!m) throw new IllegalMove();
      return applyToState2(state, m);
    }
    case "gomoku": {
      if (!Number.isInteger(action.at)) throw new IllegalMove();
      return guard(() => play(state, action.at));
    }
    case "checkers": {
      if (!Array.isArray(action.path)) throw new IllegalMove();
      const m = legalMoves3(state).find((x) => same(x.path, action.path));
      if (!m) throw new IllegalMove();
      return applyMove(state, m);
    }
    case "nardi": {
      if (action.roll) {
        if (state.phase !== "roll") throw new IllegalMove("\u10D9\u10D0\u10DB\u10D0\u10D7\u10D4\u10DA\u10D8 \u10E3\u10D9\u10D5\u10D4 \u10D2\u10D0\u10D2\u10DD\u10E0\u10D4\u10D1\u10E3\u10DA\u10D8\u10D0");
        return applyRoll(state, rollDice(rand));
      }
      const m = findMove(state, action.from, action.to);
      if (!m) throw new IllegalMove();
      return applyMove2(state, m);
    }
    case "domino": {
      if (action.draw) {
        if (!canDraw(state)) throw new IllegalMove("\u10D1\u10D0\u10D6\u10E0\u10D8\u10D3\u10D0\u10DC \u10D0\u10E6\u10D4\u10D1\u10D0 \u10D0\u10EE\u10DA\u10D0 \u10D0\u10E0 \u10E8\u10D4\u10D8\u10EB\u10DA\u10D4\u10D1\u10D0");
        return drawTile(state);
      }
      if (action.pass) {
        if (!mustPass(state)) throw new IllegalMove("\u10DE\u10D0\u10E1\u10D8 \u10D0\u10EE\u10DA\u10D0 \u10D0\u10E0 \u10E8\u10D4\u10D8\u10EB\u10DA\u10D4\u10D1\u10D0");
        return pass(state);
      }
      if (!Array.isArray(action.play)) throw new IllegalMove();
      const [x, y] = action.play;
      const i = state.hands[state.turn].findIndex((t) => t[0] === x && t[1] === y);
      if (i < 0 || !playable(state).some((o) => o.i === i && o.side === action.side)) throw new IllegalMove();
      return play2(state, i, action.side);
    }
    case "longnardi": {
      if (action.roll) {
        if (state.phase !== "roll") throw new IllegalMove("\u10D9\u10D0\u10DB\u10D0\u10D7\u10D4\u10DA\u10D8 \u10E3\u10D9\u10D5\u10D4 \u10D2\u10D0\u10D2\u10DD\u10E0\u10D4\u10D1\u10E3\u10DA\u10D8\u10D0");
        return applyRoll2(state, rollDice2(rand));
      }
      const m = findMove2(state, action.from, action.to);
      if (!m) throw new IllegalMove();
      return applyMove3(state, m);
    }
    case "durak": {
      if (typeof action.attack === "string") return guard(() => attack(state, action.attack));
      if (typeof action.beat === "string") return guard(() => defend(state, action.beat, Number(action.target)));
      if (action.take) return guard(() => take(state));
      if (action.done) return guard(() => done(state));
      throw new IllegalMove();
    }
    case "joker": {
      if ("trump" in action) return guard(() => chooseTrump(state, action.trump ?? null));
      if (typeof action.bid === "number") return guard(() => bid(state, action.bid));
      if (typeof action.play === "string") return guard(() => play3(state, action.play, { mode: action.mode, suit: action.suit }, rand));
      throw new IllegalMove();
    }
    case "bura": {
      if (Array.isArray(action.lead)) return guard(() => lead(state, action.lead));
      if (Array.isArray(action.respond)) return guard(() => respond(state, action.respond));
      throw new IllegalMove();
    }
    default:
      throw new IllegalMove("\u10E3\u10EA\u10DC\u10DD\u10D1\u10D8 \u10D7\u10D0\u10DB\u10D0\u10E8\u10D8");
  }
}
var mask = (list) => list.map(() => null);
function publicState(type, state) {
  if (!HIDDEN.has(type)) return state;
  if (type === "domino") {
    const over = isOver2(state);
    return {
      ...state,
      hands: over ? state.hands : { a: mask(state.hands.a), b: mask(state.hands.b) },
      boneyard: mask(state.boneyard)
    };
  }
  if (type === "durak") {
    const over = isOver3(state);
    return { ...state, hands: over ? state.hands : { a: mask(state.hands.a), b: mask(state.hands.b) }, stock: mask(state.stock) };
  }
  if (type === "bura") {
    const over = isOver4(state);
    return { ...state, hands: over ? state.hands : { a: mask(state.hands.a), b: mask(state.hands.b) }, stock: mask(state.stock) };
  }
  const hands = {};
  for (const seat of SEATS) hands[seat] = mask(visibleHand(state, seat));
  return { ...state, hands };
}
function handsOf(type, state) {
  if (!HIDDEN.has(type)) return null;
  if (type === "joker") return Object.fromEntries(SEATS.map((seat) => [seat, visibleHand(state, seat)]));
  return state.hands;
}
var seatToMove = (type, state) => GAMES[type].seatOf(state);

// src/games/bots.js
var VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
var CENTER = /* @__PURE__ */ new Set([27, 28, 35, 36]);
function material(s, color) {
  let v = 0;
  s.board.forEach((p, i) => {
    if (!p) return;
    const val = VAL[p.toLowerCase()] + (CENTER.has(i) ? 12 : 0);
    v += colorOf(p) === color ? val : -val;
  });
  return v;
}
var CHESS_RULES = { legalMoves, makeMove, applyToState };
var C960_RULES = {
  legalMoves: (s) => legalMoves2(s).filter((m) => !(m.flag === "castle960" && m.to !== m.rook)),
  makeMove: makeMove2,
  applyToState: applyToState2
};
function chessLike(state, R) {
  const s = fromFEN(state.fen);
  const me = s.turn;
  let best = null;
  let bestScore = -Infinity;
  for (const m of R.legalMoves(s)) {
    if (m.promo && m.promo !== "q") continue;
    const n = R.makeMove(s, m);
    const replies = R.legalMoves(n);
    let score;
    if (!replies.length) score = inCheck(n) ? 1e6 : -50;
    else {
      score = Infinity;
      for (const r of replies) score = Math.min(score, material(R.makeMove(n, r), me));
      if (inCheck(n)) score += 15;
    }
    score += cryptoRand() * 10;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best ? R.applyToState(state, best) : state;
}
var chessBot = (state) => chessLike(state, CHESS_RULES);
var chess960Bot = (state) => chessLike(state, C960_RULES);
function gomokuBot(state, rand = cryptoRand) {
  const i = bestMove(state, rand);
  return i >= 0 ? play(state, i) : state;
}
function ckEval(s, color) {
  let v = 0;
  for (const p of s.board) {
    if (!p) continue;
    const val = p === p.toUpperCase() ? 3 : 1;
    v += p.toLowerCase() === color ? val : -val;
  }
  return v;
}
function checkersBot(state) {
  const me = state.turn;
  let best = null;
  let bestScore = -Infinity;
  for (const m of legalMoves3(state)) {
    const n = applyMove(state, m);
    const replies = legalMoves3(n);
    let score;
    if (!replies.length) score = 1e6;
    else {
      score = Infinity;
      for (const r of replies) score = Math.min(score, ckEval(applyMove(n, r), me));
    }
    const to = m.path[m.path.length - 1];
    const row = to >> 3;
    score += (me === "w" ? 7 - row : row) * 0.05 + ((to & 7) > 1 && (to & 7) < 6 ? 0.05 : 0);
    score += cryptoRand() * 0.2;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best ? applyMove(state, best) : state;
}
function nardiScore(s, m) {
  const c = s.turn;
  const sign3 = c === "w" ? 1 : -1;
  const next = applySingle(s, m);
  let score = cryptoRand() * 0.6 + m.die * 0.1;
  const last = next.last[next.last.length - 1];
  if (last.hit) score += 4;
  if (m.to === "off") score += 5;
  else {
    const n = next.points[m.to] * sign3;
    if (n === 2) score += 3;
    if (n === 1) score -= 1.5;
  }
  if (m.from !== "bar" && next.points[m.from] * sign3 === 1) score -= 2;
  return score;
}
function nardiBot(state) {
  let s = state;
  const seat = s.turn;
  if (s.phase === "roll") s = applyRoll(s, rollDice(cryptoRand));
  let guard2 = 0;
  while (s.turn === seat && s.phase === "move" && guard2++ < 8) {
    const moves = legalMoves4(s);
    if (!moves.length) break;
    let best = moves[0];
    let bestScore = -Infinity;
    for (const m of moves) {
      const v = nardiScore(s, m);
      if (v > bestScore) {
        bestScore = v;
        best = m;
      }
    }
    s = applyMove2(s, best);
  }
  return s;
}
function dominoBot(state) {
  let s = state;
  const seat = s.turn;
  let guard2 = 0;
  while (s.turn === seat && !isOver2(s) && guard2++ < 30) {
    const options = playable(s);
    if (options.length) {
      let best = options[0];
      let bestScore = -1;
      for (const o of options) {
        const [x, y] = s.hands[seat][o.i];
        const v = x + y + (x === y ? 4 : 0) + cryptoRand();
        if (v > bestScore) {
          bestScore = v;
          best = o;
        }
      }
      s = play2(s, best.i, best.side);
    } else if (canDraw(s)) s = drawTile(s);
    else s = pass(s);
  }
  return s;
}
function longScore(s, m) {
  const c = s.turn;
  const next = applySingle2(s, m);
  let score = cryptoRand() * 0.5 + m.die * 0.15;
  if (m.to === "off") return score + 6;
  const sign3 = c === "w" ? 1 : -1;
  const stack = next.points[m.to] * sign3;
  if (stack === 1) score += 1.2;
  if (stack > 4) score -= 0.4 * (stack - 4);
  if (m.from === (c === "w" ? 23 : 11)) score += s.turns[c] < 6 ? 2 : 0.8;
  const p = pos(c, m.to);
  if (p >= 12 && p < 18) score += 0.6;
  if (p >= 18) score += 0.4;
  return score;
}
function longnardiBot(state) {
  let s = state;
  const seat = s.turn;
  if (s.phase === "roll") s = applyRoll2(s, rollDice2(cryptoRand));
  let guard2 = 0;
  while (s.turn === seat && s.phase === "move" && guard2++ < 8) {
    const moves = legalMoves5(s);
    if (!moves.length) break;
    let best = moves[0];
    let bestScore = -Infinity;
    for (const m of moves) {
      const v = longScore(s, m);
      if (v > bestScore) {
        bestScore = v;
        best = m;
      }
    }
    s = applyMove3(s, best);
  }
  return s;
}
function durakBot(s) {
  const me = s.turn;
  const ts = s.trumpSuit;
  const cost = (c2) => rankOf(c2) + (suitOf(c2) === ts ? 20 : 0);
  const byCost = (a, b) => cost(a) - cost(b);
  if (me === s.attacker) {
    const opts = attackOptions(s).sort(byCost);
    if (!s.table.length) {
      const hand = s.hands[me];
      const paired = opts.filter((c2) => suitOf(c2) !== ts && hand.filter((x) => rankOf(x) === rankOf(c2)).length > 1);
      return attack(s, paired[0] && cost(paired[0]) <= cost(opts[0]) + 3 ? paired[0] : opts[0]);
    }
    const late = s.stock.length <= 2;
    const cand = opts.filter((c2) => (suitOf(c2) !== ts || late) && (rankOf(c2) <= 11 || late));
    if (cand.length) return attack(s, cand[0]);
    return done(s);
  }
  const open = s.table.findIndex((p) => !p.d);
  if (open < 0) return s;
  const target = s.table[open].a;
  const beaters = s.hands[me].filter((c2) => beats(c2, target, ts)).sort(byCost);
  if (!beaters.length) return take(s);
  const c = beaters[0];
  if (suitOf(c) === ts && suitOf(target) !== ts && rankOf(c) >= 12 && s.stock.length > 8 && rankOf(target) <= 10) return take(s);
  return defend(s, c, open);
}
function estimateTricks(hand, ts, n) {
  let e = 0;
  const count3 = (suit) => hand.filter((c) => !isJoker(c) && suitOf(c) === suit).length;
  for (const c of hand) {
    if (isJoker(c)) {
      e += 0.95;
      continue;
    }
    const r = rankOf(c);
    if (ts && suitOf(c) === ts) e += r === 14 ? 0.95 : r === 13 ? 0.8 : r === 12 ? 0.6 : r === 11 ? 0.45 : n >= 6 ? 0.3 : 0.15;
    else if (r === 14) e += n <= 3 ? 0.85 : 0.7;
    else if (r === 13 && count3(suitOf(c)) >= 2) e += n <= 4 ? 0.3 : 0.4;
  }
  return e;
}
function pickTrump(hand) {
  let best = null;
  let bestW = 0;
  for (const suit of SUITS) {
    const w = hand.filter((c) => !isJoker(c) && suitOf(c) === suit).reduce((n, c) => n + Math.max(1, rankOf(c) - 10), 0);
    if (w > bestW) {
      bestW = w;
      best = suit;
    }
  }
  return bestW >= 4 ? best : null;
}
function jokerBot(s, rand = cryptoRand) {
  const me = s.turn;
  if (s.phase === "trump") return chooseTrump(s, pickTrump(visibleHand(s, me)));
  if (s.phase === "bid") {
    const opts = bidOptions(s);
    const e = estimateTricks(s.hands[me], s.trumpSuit, s.n);
    let want = Math.max(0, Math.min(s.n, Math.round(e)));
    if (!opts.includes(want)) want = e < want ? want - 1 : want + 1;
    if (!opts.includes(want)) want = opts.reduce((a, b) => Math.abs(b - e) < Math.abs(a - e) ? b : a);
    return bid(s, want);
  }
  if (s.phase !== "play") return s;
  const ts = s.trumpSuit;
  const legal = legalCards(s, me);
  const need = s.bids[me] - s.taken[me];
  const wantWin = need > 0;
  const cost = (c) => isJoker(c) ? 100 : rankOf(c) + (suitOf(c) === ts ? 12 : 0);
  const asc = legal.slice().sort((a, b) => cost(a) - cost(b));
  const regular = asc.filter((c) => !isJoker(c));
  const jk = asc.find(isJoker);
  if (!s.trick.length) {
    if (wantWin) {
      const ace = regular.filter((c) => rankOf(c) === 14 && suitOf(c) !== ts)[0];
      if (ace) return play3(s, ace, {}, rand);
      const topTrump = regular.filter((c) => suitOf(c) === ts).pop();
      if (topTrump && rankOf(topTrump) >= 13) return play3(s, topTrump, {}, rand);
      if (jk) {
        const suit = ts || SUITS.find((x) => !s.hands[me].some((c) => suitOf(c) === x)) || "s";
        return play3(s, jk, { mode: "high", suit }, rand);
      }
      return play3(s, regular[regular.length - 1], {}, rand);
    }
    const low = regular.filter((c) => suitOf(c) !== ts)[0] || regular[0];
    if (low) return play3(s, low, {}, rand);
    return play3(s, jk, { mode: "low", suit: SUITS[Math.floor(rand() * 4)] }, rand);
  }
  const wins = (card, mode) => trickWinner([...s.trick, { seat: me, card, mode }], ts) === s.trick.length;
  if (wantWin) {
    const winner = regular.find((c) => wins(c));
    if (winner) return play3(s, winner, {}, rand);
    if (jk) return play3(s, jk, { mode: "high" }, rand);
    return play3(s, regular[0], {}, rand);
  }
  const losers = regular.filter((c) => !wins(c));
  if (losers.length) return play3(s, losers[losers.length - 1], {}, rand);
  if (jk) return play3(s, jk, { mode: "low" }, rand);
  return play3(s, regular[0], {}, rand);
}
function combos(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [x, ...rest] = arr;
  return [...combos(rest, k - 1).map((c) => [x, ...c]), ...combos(rest, k)];
}
function buraBot(s) {
  const ts = s.trumpSuit;
  const isT = (c) => suitOf(c) === ts;
  if (s.phase === "lead") {
    const hand = s.hands[s.leader];
    const max = maxLead(s);
    let best2 = null;
    let bestScore2 = -Infinity;
    for (let k = 1; k <= max; k++) {
      for (const c of combos(hand, k)) {
        if (!canLead(s, c)) continue;
        const safe = c.every((x) => isT(x) && rankOf(x) >= 13);
        const score = (safe ? sumPoints(c) : -sumPoints(c)) - c.filter(isT).length * (safe ? 0 : 7) + (k - 1) * 2 - c.reduce((n, x) => n + rankOf(x), 0) * 0.05;
        if (score > bestScore2) {
          bestScore2 = score;
          best2 = c;
        }
      }
    }
    return lead(s, best2);
  }
  const seat = otherSeat3(s.leader);
  const leadPts = sumPoints(s.lead);
  let best = null;
  let bestScore = -Infinity;
  for (const c of combos(s.hands[seat], s.lead.length)) {
    const own2 = sumPoints(c);
    const win = beatsAll(c, s.lead, ts);
    const trumps = c.filter(isT).length;
    const score = win ? leadPts + own2 - trumps * (leadPts >= 10 ? 3 : 8) : -(leadPts + own2) - trumps * 6;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return respond(s, best);
}
var BOTS = {
  chess: chessBot,
  chess960: chess960Bot,
  gomoku: gomokuBot,
  checkers: checkersBot,
  nardi: nardiBot,
  domino: dominoBot,
  longnardi: longnardiBot,
  durak: durakBot,
  joker: jokerBot,
  bura: buraBot,
  loto: (s) => s
};

// supabase/functions-src/game-core.js
var HttpError = class extends Error {
  constructor(status4, message) {
    super(message);
    this.status = status4;
  }
};
var TIME_CONTROLS = { "1+0": [1, 0], "3+0": [3, 0], "3+2": [3, 2], "5+0": [5, 0], "10+0": [10, 0] };
var CLOCK_GAMES = /* @__PURE__ */ new Set(["chess", "chess960", "checkers"]);
var ABORT_AFTER = 6e4;
var seatsIn = (g) => SEAT_LETTERS.slice(0, g.seats || 2);
var playerAt = (g, seat) => g[`player_${seat}`] ?? null;
var seatOfUser = (g, uid) => seatsIn(g).find((s) => playerAt(g, s) === uid && !(g.bots || []).includes(s)) || null;
var isBot = (g, seat) => (g.bots || []).includes(seat);
async function handle(body, { userId, db: db2, rand = cryptoRand, now = Date.now }) {
  if (!userId) throw new HttpError(401, "\u10E8\u10D4\u10E1\u10D5\u10DA\u10D0 \u10E1\u10D0\u10ED\u10D8\u10E0\u10DD\u10D0");
  const op = body?.op;
  const type = body?.type;
  if (["create", "random", "join", "start", "move"].includes(op) && !await db2.canAct(userId)) {
    throw new HttpError(403, "\u10D0\u10DC\u10D2\u10D0\u10E0\u10D8\u10E8\u10D8 \u10D3\u10E0\u10DD\u10D4\u10D1\u10D8\u10D7 \u10E8\u10D4\u10D6\u10E6\u10E3\u10D3\u10E3\u10DA\u10D8\u10D0");
  }
  async function saveHidden(id, g, full) {
    if (!HIDDEN.has(g.type)) return;
    await db2.setPrivate(id, full);
    const hands = handsOf(g.type, full);
    await db2.setHands(id, seatsIn(g).map((seat) => ({
      seat,
      user_id: isBot(g, seat) ? null : playerAt(g, seat),
      tiles: hands[seat]
    })));
  }
  function runBots(g, state) {
    let s = state;
    let guard2 = 0;
    while (!outcome(g.type, s).over && isBot(g, seatToMove(g.type, s)) && guard2++ < 400) {
      s = BOTS[g.type](s, rand);
    }
    return s;
  }
  async function create(t, opts = {}) {
    if (!GAMES[t]) throw new HttpError(400, "\u10E3\u10EA\u10DC\u10DD\u10D1\u10D8 \u10D7\u10D0\u10DB\u10D0\u10E8\u10D8");
    const seats = seatsOf(t);
    const invites = [.../* @__PURE__ */ new Set([...opts.invites || [], ...opts.invite ? [opts.invite] : []])].filter(Boolean);
    if (invites.includes(userId)) throw new HttpError(400, "\u10E1\u10D0\u10D9\u10E3\u10D7\u10D0\u10E0 \u10D7\u10D0\u10D5\u10E1 \u10D5\u10D4\u10E0 \u10DB\u10DD\u10D8\u10EC\u10D5\u10D4\u10D5");
    if (invites.length > seats - 1) throw new HttpError(400, `\u10DB\u10D0\u10E5\u10E1\u10D8\u10DB\u10E3\u10DB ${seats - 1} \u10DB\u10DD\u10EC\u10D5\u10D4\u10D5\u10D0`);
    let tc = null;
    if (opts.tc) {
      if (!TIME_CONTROLS[opts.tc] || !CLOCK_GAMES.has(t)) throw new HttpError(400, "\u10D0\u10E1\u10D4\u10D7\u10D8 \u10D3\u10E0\u10DD\u10D8\u10E1 \u10D9\u10DD\u10DC\u10E2\u10E0\u10DD\u10DA\u10D8 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1");
      tc = opts.tc;
    }
    const full = initFor(t, rand, { mode: opts.mode });
    const row = {
      type: t,
      state: publicState(t, full),
      player_a: userId,
      seats,
      invited: seats === 2 ? invites[0] || null : null,
      invites,
      is_public: opts.public ?? !invites.length,
      status: "waiting",
      options: opts.mode ? { mode: opts.mode } : {},
      tc,
      tournament_id: opts.tournament || null,
      clock: tc ? { a: TIME_CONTROLS[tc][0] * 6e4, b: TIME_CONTROLS[tc][0] * 6e4, inc: TIME_CONTROLS[tc][1] * 1e3, at: null } : null,
      bots: []
    };
    const id = await db2.insertGame(row);
    await saveHidden(id, { ...row, id }, full);
    for (const u of invites) await db2.notify({ user_id: u, actor_id: userId, type: "game_invite", game_id: id });
    return { id };
  }
  async function finish2(g, state, o) {
    if (g.seats > 2) {
      const scores = {};
      for (const seat of seatsIn(g)) {
        const uid = playerAt(g, seat);
        if (!uid) continue;
        scores[uid] = isBot(g, seat) ? -1e6 : state.scores?.[seat] ?? 0;
      }
      const winner2 = o.winner && !isBot(g, o.winner) ? playerAt(g, o.winner) : null;
      await db2.finishTable(g.id, winner2, o.result, scores);
      return;
    }
    const winner = o.winner === "a" ? g.player_a : o.winner === "b" ? g.player_b : null;
    await db2.finish(g.id, winner, o.result);
  }
  const load = async (id) => {
    const g = await db2.getGame(id);
    if (!g) throw new HttpError(404, "\u10D7\u10D0\u10DB\u10D0\u10E8\u10D8 \u10D5\u10D4\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0");
    g.seats = g.seats || 2;
    g.bots = g.bots || [];
    return g;
  };
  switch (op) {
    case "create":
      if (body.tournament) throw new HttpError(400, "\u10E2\u10E3\u10E0\u10DC\u10D8\u10E0\u10D8\u10E1 \u10D7\u10D0\u10DB\u10D0\u10E8\u10D8 \u10DB\u10EE\u10DD\u10DA\u10DD\u10D3 \u10E8\u10D4\u10DB\u10D7\u10EE\u10D5\u10D4\u10D5\u10D8\u10D7\u10D8 \u10DB\u10D4\u10E2\u10DD\u10E5\u10D8\u10D7");
      return create(type, { invite: body.invite, invites: body.invites, mode: body.mode, tc: body.tc, public: body.public });
    case "random": {
      if (!GAMES[type]) throw new HttpError(400, "\u10E3\u10EA\u10DC\u10DD\u10D1\u10D8 \u10D7\u10D0\u10DB\u10D0\u10E8\u10D8");
      if (seatsOf(type) > 2) {
        const id = await db2.takeAnySeat(userId, type);
        if (id) return { id };
        const mine = await db2.myWaiting(userId, type, null, null);
        if (mine) return { id: mine };
        return create(type, { mode: body.mode || "standard", public: true });
      }
      let tc = body.tc || null;
      let tournament = null;
      if (body.tournament) {
        const t = await db2.getTournament(body.tournament);
        if (!t) throw new HttpError(404, "\u10E2\u10E3\u10E0\u10DC\u10D8\u10E0\u10D8 \u10D5\u10D4\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0");
        if (t.type !== type) throw new HttpError(400, "\u10E1\u10EE\u10D5\u10D0 \u10D7\u10D0\u10DB\u10D0\u10E8\u10D8\u10E1 \u10E2\u10E3\u10E0\u10DC\u10D8\u10E0\u10D8\u10D0");
        const n = now();
        if (n < Date.parse(t.starts_at)) throw new HttpError(409, "\u10E2\u10E3\u10E0\u10DC\u10D8\u10E0\u10D8 \u10EF\u10D4\u10E0 \u10D0\u10E0 \u10D3\u10D0\u10EC\u10E7\u10D4\u10D1\u10E3\u10DA\u10D0");
        if (n >= Date.parse(t.ends_at)) throw new HttpError(409, "\u10E2\u10E3\u10E0\u10DC\u10D8\u10E0\u10D8 \u10D3\u10D0\u10E1\u10E0\u10E3\u10DA\u10D3\u10D0");
        if (!await db2.isTournamentPlayer(t.id, userId)) throw new HttpError(403, "\u10EF\u10D4\u10E0 \u10E8\u10D4\u10E3\u10D4\u10E0\u10D7\u10D3\u10D8 \u10E2\u10E3\u10E0\u10DC\u10D8\u10E0\u10E1");
        const active = await db2.myActiveInTournament(userId, t.id);
        if (active) return { id: active };
        tc = t.tc || null;
        tournament = t.id;
      }
      if (tc && !TIME_CONTROLS[tc]) throw new HttpError(400, "\u10D0\u10E1\u10D4\u10D7\u10D8 \u10D3\u10E0\u10DD\u10D8\u10E1 \u10D9\u10DD\u10DC\u10E2\u10E0\u10DD\u10DA\u10D8 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1");
      const claimed = await db2.claim(userId, type, tc, tournament);
      if (claimed) return { id: claimed };
      const waiting = await db2.myWaiting(userId, type, tc, tournament);
      if (waiting) return { id: waiting };
      return create(type, { tc, tournament, public: true });
    }
    case "join": {
      const g = await load(body.id);
      if (g.seats > 2) {
        await db2.takeSeat(userId, g.id);
        return { id: g.id };
      }
      await db2.join(userId, body.id);
      return { id: body.id };
    }
    // 4-ადგილიანი მაგიდა: შემქმნელი იწყებს, თავისუფალ ადგილებს კომპიუტერი იკავებს
    case "start": {
      const g = await load(body.id);
      if (g.seats <= 2) throw new HttpError(400, "\u10D4\u10E1 \u10D7\u10D0\u10DB\u10D0\u10E8\u10D8 \u10DD\u10E0 \u10DB\u10DD\u10D7\u10D0\u10DB\u10D0\u10E8\u10D4\u10D6\u10D4\u10D0");
      if (g.player_a !== userId) throw new HttpError(403, "\u10DB\u10D0\u10D2\u10D8\u10D3\u10D0\u10E1 \u10DB\u10EE\u10DD\u10DA\u10DD\u10D3 \u10E8\u10D4\u10DB\u10E5\u10DB\u10DC\u10D4\u10DA\u10D8 \u10D8\u10EC\u10E7\u10D4\u10D1\u10E1");
      if (g.status !== "waiting") throw new HttpError(409, "\u10D7\u10D0\u10DB\u10D0\u10E8\u10D8 \u10E3\u10D9\u10D5\u10D4 \u10D3\u10D0\u10EC\u10E7\u10D4\u10D1\u10E3\u10DA\u10D8\u10D0");
      const bots = seatsIn(g).filter((s) => !playerAt(g, s));
      const live = { ...g, bots };
      const full = HIDDEN.has(g.type) ? await db2.getPrivate(g.id) : g.state;
      const next = runBots(live, full);
      const patch = {
        status: "active",
        bots,
        state: publicState(g.type, next),
        move_no: g.move_no + 1,
        updated_at: new Date(now()).toISOString(),
        turn: playerAt(g, seatToMove(g.type, next))
      };
      const ok = await db2.updateGame(g.id, patch, g.move_no, "waiting");
      if (!ok) throw new HttpError(409, "\u10DB\u10D0\u10D2\u10D8\u10D3\u10D0 \u10D2\u10D0\u10DC\u10D0\u10EE\u10DA\u10D3\u10D0 \u2014 \u10E1\u10EA\u10D0\u10D3\u10D4 \u10EE\u10D4\u10DA\u10D0\u10EE\u10DA\u10D0");
      await saveHidden(g.id, live, next);
      return { move_no: patch.move_no };
    }
    case "move": {
      const g = await load(body.id);
      if (g.status !== "active") throw new HttpError(409, "\u10D7\u10D0\u10DB\u10D0\u10E8\u10D8 \u10D0\u10E5\u10E2\u10D8\u10E3\u10E0\u10D8 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1");
      const seat = seatOfUser(g, userId);
      if (!seat) throw new HttpError(403, "\u10D0\u10DB \u10D7\u10D0\u10DB\u10D0\u10E8\u10D8\u10E1 \u10DB\u10DD\u10DC\u10D0\u10EC\u10D8\u10DA\u10D4 \u10D0\u10E0 \u10EE\u10D0\u10E0");
      if (typeof body.move_no === "number" && body.move_no !== g.move_no) throw new HttpError(409, "\u10D3\u10D0\u10E4\u10D0 \u10D2\u10D0\u10DC\u10D0\u10EE\u10DA\u10D3\u10D0 \u2014 \u10E1\u10EA\u10D0\u10D3\u10D4 \u10EE\u10D4\u10DA\u10D0\u10EE\u10DA\u10D0");
      const full = HIDDEN.has(g.type) ? await db2.getPrivate(g.id) : g.state;
      if (!full) throw new HttpError(500, "\u10D7\u10D0\u10DB\u10D0\u10E8\u10D8\u10E1 \u10DB\u10D3\u10D2\u10DD\u10DB\u10D0\u10E0\u10D4\u10DD\u10D1\u10D0 \u10D5\u10D4\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0");
      if (seatToMove(g.type, full) !== seat) throw new HttpError(409, "\u10E8\u10D4\u10DC\u10D8 \u10E0\u10D8\u10D2\u10D8 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1");
      let clock = g.clock ? { ...g.clock } : null;
      if (clock) {
        const t = now();
        if (clock.at != null) {
          const left = clock[seat] - (t - clock.at);
          if (left <= 0) {
            await finishOnTime(g, seat);
            return { over: true, timeout: true };
          }
          clock[seat] = left + clock.inc;
        }
        clock.at = t;
      }
      let next;
      try {
        next = applyAction(g.type, full, body.action, rand);
      } catch (e) {
        if (e instanceof IllegalMove) throw new HttpError(400, e.message);
        throw e;
      }
      next = runBots(g, next);
      const o = outcome(g.type, next);
      const patch = { state: publicState(g.type, next), move_no: g.move_no + 1, updated_at: new Date(now()).toISOString() };
      if (clock) patch.clock = clock;
      if (!o.over) patch.turn = playerAt(g, seatToMove(g.type, next));
      const ok = await db2.updateGame(g.id, patch, g.move_no);
      if (!ok) throw new HttpError(409, "\u10D3\u10D0\u10E4\u10D0 \u10D2\u10D0\u10DC\u10D0\u10EE\u10DA\u10D3\u10D0 \u2014 \u10E1\u10EA\u10D0\u10D3\u10D4 \u10EE\u10D4\u10DA\u10D0\u10EE\u10DA\u10D0");
      await saveHidden(g.id, g, next);
      if (o.over) await finish2(g, next, o);
      return { move_no: patch.move_no, state: patch.state, over: o.over };
    }
    // ლოტო: კასრს იღებს ნებისმიერი მონაწილის მოთხოვნა, ოღონდ მხოლოდ დროზე და მხოლოდ ერთხელ (move_no)
    case "tick": {
      const g = await load(body.id);
      if (g.type !== "loto" || g.status !== "active") return { ok: false };
      if (!seatOfUser(g, userId)) throw new HttpError(403, "\u10D0\u10DB \u10D7\u10D0\u10DB\u10D0\u10E8\u10D8\u10E1 \u10DB\u10DD\u10DC\u10D0\u10EC\u10D8\u10DA\u10D4 \u10D0\u10E0 \u10EE\u10D0\u10E0");
      const t = now();
      if (!loto_exports.due(g.state, t)) return { ok: false, wait: g.state.next_at - t };
      const next = loto_exports.draw(g.state, t);
      const o = outcome(g.type, next);
      const patch = { state: next, move_no: g.move_no + 1, updated_at: new Date(t).toISOString() };
      if (!await db2.updateGame(g.id, patch, g.move_no)) return { ok: false };
      if (o.over) await finish2(g, next, o);
      return { ok: true, move_no: patch.move_no, over: o.over };
    }
    case "flag": {
      const g = await load(body.id);
      if (g.status !== "active" || !g.clock) return { ok: false };
      if (!seatOfUser(g, userId)) throw new HttpError(403, "\u10D0\u10DB \u10D7\u10D0\u10DB\u10D0\u10E8\u10D8\u10E1 \u10DB\u10DD\u10DC\u10D0\u10EC\u10D8\u10DA\u10D4 \u10D0\u10E0 \u10EE\u10D0\u10E0");
      const t = now();
      if (g.clock.at == null) {
        if (t - Date.parse(g.updated_at) < ABORT_AFTER) throw new HttpError(409, "\u10DE\u10D8\u10E0\u10D5\u10D4\u10DA\u10D8 \u10E1\u10D5\u10DA\u10D8\u10E1 \u10D3\u10E0\u10DD \u10EF\u10D4\u10E0 \u10D0\u10E0 \u10D0\u10DB\u10DD\u10EC\u10E3\u10E0\u10E3\u10DA\u10D0");
        await db2.finish(g.id, null, "abort");
        return { ok: true, aborted: true };
      }
      const seat = seatToMove(g.type, g.state);
      if (g.clock[seat] - (t - g.clock.at) > 0) throw new HttpError(409, "\u10D3\u10E0\u10DD \u10EF\u10D4\u10E0 \u10D0\u10E0 \u10D0\u10DB\u10DD\u10EC\u10E3\u10E0\u10E3\u10DA\u10D0");
      await finishOnTime(g, seat);
      return { ok: true };
    }
    case "resign": {
      const g = await load(body.id);
      if (g.status === "waiting") {
        if (g.player_a === userId) {
          await db2.finish(g.id, null, "cancel");
          return { ok: true };
        }
        if (g.seats > 2 && seatOfUser(g, userId)) {
          await db2.leaveSeat(userId, g.id);
          return { ok: true };
        }
        throw new HttpError(403, "\u10DB\u10EE\u10DD\u10DA\u10DD\u10D3 \u10E8\u10D4\u10DB\u10E5\u10DB\u10DC\u10D4\u10DA\u10E1 \u10E8\u10D4\u10E3\u10EB\u10DA\u10D8\u10D0 \u10D2\u10D0\u10E3\u10E5\u10DB\u10D4\u10D1\u10D0");
      }
      if (g.status !== "active") return { ok: true };
      const seat = seatOfUser(g, userId);
      if (!seat) throw new HttpError(403, "\u10D0\u10DB \u10D7\u10D0\u10DB\u10D0\u10E8\u10D8\u10E1 \u10DB\u10DD\u10DC\u10D0\u10EC\u10D8\u10DA\u10D4 \u10D0\u10E0 \u10EE\u10D0\u10E0");
      if (g.seats > 2) {
        const live = { ...g, bots: [...g.bots, seat] };
        const humansLeft = seatsIn(g).filter((s) => !isBot(live, s));
        const full = HIDDEN.has(g.type) ? await db2.getPrivate(g.id) : g.state;
        if (!humansLeft.length) {
          await finish2(live, full, { winner: null, result: "resign" });
          return { ok: true };
        }
        const next = runBots(live, full);
        const o = outcome(g.type, next);
        const patch = { bots: live.bots, state: publicState(g.type, next), move_no: g.move_no + 1, updated_at: new Date(now()).toISOString() };
        if (!o.over) patch.turn = playerAt(g, seatToMove(g.type, next));
        const ok = await db2.updateGame(g.id, patch, g.move_no);
        if (!ok) throw new HttpError(409, "\u10DB\u10D0\u10D2\u10D8\u10D3\u10D0 \u10D2\u10D0\u10DC\u10D0\u10EE\u10DA\u10D3\u10D0 \u2014 \u10E1\u10EA\u10D0\u10D3\u10D4 \u10EE\u10D4\u10DA\u10D0\u10EE\u10DA\u10D0");
        await saveHidden(g.id, live, next);
        if (o.over) await finish2(live, next, o);
        return { ok: true };
      }
      await db2.finish(g.id, userId === g.player_a ? g.player_b : g.player_a, "resign");
      return { ok: true };
    }
    default:
      throw new HttpError(400, "\u10E3\u10EA\u10DC\u10DD\u10D1\u10D8 \u10DD\u10DE\u10D4\u10E0\u10D0\u10EA\u10D8\u10D0");
  }
  async function finishOnTime(g, loserSeat) {
    const winSeat = loserSeat === "a" ? "b" : "a";
    if (g.type === "chess" || g.type === "chess960") {
      const color = winSeat === "a" ? "w" : "b";
      const pieces = chess_exports.fromFEN(g.state.fen).board.filter((p) => p && chess_exports.colorOf(p) === color);
      if (pieces.length === 1) {
        await db2.finish(g.id, null, "timeout");
        return;
      }
    }
    await db2.finish(g.id, playerAt(g, winSeat), "timeout");
  }
}

// supabase/functions-src/game.ts
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var json = (data, status4 = 200) => new Response(JSON.stringify(data), { status: status4, headers: { ...cors, "Content-Type": "application/json" } });
function serviceKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const k = keys.default ?? Object.values(keys)[0];
    if (typeof k === "string" && k) return k;
  } catch {
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}
var admin = createClient(Deno.env.get("SUPABASE_URL"), serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false }
});
var must = ({ data, error }) => {
  if (error) throw new HttpError(error.code === "P0001" ? 409 : 500, error.message);
  return data;
};
var db = {
  async canAct(userId) {
    const p = must(await admin.from("profiles").select("banned_until").eq("id", userId).maybeSingle());
    return !p?.banned_until || new Date(p.banned_until) < /* @__PURE__ */ new Date();
  },
  async getGame(id) {
    return must(await admin.from("games").select("*").eq("id", id).maybeSingle());
  },
  async getPrivate(id) {
    const row = must(await admin.from("game_private").select("state").eq("game_id", id).maybeSingle());
    return row?.state ?? null;
  },
  async insertGame(row) {
    return must(await admin.from("games").insert(row).select("id").single()).id;
  },
  async updateGame(id, patch, expectMoveNo, expectStatus = "active") {
    const rows = must(await admin.from("games").update(patch).eq("id", id).eq("move_no", expectMoveNo).eq("status", expectStatus).select("id"));
    return rows.length === 1;
  },
  async setPrivate(id, state) {
    must(await admin.from("game_private").upsert({ game_id: id, state }));
  },
  async setHands(id, rows) {
    must(await admin.from("game_hands").upsert(rows.map((r) => ({ game_id: id, ...r }))));
  },
  async claim(userId, type, tc, tournament) {
    return must(await admin.rpc("svc_claim_game", { p_user: userId, p_type: type, p_tc: tc, p_tournament: tournament }));
  },
  async myWaiting(userId, type, tc, tournament) {
    let q = admin.from("games").select("id").eq("type", type).eq("status", "waiting").eq("is_public", true).eq("player_a", userId);
    q = tc ? q.eq("tc", tc) : q.is("tc", null);
    q = tournament ? q.eq("tournament_id", tournament) : q.is("tournament_id", null);
    const row = must(await q.limit(1).maybeSingle());
    return row?.id ?? null;
  },
  async takeSeat(userId, id) {
    return must(await admin.rpc("svc_take_seat", { p_user: userId, p_id: id }));
  },
  async takeAnySeat(userId, type) {
    return must(await admin.rpc("svc_take_any_seat", { p_user: userId, p_type: type }));
  },
  async leaveSeat(userId, id) {
    must(await admin.rpc("svc_leave_seat", { p_user: userId, p_id: id }));
  },
  async finishTable(id, winner, result, scores) {
    must(await admin.rpc("svc_finish_table", { p_id: id, p_winner: winner, p_result: result, p_scores: scores }));
  },
  async getTournament(id) {
    return must(await admin.from("tournaments").select("id, type, tc, starts_at, ends_at").eq("id", id).maybeSingle());
  },
  async isTournamentPlayer(tournamentId, userId) {
    const row = must(await admin.from("tournament_players").select("user_id").eq("tournament_id", tournamentId).eq("user_id", userId).maybeSingle());
    return Boolean(row);
  },
  async myActiveInTournament(userId, tournamentId) {
    const row = must(await admin.from("games").select("id").eq("tournament_id", tournamentId).eq("status", "active").or(`player_a.eq.${userId},player_b.eq.${userId}`).limit(1).maybeSingle());
    return row?.id ?? null;
  },
  async join(userId, id) {
    must(await admin.rpc("svc_join_game", { p_user: userId, p_id: id }));
  },
  async finish(id, winner, result) {
    must(await admin.rpc("svc_finish", { p_id: id, p_winner: winner, p_result: result }));
  },
  async notify(row) {
    must(await admin.from("notifications").insert(row));
  }
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data?.user) throw new HttpError(401, "\u10E8\u10D4\u10E1\u10D5\u10DA\u10D0 \u10E1\u10D0\u10ED\u10D8\u10E0\u10DD\u10D0");
    const body = await req.json();
    return json(await handle(body, { userId: data.user.id, db }));
  } catch (e) {
    const status4 = e.status ?? 500;
    if (status4 === 500) console.error(e);
    return json({ error: e.message }, status4);
  }
});
