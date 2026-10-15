import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon.jsx'
import { Empty, PersonRow } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Link, useLocation } from '../lib/router.jsx'
import { count } from '../lib/format.js'
import { PostCard } from '../components/PostCard.jsx'
import { SuggestList } from '../components/Suggest.jsx'
import { priceText } from '../lib/market.js'

const RESULT_TABS = [['all', 'ყველა'], ['people', 'ხალხი'], ['posts', 'პოსტები'], ['groups', 'ჯგუფები'], ['listings', 'ბაზარი']]

export default function Explore() {
  const { query } = useLocation()
  const [q, setQ] = useState(query.get('q') || '')
  const [mode, setMode] = useState(['classmates', 'people'].includes(query.get('tab')) ? query.get('tab') : 'grid')
  const [res, setRes] = useState(null)
  const [rtab, setRtab] = useState('all')
  const [grid, setGrid] = useState(null)

  const [tags, setTags] = useState([])
  useEffect(() => {
    api.explore().then(setGrid).catch(() => setGrid([]))
    api.trendingTags().then(setTags).catch(() => {})
  }, [])
  useEffect(() => {
    if (!q.trim()) { setRes(null); return }
    let live = true
    const t = setTimeout(() => api.searchAll(q.trim()).then((r) => live && setRes({ q: q.trim(), ...r })).catch(() => live && setRes({ q: q.trim(), people: [], posts: [], tags: [], groups: [], listings: [] })), 280)
    return () => { live = false; clearTimeout(t) }
  }, [q])

  const searching = q.trim().length > 0
  return (
    <>
      <div className="explore-search">
        <div className="searchbox">
          <Icon name="search" size={19} />
          <input className="input" type="search" value={q} onChange={(e) => { setQ(e.target.value); setRtab('all') }} placeholder="ხალხი, პოსტები, ჯგუფები, ბაზარი" aria-label="ძებნა" enterKeyHint="search" />
        </div>
      </div>
      {!searching && (
        <div className="chips" style={{ padding: '6px 16px 4px' }}>
          <button className={`chip${mode === 'grid' ? ' on' : ''}`} onClick={() => setMode('grid')}><Icon name="sparkle" size={16} />აღმოაჩინე</button>
          <button className={`chip${mode === 'people' ? ' on' : ''}`} onClick={() => setMode('people')}><Icon name="userPlus" size={16} />ვის გამოიწერო</button>
          <button className={`chip${mode === 'classmates' ? ' on' : ''}`} onClick={() => setMode('classmates')}><Icon name="school" size={16} />კლასელები</button>
          <Link className="chip" to="/groups"><Icon name="users" size={16} />ჯგუფები</Link>
          <Link className="chip" to="/market"><Icon name="bag" size={16} />ბაზარი</Link>
          <Link className="chip" to="/events"><Icon name="clock" size={16} />ივენთები</Link>
          <Link className="chip" to="/dating"><Icon name="flame" size={16} />გაცნობა</Link>
          <Link className="chip" to="/games"><Icon name="dice" size={16} />თამაშები</Link>
          <Link className="chip" to="/rewards"><Icon name="medal" size={16} />ჯილდოები</Link>
        </div>
      )}
      {searching && <SearchResults res={res} q={q.trim()} tab={rtab} setTab={setRtab} />}
      {!searching && mode === 'people' && <SuggestList limit={20} />}
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

// ძებნის შედეგები: ქართულად ან ლათინურად („giorgi“ = „გიორგი“)
function SearchResults({ res, q, tab, setTab }) {
  if (!res || res.q !== q) return <div className="center pad"><div className="spinner" /></div>
  const total = res.people.length + res.posts.length + res.tags.length + res.groups.length + res.listings.length
  const tagLink = q.startsWith('#') && q.length > 2 ? q.slice(1).toLowerCase() : null
  if (!total && !tagLink) {
    return <Empty icon="search" title={`„${q}“ — ვერაფერი ვიპოვე`} text="სცადე სხვაგვარად: ქართულად ან ლათინურად, ან სიტყვის ნაწილით." />
  }
  const show = (k) => tab === 'all' || tab === k
  const cut = (list, n) => (tab === 'all' ? list.slice(0, n) : list)
  const more = (k, list, n) => tab === 'all' && list.length > n && <button className="search-more" onClick={() => setTab(k)}>ყველა ({list.length})</button>
  return (
    <div className="search-results">
      <div className="chips" role="tablist" style={{ padding: '6px 16px 2px' }}>
        {RESULT_TABS.filter(([k]) => k === 'all' || res[k]?.length).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'all' && (tagLink || res.tags.length > 0) && (
        <nav className="trend" aria-label="თეგები" style={{ paddingTop: 8 }}>
          {tagLink && !res.tags.some((t) => t.tag === tagLink) && <Link to={`/tag/${encodeURIComponent(tagLink)}`}>#{tagLink}</Link>}
          {res.tags.map((t) => <Link key={t.tag} to={`/tag/${encodeURIComponent(t.tag)}`}>#{t.tag}<small>{t.posts}</small></Link>)}
        </nav>
      )}
      {show('people') && res.people.length > 0 && (
        <section aria-label="ხალხი">
          {tab === 'all' && <div className="section-title"><h2>ხალხი</h2></div>}
          {cut(res.people, 4).map((p) => <PersonRow key={p.id} user={p} sub={[`@${p.username}`, p.city].filter(Boolean).join(', ')} />)}
          {more('people', res.people, 4)}
        </section>
      )}
      {show('groups') && res.groups.length > 0 && (
        <section aria-label="ჯგუფები">
          {tab === 'all' && <div className="section-title"><h2>ჯგუფები</h2></div>}
          {cut(res.groups, 3).map((g) => (
            <Link key={g.id} to={`/groups/${g.slug}`} className="person-row">
              {g.cover_url ? <img className="search-thumb" src={g.cover_url} alt="" loading="lazy" /> : <span className="search-thumb"><Icon name="users" size={20} /></span>}
              <div className="who"><b>{g.name}</b><small>{count(g.members_count) || 0} წევრი{g.privacy === 'private' ? ', დახურული' : ''}</small></div>
            </Link>
          ))}
          {more('groups', res.groups, 3)}
        </section>
      )}
      {show('listings') && res.listings.length > 0 && (
        <section aria-label="ბაზარი">
          {tab === 'all' && <div className="section-title"><h2>ბაზარი</h2></div>}
          {cut(res.listings, 3).map((l) => (
            <Link key={l.id} to={`/market/${l.id}`} className="person-row">
              {l.photo ? <img className="search-thumb sq" src={l.photo} alt="" loading="lazy" /> : <span className="search-thumb sq"><Icon name="bag" size={20} /></span>}
              <div className="who"><b>{l.title}</b><small>{[priceText(l.price, l.currency), l.city].filter(Boolean).join(', ')}</small></div>
            </Link>
          ))}
          {more('listings', res.listings, 3)}
        </section>
      )}
      {show('posts') && res.posts.length > 0 && (
        <section aria-label="პოსტები">
          {tab === 'all' && <div className="section-title"><h2>პოსტები</h2></div>}
          {cut(res.posts, 5).map((p) => <PostCard key={p.id} post={p} />)}
          {more('posts', res.posts, 5)}
        </section>
      )}
    </div>
  )
}
