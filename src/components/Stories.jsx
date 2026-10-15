import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Avatar, ConfirmSheet, PersonRow, Sheet } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useComposer } from './Composer.jsx'
import { timeAgo, agoPhrase } from '../lib/format.js'
import { navigate } from '../lib/router.jsx'
import { useToast } from './Toast.jsx'

export function StoryRail() {
  const { me } = useAuth()
  const { chooser } = useComposer()
  const [groups, setGroups] = useState(null)
  const [open, setOpen] = useState(null)

  const load = useCallback(() => api.stories().then(setGroups).catch(() => setGroups([])), [])
  useEffect(() => {
    load()
    window.addEventListener('ezo:story', load)
    return () => window.removeEventListener('ezo:story', load)
  }, [load])

  const mine = groups?.find((g) => g.author.id === me?.id)
  const others = groups?.filter((g) => g.author.id !== me?.id) || []

  return (
    <>
      <div className="stories" role="list" aria-label="სთორიები">
        <button className="story-bubble" onClick={() => (mine ? setOpen(groups.indexOf(mine)) : chooser())} role="listitem">
          <span style={{ position: 'relative' }}>
            <span className={`story-ring${mine ? (mine.seen ? ' seen' : '') : ' add'}`}>
              <span className="inner"><Avatar user={me} size={58} /></span>
            </span>
            {!mine && <span className="story-add-plus"><Icon name="plus" size={14} strokeWidth={3} /></span>}
          </span>
          <span className="name">შენი სთორი</span>
        </button>
        {groups === null && Array.from({ length: 5 }, (_, i) => (
          <div className="story-bubble" key={i}><div className="skel" style={{ width: 70, height: 70, borderRadius: '50%' }} /><div className="skel" style={{ width: 48, height: 9 }} /></div>
        ))}
        {others.map((g) => (
          <button key={g.author.id} className="story-bubble" role="listitem" onClick={() => setOpen(groups.indexOf(g))}>
            <span className={`story-ring${g.seen ? ' seen' : ''}${g.close ? ' close' : ''}`}><span className="inner"><Avatar user={g.author} size={58} /></span></span>
            <span className="name">{g.author.full_name?.split(' ')[0] || g.author.username}</span>
          </button>
        ))}
      </div>
      {open !== null && groups?.[open] && (
        <StoryViewer
          groups={groups}
          start={open}
          onClose={() => { setOpen(null); load() }}
        />
      )}
    </>
  )
}

const DURATION = 5000

