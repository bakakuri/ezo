import { useEffect, useState } from 'react'
import { Avatar, Sheet, TopBar, PersonRow, Loader } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { Die } from '../components/games/NardiBoard.jsx'
import { Swatch } from '../components/games/Swatch.jsx'
import { MiniBoard } from '../components/games/ChessBoard.jsx'
import { GAME_LIST, GAMES, seatsOf } from '../games/index.js'
import { TournamentCard, CreateTournament, phaseOf } from './Tournament.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Link, navigate } from '../lib/router.jsx'
import { timeAgo } from '../lib/format.js'
import { useToast } from '../components/Toast.jsx'

export { Swatch }

export default function Games() {
  const { me } = useAuth()
  const [mine, setMine] = useState(null)
  const [stats, setStats] = useState({})
  const [pick, setPick] = useState(null)
  const [board, setBoard] = useState('nardi')
  const [leaders, setLeaders] = useState(null)
  const [tours, setTours] = useState(null)
  const [newTour, setNewTour] = useState(false)
  const [puzzle, setPuzzle] = useState(null)
  const [live, setLive] = useState([])
  const staff = ['moderator', 'admin'].includes(me?.role)

  useEffect(() => {
    api.myGames().then(setMine).catch(() => setMine([]))
    api.stats(me.id).then((l) => setStats(Object.fromEntries(l.map((s) => [s.type, s])))).catch(() => {})
    api.tournaments().then(setTours).catch(() => setTours([]))
    api.dailyPuzzle().then(setPuzzle).catch(() => {})
    api.liveGames().then(setLive).catch(() => {})
  }, [me.id])
  useEffect(() => { setLeaders(null); api.leaderboard(board).then(setLeaders).catch(() => setLeaders([])) }, [board])

  return (
    <>
      <TopBar title="თამაშები" lined={false} />
      <section className="games-hero">
        <div className="nardi-hero">
          <div className="pts top" />
          <div className="hero-inner">
            <div className="hstack" style={{ gap: 10 }}><Die n={6} /><Die n={6} /></div>
            <h2>ნარდი ეზოში</h2>
            <p>ქართული კლასიკა — მეგობართან, უცნობთან ან კომპიუტერთან.</p>
            <button className="btn btn-accent lg" onClick={() => setPick('nardi')}>თამაშის დაწყება</button>
          </div>
          <div className="pts bottom" />
        </div>
      </section>

      {mine?.length > 0 && (
        <>
          <div className="section-title"><h2>მიმდინარე</h2></div>
          {mine.map((g) => {
            const opp = g.player_a === me.id ? g.b : g.a
            const myTurn = g.turn === me.id
            const invited = g.status === 'waiting' && (g.invited === me.id || (g.invites || []).includes(me.id)) && ![g.player_b, g.player_c, g.player_d].includes(me.id)
            const table = (g.seats || 2) > 2
            return (
              <Link key={g.id} to={`/g/${g.id}`} className="game-card">
                <Swatch type={g.type} />
                <div style={{ minWidth: 0 }}>
                  <h3>{GAMES[g.type].title}{g.tc ? <span className="tc-tag">{g.tc}</span> : null}</h3>
                  <p className="ellipsis">{table
                    ? `${g.status === 'waiting' ? 'მაგიდა იკრიბება' : 'მაგიდა'}, ${timeAgo(g.updated_at)}`
                    : `${opp ? `${opp.full_name || opp.username}, ` : 'მოწინააღმდეგეს ველოდებით, '}${timeAgo(g.updated_at)}`}</p>
                </div>
                {(myTurn || invited) && <span className="btn btn-accent sm">{invited ? 'მიღება' : 'შენი სვლა'}</span>}
              </Link>
            )
          })}
        </>
      )}

      {puzzle && (
        <Link to="/puzzle" className={`puzzle-card${puzzle.solved ? ' solved' : ''}`}>
          <MiniBoard fen={puzzle.fen} flipped={puzzle.fen.split(' ')[1] === 'b'} />
          <div className="grow">
            <small>დღის ამოცანა</small>
            <b>{puzzle.title}</b>
            <span>მატი {puzzle.moves === 1 ? 'ერთ' : puzzle.moves} სვლაში, {puzzle.fen.split(' ')[1] === 'w' ? 'თეთრებით' : 'შავებით'}</span>
          </div>
          {puzzle.solved ? <span className="done"><Icon name="check" size={18} strokeWidth={2.8} /></span> : <span className="btn btn-accent sm">ამოხსენი</span>}
        </Link>
      )}

      {live.length > 0 && (
        <>
          <div className="section-title"><h2>ახლა თამაშობენ</h2><span className="live-dot">ლაივი</span></div>
          <div className="live-row">
            {live.map((g) => {
              const ps = ['a', 'b', 'c', 'd'].map((s) => g[s]).filter(Boolean)
              return (
                <Link key={g.id} to={`/g/${g.id}`} className="live-card">
                  <Swatch type={g.type} />
                  <b>{GAMES[g.type]?.title}</b>
                  <span className="who">{ps.slice(0, 2).map((p) => <Avatar key={p.id} user={p} size={22} />)}<small className="ellipsis">{ps.map((p) => (p.full_name || p.username).split(' ')[0]).join(' — ')}</small></span>
                  <span className="watch"><Icon name="eye" size={14} />ყურება</span>
                </Link>
              )
            })}
          </div>
        </>
      )}

      <div className="section-title"><h2>ყველა თამაში</h2></div>
      {GAME_LIST.map((g) => (
        <button key={g.type} className="game-card" onClick={() => setPick(g.type)}>
          <Swatch type={g.type} />
          <div>
            <h3>{g.title}</h3>
            <p>{g.blurb}</p>
          </div>
          <div className="rating">{stats[g.type] ? <><b>{stats[g.type].rating}</b>რეიტინგი</> : <Icon name="play" size={18} />}</div>
        </button>
      ))}

      <div className="section-title">
        <h2>ტურნირები</h2>
        {staff && <button className="btn btn-ghost sm" onClick={() => setNewTour(true)}><Icon name="plus" size={16} />ტურნირი</button>}
      </div>
      {tours === null && <Loader />}
      {tours?.length === 0 && <p className="pad small faint">ახლო დღეებში ტურნირი არ არის.</p>}
      {tours && [...tours].sort((x, y) => ({ live: 0, soon: 1, done: 2 }[phaseOf(x)] - { live: 0, soon: 1, done: 2 }[phaseOf(y)])).slice(0, 5)
        .map((t) => <TournamentCard key={t.id} t={t} />)}

      <div className="section-title"><h2>საუკეთესოები</h2></div>
      <div className="chips">
        {GAME_LIST.map((g) => <button key={g.type} className={`chip${board === g.type ? ' on' : ''}`} onClick={() => setBoard(g.type)}>{g.title}</button>)}
      </div>
      <div style={{ padding: '8px 0 20px' }}>
        {leaders === null && <Loader />}
        {leaders?.length === 0 && <p className="pad small faint">ჯერ არავის უთამაშია. იყავი პირველი.</p>}
        {leaders?.map((l, i) => (
          <Link key={l.user_id} to={`/u/${l.p?.username}`} className={`leader${l.user_id === me.id ? ' me' : ''}`}>
            <span className={`pos${i < 3 ? ' top' : ''}`}>{i + 1}</span>
            <Avatar user={l.p} size={38} />
            <div style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block' }}>{l.p?.full_name || l.p?.username}</b><span className="xs faint">{l.wins} მოგება, {l.losses} წაგება</span></div>
            <span className="rt">{l.rating}</span>
          </Link>
        ))}
      </div>

      {pick && <ModeSheet type={pick} onClose={() => setPick(null)} />}
      {newTour && <CreateTournament onClose={() => setNewTour(false)} />}
    </>
  )
}

