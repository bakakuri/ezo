import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar, Loader, Sheet, TopBar, Empty } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import ChessBoard from '../components/games/ChessBoard.jsx'
import CheckersBoard from '../components/games/CheckersBoard.jsx'
import NardiBoard from '../components/games/NardiBoard.jsx'
import DominoTable from '../components/games/DominoTable.jsx'
import GomokuBoard from '../components/games/GomokuBoard.jsx'
import DurakTable from '../components/games/DurakTable.jsx'
import JokerTable from '../components/games/JokerTable.jsx'
import BuraTable from '../components/games/BuraTable.jsx'
import LotoTable from '../components/games/LotoTable.jsx'
import { GameSocial } from '../components/games/GameSocial.jsx'
import { GAMES, outcome, RESULT_TEXT, cryptoRand, seatsOf, SEAT_LETTERS, loto } from '../games/index.js'
import { BOTS } from '../games/bots.js'
import { REPLAYABLE } from '../games/hidden.js'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Link, navigate } from '../lib/router.jsx'
import { useToast } from '../components/Toast.jsx'

export const BOARDS = {
  chess: ChessBoard, chess960: (p) => <ChessBoard {...p} variant="960" />, gomoku: GomokuBoard,
  checkers: CheckersBoard, nardi: NardiBoard, domino: DominoTable,
  longnardi: (p) => <NardiBoard {...p} variant="long" />, durak: DurakTable, joker: JokerTable,
  bura: BuraTable, loto: LotoTable,
}
const CARD_GAMES = new Set(['durak', 'bura'])
const modeOf = (type, m) => (GAMES[type].modes?.[m] ? m : GAMES[type].defaultMode)
const BOT = { id: 'bot', full_name: 'კომპიუტერი', username: 'bot' }
const BOT_NAMES = { b: 'ლევანი', c: 'თამარი', d: 'გიო' }
const botFor = (seat) => ({ id: `bot-${seat}`, full_name: BOT_NAMES[seat] || 'კომპიუტერი', username: 'bot' })
// სერვერზე დამალული ინფორმაციის თამაშებში (დასტა, დარიგება) სვლას წინასწარ არ ვაჩვენებთ
const NO_PREVIEW = new Set(['durak', 'joker', 'bura'])

function statusFor(type, state, { mySeat, names, seatToMove, over }) {
  if (over || type === 'loto') return null
  const mine = mySeat === seatToMove
  const who = names[seatToMove]
  if ((type === 'chess' || type === 'chess960') && outcome(type, state).check) return { alert: true, text: mine ? 'შახი! დაიცავი მეფე' : `შახი გამოუცხადე ${who}-ს` }
  if (type === 'nardi' || type === 'longnardi') {
    if (state.noMoves && state.passedBy) {
      const passer = names[state.passedBy === 'w' ? 'a' : 'b']
      return { text: `${passer}: ${state.rolled.join('–')} — სვლა არ იყო` }
    }
    if (state.phase === 'roll') return { text: mine ? 'გააგორე კამათელი' : `${who} აგორებს…` }
    return { text: mine ? `შენი სვლა — დარჩა ${state.dice.length}` : `${who} დადის…` }
  }
  if (type === 'domino') {
    if (state.last?.passed) return { text: `${names[state.last.seat]}-მა გაატარა` }
    if (state.last?.drew && state.last.seat === seatToMove) return { text: mine ? 'აიღე ბაზრიდან — სცადე ისევ' : `${who} ბაზრიდან იღებს…` }
  }
  if (type === 'durak') {
    if (seatToMove === state.attacker) {
      if (state.phase === 'take') return { text: mine ? 'მოწინააღმდეგე იღებს — შეგიძლია ჩაუმატო' : `${who} გიმატებს…` }
      if (state.table.length) return { text: mine ? 'ჩაუმატე ან თქვი „ბიტა“' : `${who}: ჩამატება თუ ბიტა?` }
      return { text: mine ? 'შენი შეტევაა' : `${who} უტევს…` }
    }
    return { text: mine ? 'მოიგერიე ან აიღე' : `${who} იგერიებს…` }
  }
  if (type === 'bura') {
    if (state.phase === 'respond') return { text: mine ? `უპასუხე ${state.lead.length} კარტით` : `${who} პასუხობს…` }
    return { text: mine ? 'შენი სვლაა' : `${who} ფიქრობს…` }
  }
  if (type === 'joker') {
    if (state.phase === 'trump') return { text: mine ? 'აირჩიე კოზირი' : `${who} ირჩევს კოზირს…` }
    if (state.phase === 'bid') return { text: mine ? 'შენი შეკვეთაა' : `${who} აცხადებს…` }
    return { text: mine ? 'შენი სვლაა' : `${who} ფიქრობს…` }
  }
  return { text: mine ? 'შენი სვლა' : `${who} ფიქრობს…` }
}

