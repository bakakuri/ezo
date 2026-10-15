import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Sheet, Avatar } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useToast } from './Toast.jsx'
import { compressImage, mediaDims, checkFile } from '../lib/media.js'
import { QuoteCard } from './PostCard.jsx'
import { PollEditor, pollReady } from './PostExtras.jsx'
import { navigate } from '../lib/router.jsx'

const ComposerCtx = createContext(null)
const MAX = 2000

export function ComposerProvider({ children }) {
  const [open, setOpen] = useState(null) // { mode: 'chooser' | 'post', parent, quote, kind }
  const compose = useCallback((opts = {}) => setOpen({ mode: 'post', kind: 'post', ...opts }), [])
  const chooser = useCallback(() => setOpen({ mode: 'chooser' }), [])
  const close = useCallback(() => setOpen(null), [])
  return (
    <ComposerCtx.Provider value={{ compose, chooser }}>
      {children}
      {open?.mode === 'chooser' && <CreateChooser onClose={close} onPick={(kind) => setOpen(kind === 'poll' ? { mode: 'post', kind: 'post', withPoll: true } : { mode: 'post', kind })} />}
      {open?.mode === 'post' && <ComposerSheet {...open} onClose={close} />}
    </ComposerCtx.Provider>
  )
}

export const useComposer = () => useContext(ComposerCtx)