// mode: 'stories' | 'highlight' (ჰაილაითი — მხოლოდ ყურება; მფლობელს შეუძლია წაშლა)
export function StoryViewer({ groups, start, onClose, mode = 'stories', onDeleteHighlight }) {
  const highlight = mode === 'highlight'
  const { me } = useAuth()
  const [viewers, setViewers] = useState(null)
  const [panel, setPanel] = useState(null) // 'viewers' | 'delete'
  const [reply, setReply] = useState('')
  const [typingReply, setTypingReply] = useState(false)
  const toast = useToast()
  const [gi, setGi] = useState(start)
  const [ii, setIi] = useState(() => Math.max(0, groups[start].items.findIndex((s) => !s.seen)))
  const [paused, setPaused] = useState(false)
  const bar = useRef(null)
  const raf = useRef(0)
  const elapsed = useRef(0)
  const group = groups[gi]
  const item = group?.items[ii]

  const next = useCallback(() => {
    elapsed.current = 0
    if (ii < group.items.length - 1) setIi(ii + 1)
    else if (gi < groups.length - 1) { setGi(gi + 1); setIi(0) }
    else onClose()
  }, [ii, gi, group, groups.length, onClose])
  const prev = () => {
    elapsed.current = 0
    if (ii > 0) setIi(ii - 1)
    else if (gi > 0) { setGi(gi - 1); setIi(0) }
  }

  const mine = group?.author.id === me?.id
  useEffect(() => {
    if (!item || highlight) return
    if (mine) { setViewers(null); api.storyViewers(item.id).then(setViewers).catch(() => setViewers([])) }
    else api.viewStory(item.id)
  }, [item, mine, highlight])
  useEffect(() => { setPaused(Boolean(panel) || typingReply) }, [panel, typingReply])
  const sendReply = async (body) => {
    if (!body.trim()) return
    try {
      const conv = await api.openDM(group.author.id)
      await api.send(conv, { body: body.trim(), meta: { story: { id: item.id, url: item.media_type === 'image' ? item.media_url : null } } })
      setReply('')
      setTypingReply(false)
      toast('გაიგზავნა')
    } catch (e) { toast(e.message, 'error') }
  }

  useEffect(() => {
    let last = performance.now()
    const tick = (t) => {
      if (!paused) elapsed.current += t - last
      last = t
      const pct = Math.min(1, elapsed.current / DURATION)
      if (bar.current) bar.current.style.width = `${pct * 100}%`
      if (pct >= 1) next()
      else raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [gi, ii, paused, next])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  if (!item) return null
  return createPortal(
    <div className="story-viewer" role="dialog" aria-label={`${group.author.full_name} — სთორი`}>
      <div className="story-stage"
        onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)}>
        {item.media_type === 'video'
          ? <video src={item.media_url} autoPlay playsInline muted />
          : <img src={item.media_url} alt="" />}
        <div className="story-bars">
          {group.items.map((s, i) => (
            <div key={s.id}><i ref={i === ii ? bar : null} style={{ width: i < ii ? '100%' : '0%' }} /></div>
          ))}
        </div>
        <div className="story-head">
          <button className="hstack" onClick={() => { onClose(); navigate(`/u/${group.author.username}`) }}>
            <Avatar user={group.author} size={34} />
            <b>{highlight ? group.title : group.author.full_name || group.author.username}</b>
            <span style={{ opacity: 0.75 }} className="small">{timeAgo(item.created_at)}</span>
          </button>
          {item.audience === 'close' && <span className="cf-badge" title="ახლო მეგობრებისთვის" aria-label="ახლო მეგობრებისთვის"><Icon name="star" size={13} fill /></span>}
          <span className="grow" />
          <button className="icon-btn" onClick={onClose} aria-label="დახურვა"><Icon name="close" /></button>
        </div>
        <button className="story-tap l" aria-label="წინა" onClick={prev} />
        <button className="story-tap r" aria-label="შემდეგი" onClick={next} />
        {item.caption && (!mine || highlight) && <div className="story-caption" style={{ bottom: highlight ? 0 : 70 }}>{item.caption}</div>}
        {!mine && !highlight && (
          <form className="story-reply" onSubmit={(e) => { e.preventDefault(); sendReply(reply) }} onPointerDown={(e) => e.stopPropagation()}>
            <input value={reply} onChange={(e) => setReply(e.target.value)} onFocus={() => setTypingReply(true)} onBlur={() => !reply && setTypingReply(false)}
              placeholder={`უპასუხე ${group.author.full_name?.split(' ')[0] || group.author.username}-ს…`} aria-label="პასუხი სთორიზე" />
            {reply.trim()
              ? <button className="qr" type="submit" aria-label="გაგზავნა"><Icon name="send" size={24} /></button>
              : ['❤️', '🔥', '😂'].map((e) => <button key={e} type="button" className="qr" onClick={() => sendReply(e)} aria-label={e}>{e}</button>)}
          </form>
        )}
        {highlight && mine && onDeleteHighlight && (
          <div className="story-foot">
            <span />
            <button onClick={() => setPanel('delete')} aria-label="ჰაილაითის წაშლა"><Icon name="trash" size={20} />ჰაილაითის წაშლა</button>
          </div>
        )}
        {mine && !highlight && (
          <div className="story-foot">
            <button onClick={() => setPanel('viewers')}><Icon name="eye" size={20} />{viewers ? `${viewers.length} ნახვა` : '…'}</button>
            <button onClick={() => setPanel('delete')} aria-label="სთორის წაშლა"><Icon name="trash" size={20} /></button>
          </div>
        )}
        {panel === 'viewers' && (
          <Sheet title="ვინ ნახა" onClose={() => setPanel(null)}>
            <div style={{ overflowY: 'auto', paddingBottom: 12, minHeight: 160 }}>
              {viewers?.length === 0 && <p className="pad small faint" style={{ textAlign: 'center' }}>ჯერ არავის უნახავს</p>}
              {viewers?.map((v) => <PersonRow key={v.id} user={v} sub={agoPhrase(v.viewed_at)} />)}
            </div>
          </Sheet>
        )}
        {panel === 'delete' && (
          <ConfirmSheet title={highlight ? 'ჰაილაითის წაშლა' : 'სთორის წაშლა'} onClose={() => setPanel(null)}
            onConfirm={async () => { if (highlight) await onDeleteHighlight(group.id); else await api.deleteStory(item.id); onClose() }} />
        )}
      </div>
    </div>,
    document.body,
  )
}