// ---- საათი (ბლიცი)
const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
function Clock({ ms, running }) {
  const low = ms < 20_000
  const sec = Math.max(0, ms) / 1000
  const text = ms < 10_000 ? `0:0${sec.toFixed(1)}` : fmtClock(ms)
  return <span className={`clock${running ? ' run' : ''}${low ? ' low' : ''}`} role="timer" aria-label="დარჩენილი დრო">{text}</span>
}

function useClockNow(active) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [active])
  return now
}

function GameFrame({ type, players, mySeat, seatToMove, state, board, status, onResign, result, onAgain, againText, extra, clocks, banner, replayTo }) {
  // ხუთ რიგში შავები იწყებენ: a — შავი
  const light = (seat) => (type === 'gomoku' ? seat === 'b' : seat === 'a')
  const colorDot = (seat) => (['domino', 'durak', 'bura'].includes(type) ? null : <span className={`seat-dot ${light(seat) ? 'w' : 'b'}`} />)
  const top = mySeat === 'b' ? 'a' : 'b'
  const bottom = top === 'a' ? 'b' : 'a'
  const sub = (seat) => {
    if (type === 'domino') return `${state.hands[seat].length} ქვა`
    if (type === 'durak') return `${state.hands[seat].length} კარტი${state.attacker === seat ? ', უტევს' : ''}`
    if (type === 'bura') return `${state.points[seat]} ქულა`
    if (type === 'checkers') return `${state.board.filter((p) => p && p.toLowerCase() === (seat === 'a' ? 'w' : 'b')).length} ქვა`
    return light(seat) ? 'თეთრი' : 'შავი'
  }
  const P = ({ seat, right }) => (
    <div className={`player${seatToMove === seat && !result ? ' turn' : ''}${right ? ' right' : ''}`}>
      <Avatar user={players[seat]} size={36} />
      <div className="nm"><b>{players[seat]?.full_name || players[seat]?.username || '…'}</b><small>{colorDot(seat)}{sub(seat)}</small></div>
      {clocks && <Clock ms={clocks[seat].ms} running={clocks[seat].running} />}
    </div>
  )
  return (
    <div className={`game-room g-${type}${clocks ? ' clocked' : ''}`}>
      <TopBar title={GAMES[type].title} backTo="/games">
        {onResign && !result && <button className="btn btn-ghost sm" onClick={onResign}><Icon name="flag" size={16} />{seatsOf(type) > 2 ? 'დატოვება' : 'დანებება'}</button>}
        {replayTo && <Link className="btn btn-ghost sm" to={replayTo}><Icon name="play" size={16} />ჩანაწერი</Link>}
      </TopBar>
      {banner}
      {seatsOf(type) === 2 && !clocks && <div className="players"><P seat={top} /><span className="vs">vs</span><P seat={bottom} right /></div>}
      <div className="board-wrap">
        <div className="board-col">
          {clocks && <div className="players-v"><P seat={top} /></div>}
          <div className={`game-status${status?.alert ? ' alert' : ''}`} aria-live="polite">{status && <b>{status.text}</b>}</div>
          {board}
          {clocks && <div className="players-v"><P seat={bottom} /></div>}
        </div>
      </div>
      {extra}
      {result && (
        <Sheet onClose={result.onClose}>
          <div className="result-card">
            <h2>{result.title}</h2>
            <p className="rs">{result.reason}</p>
            {result.table && (
              <ol className="final-scores">
                {result.table.map((r) => <li key={r.seat} className={r.me ? 'me' : ''}><Avatar user={r.p} size={28} /><span>{r.name}</span><b>{r.score}</b></li>)}
              </ol>
            )}
            <div className="hstack" style={{ marginTop: 8 }}>
              <button className="btn btn-accent lg" onClick={onAgain}>{againText || 'ახალი თამაში'}</button>
              {result.link ? <Link className="btn btn-outline lg" to={result.link.to}>{result.link.text}</Link>
                : <button className="btn btn-outline lg" onClick={() => navigate('/games')}>თამაშები</button>}
            </div>
            {replayTo && <Link className="btn btn-ghost rp-open" to={replayTo}><Icon name="play" size={16} />პარტიის ჩანაწერი</Link>}
          </div>
        </Sheet>
      )}
    </div>
  )
}

