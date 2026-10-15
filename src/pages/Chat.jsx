import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Avatar, Empty, Loader, PersonRow, Sheet, TopBar, ConfirmSheet, Verified } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Link, back, navigate } from '../lib/router.jsx'
import { clock, seenText, timeAgo, dayMonth } from '../lib/format.js'
import { useUnread } from '../components/Shell.jsx'
import { compressImage } from '../lib/media.js'
import { useToast } from '../components/Toast.jsx'
import { ListingChatCard } from '../components/Listing.jsx'
import { useCalls } from '../components/Call.jsx'
import { ChatPrefsSheet, PollComposer, PollBubble, SearchResults, DISAPPEAR_LABEL, muteText } from '../components/ChatExtras.jsx'

const REACTIONS = ['❤️', '😂', '😮', '😢', '👍', '🔥']

function ConvAvatar({ c, size = 54 }) {
  if (c.kind !== 'group') return <Avatar user={c.other} size={size} online />
  const m = c.members || []
  if (m.length < 2) return <Avatar user={{ id: c.id, full_name: c.title }} size={size} />
  return (
    <span className="group-av" style={{ width: size, height: size }}>
      <Avatar user={m[0]} size={size * 0.68} />
      <Avatar user={m[1]} size={size * 0.68} />
    </span>
  )
}
const convName = (c) => (c.kind === 'group' ? c.title || 'ჯგუფური ჩატი' : c.other?.full_name || c.other?.username || 'მომხმარებელი')

