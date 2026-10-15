import { useCallback, useEffect, useState } from 'react'
import { Sheet } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { StoryViewer } from './Stories.jsx'
import { api } from '../lib/api.js'
import { dayMonth } from '../lib/format.js'
import { useToast } from './Toast.jsx'

// სთორის ჰაილაითები პროფილზე
export function HighlightsRow({ user, isMe }) {
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)
  const load = useCallback(() => api.highlights(user.id).then(setList).catch(() => setList([])), [user.id])
  useEffect(() => { load() }, [load])
  if (!list || (!list.length && !isMe)) return null

  const groups = list.map((h) => ({ id: h.id, title: h.title, author: user, seen: true, items: h.items }))
  return (
    <>
      <div className="highlights" role="list" aria-label="ჰაილაითები">
        {isMe && (
          <button className="hl" role="listitem" onClick={() => setCreating(true)}>
            <span className="hl-cover add"><Icon name="plus" size={26} /></span>
            <span className="name">ახალი</span>
          </button>
        )}
        {list.map((h, i) => (
          <button key={h.id} className="hl" role="listitem" onClick={() => setOpen(i)}>
            <span className="hl-cover">{h.cover_url && <img src={h.cover_url} alt="" loading="lazy" />}</span>
            <span className="name">{h.title}</span>
          </button>
        ))}
      </div>
      {open !== null && groups[open]?.items.length > 0 && (
        <StoryViewer groups={groups} start={open} mode="highlight" onClose={() => setOpen(null)}
          onDeleteHighlight={isMe ? async (id) => { await api.deleteHighlight(id); load() } : undefined} />
      )}
      {creating && <CreateHighlight onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load() }} />}
    </>
  )
}

function CreateHighlight({ onClose, onCreated }) {
  const toast = useToast()
  const [stories, setStories] = useState(null)
  const [picked, setPicked] = useState([])
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.storyArchive().then(setStories).catch(() => setStories([])) }, [])
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const save = async () => {
    setBusy(true)
    try { await api.createHighlight(title.trim(), picked); toast('ჰაილაითი შეიქმნა'); onCreated() } catch (e) { toast(e.message, 'error'); setBusy(false) }
  }
  return (
    <Sheet title="ახალი ჰაილაითი" onClose={onClose} actions={
      <button className="btn btn-primary sm" disabled={busy || !title.trim() || !picked.length} onClick={save}>შენახვა</button>
    }>
      <div className="sheet-body vstack">
        <label className="field"><span>სახელი</span>
          <input className="input" maxLength={30} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="მაგ. ზაფხული" />
        </label>
        <div className="field"><span>აირჩიე სთორიები <span className="faint">({picked.length})</span></span>
          {stories?.length === 0 && <p className="small muted">სთორი ჯერ არ გაქვს. დაამატე „შექმნა“ ღილაკით.</p>}
          <div className="archive-grid">
            {stories?.map((s) => {
              const on = picked.includes(s.id)
              const close = s.audience === 'close'
              return (
                <button key={s.id} className={`arch${on ? ' on' : ''}`} disabled={close} onClick={() => toggle(s.id)}
                  aria-pressed={on} aria-label={close ? 'ახლო მეგობრების სთორი — ჰაილაითში ვერ დაემატება' : `სთორი ${dayMonth(s.created_at)}`}>
                  {s.media_type === 'video' ? <video src={s.media_url} muted playsInline preload="metadata" /> : <img src={s.media_url} alt="" loading="lazy" />}
                  <span className="d">{dayMonth(s.created_at)}</span>
                  {close && <span className="cf"><Icon name="star" size={12} fill /></span>}
                  {on && <span className="tick"><Icon name="check" size={14} strokeWidth={3} /></span>}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </Sheet>
  )
}