function resultFor(type, o, mySeat, names, resultKey, state, players) {
  const key = resultKey || o.result
  const lost = mySeat && o.winner && o.winner !== mySeat
  const reason = key === 'resign' && lost ? 'დანებდი'
    : key === 'timeout' ? (lost ? 'დრო ამოგეწურა' : o.winner ? 'მოწინააღმდეგეს დრო ამოეწურა' : 'დრო ამოიწურა, მატისთვის ფიგურები არ კმარა')
      : RESULT_TEXT[key] || ''
  let table = null
  if ((type === 'joker' || type === 'loto') && state?.scores) {
    table = Object.keys(state.scores).map((s) => ({ seat: s, score: type === 'loto' ? Math.min(15, state.scores[s] % 100) + '/15' : state.scores[s], raw: state.scores[s], name: names[s], p: players[s], me: s === mySeat }))
      .sort((x, y) => y.raw - x.raw)
  }
  if (type === 'bura' && state?.points) {
    const pts = `${state.points.a}:${state.points.b}`
    if (!o.winner) return { title: 'ფრე', reason: `${reason}, ${pts}` }
    const mine = o.winner === mySeat
    return { title: state.bura ? (mine ? 'ბურა! მოიგე' : 'ბურა — წააგე') : !mySeat ? `${names[o.winner]} მოიგო` : mine ? 'მოიგე!' : 'წააგე', reason: state.bura ? reason : `ქულები ${pts}` }
  }
  if (type === 'loto' && o.winner && mySeat) return o.winner === mySeat ? { title: 'ლოტო! მოიგე', reason, table } : { title: `${names[o.winner]} მოიგო`, reason, table }
  if (!o.winner) return { title: 'ფრე', reason, table }
  if (!mySeat) return { title: `${names[o.winner]} მოიგო`, reason, table }
  if (type === 'durak') return o.winner === mySeat ? { title: 'მოიგე!', reason } : { title: 'დურაკი დარჩი', reason: 'ხელში კარტები შეგრჩა' }
  return o.winner === mySeat ? { title: 'მოიგე!', reason, table } : { title: type === 'joker' ? `${names[o.winner]} მოიგო` : 'წააგე', reason, table }
}