export function Inbox() {
  const [list, setList] = useState(null)
  const [filter, setFilter] = useState('all')
  const [creating, setCreating] = useState(false)
  const [prefsFor, setPrefsFor] = useState(null)
  const [search, setSearch] = useState(null) // { q, results }
  const { me } = useAuth()
  const load = () => api.conversations().then(setList).catch(() => setList([]))
  useEffect(() => {
    load()
    return api.subscribeNotifications(load)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // ძებნა ყველა ჩატში (300 მწ პაუზით)
  useEffect(() => {
    if (!search || search.q.trim().length < 2) return
    let live = true
    const t = setTimeout(() => api.searchMessages(search.q).then((r) => { if (live) setSearch((s) => (s ? { ...s, results: r } : s)) }).catch(() => {}), 300)
    return () => { live = false; clearTimeout(t) }
  }, [search?.q]) // eslint-disable-line react-hooks/exhaustive-deps
  const press = useRef(0)
  const rowPress = (c) => ({
    onPointerDown: () => { clearTimeout(press.current); press.current = setTimeout(() => setPrefsFor(c), 480) },
    onPointerUp: () => clearTimeout(press.current),
    onPointerLeave: () => clearTimeout(press.current),
    onPointerCancel: () => clearTimeout(press.current),
    onContextMenu: (e) => { e.preventDefault(); clearTimeout(press.current); setPrefsFor(c) },
    onClickCapture: (e) => { if (prefsFor) e.preventDefault() },
  })
  const shown = list?.filter((c) => filter === 'all' || (filter === 'unread' ? c.unread : filter === 'groups' ? c.kind === 'group' : c.kind === 'dating'))
  return (
    <>
      <TopBar title="მესიჯები" backTo="/">
        <button className="icon-btn" onClick={() => setSearch(search ? null : { q: '', results: null })} aria-label="მესიჯებში ძებნა" aria-pressed={Boolean(search)}><Icon name={search ? 'close' : 'search'} /></button>
        <button className="icon-btn" onClick={() => setCreating(true)} aria-label="ჯგუფური ჩატი"><Icon name="userPlus" /></button>
      </TopBar>
      {search && (
        <div className="inbox-search">
          <div className="searchbox"><Icon name="search" size={19} />
            <input className="input" type="search" autoFocus placeholder="მესიჯებში ძებნა" aria-label="მესიჯებში ძებნა" value={search.q}
              onChange={(e) => setSearch({ q: e.target.value, results: e.target.value.trim().length < 2 ? [] : null })} />
          </div>
          <SearchResults results={search.results} q={search.q} onPick={(r) => navigate(`/chat/${r.conversation_id}?m=${r.id}`)} />
        </div>
      )}
      {!search && <>
      <div className="chips" style={{ padding: '10px 16px 6px' }}>
        {[['all', 'ყველა'], ['unread', 'წაუკითხავი'], ['groups', 'ჯგუფები'], ['dating', 'გაცნობა']].map(([k, l]) => (
          <button key={k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {list === null && <Loader />}
      {shown?.length === 0 && <Empty icon="chat" title="მესიჯები ჯერ არ არის" text="მისწერე მეგობარს მის პროფილიდან ან შექმენი ჯგუფური ჩატი." action={<button className="btn btn-primary" onClick={() => setCreating(true)}>ჯგუფური ჩატი</button>} />}
      {shown?.map((c) => (
        <Link key={c.id} to={`/chat/${c.id}`} className={`inbox-row${c.unread ? ' unread' : ''}${c.muted ? ' muted' : ''}`} {...rowPress(c)}>
          <ConvAvatar c={c} />
          <div className="who">
            <div className="top">
              <b>{convName(c)}</b>
              {c.muted && <Icon name="bellOff" size={15} className="row-flag" title={muteText(c)} />}
              {c.disappear_hours && <Icon name="timer" size={15} className="row-flag" title={`ქრებადი მესიჯები: ${DISAPPEAR_LABEL[c.disappear_hours]}`} />}
              {c.kind === 'dating' && <span className="tag-dating">გაცნობა</span>}
              {c.pinned && <Icon name="pushpin" size={15} className="row-pin" title="მიმაგრებული" />}
              <time>{timeAgo(c.updated_at)}</time>
            </div>
            <div className="last">
              {c.last_sender === me?.id ? 'შენ: ' : c.kind === 'group' && c.last_sender_name ? `${c.last_sender_name}: ` : ''}
              {c.last_message || 'დაიწყე საუბარი'}
            </div>
          </div>
          {c.unread && <span className="unread-dot" aria-label="წაუკითხავი" />}
        </Link>
      ))}
      {list?.length > 0 && <p className="inbox-hint">ჩატზე ხანგრძლივი შეხება — მიმაგრება, დადუმება, ქრებადი მესიჯები.</p>}
      </>}
      {prefsFor && <ChatPrefsSheet conv={prefsFor} title={convName(prefsFor)} onClose={() => setPrefsFor(null)} onChanged={load} />}
      {creating && <PeoplePicker title="ახალი ჯგუფური ჩატი" withTitle onClose={() => setCreating(false)} onDone={async (ids, title) => {
        const id = await api.createGroupChat(title, ids)
        setCreating(false)
        navigate(`/chat/${id}`)
      }} />}
    </>
  )
}

function PeoplePicker({ title, withTitle, exclude = [], onClose, onDone }) {
  const { me } = useAuth()
  const toast = useToast()
  const [people, setPeople] = useState(null)
  const [sel, setSel] = useState([])
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.followList(me.id, 'following').then((l) => setPeople(l.filter((p) => !exclude.includes(p.id)))).catch(() => setPeople([])) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (people || []).filter((p) => !q || (p.full_name + p.username).toLowerCase().includes(q.toLowerCase()))
  const ok = sel.length > 0 && (!withTitle || name.trim().length > 0)
  return (
    <Sheet title={title} onClose={onClose} actions={
      <button className="btn btn-primary sm" disabled={!ok || busy} onClick={async () => {
        setBusy(true)
        try { await onDone(sel, name.trim()) } catch (e) { toast(e.message, 'error'); setBusy(false) }
      }}>{withTitle ? 'შექმნა' : 'დამატება'}</button>
    }>
      <div className="sheet-body vstack" style={{ gap: 10, paddingBottom: 6 }}>
        {withTitle && <input className="input" maxLength={80} placeholder="ჩატის სახელი" value={name} onChange={(e) => setName(e.target.value)} />}
        <div className="searchbox"><Icon name="search" size={19} /><input className="input" type="search" placeholder="ძებნა გამოწერილებში" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {sel.length > 0 && <p className="small muted">არჩეულია: {sel.length}</p>}
      </div>
      <div style={{ overflowY: 'auto', paddingBottom: 12 }}>
        {people === null && <Loader />}
        {people?.length === 0 && <p className="pad small muted">ჯერ არავინ გყავს გამოწერილი.</p>}
        {shown.map((p) => (
          <label key={p.id} className="pick-row">
            <Avatar user={p} size={42} />
            <div className="grow"><b>{p.full_name || p.username}</b><div className="small faint">@{p.username}</div></div>
            <input type="checkbox" checked={sel.includes(p.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
          </label>
        ))}
      </div>
    </Sheet>
  )
}

const dayLabel = (d) => {
  const date = new Date(d)
  const today = new Date()
  const y = new Date(); y.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'დღეს'
  if (date.toDateString() === y.toDateString()) return 'გუშინ'
  return dayMonth(date, true)
}
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export function ChatRoom({ id }) {
  const { me } = useAuth()
  const toast = useToast()
  const unread = useUnread()
  const { startCall } = useCalls()
  const [conv, setConv] = useState(undefined)
  const [msgs, setMsgs] = useState(null)
  const [members, setMembers] = useState([])
  // ?text= — მზა ტექსტი (მაგ. მილოცვა მთავარიდან); ბმულიდან ვაშორებთ, რომ განახლებაზე არ გამეორდეს
  const [text, setText] = useState(() => (new URLSearchParams(location.search).get('text') || '').slice(0, 500))
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('text')) return
    history.replaceState(history.state, '', location.pathname)
    setTimeout(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange?.(el.value.length, el.value.length) } }, 60)
  }, [])
  const [replyTo, setReplyTo] = useState(null)
  const [typing, setTyping] = useState(false)
  const [rec, setRec] = useState(null)
  const [recTime, setRecTime] = useState(0)
  const [menu, setMenu] = useState(null) // message
  const [info, setInfo] = useState(false)
  const [prefs, setPrefs] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const [votes, setVotes] = useState([])
  const [search, setSearch] = useState(null) // { q, results }
  const [detached, setDetached] = useState(false) // ძებნიდან ძველ მესიჯებთან ვართ
  const skipScroll = useRef(false)
  const [, setTick] = useState(0)
  const scroller = useRef(null)
  const fileRef = useRef(null)
  const inputRef = useRef(null)
  const typingSent = useRef(0)
  const lastTap = useRef({ id: null, t: 0 })

  useEffect(() => {
    api.conversation(id).then((c) => {
      setConv(c)
      if (c?.kind === 'group') api.chatMembers(id).then(setMembers).catch(() => {})
    }).catch(() => setConv(null))
    // ?m= — ძებნიდან: ამ მესიჯის გარშემო
    const target = new URLSearchParams(location.search).get('m')
    if (target) {
      history.replaceState(history.state, '', location.pathname)
      skipScroll.current = true
      api.messages(id, { around: target }).then((l) => { setMsgs(l); setDetached(Boolean(l.hasNewer)); flashTo(target) }).catch(() => setMsgs([]))
    } else api.messages(id).then(setMsgs).catch(() => setMsgs([]))
    api.chatPollVotes(id).then(setVotes).catch(() => {})
    api.markRead(id).then(unread.refresh)
    const off1 = api.subscribeMessages(id, (ev) => {
      if (ev.kind === 'message:new') {
        setMsgs((cur) => {
          if (!cur || cur.some((x) => x.id === ev.row.id)) return cur
          const reply = ev.row.reply_to ? cur.find((x) => x.id === ev.row.reply_to) : null
          return [...cur, { ...ev.row, reactions: ev.row.reactions || [], reply: reply ? { id: reply.id, body: reply.body, sender_id: reply.sender_id, media_type: reply.media_type, deleted_at: reply.deleted_at } : null }]
        })
        if (ev.row.sender_id !== me?.id) api.markRead(id)
        if (ev.row.meta && 'disappear' in ev.row.meta) api.conversation(id).then(setConv).catch(() => {})
      } else if (ev.kind === 'message:update') {
        setMsgs((cur) => cur?.map((x) => (x.id === ev.row.id ? { ...x, ...ev.row, reactions: x.reactions, reply: x.reply } : x)))
      } else if (ev.kind === 'reaction:set') {
        setMsgs((cur) => cur?.map((x) => (x.id === ev.row.message_id ? { ...x, reactions: [...(x.reactions || []).filter((r) => r.user_id !== ev.row.user_id), { user_id: ev.row.user_id, emoji: ev.row.emoji }] } : x)))
      } else if (ev.kind === 'reaction:remove') {
        setMsgs((cur) => cur?.map((x) => (x.id === ev.row.message_id ? { ...x, reactions: (x.reactions || []).filter((r) => r.user_id !== ev.row.user_id) } : x)))
      } else if (ev.kind === 'poll:vote') {
        setVotes((cur) => (cur.some((v) => v.message_id === ev.row.message_id && v.user_id === ev.row.user_id && v.option === ev.row.option) ? cur : [...cur, ev.row]))
      } else if (ev.kind === 'poll:unvote') {
        setVotes((cur) => cur.filter((v) => !(v.message_id === ev.row.message_id && v.user_id === ev.row.user_id && v.option === ev.row.option)))
      }
    })
    const off2 = api.subscribeTyping?.(id, setTyping)
    return () => { off1?.(); off2?.() }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (skipScroll.current) { skipScroll.current = false; return }
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs?.length, typing])

  // ქრებადი მესიჯები: ვადაგასულს ეკრანიდანაც ვაქრობთ (ყოველ 20 წამში ვამოწმებთ)
  const hasExpiring = msgs?.some((m) => m.expires_at)
  useEffect(() => {
    if (!hasExpiring) return
    const t = setInterval(() => setTick((x) => x + 1), 20000)
    return () => clearInterval(t)
  }, [hasExpiring])
  const visible = msgs?.filter((m) => !m.expires_at || Date.parse(m.expires_at) > Date.now())

  // ძებნა ამ ჩატში
  useEffect(() => {
    if (!search || search.q.trim().length < 2) return
    let live = true
    const t = setTimeout(() => api.searchMessages(search.q, id).then((r) => { if (live) setSearch((s) => (s ? { ...s, results: r } : s)) }).catch(() => {}), 300)
    return () => { live = false; clearTimeout(t) }
  }, [search?.q, id]) // eslint-disable-line react-hooks/exhaustive-deps
  function flashTo(mid) {
    setTimeout(() => {
      const el = document.getElementById(`msg-${mid}`)
      if (!el) return
      el.scrollIntoView({ block: 'center' })
      el.classList.remove('flash')
      void el.offsetWidth
      el.classList.add('flash')
    }, 80)
  }
  const jumpTo = async (mid) => {
    setSearch(null)
    if (msgs?.some((x) => x.id === mid)) return flashTo(mid)
    try {
      const l = await api.messages(id, { around: mid })
      skipScroll.current = true
      setMsgs(l)
      setDetached(Boolean(l.hasNewer))
      flashTo(mid)
    } catch (e) { toast(e.message, 'error') }
  }
  const backToLatest = async () => {
    setDetached(false)
    setMsgs(await api.messages(id))
  }
  const reloadConv = async () => setConv(await api.conversation(id))
  const vote = async (m, options) => {
    const before = votes
    setVotes((cur) => [...cur.filter((v) => !(v.message_id === m.id && v.user_id === me.id)), ...options.map((o) => ({ message_id: m.id, user_id: me.id, option: o }))])
    try { await api.voteChatPoll(m.id, options) } catch (e) { setVotes(before); toast(e.message, 'error') }
  }

  useEffect(() => {
    if (!rec) return
    const t = setInterval(() => setRecTime(Math.floor((Date.now() - rec.started) / 1000)), 250)
    return () => clearInterval(t)
  }, [rec])

  const people = useMemo(() => {
    const map = new Map(members.map((m) => [m.id, m]))
    if (conv?.other) map.set(conv.other.id, conv.other)
    if (me) map.set(me.id, me)
    return map
  }, [members, conv, me])
  const nameOf = (uid) => (uid === me?.id ? 'შენ' : people.get(uid)?.full_name?.split(' ')[0] || people.get(uid)?.username || '…')

  const send = async (payload) => {
    try {
      const m = await api.send(id, payload)
      setMsgs((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, { ...m, reactions: m.reactions || [] }]))
    } catch (e) { toast(e.message, 'error') }
  }
  const submit = () => {
    const body = text.trim()
    if (!body) return
    setText('')
    const reply = replyTo
    setReplyTo(null)
    api.sendTyping?.(id, false)
    send({ body, reply_to: reply?.id || null })
  }
  const onType = (e) => {
    setText(e.target.value)
    if (Date.now() - typingSent.current > 2500) { typingSent.current = Date.now(); api.sendTyping?.(id, true) }
  }
  const sendPhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const url = await api.upload(await compressImage(file, 1280), 'chat')
      send({ media_url: url, media_type: 'image', reply_to: replyTo?.id || null })
      setReplyTo(null)
    } catch (er) { toast(er.message, 'error') }
  }
  const startRec = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('ხმის ჩაწერა ამ ბრაუზერში არ მუშაობს', 'error')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks = []
      recorder.ondataavailable = (ev) => chunks.push(ev.data)
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        if (recorder.cancelled || !chunks.length) return
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        const ext = blob.type.includes('mp4') ? 'm4a' : 'webm'
        const url = await api.upload(new File([blob], `voice.${ext}`, { type: blob.type }), 'voice')
        send({ media_url: url, media_type: 'audio' })
      }
      recorder.start()
      setRecTime(0)
      setRec({ recorder, started: Date.now() })
    } catch { toast('მიკროფონზე წვდომა არ არის', 'error') }
  }
  const stopRec = (cancel) => {
    if (!rec) return
    rec.recorder.cancelled = cancel
    rec.recorder.stop()
    setRec(null)
  }
  const react = async (m, emoji) => {
    setMenu(null)
    const mine = m.reactions?.find((r) => r.user_id === me.id)
    const next = mine?.emoji === emoji ? null : emoji
    setMsgs((cur) => cur.map((x) => (x.id === m.id ? { ...x, reactions: [...(x.reactions || []).filter((r) => r.user_id !== me.id), ...(next ? [{ user_id: me.id, emoji: next }] : [])] } : x)))
    try { await api.react(m.id, next) } catch (e) { toast(e.message, 'error') }
  }
  const tapBubble = (m) => {
    const now = Date.now()
    if (lastTap.current.id === m.id && now - lastTap.current.t < 300 && !m.deleted_at) { react(m, '❤️'); lastTap.current = { id: null, t: 0 } }
    else lastTap.current = { id: m.id, t: now }
  }
  // ხანგრძლივი შეხება ან მარჯვენა კლიკი → მენიუ. ტაიმერი ref-შია, რომ contextmenu-მ გააუქმოს
  // (თორემ მენიუს დახურვის შემდეგ ტაიმერი მას ხელახლა გახსნიდა)
  const pressTimer = useRef(0)
  const longPress = (m) => {
    const open = () => { if (!m.deleted_at && !m.meta?.system) setMenu(m) }
    const cancel = () => clearTimeout(pressTimer.current)
    return {
      onPointerDown: () => { cancel(); pressTimer.current = setTimeout(open, 450) },
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onContextMenu: (e) => { e.preventDefault(); cancel(); open() },
    }
  }

  const other = conv?.other
  const isGroup = conv?.kind === 'group'
  if (conv === null) return <><TopBar title="ჩატი" backTo="/inbox" /><Empty icon="chat" title="ჩატი ვერ მოიძებნა" /></>

  return (
    <div className="chat">
      {search ? (
        <header className="topbar lined chat-search-bar">
          <div className="searchbox grow"><Icon name="search" size={19} />
            <input className="input" type="search" autoFocus placeholder="ძებნა ამ ჩატში" aria-label="ძებნა ამ ჩატში" value={search.q}
              onChange={(e) => setSearch({ q: e.target.value, results: e.target.value.trim().length < 2 ? [] : null })}
              onKeyDown={(e) => { if (e.key === 'Escape') setSearch(null) }} />
          </div>
          <button className="btn btn-ghost sm" onClick={() => setSearch(null)}>გაუქმება</button>
        </header>
      ) : (
      <header className="topbar lined">
        <button className="icon-btn" onClick={() => back('/inbox')} aria-label="უკან"><Icon name="back" /></button>
        {conv && (isGroup ? (
          <button className="hstack grow" onClick={() => setInfo(true)} style={{ textAlign: 'left', minWidth: 0 }}>
            <ConvAvatar c={conv} size={36} />
            <div style={{ minWidth: 0 }}>
              <b className="ellipsis" style={{ display: 'block' }}>{convName(conv)}</b>
              <span className="xs faint">{typing ? 'ვიღაც წერს…' : `${conv.members_count} წევრი`}</span>
            </div>
          </button>
        ) : other ? (
          <Link to={`/u/${other.username}`} className="hstack grow" style={{ minWidth: 0 }}>
            <Avatar user={other} size={36} online />
            <div style={{ minWidth: 0 }}>
              <b className="ellipsis" style={{ display: 'block' }}>{other.full_name || other.username}<Verified user={other} size={14} /></b>
              <span className="xs faint">{typing ? 'წერს…' : seenText(other.last_seen) || (conv.kind === 'dating' ? 'გაცნობა' : `@${other.username}`)}</span>
            </div>
          </Link>
        ) : <span className="grow" />)}
        {conv && !isGroup && other && (
          <>
            <button className="icon-btn" onClick={() => startCall(conv, other, 'audio')} aria-label="ზარი"><Icon name="call" /></button>
            <button className="icon-btn" onClick={() => startCall(conv, other, 'video')} aria-label="ვიდეოზარი"><Icon name="video" /></button>
          </>
        )}
        {conv && <button className="icon-btn" onClick={() => setPrefs(true)} aria-label="ჩატის პარამეტრები"><Icon name="more" /></button>}
      </header>
      )}
      {search && <div className="chat-search-results"><SearchResults results={search.results} q={search.q} onPick={(r) => jumpTo(r.id)} inChat /></div>}
      {conv?.disappear_hours && !search && (
        <button className="disappear-pill" onClick={() => setPrefs(true)}><Icon name="timer" size={14} />ქრებადი მესიჯები: {DISAPPEAR_LABEL[conv.disappear_hours]}</button>
      )}
      <div className="chat-scroll" ref={scroller}>
        {msgs === null && <Loader />}
        {visible?.length === 0 && other && (
          <div className="empty" style={{ marginTop: 'auto' }}>
            <Avatar user={other} size={72} />
            <h3>{other.full_name || other.username}</h3>
            <p className="small">{conv?.kind === 'dating' ? 'თქვენ ერთმანეთი მოიწონეთ. პირველი ნაბიჯი შენზეა.' : 'დაიწყე საუბარი.'}</p>
          </div>
        )}
        {visible?.map((m, i) => {
          const mine = m.sender_id === me?.id
          const prev = visible[i - 1]
          const nextM = visible[i + 1]
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
          const special = (x) => x && (x.meta?.system || x.meta?.call)
          const cont = prev && prev.sender_id === m.sender_id && !newDay && !special(prev)
          const lastOfGroup = !nextM || nextM.sender_id !== m.sender_id || special(nextM) || new Date(nextM.created_at) - new Date(m.created_at) > 5 * 60000
          const day = newDay && <div className="day-sep">{dayLabel(m.created_at)}</div>
          if (m.meta?.system) return <Fragment key={m.id}>{day}<div className="sys-msg"><b>{nameOf(m.sender_id)}</b> {m.body}</div></Fragment>
          if (m.meta?.call) {
            const c = m.meta.call
            const missed = ['missed', 'declined', 'busy'].includes(c.status)
            const label = `${c.kind === 'video' ? 'ვიდეოზარი' : 'ზარი'}${missed ? ' — გამოტოვებული' : c.duration ? `, ${fmtDur(c.duration)}` : ''}`
            return (
              <Fragment key={m.id}>
                {day}
                <div className={`call-msg${missed ? ' missed' : ''}`}>
                  <Icon name={c.kind === 'video' ? 'video' : 'call'} size={18} />{label}<span className="faint xs">{clock(m.created_at)}</span>
                  {!isGroup && other && <button className="btn btn-outline sm" onClick={() => startCall(conv, other, c.kind)}>დარეკვა</button>}
                </div>
              </Fragment>
            )
          }
          const counts = {}
          for (const r of m.reactions || []) counts[r.emoji] = (counts[r.emoji] || 0) + 1
          const myReact = m.reactions?.find((r) => r.user_id === me?.id)?.emoji
          return (
            <Fragment key={m.id}>
              {day}
              <div className={`msg-row${mine ? ' me' : ''}`} id={`msg-${m.id}`}>
                {isGroup && !mine && <span className="av">{lastOfGroup && <Avatar user={people.get(m.sender_id)} size={28} />}</span>}
                <div className="msg-col">
                  {isGroup && !mine && !cont && <span className="sender-name">{nameOf(m.sender_id)}</span>}
                  <div className={`bubble ${mine ? 'me' : 'them'}${cont ? ' cont' : ''}${m.deleted_at ? ' deleted' : ''}${m.media_type === 'image' && !m.body && !m.reply ? ' media-only' : ''}${m.meta?.poll && !m.deleted_at ? ' poll' : ''}`}
                    onClick={() => tapBubble(m)} {...longPress(m)}>
                    {m.deleted_at ? 'წაშლილი მესიჯი' : (
                      <>
                        {m.reply && (
                          <span className="reply-quote"><b>{nameOf(m.reply.sender_id)}</b>{m.reply.deleted_at ? 'წაშლილი მესიჯი' : m.reply.media_type === 'image' ? '📷 ფოტო' : m.reply.media_type === 'audio' ? '🎙 ხმოვანი' : m.reply.body}</span>
                        )}
                        {m.meta?.listing && <ListingChatCard l={m.meta.listing} mine={mine} />}
                        {m.meta?.story && (
                          <span className="story-ref">{mine ? 'უპასუხე სთორის' : 'გიპასუხა სთორიზე'}{m.meta.story.url && <img src={m.meta.story.url} alt="" />}</span>
                        )}
                        {m.media_type === 'image' && <img src={m.media_url} alt="ფოტო" loading="lazy" />}
                        {m.media_type === 'audio' && <audio src={m.media_url} controls preload="metadata" />}
                        {m.meta?.poll ? <PollBubble m={m} votes={votes} me={me} onVote={vote} /> : m.body}
                      </>
                    )}
                  </div>
                  {Object.keys(counts).length > 0 && (
                    <div className="reacts">
                      {Object.entries(counts).map(([e, n]) => (
                        <button key={e} className={myReact === e ? 'mine' : ''} onClick={() => react(m, e)} aria-label={`${e} ${n}`}>{e}{n > 1 && <small>{n}</small>}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {lastOfGroup && <div className={`bubble-time${mine ? ' me' : ''}`} style={isGroup && !mine ? { marginLeft: 42 } : undefined}>
                {m.expires_at && <Icon name="timer" size={12} title="ქრებადი მესიჯი" />}{clock(m.created_at)}
              </div>}
            </Fragment>
          )
        })}
        {typing && <div className="typing" aria-label="წერს"><i /><i /><i /></div>}
      </div>
      {detached && <button className="to-latest" onClick={backToLatest}><Icon name="arrowUp" size={16} strokeWidth={2.4} className="flip-down" />ბოლო მესიჯები</button>}
      {replyTo && (
        <div className="reply-bar">
          <Icon name="replyArrow" size={18} />
          <div className="txt"><b>{nameOf(replyTo.sender_id)}</b><span>{replyTo.media_type === 'image' ? '📷 ფოტო' : replyTo.media_type === 'audio' ? '🎙 ხმოვანი' : replyTo.body}</span></div>
          <button className="icon-btn sm" onClick={() => setReplyTo(null)} aria-label="პასუხის გაუქმება"><Icon name="close" size={18} /></button>
        </div>
      )}
      <div className="chat-bar">
        {rec ? (
          <>
            <button className="icon-btn" onClick={() => stopRec(true)} aria-label="გაუქმება"><Icon name="trash" /></button>
            <div className="rec"><i />{`${Math.floor(recTime / 60)}:${String(recTime % 60).padStart(2, '0')}`}<span className="grow" />იწერება</div>
            <button className="send-btn" onClick={() => stopRec(false)} aria-label="გაგზავნა"><Icon name="arrowUp" size={22} strokeWidth={2.4} /></button>
          </>
        ) : (
          <>
            <button className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="ფოტო"><Icon name="image" /></button>
            {isGroup && !text.trim() && <button className="icon-btn" onClick={() => setPollOpen(true)} aria-label="გამოკითხვა"><Icon name="poll" /></button>}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={sendPhoto} />
            <textarea ref={inputRef} rows={1} value={text} onChange={onType} placeholder="მესიჯი…" aria-label="მესიჯი"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); submit() } }} />
            {text.trim()
              ? <button className="send-btn" onClick={submit} aria-label="გაგზავნა"><Icon name="arrowUp" size={22} strokeWidth={2.4} /></button>
              : <button className="icon-btn" onClick={startRec} aria-label="ხმოვანი"><Icon name="mic" /></button>}
          </>
        )}
      </div>

      {menu && (
        <Sheet onClose={() => setMenu(null)}>
          <div className="react-picker" role="group" aria-label="რეაქცია">
            {REACTIONS.map((e) => (
              <button key={e} className={menu.reactions?.find((r) => r.user_id === me.id)?.emoji === e ? 'mine' : ''} onClick={() => react(menu, e)} aria-label={e}>{e}</button>
            ))}
          </div>
          <div className="menu">
            <button onClick={() => { setReplyTo(menu); setMenu(null); inputRef.current?.focus() }}><Icon name="replyArrow" />პასუხი</button>
            {menu.body && <button onClick={async () => { try { await navigator.clipboard.writeText(menu.body); toast('დაკოპირდა') } catch { /* */ } setMenu(null) }}><Icon name="copy" />კოპირება</button>}
            {menu.sender_id === me?.id && (
              <button className="danger" onClick={async () => {
                const m = menu
                setMenu(null)
                try {
                  await api.deleteMessage(m.id)
                  setMsgs((cur) => cur.map((x) => (x.id === m.id ? { ...x, body: '', media_url: null, media_type: null, meta: {}, deleted_at: new Date().toISOString() } : x)))
                } catch (e) { toast(e.message, 'error') }
              }}><Icon name="trash" />წაშლა ყველასთვის</button>
            )}
          </div>
        </Sheet>
      )}
      {prefs && conv && <ChatPrefsSheet conv={conv} title={convName(conv)} onClose={() => setPrefs(false)} onChanged={reloadConv}
        onSearch={() => setSearch({ q: '', results: [] })} onInfo={isGroup ? () => setInfo(true) : null} />}
      {pollOpen && <PollComposer onClose={() => setPollOpen(false)} onSend={async (p) => {
        try {
          const m = await api.sendChatPoll(id, p)
          setMsgs((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, { ...m, reactions: m.reactions || [] }]))
        } catch (e) { toast(e.message, 'error'); throw e }
      }} />}
      {info && conv && <GroupChatInfo conv={conv} members={members} onClose={() => setInfo(false)}
        onChanged={async () => { setConv(await api.conversation(id)); setMembers(await api.chatMembers(id)) }} />}
    </div>
  )
}

