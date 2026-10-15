import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon.jsx'
import { Empty, PersonRow } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Link, useLocation } from '../lib/router.jsx'
import { count } from '../lib/format.js'

export default function Explore() {
  const { query } = useLocation()
  const [q, setQ] = useState(query.get('q') || '')
  const [mode, setMode] = useState(query.get('tab') === 'classmates' ? 'classmates' : 'grid')
  const [people, setPeople] = useState([])
  const [grid, setGrid] = useState(null)

  const [tags, setTags] = useState([])
  useEffect(() => {
    api.explore().then(setGrid).catch(() => setGrid([]))
    api.trendingTags().then(setTags).catch(() => {})
  }, [])
  useEffect(() => {
    if (!q.trim()) { setPeople([]); return }
    const t = setTimeout(() => api.search(q.replace(/^[#@]/, '')).then(setPeople).catch(() => {}), 250)
    return () => clearTimeout(t)
  }, [q])

  const searching = q.trim().length > 0
  return (
    <>
      <div className="explore-search">
        <div className="searchbox">
          <Icon name="search" size={19} />
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ძებნა: სახელი ან @username" aria-label="ძებნა" />
        </div>
      </div>
      {!searching && (
        <div className="chips" style={{ padding: '6px 16px 4px' }}>
          <button className={`chip${mode === 'grid' ? ' on' : ''}`} onClick={() => setMode('grid')}><Icon name="sparkle" size={16} />აღმოაჩინე</button>
          <button className={`chip${mode === 'classmates' ? ' on' : ''}`} onClick={() => setMode('classmates')}><Icon name="school" size={16} />კლასელები</button>
          <Link className="chip" to="/groups"><Icon name="users" size={16} />ჯგუფები</Link>
          <Link className="chip" to="/market"><Icon name="bag" size={16} />ბაზარი</Link>
          <Link className="chip" to="/events"><Icon name="clock" size={16} />ივენთები</Link>
          <Link className="chip" to="/dating"><Icon name="flame" size={16} />გაცნობა</Link>
          <Link className="chip" to="/games"><Icon name="dice" size={16} />თამაშები</Link>
          <Link className="chip" to="/rewards"><Icon name="medal" size={16} />ჯილდოები</Link>
        </div>
      )}
      {searching && q.trim().startsWith('#') && q.trim().length > 2 && (
        <Link to={`/tag/${encodeURIComponent(q.trim().slice(1).toLowerCase())}`} className="person-row">
          <span className="group-thumb" style={{ width: 46, height: 46, borderRadius: 23, background: 'var(--bg-2)', color: 'var(--ink)' }}>#</span>
          <div className="who"><b>{q.trim()}</b><small>პოსტები ამ თეგით</small></div>
        </Link>
      )}
      {searching && (
        people.length
          ? people.map((p) => <PersonRow key={p.id} user={p} sub={[p.username && `@${p.username}`, p.city].filter(Boolean).join(', ')} />)
          : <p className="pad small faint">„{q}“ — ვერავინ ვიპოვე</p>
      )}
      {!searching && mode === 'classmates' && <Classmates />}
      {!searching && mode === 'grid' && tags.length > 0 && (
        <>
          <div className="section-title"><h2>პოპულარული თეგები</h2></div>
          <nav className="trend" aria-label="პოპულარული თეგები">
            {tags.map((t) => <Link key={t.tag} to={`/tag/${encodeURIComponent(t.tag)}`}>#{t.tag}<small>{t.posts}</small></Link>)}
          </nav>
        </>
      )}
      {!searching && mode === 'grid' && (
        grid === null
          ? <div className="grid3" style={{ marginTop: 10 }}>{Array.from({ length: 9 }, (_, i) => <a key={i}><div className="skel" style={{ width: '100%', height: '100%', borderRadius: 0 }} /></a>)}</div>
          : grid.length === 0
            ? <Empty icon="image" title="ჯერ ფოტოები არ არის" text="როცა ხალხი ფოტოებს გააზიარებს, აქ გამოჩნდება." />
            : (
              <div className="grid3" style={{ marginTop: 10 }}>
                {grid.map((p) => (
                  <Link key={p.id} to={p.kind === 'reel' ? `/reels?start=${p.id}` : `/p/${p.id}`}>
                    {p.media[0].type === 'video' ? <video src={p.media[0].url} muted preload="metadata" playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={p.media[0].thumb || p.media[0].url} alt="" loading="lazy" decoding="async" />}
                    {p.kind === 'reel' && <span className="kind-badge"><Icon name="reels" size={18} /></span>}
                    <span className="stat"><Icon name="heart" size={14} fill />{count(p.like_count) || 0}</span>
                  </Link>
                ))}
              </div>
            )
      )}
    </>
  )
}

function Classmates() {
  const { me } = useAuth()
  const [f, setF] = useState({ school: me?.school || '', year: me?.grad_year || '', city: '' })
  const [list, setList] = useState(null)
  const [followed, setFollowed] = useState({})
  const search = async (e) => {
    e?.preventDefault()
    setList(await api.classmates(f))
  }
  useEffect(() => { if (me?.school) search() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section>
      <form className="vstack pad" onSubmit={search} style={{ gap: 10 }}>
        <p className="small muted">იპოვე ვინც შენთან ერთად სწავლობდა — სკოლით, დამთავრების წლით ან ქალაქით.</p>
        <input className="input" placeholder="სკოლა" value={f.school} onChange={(e) => setF({ ...f, school: e.target.value })} />
        <div className="hstack">
          <input className="input" placeholder="წელი" inputMode="numeric" maxLength={4} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} />
          <input className="input" placeholder="ქალაქი" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
        </div>
        <button className="btn btn-primary block">ძებნა</button>
      </form>
      {list?.length === 0 && <p className="pad small faint">ამ კრიტერიუმებით ჯერ ვერავინ ვიპოვე. სცადე მხოლოდ სკოლით.</p>}
      {list?.map((p) => (
        <PersonRow key={p.id} user={p} sub={[p.school, p.grad_year].filter(Boolean).join(', ') || p.city} right={
          <button className={`btn sm ${followed[p.id] ? 'btn-outline' : 'btn-primary'}`} onClick={async () => {
            const on = !followed[p.id]
            setFollowed((x) => ({ ...x, [p.id]: on }))
            await api.follow(p.id, on)
          }}>{followed[p.id] ? 'გამოწერილია' : 'გამოწერა'}</button>
        } />
      ))}
    </section>
  )
}