// ---- კომპიუტერთან ან ერთ ტელეფონზე
export function LocalGame({ type, mode, opts = {} }) {
  const { me } = useAuth()
  const init = () => GAMES[type].init(cryptoRand, opts)
  const [state, setState] = useState(init)
  const [handoff, setHandoff] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const o = outcome(type, state)
  const seatToMove = GAMES[type].seatOf(state)
  const seats = SEAT_LETTERS.slice(0, seatsOf(type))
  const botSeats = mode === 'bot' ? seats.slice(1) : []

  // ლოტო: კასრებს თავად ვიღებთ დროზე
  useEffect(() => {
    if (type !== 'loto' || o.over) return
    const wait = state.next_at === null ? 300 : Math.max(0, state.next_at - Date.now())
    const t = setTimeout(() => setState((s) => (loto.due(s, Date.now()) ? loto.draw(s, Date.now()) : s)), wait)
    return () => clearTimeout(t)
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (o.over || !botSeats.includes(seatToMove)) return
    const delay = type === 'nardi' || type === 'longnardi' ? 900 : type === 'joker' ? (state.trick?.length === 0 && state.phase === 'play' ? 1100 : 700) : 650
    const t = setTimeout(() => setState((s) => BOTS[type](s, cryptoRand)), delay)
    return () => clearTimeout(t)
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  const players = mode === 'bot'
    ? Object.fromEntries(seats.map((s, i) => [s, i === 0 ? me : seats.length > 2 ? botFor(s) : BOT]))
    : { a: { id: 'p1', full_name: 'მოთამაშე 1' }, b: { id: 'p2', full_name: 'მოთამაშე 2' } }
  const names = Object.fromEntries(seats.map((s, i) => [s, i === 0 && mode === 'bot' ? 'შენ' : players[s].full_name]))
  const mySeat = mode === 'bot' ? 'a' : seatToMove
  const canMove = !o.over && !botSeats.includes(seatToMove) && !handoff
  const hiddenLocal = mode === 'local' && GAMES[type].hidden
  const onMove = (_action, compute) => {
    let ns
    try { ns = compute() } catch { return }
    setState(ns)
    if (hiddenLocal && GAMES[type].seatOf(ns) !== seatToMove && !outcome(type, ns).over) setHandoff(true)
  }
  const Board = BOARDS[type]
  const viewSeat = hiddenLocal ? seatToMove : 'a'
  return (
    <GameFrame
      type={type} players={players} mySeat="a" seatToMove={seatToMove} state={state}
      status={statusFor(type, state, { mySeat, names, seatToMove, over: o.over })}
      board={
        <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
          <Board state={state} orientation="a" seat={viewSeat} canMove={canMove} onMove={onMove} players={players} />
          {handoff && (
            <div className="handoff">
              <h3>გადაეცი ტელეფონი</h3>
              <p>{names[seatToMove]}, შენი რიგია. {CARD_GAMES.has(type) ? 'კარტები' : 'ქვები'} დამალულია, რომ მეტოქემ ვერ დაინახოს.</p>
              <button className="btn btn-accent lg" onClick={() => setHandoff(false)}>{CARD_GAMES.has(type) ? 'ჩემი კარტების ჩვენება' : 'ჩემი ქვების ჩვენება'}</button>
            </div>
          )}
        </div>
      }
      result={o.over && !dismissed ? { ...resultFor(type, o, mode === 'bot' ? 'a' : null, names, null, state, players), onClose: () => setDismissed(true) } : null}
      onAgain={() => { setState(init()); setDismissed(false); setHandoff(false) }}
    />
  )
}

// ---- ჯოკერის მაგიდა: მოლოდინის ოთახი
function TableLobby({ g, me, onChange }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const seated = SEAT_LETTERS.slice(0, g.seats).filter((s) => g[`player_${s}`] === me?.id)[0]
  const isOwner = g.player_a === me?.id
  const invitedMe = (g.invites || []).includes(me?.id)
  const run = async (fn) => {
    setBusy(true)
    try { await fn(); onChange() } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const mode = GAMES[g.type].modes?.[modeOf(g.type, g.options?.mode || g.state?.mode)] || { title: '' }
  const empty = SEAT_LETTERS.slice(0, g.seats).filter((s) => !g[`player_${s}`]).length
  return (
    <div className="table-lobby">
      <div className="lobby-felt">
        <h3>{GAMES[g.type].title}: {mode.title}</h3>
        <p className="small">{g.is_public ? 'ღია მაგიდა — ნებისმიერს შეუძლია დაჯდეს' : 'მაგიდა მოწვეულებისთვის'}</p>
        <div className="lobby-seats">
          {SEAT_LETTERS.slice(0, g.seats).map((s) => {
            const p = g[s]
            return (
              <div key={s} className={`lobby-seat${p ? ' taken' : ''}`}>
                {p ? <Avatar user={p} size={52} /> : <span className="free"><Icon name="plus" size={20} /></span>}
                <b>{p ? (p.id === me?.id ? 'შენ' : (p.full_name || p.username).split(' ')[0]) : 'თავისუფალი'}</b>
                {s === 'a' && <small>მასპინძელი</small>}
              </div>
            )
          })}
        </div>
      </div>
      <div className="lobby-actions">
        {g.status === 'cancelled' ? <p className="muted">მაგიდა დაიშალა.</p> : isOwner ? (
          <>
            <button className="btn btn-accent lg block" disabled={busy} onClick={() => run(() => api.startTable(g.id))}>
              {empty ? `დაწყება — ${empty} ბოტით` : 'დაწყება'}
            </button>
            <button className="btn btn-ghost block" disabled={busy} onClick={() => run(async () => { await api.resign(g.id); navigate('/games', { replace: true }) })}>მაგიდის დაშლა</button>
          </>
        ) : seated ? (
          <>
            <p className="muted small">ველოდებით, რომ {(g.a?.full_name || '').split(' ')[0]} თამაშს დაიწყებს.</p>
            <button className="btn btn-outline block" disabled={busy} onClick={() => run(() => api.resign(g.id))}>ადგილის დატოვება</button>
          </>
        ) : (g.is_public || invitedMe) && empty ? (
          <button className="btn btn-accent lg block" disabled={busy} onClick={() => run(() => api.joinGame(g.id))}>დაჯდომა</button>
        ) : (
          <p className="muted">მაგიდასთან ადგილი აღარ არის.</p>
        )}
      </div>
    </div>
  )
}

// ---- ონლაინ
export function OnlineGame({ id }) {
  const { me } = useAuth()
  const toast = useToast()
  const [g, setG] = useState(undefined)
  const [pending, setPending] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [tour, setTour] = useState(null)
  const flagged = useRef(-1)
  const load = useCallback(() => api.game(id).then(setG).catch(() => setG(null)), [id])

  useEffect(() => {
    load()
    return api.subscribeGame(id, load)
  }, [id, load])
  useEffect(() => {
    if (g?.tournament_id && tour?.id !== g.tournament_id) api.tournament(g.tournament_id).then(setTour).catch(() => {})
  }, [g?.tournament_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const clockOn = Boolean(g?.clock && g.status === 'active')
  const now = useClockNow(clockOn)

  // ლოტო: როცა კასრის დრო მოვა, სერვერს ვთხოვთ შემდეგს (თვითონ ამოწმებს დროს და იღებს მხოლოდ ერთხელ)
  const lotoOn = g?.type === 'loto' && g.status === 'active'
  const lotoNow = useClockNow(lotoOn)
  const ticked = useRef(-1)
  useEffect(() => {
    if (!lotoOn) return
    const seated = SEAT_LETTERS.slice(0, g.seats || 2).some((s) => g[`player_${s}`] === me?.id && !(g.bots || []).includes(s))
    if (!seated || !loto.due(g.state, lotoNow) || ticked.current === g.move_no) return
    ticked.current = g.move_no
    api.tick(id).then((r) => {
      if (!r?.ok) setTimeout(() => { ticked.current = -1 }, Math.max(300, r?.wait || 700))
      load()
    }).catch(() => { setTimeout(() => { ticked.current = -1 }, 1500) })
  }, [lotoNow, lotoOn]) // eslint-disable-line react-hooks/exhaustive-deps

  // საათი: დრო რომ ამოიწურება, სერვერს ვატყობინებთ (სერვერი თვითონ ამოწმებს)
  useEffect(() => {
    if (!clockOn) return
    const c = g.clock
    const side = GAMES[g.type].seatOf(g.state)
    const expired = c.at == null ? now - Date.parse(g.updated_at) > 61_000 : c[side] - (now - c.at) <= 0
    if (expired && flagged.current !== g.move_no) {
      flagged.current = g.move_no
      api.flag(id).then(load).catch(() => {})
    }
  }, [now, clockOn]) // eslint-disable-line react-hooks/exhaustive-deps

  if (g === undefined) return <><TopBar title="თამაში" backTo="/games" /><Loader /></>
  if (g === null) return <><TopBar title="თამაში" backTo="/games" /><Empty icon="dice" title="თამაში ვერ მოიძებნა" /></>

  const type = g.type
  const seats = SEAT_LETTERS.slice(0, g.seats || 2)
  const bots = g.bots || []
  const mySeat = seats.find((s) => g[`player_${s}`] === me?.id && !bots.includes(s)) || null
  const players = Object.fromEntries(seats.map((s) => [s, bots.includes(s) && !g[s] ? botFor(s) : g[s]]))
  const names = Object.fromEntries(seats.map((s) => [s, s === mySeat ? 'შენ' : (players[s]?.full_name || (seats.length > 2 ? 'მოთამაშე' : 'მოწინააღმდეგე'))]))
  const tourBanner = g.tournament_id ? (
    <Link to={`/t/${g.tournament_id}`} className="tour-banner"><Icon name="trophy" size={16} />{tour?.title || 'ტურნირი'}<span className="grow" /><span className="small">ცხრილი</span></Link>
  ) : null

  if ((g.status === 'waiting' || g.status === 'cancelled') && seatsOf(type) > 2) {
    return (
      <>
        <TopBar title={GAMES[type].title} backTo="/games" />
        <TableLobby g={g} me={me} onChange={load} />
      </>
    )
  }

  if (g.status === 'waiting' || g.status === 'cancelled') {
    const invitedMe = g.invited === me?.id
    return (
      <>
        <TopBar title={GAMES[type].title} backTo="/games" />
        {tourBanner}
        <div className="empty" style={{ paddingTop: 70 }}>
          <div className="art"><Icon name={g.tc ? 'clock' : 'dice'} size={30} /></div>
          {g.status === 'cancelled' ? <h3>{g.result === 'abort' ? 'თამაში გაუქმდა — პირველი სვლა არ გაკეთდა' : 'თამაში გაუქმდა'}</h3> : invitedMe ? (
            <>
              <h3>{g.a?.full_name} გეპატიჟება — {GAMES[type].title}{g.tc ? `, ${g.tc}` : ''}</h3>
              <button className="btn btn-accent lg" onClick={async () => { try { await api.joinGame(id); load() } catch (e) { toast(e.message, 'error') } }}>თამაშის დაწყება</button>
            </>
          ) : mySeat === 'a' ? (
            <>
              <h3>{g.invited ? 'ველოდებით მოწვეულს…' : 'ვეძებთ მოწინააღმდეგეს…'}</h3>
              {g.tc && <p className="small">ბლიცი {g.tc}</p>}
              <div className="spinner" />
              <p className="small">შეგიძლია დატოვო ეს გვერდი — როცა თამაში დაიწყება, „თამაშებში“ გამოჩნდება.</p>
              <button className="btn btn-outline" onClick={async () => { await api.resign(id); navigate(g.tournament_id ? `/t/${g.tournament_id}` : '/games', { replace: true }) }}>გაუქმება</button>
            </>
          ) : (
            <>
              <h3>{g.a?.full_name} ეძებს მოწინააღმდეგეს</h3>
              <button className="btn btn-accent lg" onClick={async () => { try { await api.joinGame(id); load() } catch (e) { toast(e.message, 'error') } }}>შეერთება</button>
            </>
          )}
        </div>
      </>
    )
  }

  const state = g.state
  const seatToMove = GAMES[type].seatOf(state)
  const finished = g.status === 'finished'
  const canMove = !finished && !pending && mySeat === seatToMove
  const onMove = async (action, compute) => {
    // კამათელი, ბაზარი, დასტა და დარიგება სერვერზე წყდება — მათ წინასწარ არ ვაჩვენებთ
    if (!action.roll && !action.draw && !action.pass && !NO_PREVIEW.has(type)) {
      try { const ns = compute(); setG((x) => ({ ...x, state: ns })) } catch { /* სერვერის პასუხს დაველოდებით */ }
    }
    setPending(true)
    try {
      await api.move(id, action, g.move_no)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      await load()
      setPending(false)
    }
  }

  let clocks = null
  if (g.clock) {
    const c = g.clock
    clocks = {}
    for (const s of ['a', 'b']) {
      const running = !finished && c.at != null && s === seatToMove
      clocks[s] = { ms: running ? c[s] - (now - c.at) : c[s], running }
    }
  }

  const winnerSeat = g.winner ? seats.find((s) => g[`player_${s}`] === g.winner) : null
  const o = finished ? { winner: type === 'joker' ? state.winner || null : winnerSeat } : null
  const Board = BOARDS[type]
  const tourLive = tour && Date.now() < Date.parse(tour.ends_at)
  return (
    <>
      <GameFrame
        type={type} players={players} mySeat={mySeat} seatToMove={finished ? null : seatToMove} state={state}
        status={statusFor(type, state, { mySeat, names, seatToMove, over: finished })}
        board={<Board state={state} orientation={mySeat || 'a'} seat={mySeat || 'a'} canMove={canMove} onMove={onMove} players={players} />}
        onResign={mySeat ? () => setConfirm(true) : null}
        clocks={clocks}
        replayTo={finished && REPLAYABLE.includes(type) && (g.move_no || 0) > 1 ? `/g/${id}/replay` : null}
        banner={<>{tourBanner}{!mySeat && !finished && <div className="watch-banner"><Icon name="eye" size={16} />შენ უყურებ — {Object.values(players).filter(Boolean).map((p) => (p.full_name || p.username || '').split(' ')[0]).join(' და ')}</div>}</>}
        extra={<GameSocial gameId={id} me={me} isPlayer={Boolean(mySeat)} active={!finished} />}
        result={finished && !dismissed ? {
          ...resultFor(type, o, mySeat, names, g.result, state, players),
          link: g.tournament_id ? { to: `/t/${g.tournament_id}`, text: 'ცხრილი' } : null,
          onClose: () => setDismissed(true),
        } : null}
        againText={g.tournament_id ? (tourLive ? 'შემდეგი თამაში' : 'ტურნირი დასრულდა') : seats.length > 2 ? 'ახალი მაგიდა' : 'რევანში'}
        onAgain={async () => {
          try {
            if (g.tournament_id) {
              if (!tourLive) { navigate(`/t/${g.tournament_id}`); return }
              navigate(`/g/${await api.joinRandom(type, { tournament: g.tournament_id })}`, { replace: true })
            } else if (seats.length > 2) {
              const humans = seats.filter((s) => g[`player_${s}`] && g[`player_${s}`] !== me.id && !bots.includes(s)).map((s) => g[`player_${s}`])
              navigate(`/g/${await api.createGame(type, null, { invites: humans, mode: state.mode })}`, { replace: true })
            } else {
              const opp = mySeat === 'a' ? g.player_b : g.player_a
              navigate(`/g/${await api.createGame(type, opp, { tc: g.tc })}`, { replace: true })
            }
            setDismissed(false)
          } catch (e) { toast(e.message, 'error') }
        }}
      />
      {confirm && (
        <Sheet title={seats.length > 2 ? 'მაგიდის დატოვება?' : 'დანებება?'} onClose={() => setConfirm(false)}>
          <div className="sheet-body vstack">
            <p className="muted">{seats.length > 2 ? 'შენს ადგილს კომპიუტერი დაიკავებს, თამაში კი წაგებად ჩაგეთვლება.' : 'თამაში დასრულდება და მოგება მოწინააღმდეგეს ჩაეთვლება.'}</p>
            <button className="btn btn-danger lg block" onClick={async () => { setConfirm(false); await api.resign(id); load() }}>{seats.length > 2 ? 'დატოვება' : 'დანებება'}</button>
            <button className="btn btn-ghost block" onClick={() => setConfirm(false)}>გაგრძელება</button>
          </div>
        </Sheet>
      )}
    </>
  )
}

export function LocalGameRoute({ type, query }) {
  const mode = query.get('mode') === 'local' ? 'local' : 'bot'
  if (!GAMES[type]) return <><TopBar title="თამაში" backTo="/games" /><Empty title="ასეთი თამაში არ გვაქვს" /></>
  if (mode === 'local' && seatsOf(type) > 2) return <><TopBar title={GAMES[type].title} backTo="/games" /><Empty title={`${GAMES[type].title} ერთ ტელეფონზე არ ითამაშება`} /></>
  const jm = query.get('jm')
  return <LocalGame key={`${type}-${mode}-${jm}`} type={type} mode={mode} opts={{ mode: modeOf(type, jm) }} />
}
