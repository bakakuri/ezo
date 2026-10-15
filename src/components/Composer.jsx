import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Sheet, Avatar } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useToast } from './Toast.jsx'
import { compressImage, mediaDims, checkFile } from '../lib/media.js'
import { QuoteCard, LinkCard } from './PostCard.jsx'
import { firstUrl } from '../lib/links.js'
import { PollEditor, pollReady } from './PostExtras.jsx'
import { navigate } from '../lib/router.jsx'
import { timeAgo } from '../lib/format.js'

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

// @მოხსენიება კურსორთან: „…@nin|“ → 'nin'
const MENTION_AT = /(^|[^A-Za-z0-9_.@])@([A-Za-z0-9_.]{0,24})$/

function ComposerSheet({ kind = 'post', parent, quote, group, prefill = '', withPoll = false, edit = null, onSaved, onClose }) {
  const { me } = useAuth()
  const toast = useToast()
  const [text, setText] = useState(edit ? edit.body || '' : prefill)
  const [files, setFiles] = useState([]) // { file, url }
  const [busy, setBusy] = useState(false)
  const [poll, setPoll] = useState(withPoll ? { options: ['', ''], days: 1, multi: false } : null)
  const pick = useRef(null)
  const ta = useRef(null)
  const isReel = kind === 'reel'
  // მონახაზები: მხოლოდ ჩვეულებრივ პოსტზე (არა პასუხი, ციტატა ან ვიდეო)
  const draftable = !parent && !quote && !isReel && !edit
  const [draftId, setDraftId] = useState(null)
  const [drafts, setDrafts] = useState([])
  const [panel, setPanel] = useState(null) // 'drafts' | 'ask'
  const saved = useRef({ text: prefill, poll: JSON.stringify(poll) })
  const live = useRef({})
  live.current = { text, poll, busy, files }

  // ბმულის ბარათი: ტექსტის პირველი ბმული → /api/unfurl (ფოტოს, გამოკითხვის ან ციტატის გარეშე)
  const [link, setLink] = useState(edit?.link || null)
  const linkFor = useRef(edit?.link ? firstUrl(edit.body || '') : null)
  const [linkOff, setLinkOff] = useState(null)
  const linkAllowed = !isReel && !quote && !poll && !files.length && !(edit && (edit.media?.length || edit.quote_id || edit.poll))
  useEffect(() => {
    if (!linkAllowed) return
    const url = firstUrl(text)
    if (url === linkFor.current) return
    if (!url || url === linkOff) { linkFor.current = url; setLink(null); return }
    const t = setTimeout(() => {
      linkFor.current = url
      api.unfurl(url).then((r) => { if (linkFor.current === url) setLink(r?.title ? r : null) })
    }, 700)
    return () => clearTimeout(t)
  }, [text, linkAllowed, linkOff])

  // @მოხსენიების შემოთავაზებები
  const [mention, setMention] = useState(null) // { q, start, list, i }
  const mentionReq = useRef(0)
  const onType = (e) => {
    setText(e.target.value)
    const caret = e.target.selectionStart ?? e.target.value.length
    const m = MENTION_AT.exec(e.target.value.slice(0, caret))
    if (!m || m[2].length < 2) { setMention(null); return }
    const q = m[2]
    const id = ++mentionReq.current
    setMention((cur) => ({ q, start: caret - q.length - 1, list: cur?.list || [], i: 0 }))
    setTimeout(() => {
      if (id !== mentionReq.current) return
      api.search(q).then((people) => {
        if (id !== mentionReq.current) return
        const list = people.filter((p) => p.id !== me?.id && p.username).slice(0, 5)
        setMention((cur) => (cur && cur.q === q ? { ...cur, list, i: 0 } : cur))
      }).catch(() => {})
    }, 220)
  }
  const pickMention = (u) => {
    const end = mention.start + mention.q.length + 1
    const next = `${text.slice(0, mention.start)}@${u.username} ${text.slice(end)}`
    setText(next)
    setMention(null)
    mentionReq.current++
    caretTo.current = mention.start + u.username.length + 2
  }
  // კურსორი ჩასმული სახელის შემდეგ — მაშინვე, React-ის განახლებისთანავე (შემდეგ ასოებამდე)
  const caretTo = useRef(null)
  useLayoutEffect(() => {
    if (caretTo.current === null || !ta.current) return
    ta.current.focus()
    ta.current.setSelectionRange(caretTo.current, caretTo.current)
    caretTo.current = null
  })
  const onKey = (e) => {
    if (mention?.list.length) {
      const n = mention.list.length
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMention((m) => ({ ...m, i: (m.i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n })); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mention.list[mention.i]); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null); return }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
  }

  useEffect(() => { ta.current?.focus() }, [])
  useEffect(() => { if (draftable) api.drafts().then(setDrafts).catch(() => {}) }, [draftable])

  // დახურვისას: თუ რამე დაწერილია და შენახული არაა — ვკითხოთ
  const requestClose = useCallback(() => {
    const { text: t, poll: pl, busy: b } = live.current
    const dirty = t.trim() !== saved.current.text.trim() || JSON.stringify(pl) !== saved.current.poll
    if (draftable && !b && dirty && (t.trim() || pl?.options?.some((o) => o.trim()))) setPanel('ask')
    else onClose()
  }, [draftable, onClose])

  const saveDraft = async () => {
    try {
      const pollData = poll ? { options: poll.options, days: poll.days, multi: poll.multi } : null
      const d = await api.saveDraft({ id: draftId, body: text, poll: pollData, group_id: group?.id || null })
      saved.current = { text, poll: JSON.stringify(poll) }
      setDraftId(d.id)
      toast(files.length ? 'მონახაზი შეინახა — ფოტოები მონახაზში არ ინახება' : 'მონახაზი შეინახა')
      onClose()
    } catch (e) { toast(e.message, 'error') }
  }
  const openDraft = (d) => {
    setText(d.body)
    const pl = d.poll ? { options: d.poll.options?.length ? d.poll.options : ['', ''], days: d.poll.days || 1, multi: Boolean(d.poll.multi) } : null
    setPoll(pl)
    setDraftId(d.id)
    saved.current = { text: d.body, poll: JSON.stringify(pl) }
    setPanel(null)
    setTimeout(() => ta.current?.focus(), 50)
  }
  const removeDraft = async (d) => {
    setDrafts((list) => list.filter((x) => x.id !== d.id))
    if (d.id === draftId) setDraftId(null)
    try { await api.deleteDraft(d.id) } catch (e) { toast(e.message, 'error') }
  }
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

  const editChanged = Boolean(edit) && (text.trim() !== (edit.body || '').trim() || (linkAllowed && (link?.url || null) !== (edit.link?.url || null)))
  const canPost = edit
    ? !busy && text.length <= MAX && Boolean(text.trim() || edit.media?.length) && editChanged
    : !busy && text.length <= MAX && (poll ? text.trim() && pollReady(poll) : isReel ? files.length > 0 : text.trim() || files.length)

  const submit = async () => {
    if (!canPost) return
    setBusy(true)
    if (edit) {
      try {
        const post = await api.editPost(edit.id, text.trim(), linkAllowed ? link : edit.link ?? null)
        onSaved?.(post)
        toast('შესწორდა')
        onClose()
      } catch (e) {
        toast(e.message, 'error')
        setBusy(false)
      }
      return
    }
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
      const post = await api.createPost({ body: text.trim(), media, kind, parent_id: parent?.id || null, quote_id: quote?.id || null, group_id: group?.id || null, poll: pollData, link: linkAllowed ? link : null })
      if (draftId) api.deleteDraft(draftId).catch(() => {})
      window.dispatchEvent(new CustomEvent('ezo:posted', { detail: post }))
      toast(parent ? 'პასუხი გამოქვეყნდა' : 'გამოქვეყნდა')
      onClose()
    } catch (e) {
      toast(e.message, 'error')
      setBusy(false)
    }
  }

  const title = edit ? 'რედაქტირება' : parent ? 'პასუხი' : quote ? 'ციტირება' : isReel ? 'ახალი ვიდეო' : poll ? 'გამოკითხვა' : 'ახალი პოსტი'
  const minutesLeft = edit ? Math.max(0, Math.ceil((Date.parse(edit.created_at) + 15 * 60000 - Date.now()) / 60000)) : 0
  return (
    <>
    <Sheet title={title} onClose={requestClose} actions={
      <button className="btn btn-primary sm" disabled={!canPost} onClick={submit}>{busy ? 'იტვირთება…' : edit ? 'შენახვა' : 'გამოქვეყნება'}</button>
    }>
      <div className="sheet-body">
        {draftable && drafts.length > 0 && (
          <button type="button" className="drafts-link" onClick={() => setPanel('drafts')}>
            <Icon name="edit" size={15} />მონახაზები ({drafts.length})
          </button>
        )}
        {parent && (
          <div className="reply-hint">პასუხი <b>@{parent.author?.username}</b>-ს</div>
        )}
        {group && <div className="reply-hint"><Icon name="users" size={14} /> ჯგუფში: <b>{group.name}</b></div>}
        {edit && <div className="reply-hint">შესწორება შეგიძლია კიდევ {minutesLeft} წუთი. პოსტზე გამოჩნდება „შესწორებული“.</div>}
        <div className="composer">
          <Avatar user={me} size={40} />
          <div style={{ minWidth: 0 }}>
            <b>{me?.full_name || me?.username}</b>
            <textarea
              ref={ta}
              value={text}
              onChange={onType}
              onBlur={() => setTimeout(() => setMention(null), 150)}
              placeholder={poll ? 'დასვი კითხვა…' : parent ? 'დაწერე პასუხი…' : isReel ? 'აღწერა ვიდეოსთვის…' : 'რა ხდება ეზოში?'}
              onKeyDown={onKey}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={Boolean(mention?.list.length)}
              aria-controls="mention-list"
              aria-activedescendant={mention?.list.length ? `mention-${mention.list[mention.i].id}` : undefined}
            />
            {mention?.list.length > 0 && (
              <ul className="mention-list" id="mention-list" role="listbox" aria-label="ვის მოიხსენიებ">
                {mention.list.map((u, i) => (
                  <li key={u.id} id={`mention-${u.id}`} role="option" aria-selected={i === mention.i} className={i === mention.i ? 'on' : ''}
                    onPointerDown={(e) => { e.preventDefault(); pickMention(u) }}>
                    <Avatar user={u} size={30} />
                    <span className="grow"><b>{u.full_name || u.username}</b><small>@{u.username}</small></span>
                  </li>
                ))}
              </ul>
            )}
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
            {linkAllowed && link && <LinkCard link={link} onRemove={() => { setLinkOff(linkFor.current); setLink(null) }} />}
            {poll && <PollEditor value={poll} onChange={setPoll} />}
            {!edit && <div className="composer-tools">
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
            </div>}
          </div>
        </div>
      </div>
    </Sheet>
    {panel === 'ask' && (
      <Sheet title="მონახაზად შევინახო?" onClose={() => setPanel(null)}>
        <div className="sheet-body vstack">
          <p className="muted small">მონახაზი ყველა მოწყობილობაზე გამოჩნდება — „ახალი პოსტის“ ფანჯარაში, „მონახაზებში“.</p>
          <button className="btn btn-primary lg block" onClick={saveDraft}>მონახაზად შენახვა</button>
          <button className="btn btn-outline lg block" onClick={() => { setPanel(null); onClose() }}>{draftId ? 'ცვლილებების გაუქმება' : 'წაშლა'}</button>
          <button className="btn btn-ghost block" onClick={() => setPanel(null)}>წერის გაგრძელება</button>
        </div>
      </Sheet>
    )}
    {panel === 'drafts' && (
      <Sheet title="მონახაზები" onClose={() => setPanel(null)}>
        <div className="drafts-list">
          {drafts.map((d) => (
            <div key={d.id} className={`draft-row${d.id === draftId ? ' on' : ''}`}>
              <button type="button" className="grow" onClick={() => openDraft(d)}>
                <span className="draft-text">{d.body || 'უსათაურო'}</span>
                <small>{d.poll ? 'გამოკითხვა, ' : ''}{timeAgo(d.updated_at)}</small>
              </button>
              <button type="button" className="icon-btn sm" onClick={() => removeDraft(d)} aria-label="მონახაზის წაშლა"><Icon name="trash" size={17} /></button>
            </div>
          ))}
          {drafts.length === 0 && <p className="pad small faint">მონახაზები აღარ არის.</p>}
        </div>
      </Sheet>
    )}
    </>
  )
}
