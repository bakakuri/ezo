import { useEffect, useState } from 'react'
import { Empty, Loader, TopBar } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import ChessBoard from '../components/games/ChessBoard.jsx'
import { CoinIcon, useRewards } from '../components/Rewards.jsx'
import { chess } from '../games/index.js'
import { api } from '../lib/api.js'
import { Link } from '../lib/router.jsx'
import { untilText } from '../lib/format.js'

const uciOf = (m) => chess.sqName(m.from) + chess.sqName(m.to) + (m.promo || '')
const side = (fen) => fen.split(' ')[1]
function play(state, uci) {
  const m = chess.legalMoves(chess.fromFEN(state.fen)).find((x) => uciOf(x) === uci)
  return m ? chess.applyToState(state, m) : state
}
// შუაღამემდე თბილისის დროით
function msToTbilisiMidnight() {
  const now = new Date()
  const tb = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tbilisi' }))
  const next = new Date(tb)
  next.setHours(24, 0, 0, 0)
  return next - tb
}

export default function Puzzle() {
  const { refresh } = useRewards()
  const [p, setP] = useState(undefined)
  const [state, setState] = useState(null)
  const [moves, setMoves] = useState([])
  const [mode, setMode] = useState('play') // play | wait | wrong | solved
  const [attempts, setAttempts] = useState(0)
  const [solvers, setSolvers] = useState(0)

  useEffect(() => {
    api.dailyPuzzle().then((d) => {
      setP(d)
      setAttempts(d.attempts)
      setSolvers(d.solvers)
      let s = { fen: d.fen, turn: side(d.fen), last: null, count: 0 }
      if (d.solved && d.solution) { for (const m of d.solution) s = play(s, m); setMode('solved'); setMoves(d.solution) }
      setState(s)
    }).catch(() => setP(null))
  }, [])

  if (p === undefined) return <><TopBar title="დღის ამოცანა" backTo="/games" /><Loader /></>
  if (p === null) return <><TopBar title="დღის ამოცანა" backTo="/games" /><Empty icon="sparkle" title="ამოცანა ვერ ჩაიტვირთა" text="სცადე ცოტა ხანში." /></>

  const me = side(p.fen)
  const onMove = async (action, compute) => {
    if (mode !== 'play' && mode !== 'wrong') return
    const before = state
    const next = compute()
    const uci = chess.sqName(action.from) + chess.sqName(action.to) + (action.promo || '')
    const seq = [...moves, uci]
    setState(next)
    setMode('wait')
    try {
      const r = await api.puzzleMove(seq)
      if (!r.correct) {
        setAttempts((n) => n + 1)
        setMode('wrong')
        setTimeout(() => setState(before), 650)
        return
      }
      if (r.solved) {
        setMoves(seq)
        setMode('solved')
        setAttempts(r.attempts ?? attempts + 1)
        if (r.solvers) setSolvers(r.solvers)
        refresh()
        return
      }
      setMoves([...seq, r.reply])
      setTimeout(() => { setState((s) => play(s, r.reply)); setMode('play') }, 550)
    } catch {
      setState(before)
      setMode('play')
    }
  }

  const done = mode === 'solved'
  return (
    <>
      <TopBar title="დღის ამოცანა" backTo="/games" />
      <section className="puzzle-head">
        <span className={`side-chip ${me}`}><i />{me === 'w' ? 'თეთრები იწყებენ' : 'შავები იწყებენ'}</span>
        <h1>{p.title}</h1>
        <p>მატი {p.moves === 1 ? 'ერთ' : `${p.moves}`} სვლაში</p>
      </section>
      <div className={`puzzle-board${mode === 'wrong' ? ' shake' : ''}${done ? ' solved' : ''}`}>
        {state && <ChessBoard state={state} orientation={me === 'w' ? 'a' : 'b'} canMove={mode === 'play' || mode === 'wrong'} onMove={onMove} />}
        {done && <span className="mate-burst" aria-hidden="true">#</span>}
      </div>
      <div className={`puzzle-status ${mode}`} aria-live="polite">
        {mode === 'play' && (moves.length ? <><Icon name="check" size={18} strokeWidth={2.6} />სწორია! გააგრძელე</> : <>იპოვე მატი</>)}
        {mode === 'wait' && <span className="spinner" />}
        {mode === 'wrong' && <><Icon name="close" size={18} strokeWidth={2.6} />ეს სვლა არ არის — სცადე სხვა</>}
        {done && <><Icon name="trophy" size={20} />ამოხსნილია{attempts > 1 ? `, ${attempts} ცდით` : ' პირველივე ცდით'}!</>}
      </div>
      {done && (
        <div className="puzzle-done">
          <span className="reward"><b>+15 XP</b><span><CoinIcon size={16} />+5</span></span>
          <p className="small muted">დღეს უკვე {solvers} ადამიანმა ამოხსნა. ახალი ამოცანა — {untilText(msToTbilisiMidnight())}-ში.</p>
          <Link to="/games" className="btn btn-soft">თამაშებში დაბრუნება</Link>
        </div>
      )}
      {!done && <p className="pad small muted" style={{ textAlign: 'center' }}>ამოხსნისთვის: +15 XP და 5 ბროწეული. ცდები შეუზღუდავია.</p>}
    </>
  )
}