const TCS = [[null, 'კლასიკური'], ['1+0', '1+0'], ['3+2', '3+2'], ['5+0', '5+0'], ['10+0', '10+0']]
const CLOCKED = new Set(['chess', 'checkers'])

function ModeSheet({ type, onClose }) {
  const toast = useToast()
  const [friends, setFriends] = useState(null)
  const [chosen, setChosen] = useState([])
  const [busy, setBusy] = useState(false)
  const [tc, setTc] = useState(null)
  const g = GAMES[type]
  const [jm, setJm] = useState(g.defaultMode || null)
  const { me } = useAuth()
  const table = seatsOf(type) > 2

  const random = async () => {
    setBusy(true)
    try { navigate(`/g/${await api.joinRandom(type, { tc, mode: jm })}`) } catch (e) { toast(e.message, 'error'); setBusy(false) }
  }
  const invite = async (list) => {
    setBusy(true)
    try { navigate(`/g/${await api.createGame(type, table ? null : list[0].id, { tc, mode: jm, invites: table ? list.map((f) => f.id) : undefined })}`) } catch (e) { toast(e.message, 'error'); setBusy(false) }
  }
  if (friends) {
    const toggle = (f) => setChosen((c) => (c.some((x) => x.id === f.id) ? c.filter((x) => x.id !== f.id) : c.length < 3 ? [...c, f] : c))
    return (
      <Sheet title={table ? 'ვის ეპატიჟები? (3-მდე)' : 'ვის ეპატიჟები?'} onClose={onClose} actions={table && (
        <button className="btn btn-primary sm" disabled={busy} onClick={() => invite(chosen)}>{chosen.length ? `მაგიდა (${chosen.length + 1})` : 'მარტო დავიწყებ'}</button>
      )}>
        <div style={{ overflowY: 'auto', paddingBottom: 12 }}>
          {friends.length === 0 && <p className="pad small muted">ჯერ არავინ გყავს გამოწერილი. იპოვე მეგობრები ძიებაში.</p>}
          {friends.map((f) => {
            const on = chosen.some((x) => x.id === f.id)
            return (
              <PersonRow key={f.id} user={f} right={table
                ? <button className={`btn sm ${on ? 'btn-primary' : 'btn-outline'}`} aria-pressed={on} onClick={() => toggle(f)}>{on ? <Icon name="check" size={16} /> : 'არჩევა'}</button>
                : <button className="btn btn-primary sm" disabled={busy} onClick={() => invite([f])}>მოწვევა</button>} />
            )
          })}
        </div>
      </Sheet>
    )
  }
  const modes = table ? [
    { icon: 'globe', title: 'ღია მაგიდა', sub: 'დაჯდები თავისუფალ ადგილზე ან გახსნი ახალს', run: random },
    { icon: 'users', title: 'მეგობრებთან', sub: 'მოიწვიე 3-მდე; ცარიელ ადგილებს კომპიუტერი დაიკავებს', run: async () => setFriends(await api.followList(me.id, 'following')) },
    { icon: 'cpu', title: 'კომპიუტერებთან', sub: 'სამი ბოტი, რეიტინგის გარეშე', run: () => navigate(`/play/${type}?mode=bot&jm=${jm}`) },
  ] : [
    { icon: 'globe', title: 'შემთხვევითი მოწინააღმდეგე', sub: tc ? `ბლიცი ${tc}, რეიტინგზე` : 'ონლაინ, რეიტინგზე', run: random },
    { icon: 'users', title: 'მეგობრის მოწვევა', sub: 'მიიღებს შეტყობინებას', run: async () => setFriends(await api.followList(me.id, 'following')) },
    { icon: 'cpu', title: 'კომპიუტერთან', sub: 'ვარჯიშისთვის, რეიტინგის გარეშე', run: () => navigate(`/play/${type}?mode=bot`) },
    { icon: 'phone', title: 'ერთ ტელეფონზე', sub: 'ორი მოთამაშე ერთ ეკრანზე', run: () => navigate(`/play/${type}?mode=local`) },
  ]
  return (
    <Sheet title={g.title} onClose={onClose}>
      {CLOCKED.has(type) && (
        <div className="mode-opts">
          <span className="small muted">დრო</span>
          <div className="chips inline">{TCS.map(([v, l]) => <button key={l} className={`chip${tc === v ? ' on' : ''}`} onClick={() => setTc(v)}>{l}</button>)}</div>
        </div>
      )}
      {g.modes && (
        <div className="mode-opts">
          <span className="small muted">{type === 'loto' ? 'როდის მთავრდება' : 'თამაშის სიგრძე'}</span>
          <div className="chips inline">
            {Object.entries(g.modes).sort(([a], [b]) => (a === g.defaultMode ? -1 : b === g.defaultMode ? 1 : 0)).map(([k, m]) => (
              <button key={k} className={`chip${jm === k ? ' on' : ''}`} onClick={() => setJm(k)}>{m.title} <small>{g.modeNote?.(k)}</small></button>
            ))}
          </div>
        </div>
      )}
      <div className="menu mode-list">
        {modes.map((m) => (
          <button key={m.icon} onClick={m.run} disabled={busy}>
            <span className="ico"><Icon name={m.icon} size={22} /></span>
            <div className="grow"><b>{m.title}</b><div className="small muted">{m.sub}</div></div>
            {busy && m.icon === 'globe' ? <div className="spinner" /> : <Icon name="back" size={18} className="flip-x" />}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
