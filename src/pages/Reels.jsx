import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon.jsx'
import { Avatar, Sheet, Empty } from '../components/ui.jsx'
import { PostCard, RichText } from '../components/PostCard.jsx'
import { useComposer } from '../components/Composer.jsx'
import { api } from '../lib/api.js'
import { Link, useLocation } from '../lib/router.jsx'
import { count } from '../lib/format.js'
import { useAuth } from '../lib/auth.jsx'
import { useToast } from '../components/Toast.jsx'
import { useSaver, saving } from '../lib/net.js'

export default function Reels() {
  const { query } = useLocation()
  const { compose } = useComposer()
  const [list, setList] = useState(null)
  const [muted, setMuted] = useState(true)
  const [comments, setComments] = useState(null)
  const offset = useRef(0)
  const loading = useRef(false)

  useEffect(() => {
    const start = query.get('start')
    api.reels(0).then(async (r) => {
      offset.current = r.length
      if (start && !r.some((x) => x.id === start)) {
        const p = await api.post(start)
        if (p) r = [p, ...r]
      } else if (start) r = [r.find((x) => x.id === start), ...r.filter((x) => x.id !== start)]
      setList(r)
    }).catch(() => setList([]))
    const onPosted = (e) => { if (e.detail.kind === 'reel') setList((c) => [e.detail, ...(c || [])]) }
    window.addEventListener('ezo:posted', onPosted)
    return () => window.removeEventListener('ezo:posted', onPosted)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const more = async (i) => {
    if (loading.current || !list || i < list.length - 2) return
    loading.current = true
    try {
      const r = await api.reels(offset.current)
      offset.current += r.length
      if (r.length) setList((c) => [...c, ...r.filter((x) => !c.some((y) => y.id === x.id))])
    } finally { loading.current = false }
  }

  return (
    <>
      <div className="reels-top">
        <h1>ვიდეოები</h1>
        <div className="hstack" style={{ gap: 0 }}>
          <button className="icon-btn" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'ხმის ჩართვა' : 'ხმის გამორთვა'}><Icon name={muted ? 'mute' : 'volume'} /></button>
          <button className="icon-btn" onClick={() => compose({ kind: 'reel' })} aria-label="ვიდეოს დამატება"><Icon name="camera" /></button>
        </div>
      </div>
      <div className="reels">
        {list === null && <div className="reel"><div className="spinner" style={{ borderColor: '#333', borderTopColor: '#fff' }} /></div>}
        {list?.length === 0 && (
          <div className="reel">
            <div style={{ color: '#fff' }}><Empty icon="reels" title="ვიდეოები ჯერ არ არის" text="ატვირთე პირველი." action={<button className="btn btn-accent" onClick={() => compose({ kind: 'reel' })}>ვიდეოს ატვირთვა</button>} /></div>
          </div>
        )}
        {list?.map((r, i) => <Reel key={r.id} reel={r} muted={muted} onVisible={() => more(i)} onComments={() => setComments(r)} />)}
      </div>
      {comments && <Comments reel={comments} onClose={() => setComments(null)} />}
    </>
  )
}

function Reel({ reel: initial, muted, onVisible, onComments }) {
  const [reel, setReel] = useState(initial)
  const saver = useSaver()
  const [playing, setPlaying] = useState(!saving())
  const [hearts, setHearts] = useState([])
  const [followed, setFollowed] = useState(false)
  const { me } = useAuth()
  const toast = useToast()
  const box = useRef(null)
  const video = useRef(null)
  const lastTap = useRef(0)
  const m = reel.media?.[0]

  useEffect(() => {
    const io = new IntersectionObserver(([en]) => {
      const v = video.current
      if (en.isIntersecting) {
        onVisible()
        // ტრაფიკის დაზოგვისას ვიდეო თავისით არ ირთვება — შეხებით
        if (saving()) { setPlaying(false); return }
        setPlaying(true)
        if (v) { v.currentTime = 0; v.play().catch(() => {}) }
      } else if (v) { v.pause(); if (saving()) setPlaying(false) }
    }, { threshold: 0.65 })
    io.observe(box.current)
    return () => io.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const like = async (force) => {
    const on = force ?? !reel.liked
    if (on === reel.liked) return
    setReel((x) => ({ ...x, liked: on, like_count: x.like_count + (on ? 1 : -1) }))
    try { await api.like(reel.id, on) } catch (e) { toast(e.message, 'error') }
  }
  const tap = (e) => {
    const now = Date.now()
    if (now - lastTap.current < 280) {
      const rect = box.current.getBoundingClientRect()
      const id = now
      setHearts((h) => [...h, { id, x: e.clientX - rect.left - 48, y: e.clientY - rect.top - 48 }])
      setTimeout(() => setHearts((h) => h.filter((x) => x.id !== id)), 800)
      like(true)
      lastTap.current = 0
      return
    }
    lastTap.current = now
    setTimeout(() => {
      if (lastTap.current !== now) return
      const v = video.current
      if (!v) return
      if (v.paused) { v.play(); setPlaying(true) } else { v.pause(); setPlaying(false) }
    }, 290)
  }
  const share = async () => {
    const url = `${location.origin}/reels?start=${reel.id}`
    try {
      if (navigator.share) await navigator.share({ url })
      else { await navigator.clipboard.writeText(url); toast('ბმული დაკოპირდა') }
    } catch { /* */ }
  }
  const a = reel.author || {}
  return (
    <section className="reel" ref={box} aria-label={`ვიდეო: ${a.full_name}`}>
      <div className="frame" onClick={tap}>
        {m?.type === 'video'
          ? <video ref={video} src={m.url} loop playsInline muted={muted} preload={saver ? 'none' : 'metadata'} />
          : <img className="kb" src={m?.url} alt="" />}
      </div>
      <div className="shade" />
      {!playing && <div className="paused"><Icon name="play" size={32} /></div>}
      {hearts.map((h) => <div key={h.id} className="reel-heart" style={{ left: h.x, top: h.y }}><Icon name="heart" size={96} fill /></div>)}
      <div className="reel-info">
        <div className="who">
          <Link to={`/u/${a.username}`} className="hstack"><Avatar user={a} size={36} /><span>{a.full_name || a.username}</span></Link>
          {a.id !== me?.id && !followed && (
            <button className="btn" onClick={async () => { setFollowed(true); await api.follow(a.id, true) }}>გამოწერა</button>
          )}
        </div>
        {reel.body && <p><RichText text={reel.body} /></p>}
      </div>
      <div className="reel-side">
        <button className={reel.liked ? 'liked' : ''} onClick={() => like()} aria-label="მოწონება"><Icon name="heart" size={32} fill={reel.liked} />{count(reel.like_count) || 0}</button>
        <button onClick={onComments} aria-label="კომენტარები"><Icon name="reply" size={30} />{count(reel.reply_count) || 0}</button>
        <button onClick={share} aria-label="გაზიარება"><Icon name="send" size={29} /></button>
      </div>
    </section>
  )
}

function Comments({ reel, onClose }) {
  const [list, setList] = useState(null)
  const { compose } = useComposer()
  useEffect(() => {
    api.thread(reel.id).then((t) => setList(t?.replies.filter((r) => r.parent_id === reel.id) || [])).catch(() => setList([]))
    const onPosted = (e) => { if (e.detail.parent_id === reel.id) setList((c) => [...(c || []), e.detail]) }
    window.addEventListener('ezo:posted', onPosted)
    return () => window.removeEventListener('ezo:posted', onPosted)
  }, [reel.id])
  return (
    <Sheet title="კომენტარები" onClose={onClose} actions={<button className="btn btn-primary sm" onClick={() => compose({ parent: reel })}>დაწერა</button>}>
      <div style={{ overflowY: 'auto', minHeight: 200 }}>
        {list === null && <div className="center pad"><div className="spinner" /></div>}
        {list?.length === 0 && <p className="pad small faint" style={{ textAlign: 'center' }}>კომენტარები ჯერ არ არის. დაწერე პირველი.</p>}
        {list?.map((r) => <PostCard key={r.id} post={r} />)}
      </div>
    </Sheet>
  )
}
