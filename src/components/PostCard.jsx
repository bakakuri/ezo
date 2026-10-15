import { useState } from 'react'
import { Avatar, Sheet } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { Link, navigate } from '../lib/router.jsx'
import { timeAgo, count } from '../lib/format.js'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useToast } from './Toast.jsx'
import { useComposer } from './Composer.jsx'
import { ReportSheet } from './Report.jsx'
import { PollView, SaveSheet } from './PostExtras.jsx'

// #თეგები და @მოხსენიებები ბმულებად
export function RichText({ text }) {
  if (!text) return null
  const parts = text.split(/([#@][\p{L}\p{N}_.]+)/gu)
  return parts.map((p, i) => {
    if (p.startsWith('@') && p.length > 1) return <Link key={i} className="tag" to={`/u/${p.slice(1).replace(/\.$/, '')}`} onClick={(e) => e.stopPropagation()}>{p}</Link>
    if (p.startsWith('#') && p.length > 1) return <Link key={i} className="tag" to={`/tag/${encodeURIComponent(p.slice(1).toLowerCase())}`} onClick={(e) => e.stopPropagation()}>{p}</Link>
    return p
  })
}

export function Media({ media }) {
  if (!media?.length) return null
  const single = media.length === 1
  return (
    <div className={`media ${single ? 'single' : 'multi'}`} onClick={(e) => e.stopPropagation()}>
      {media.map((m, i) => (
        <div className="m" key={i} style={single && m.w && m.h ? { aspectRatio: `${Math.max(m.w / m.h, 0.66)}` } : undefined}>
          {m.type === 'video'
            ? <video src={m.url} controls playsInline preload="metadata" muted />
            : <img src={m.url} alt="" loading="lazy" decoding="async" />}
        </div>
      ))}
    </div>
  )
}

export function QuoteCard({ post }) {
  if (!post) return null
  return (
    <Link to={`/p/${post.id}`} className="quote-card" onClick={(e) => e.stopPropagation()}>
      <div className="qhead"><Avatar user={post.author} size={20} /><b>{post.author?.full_name || post.author?.username}</b><span className="faint">{timeAgo(post.created_at)}</span></div>
      {post.body && <div className="qbody">{post.body}</div>}
      {post.media?.[0]?.type === 'image' && <img src={post.media[0].thumb || post.media[0].url} alt="" loading="lazy" decoding="async" />}
    </Link>
  )
}

export function PostCard({ post: initial, threaded = false, focus = false, hideGroup = false, onDeleted }) {
  const [post, setPost] = useState(initial)
  const [menu, setMenu] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [burst, setBurst] = useState(0)
  const [saving, setSaving] = useState(false)
  const { me } = useAuth()
  const toast = useToast()
  const { compose } = useComposer()
  if (!post) return null
  const a = post.author || {}

  const like = async (e) => {
    e.stopPropagation()
    const on = !post.liked
    setPost((p) => ({ ...p, liked: on, like_count: p.like_count + (on ? 1 : -1) }))
    if (on) { setBurst((b) => b + 1); setTimeout(() => setBurst(0), 700) }
    try { await api.like(post.id, on) } catch (er) {
      setPost((p) => ({ ...p, liked: !on, like_count: p.like_count + (on ? -1 : 1) }))
      toast(er.message, 'error')
    }
  }
  const toggleSave = async (e) => {
    e.stopPropagation()
    const on = !post.saved
    setPost((p) => ({ ...p, saved: on }))
    try { await api.save(post.id, on); if (on) toast('შეინახა') } catch (er) { setPost((p) => ({ ...p, saved: !on })); toast(er.message, 'error') }
  }
  const share = async (e) => {
    e.stopPropagation()
    const url = `${location.origin}/p/${post.id}`
    try {
      if (navigator.share) await navigator.share({ url, text: post.body?.slice(0, 80) })
      else { await navigator.clipboard.writeText(url); toast('ბმული დაკოპირდა') }
    } catch { /* გაუქმდა */ }
  }

  return (
    <article className={`post${threaded ? ' threaded' : ''}${focus ? ' focus' : ''}`} onClick={() => !focus && navigate(`/p/${post.id}`)} style={{ cursor: focus ? 'default' : 'pointer' }}>
      {!focus && (
        <div className="post-rail">
          <Link to={`/u/${a.username}`} onClick={(e) => e.stopPropagation()}><Avatar user={a} size={40} /></Link>
          {threaded && <div className="line" />}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="post-head">
          {focus && <Link to={`/u/${a.username}`} style={{ marginRight: 6 }}><Avatar user={a} size={40} /></Link>}
          <Link to={`/u/${a.username}`} className="name" onClick={(e) => e.stopPropagation()}>{a.full_name || a.username}</Link>
          {post.group && !hideGroup && (
            <Link to={`/groups/${post.group.slug}`} className="post-group" onClick={(e) => e.stopPropagation()}>
              <Icon name="users" size={13} /><b>{post.group.name}</b>
            </Link>
          )}
          <time className="time" dateTime={post.created_at}>{timeAgo(post.created_at)}</time>
          <button className="icon-btn sm more" aria-label="მეტი" onClick={(e) => { e.stopPropagation(); setMenu(true) }}><Icon name="more" size={18} /></button>
        </div>
        {post.body && <div className="post-body"><RichText text={post.body} /></div>}
        <Media media={post.media} />
        {post.poll && <PollView postId={post.id} poll={post.poll} own={a.id === me?.id} />}
        {post.quote && <QuoteCard post={post.quote} />}
        <div className="actions">
          <button className={`act${post.liked ? ' liked' : ''}`} onClick={like} aria-label="მოწონება" aria-pressed={post.liked}>
            <Icon name="heart" size={20} fill={post.liked} />{burst > 0 && <span className="burst" key={burst} aria-hidden="true" />}<span className="cnt" key={post.like_count}>{count(post.like_count)}</span>
          </button>
          <button className="act" aria-label="პასუხი" onClick={(e) => { e.stopPropagation(); compose({ parent: post }) }}>
            <Icon name="reply" size={20} />{count(post.reply_count)}
          </button>
          <button className="act" aria-label="ციტირება" onClick={(e) => { e.stopPropagation(); compose({ quote: post }) }}>
            <Icon name="repost" size={20} />{count(post.repost_count)}
          </button>
          <button className="act" aria-label="გაზიარება" onClick={share}><Icon name="send" size={19} /></button>
          <button className={`act save${post.saved ? ' saved' : ''}`} aria-label={post.saved ? 'შენახულიდან ამოღება' : 'შენახვა'} aria-pressed={Boolean(post.saved)}
            onClick={toggleSave} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSaving(true) }}>
            <Icon name="bookmark" size={19} fill={Boolean(post.saved)} />
          </button>
        </div>
      </div>
      {menu && (
        <Sheet onClose={() => setMenu(false)}>
          <div className="menu" onClick={(e) => e.stopPropagation()}>
            {a.id === me?.id ? (
              <button className="danger" onClick={async () => {
                setMenu(false)
                await api.deletePost(post.id)
                toast('წაიშალა')
                onDeleted?.(post.id)
                setPost(null)
              }}><Icon name="trash" />წაშლა</button>
            ) : (
              <>
                <button onClick={() => { setMenu(false); setReporting(true) }}><Icon name="flag" />დარეპორტება</button>
                <button className="danger" onClick={async () => { setMenu(false); await api.block(a.id); toast(`@${a.username} დაიბლოკა`); setPost(null) }}><Icon name="block" />დაბლოკვა @{a.username}</button>
              </>
            )}
            <button onClick={() => { setMenu(false); setSaving(true) }}><Icon name="bookmark" />კოლექციაში შენახვა</button>
            <button onClick={(e) => { setMenu(false); share(e) }}><Icon name="link" />ბმულის კოპირება</button>
          </div>
        </Sheet>
      )}
      {saving && <div onClick={(e) => e.stopPropagation()}><SaveSheet postId={post.id} onClose={() => setSaving(false)} onSaved={() => setPost((p) => ({ ...p, saved: true }))} /></div>}
      {reporting && <div onClick={(e) => e.stopPropagation()}><ReportSheet post={post.id} onClose={() => setReporting(false)} /></div>}
    </article>
  )
}