function GroupChatInfo({ conv, members, onClose, onChanged }) {
  const toast = useToast()
  const [view, setView] = useState(null) // 'add' | 'leave'
  const [title, setTitle] = useState(conv.title || '')
  const admin = conv.my_role === 'admin'
  if (view === 'add') {
    return <PeoplePicker title="წევრების დამატება" exclude={members.map((m) => m.id)} onClose={() => setView(null)} onDone={async (ids) => {
      await api.addChatMembers(conv.id, ids)
      await onChanged()
      setView(null)
    }} />
  }
  if (view === 'leave') {
    return <ConfirmSheet title="ჩატის დატოვება" text="შეტყობინებებს აღარ მიიღებ. ხელახლა დასამატებლად ადმინი დაგჭირდება." confirm="დატოვება"
      onClose={() => setView(null)} onConfirm={async () => { await api.leaveChat(conv.id); navigate('/inbox', { replace: true }) }} />
  }
  return (
    <Sheet title="ჩატის ინფორმაცია" onClose={onClose}>
      <div className="sheet-body vstack" style={{ gap: 10 }}>
        {admin ? (
          <div className="hstack">
            <input className="input grow" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="ჩატის სახელი" />
            <button className="btn btn-primary sm" disabled={!title.trim() || title.trim() === conv.title} onClick={async () => {
              try { await api.renameChat(conv.id, title.trim()); await onChanged(); toast('სახელი შეიცვალა') } catch (e) { toast(e.message, 'error') }
            }}>შენახვა</button>
          </div>
        ) : <h3 className="display" style={{ fontSize: 'var(--t-xl)' }}>{conv.title}</h3>}
        <p className="small muted">{members.length} წევრი</p>
      </div>
      <div style={{ overflowY: 'auto' }}>
        {admin && <button className="person-row" style={{ width: '100%' }} onClick={() => setView('add')}><span className="group-thumb" style={{ width: 46, height: 46, borderRadius: 23, background: 'var(--bg-2)', color: 'var(--ink)' }}><Icon name="userPlus" /></span><div className="who"><b>წევრის დამატება</b></div></button>}
        {members.map((m) => <PersonRow key={m.id} user={m} right={m.role === 'admin' ? <span className="role-badge">ადმინი</span> : null} />)}
        <div className="menu"><button className="danger" onClick={() => setView('leave')}><Icon name="logout" />ჩატის დატოვება</button></div>
      </div>
    </Sheet>
  )
}