function CreateChooser({ onClose, onPick }) {
  const toast = useToast()
  const fileRef = useRef(null)
  const audience = useRef('all')
  const [busy, setBusy] = useState(false)
  const addStory = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const err = checkFile(file)
    if (err) return toast(err, 'error')
    setBusy(true)
    try {
      await api.createStory(file.type.startsWith('image') ? await compressImage(file, 1440) : file, '', audience.current)
      window.dispatchEvent(new Event('ezo:story'))
      toast(audience.current === 'close' ? 'სთორი ახლო მეგობრებისთვის დაემატა' : 'სთორი დაემატა')
      onClose()
    } catch (er) {
      toast(er.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title="შექმნა" onClose={onClose}>
      <div className="menu">
        <button onClick={() => onPick('post')}><Icon name="edit" /><div className="grow"><b>პოსტი</b><div className="small muted">ტექსტი, ფოტოები, თრედი</div></div></button>
        <button onClick={() => { audience.current = 'all'; fileRef.current?.click() }} disabled={busy}><Icon name="camera" /><div className="grow"><b>სთორი</b><div className="small muted">ქრება 24 საათში</div></div>{busy && <div className="spinner" />}</button>
        <button onClick={() => { audience.current = 'close'; fileRef.current?.click() }} disabled={busy}><span className="cf-ico"><Icon name="star" size={18} fill /></span><div className="grow"><b>სთორი ახლო მეგობრებისთვის</b><div className="small muted">მხოლოდ შენ მიერ არჩეულები ნახავენ</div></div></button>
        <button onClick={() => onPick('poll')}><Icon name="poll" /><div className="grow"><b>გამოკითხვა</b><div className="small muted">2–4 პასუხი, 1 დღიდან 1 კვირამდე</div></div></button>
        <button onClick={() => onPick('reel')}><Icon name="reels" /><div className="grow"><b>ვიდეო</b><div className="small muted">ვერტიკალური, „ვიდეოების“ ფიდში</div></div></button>
        <button onClick={() => { onClose(); navigate('/market/new') }}><Icon name="tag" /><div className="grow"><b>განცხადება ბაზარში</b><div className="small muted">გაყიდე ან აჩუქე ის, რაც აღარ გჭირდება</div></div></button>
      </div>
      <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={addStory} />
    </Sheet>
  )
}

function ComposerSheet({ kind = 'post', parent, quote, group, prefill = '', withPoll = false, onClose }) {
  const { me } = useAuth()
  const toast = useToast()
  const [text, setText] = useState(prefill)
  const [files, setFiles] = useState([]) // { file, url }
  const [busy, setBusy] = useState(false)
  const [poll, setPoll] = useState(withPoll ? { options: ['', ''], days: 1, multi: false } : null)
  const pick = useRef(null)
  const ta = useRef(null)
  const isReel = kind === 'reel'

  useEffect(() => { ta.current?.focus() }, [])
  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.url)), [files])

  const onFiles = (e) => {
    const list = [...(e.target.files || [])]
    e.target.value = ''
    for (const f of list) {
      const err = checkFile(f)
      if (err) { toast(err, 'error'); return }
    }
    const hasVideo = list.some((f) => f.type.startsWith('video'))
    if (isReel || hasVideo) setFiles(list.slice(0, 1).map((file) => ({ file, url: URL.createObjectURL(file) })))
    else setFiles((cur) => [...cur, ...list.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 6))
  }

  const canPost = !busy && text.length <= MAX && (poll ? text.trim() && pollReady(poll) : isReel ? files.length > 0 : text.trim() || files.length)

  const submit = async () => {
    if (!canPost) return
    setBusy(true)
    try {
      const media = []
      for (const { file } of files) {
        const ready = file.type.startsWith('image') ? await compressImage(file) : file
        const dims = await mediaDims(ready).catch(() => ({ w: 1080, h: 1350 }))
        const url = await api.upload(ready, isReel ? 'reels' : 'posts')
        // ბადეებისთვის პატარა ასლი (480 პქ) — ტრაფიკის დაზოგვა
        const thumb = file.type.startsWith('image') ? await api.upload(await compressImage(file, 480, 0.74), 'thumbs').catch(() => null) : null
        media.push({ url, type: file.type.startsWith('video') ? 'video' : 'image', ...dims, ...(thumb ? { thumb } : {}) })
      }
      const pollData = poll ? { options: poll.options.map((o) => o.trim()).filter(Boolean), days: poll.days, multi: poll.multi } : null
      const post = await api.createPost({ body: text.trim(), media, kind, parent_id: parent?.id || null, quote_id: quote?.id || null, group_id: group?.id || null, poll: pollData })
      window.dispatchEvent(new CustomEvent('ezo:posted', { detail: post }))
      toast(parent ? 'პასუხი გამოქვეყნდა' : 'გამოქვეყნდა')
      onClose()
    } catch (e) {
      toast(e.message, 'error')
      setBusy(false)
    }
  }

  const title = parent ? 'პასუხი' : quote ? 'ციტირება' : isReel ? 'ახალი ვიდეო' : poll ? 'გამოკითხვა' : 'ახალი პოსტი'
  return (
    <Sheet title={title} onClose={onClose} actions={
      <button className="btn btn-primary sm" disabled={!canPost} onClick={submit}>{busy ? 'იტვირთება…' : 'გამოქვეყნება'}</button>
    }>
      <div className="sheet-body">
        {parent && (
          <div className="reply-hint">პასუხი <b>@{parent.author?.username}</b>-ს</div>
        )}
        {group && <div className="reply-hint"><Icon name="users" size={14} /> ჯგუფში: <b>{group.name}</b></div>}
        <div className="composer">
          <Avatar user={me} size={40} />
          <div style={{ minWidth: 0 }}>
            <b>{me?.full_name || me?.username}</b>
            <textarea
              ref={ta}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={poll ? 'დასვი კითხვა…' : parent ? 'დაწერე პასუხი…' : isReel ? 'აღწერა ვიდეოსთვის…' : 'რა ხდება ეზოში?'}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
            />
            {files.length > 0 && (
              <div className="thumbs">
                {files.map((f, i) => (
                  <div className="t" key={f.url}>
                    {f.file.type.startsWith('video') ? <video src={f.url} muted playsInline /> : <img src={f.url} alt="" />}
                    <button aria-label="წაშლა" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            {quote && <QuoteCard post={quote} />}
            {poll && <PollEditor value={poll} onChange={setPoll} />}
            <div className="composer-tools">
              <button className="icon-btn sm" onClick={() => pick.current?.click()} aria-label={isReel ? 'ვიდეოს არჩევა' : 'ფოტო ან ვიდეო'}>
                <Icon name={isReel ? 'reels' : 'image'} size={21} />
              </button>
              <input ref={pick} type="file" hidden multiple={!isReel} accept={isReel ? 'video/*,image/*' : 'image/*,video/*'} onChange={onFiles} />
              {!isReel && !parent && (
                <button className={`icon-btn sm${poll ? ' on' : ''}`} onClick={() => setPoll(poll ? null : { options: ['', ''], days: 1, multi: false })} aria-label={poll ? 'გამოკითხვის მოხსნა' : 'გამოკითხვა'} aria-pressed={Boolean(poll)}>
                  <Icon name="poll" size={21} />
                </button>
              )}
              {isReel && !files.length && <span className="small faint">აირჩიე ვერტიკალური ვიდეო</span>}
              <span className={`counter${text.length > MAX ? ' over' : ''}`}>{text.length > MAX - 200 ? MAX - text.length : ''}</span>
            </div>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
