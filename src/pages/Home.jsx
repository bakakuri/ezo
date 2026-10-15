import { useCallback, useEffect, useRef, useState } from 'react'
import { PostCard } from '../components/PostCard.jsx'
import { StoryRail } from '../components/Stories.jsx'
import { Avatar, Empty, PostSkeleton } from '../components/ui.jsx'
import { Mark } from '../components/Icon.jsx'
import { HomeTopActions } from '../components/Shell.jsx'
import { useComposer } from '../components/Composer.jsx'
import { useAuth } from '../lib/auth.jsx'
import { api } from '../lib/api.js'
import { Link } from '../lib/router.jsx'
import { Icon } from '../components/Icon.jsx'
import { banText } from '../lib/format.js'
import { pushStatus, enablePush } from '../lib/push.js'
import { SuggestStrip } from '../components/Suggest.jsx'

const readTab = () => { try { return localStorage.getItem('ezo.feed') || 'foryou' } catch { return 'foryou' } }

const FEED_KEY = (uid, mode) => `ezo.feedcache.${uid}.${mode}`
function readFeed(uid, mode) {
  try {
    const raw = localStorage.getItem(FEED_KEY(uid, mode))
    const x = raw && JSON.parse(raw)
    return x && Date.now() - x.at < 7 * 864e5 ? x.posts : null
  } catch { return null }
}
function writeFeed(uid, mode, posts) {
  try { localStorage.setItem(FEED_KEY(uid, mode), JSON.stringify({ at: Date.now(), posts: posts.slice(0, 15) })) } catch { /* სავსეა */ }
}

export default function Home() {
  const { me } = useAuth()
  const { compose } = useComposer()
  const [tab, setTab] = useState(readTab)
  const [posts, setPosts] = useState(null)
  const [next, setNext] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [stale, setStale] = useState(false)
  const sentinel = useRef(null)

  // ფიდი ჯერ შენახულიდან (მყისიერად და offline-ში), მერე ქსელიდან
  const load = useCallback(async (mode) => {
    const cached = readFeed(me?.id, mode)
    setPosts(cached)
    setStale(Boolean(cached))
    setError(null)
    try {
      const r = await api.feed(mode)
      setPosts(r.posts)
      setNext(r.next)
      setStale(false)
      writeFeed(me?.id, mode, r.posts)
    } catch (e) {
      if (!cached) { setError(e.message); setPosts([]) }
    }
  }, [me?.id])

  useEffect(() => { load(tab); try { localStorage.setItem('ezo.feed', tab) } catch { /* */ } }, [tab, load])

  useEffect(() => {
    const onPosted = (e) => {
      const p = e.detail
      if (!p.parent_id && p.kind === 'post') setPosts((cur) => (cur ? [p, ...cur] : [p]))
    }
    window.addEventListener('ezo:posted', onPosted)
    return () => window.removeEventListener('ezo:posted', onPosted)
  }, [])

  useEffect(() => {
    if (!next || !sentinel.current) return
    const io = new IntersectionObserver(async ([en]) => {
      if (!en.isIntersecting || loadingMore) return
      setLoadingMore(true)
      try {
        const r = await api.feed(tab, next)
        setPosts((cur) => [...cur, ...r.posts.filter((p) => !cur.some((c) => c.id === p.id))])
        setNext(r.next)
      } finally { setLoadingMore(false) }
    }, { rootMargin: '600px' })
    io.observe(sentinel.current)
    return () => io.disconnect()
  }, [next, tab, loadingMore])

  return (
    <>
      <header className="topbar home-top">
        <Link to="/" className="wordmark" aria-label="ეზო — მთავარი"><Mark size={28} /><span>ეზო</span></Link>
        <HomeTopActions />
      </header>
      {banText(me?.banned_until) && (
        <div className="notice err" style={{ margin: '8px 16px 0' }}>
          ანგარიში შეზღუდულია {banText(me.banned_until)}: პოსტების, მესიჯების და სთორიების დამატება ახლა არ შეიძლება.{me.ban_reason ? ` მიზეზი: ${me.ban_reason}.` : ''}
        </div>
      )}
      <PushPrompt />
      <StoryRail />
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'foryou'} className={tab === 'foryou' ? 'on' : ''} onClick={() => setTab('foryou')}>შენთვის</button>
        <button role="tab" aria-selected={tab === 'following'} className={tab === 'following' ? 'on' : ''} onClick={() => setTab('following')}>გამოწერები</button>
      </div>
      <div className="composer-inline" onClick={() => compose()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && compose()}>
        <Avatar user={me} size={40} />
        <div className="hstack" style={{ justifyContent: 'space-between' }}>
          <span className="ph">რა ხდება ეზოში?</span>
          <span className="btn btn-primary sm" aria-hidden="true">გამოქვეყნება</span>
        </div>
      </div>
      {stale && !navigator.onLine && <p className="stale-note">ოფლაინ ხარ — ნაჩვენებია ბოლოს ნანახი ფიდი</p>}
      {posts !== null && posts.length < 3 && <SuggestStrip title="ვის გამოიწერო" />}
      {posts === null && <PostSkeleton n={3} />}
      {error && <Empty icon="refresh" title="ფიდი ვერ ჩაიტვირთა" text={error} action={<button className="btn btn-outline" onClick={() => load(tab)}>თავიდან ცდა</button>} />}
      {posts?.length === 0 && !error && (
        tab === 'following'
          ? <Empty icon="users" title="აქ ჯერ ცარიელია" text="გამოიწერე მეგობრები და მათი პოსტები აქ გამოჩნდება." action={<Link to="/explore" className="btn btn-primary">ხალხის პოვნა</Link>} />
          : <Empty icon="sparkle" title="ეზო ჯერ წყნარია" text="იყავი პირველი — დაწერე რამე." action={<button className="btn btn-primary" onClick={() => compose()}>პოსტის დაწერა</button>} />
      )}
      {posts?.map((p, i) => (
        <div key={p.id}>
          <PostCard post={p} onDeleted={(id) => setPosts((cur) => cur.filter((x) => x.id !== id))} />
          {i === 2 && <SuggestStrip />}
        </div>
      ))}
      <div ref={sentinel} style={{ height: 1 }} />
      {loadingMore && <div className="center pad"><div className="spinner" /></div>}
    </>
  )
}

function PushPrompt() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    let dismissed = false
    try { dismissed = localStorage.getItem('ezo.pushPrompt') === 'no' } catch { /* */ }
    if (!dismissed) pushStatus().then((st) => setShow(st === 'off'))
  }, [])
  if (!show) return null
  const close = () => { setShow(false); try { localStorage.setItem('ezo.pushPrompt', 'no') } catch { /* */ } }
  return (
    <div className="push-card" role="region" aria-label="შეტყობინებები">
      <span className="ico"><Icon name="bell" size={22} /></span>
      <div className="grow">
        <b>ნუ გამოგრჩება მესიჯი</b>
        <p>ჩართე შეტყობინებები — მესიჯზე, შენს სვლაზე და ახალ წყვილზე გაცნობიებთ.</p>
        <div className="hstack" style={{ marginTop: 10 }}>
          <button className="btn btn-primary sm" onClick={async () => { const st = await enablePush().catch(() => 'off'); if (st === 'on' || st === 'denied') close() }}>ჩართვა</button>
          <button className="btn btn-ghost sm" onClick={close}>მოგვიანებით</button>
        </div>
      </div>
    </div>
  )
}
