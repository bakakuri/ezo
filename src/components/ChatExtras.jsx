import { useState } from 'react'
import { Avatar, Sheet, Toggle } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { api } from '../lib/api.js'
import { useToast } from './Toast.jsx'
import { clock, dayMonth } from '../lib/format.js'

// ეტაპი I: ჩატის პარამეტრები (მიმაგრება, დადუმება, ქრებადი მესიჯები), გამოკითხვა და მესიჯებში ძებნა

export const DISAPPEAR_LABEL = { 24: '24 საათი', 168: '7 დღე' }

export function muteText(c) {
  if (!c?.muted) return ''
  if (c.mute_forever) return 'დადუმებულია'
  const d = new Date(c.muted_until)
  const today = new Date().toDateString() === d.toDateString()
  return `დადუმებულია ${today ? clock(d) : `${dayMonth(d)}, ${clock(d)}`}-მდე`
}

// მენიუ: ჩატის სიიდან (ხანგრძლივი შეხებით) და ჩატის ზედა „⋯“ ღილაკიდან
export function ChatPrefsSheet({ conv, title, onClose, onChanged, onSearch, onInfo }) {
  const toast = useToast()
  const [view, setView] = useState(null) // null | 'mute' | 'disappear'
  const [busy, setBusy] = useState(false)
  const run = async (fn, msg) => {
    setBusy(true)
    try { await fn(); await onChanged?.(); if (msg) toast(msg); onClose() } catch (e) { toast(e.message, 'error'); setBusy(false) }
  }
  const isGroup = conv.kind === 'group'
  const canDisappear = !isGroup || conv.my_role === 'admin'

  if (view === 'mute') {
    return (
      <Sheet title="დადუმება" onClose={onClose}>
        <p className="sheet-note">შეტყობინებები ამ ჩატიდან აღარ მოვა. მესიჯები ისევ ჩანს, წაუკითხავი ნიშანი — ნაცრისფერი.</p>
        <div className="menu">
          {[[8, '8 საათით'], [24 * 7, '1 კვირით'], [-1, 'სანამ ხმას არ ჩავრთავ']].map(([h, l]) => (
            <button key={h} disabled={busy} onClick={() => run(() => api.setChatPrefs(conv.id, { muteHours: h }), 'ჩატი დადუმდა')}><Icon name="bellOff" />{l}</button>
          ))}
        </div>
      </Sheet>
    )
  }
  if (view === 'disappear') {
    const cur = conv.disappear_hours || null
    return (
      <Sheet title="ქრებადი მესიჯები" onClose={onClose}>
        <p className="sheet-note">ახალი მესიჯები ყველასთვის გაქრება არჩეული დროის შემდეგ. უკვე გაგზავნილი მესიჯები რჩება.
          {isGroup && !canDisappear ? ' ჯგუფურ ჩატში ამას ადმინი ცვლის.' : ''}</p>
        <div className="choice-list" role="radiogroup" aria-label="ვადა">
          {[[null, 'გამორთული'], [24, '24 საათი'], [168, '7 დღე']].map(([h, l]) => (
            <button key={String(h)} role="radio" aria-checked={cur === h} className={cur === h ? 'on' : ''} disabled={busy || !canDisappear}
              onClick={() => (cur === h ? onClose() : run(() => api.setDisappearing(conv.id, h), h ? `ქრებადი მესიჯები: ${l}` : 'ქრებადი მესიჯები გამოირთო'))}>
              <span className="radio-dot" aria-hidden="true" />{l}
            </button>
          ))}
        </div>
      </Sheet>
    )
  }
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="menu">
        {onSearch && <button onClick={() => { onClose(); onSearch() }}><Icon name="search" />ძებნა ჩატში</button>}
        <button disabled={busy} onClick={() => run(() => api.setChatPrefs(conv.id, { pin: !conv.pinned }), conv.pinned ? 'მიმაგრება მოიხსნა' : 'ჩატი მიმაგრდა')}>
          <Icon name="pushpin" />{conv.pinned ? 'მიმაგრების მოხსნა' : 'ჩატის მიმაგრება'}
        </button>
        {conv.muted
          ? <button disabled={busy} onClick={() => run(() => api.setChatPrefs(conv.id, { muteHours: 0 }), 'ხმა ჩაირთო')}><Icon name="bell" /><div className="grow">ხმის ჩართვა<small>{muteText(conv)}</small></div></button>
          : <button onClick={() => setView('mute')}><Icon name="bellOff" />დადუმება</button>}
        {conv.kind !== 'dating' && (
          <button onClick={() => setView('disappear')}><Icon name="timer" /><div className="grow">ქრებადი მესიჯები<small>{conv.disappear_hours ? DISAPPEAR_LABEL[conv.disappear_hours] : 'გამორთულია'}</small></div></button>
        )}
        {onInfo && <button onClick={() => { onClose(); onInfo() }}><Icon name="users" />ჩატის ინფორმაცია</button>}
      </div>
    </Sheet>
  )
}

// ---- გამოკითხვა
export function PollComposer({ onClose, onSend }) {
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState(['', ''])
  const [multi, setMulti] = useState(false)
  const [busy, setBusy] = useState(false)
  const filled = opts.map((o) => o.trim()).filter(Boolean)
  const ok = q.trim() && filled.length >= 2 && !busy
  const send = async () => {
    setBusy(true)
    try { await onSend({ question: q.trim(), options: filled, multi }); onClose() } catch { setBusy(false) }
  }
  return (
    <Sheet title="გამოკითხვა" onClose={onClose} actions={<button className="btn btn-primary sm" disabled={!ok} onClick={send}>გაგზავნა</button>}>
      <div className="sheet-body vstack poll-compose" style={{ gap: 10 }}>
        <label className="field"><span>კითხვა</span>
          <input className="input" maxLength={300} value={q} onChange={(e) => setQ(e.target.value)} placeholder="მაგ. როდის შევხვდეთ?" autoFocus />
        </label>
        <div className="field"><span>პასუხები</span>
          {opts.map((o, i) => (
            <div key={i} className="hstack poll-opt-row">
              <input className="input grow" maxLength={100} value={o} placeholder={`პასუხი ${i + 1}`} aria-label={`პასუხი ${i + 1}`}
                onChange={(e) => setOpts((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))} />
              {opts.length > 2 && <button type="button" className="icon-btn sm" aria-label={`პასუხი ${i + 1}-ის წაშლა`} onClick={() => setOpts((cur) => cur.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>}
            </div>
          ))}
          {opts.length < 10 && <button type="button" className="btn btn-ghost sm add-opt" onClick={() => setOpts((cur) => [...cur, ''])}><Icon name="plus" size={16} />პასუხის დამატება</button>}
        </div>
        <div className="hstack" style={{ justifyContent: 'space-between' }}>
          <span className="small">რამდენიმე პასუხის არჩევა</span>
          <Toggle on={multi} onChange={setMulti} label="რამდენიმე პასუხის არჩევა" />
        </div>
      </div>
    </Sheet>
  )
}

export function PollBubble({ m, votes, me, onVote }) {
  const opts = m.meta.poll.options || []
  const multi = Boolean(m.meta.poll.multi)
  const mine = votes.filter((v) => v.message_id === m.id && v.user_id === me.id).map((v) => v.option)
  const counts = opts.map((_, i) => votes.filter((v) => v.message_id === m.id && v.option === i).length)
  const voters = new Set(votes.filter((v) => v.message_id === m.id).map((v) => v.user_id)).size
  const showResults = mine.length > 0 || m.sender_id === me.id
  const max = Math.max(1, ...counts)
  const toggle = (i) => {
    const next = multi ? (mine.includes(i) ? mine.filter((x) => x !== i) : [...mine, i]) : (mine.includes(i) ? [] : [i])
    onVote(m, next)
  }
  return (
    <div className="poll-msg" onClick={(e) => e.stopPropagation()}>
      <span className="poll-kind"><Icon name="poll" size={14} />გამოკითხვა{multi ? ', რამდენიმე პასუხით' : ''}</span>
      <b className="poll-q">{m.body}</b>
      <div className="poll-opts" role={multi ? 'group' : 'radiogroup'} aria-label={m.body}>
        {opts.map((o, i) => {
          const pct = voters ? Math.round((counts[i] / voters) * 100) : 0
          return (
            <button key={i} type="button" role={multi ? 'checkbox' : 'radio'} aria-checked={mine.includes(i)}
              className={`poll-opt${mine.includes(i) ? ' on' : ''}${counts[i] === max && counts[i] > 0 && showResults ? ' lead' : ''}`} onClick={() => toggle(i)}>
              {showResults && <span className="fill" style={{ width: `${pct}%` }} />}
              <span className={`mark${multi ? ' sq' : ''}`} aria-hidden="true">{mine.includes(i) && <Icon name="check" size={12} strokeWidth={3} />}</span>
              <span className="txt">{o}</span>
              {showResults && <span className="pct">{pct}%</span>}
            </button>
          )
        })}
      </div>
      <small className="poll-total">{voters ? `${voters} ხმა` : 'ჯერ არავის უპასუხია'}{!showResults && voters ? ' — შედეგი ხმის მიცემის შემდეგ ჩანს' : ''}</small>
    </div>
  )
}

// ---- ძებნა: ნაპოვნი სიტყვა გამოკვეთილი (თუ ზუსტად ემთხვევა; ლათინური→ქართული დამთხვევაც პოულობს, მაგრამ არ კვეთს)
export function Highlight({ text, q }) {
  const t = String(text || '')
  const n = q.trim()
  const i = n.length >= 2 ? t.toLowerCase().indexOf(n.toLowerCase()) : -1
  if (i < 0) return t.length > 140 ? `${t.slice(0, 140)}…` : t
  const start = Math.max(0, i - 40)
  return <>{start > 0 ? '…' : ''}{t.slice(start, i)}<mark>{t.slice(i, i + n.length)}</mark>{t.slice(i + n.length, i + n.length + 100)}{i + n.length + 100 < t.length ? '…' : ''}</>
}

export function SearchResults({ results, q, onPick, inChat = false }) {
  if (results === null) return <div className="center pad"><div className="spinner" /></div>
  if (q.trim().length < 2) return <p className="pad small faint">ჩაწერე მინიმუმ 2 ასო. ქართულად ან ლათინურად — ორივე იპოვის.</p>
  if (!results.length) return <p className="pad small faint">„{q.trim()}“ — ვერაფერი მოიძებნა.</p>
  return (
    <div className="msg-results" role="list">
      {results.map((r) => {
        const conv = r.kind === 'group' ? r.title || 'ჯგუფური ჩატი' : r.other?.full_name || r.other?.username
        return (
          <button key={r.id} role="listitem" className="msg-result" onClick={() => onPick(r)}>
            <Avatar user={inChat || r.kind !== 'group' ? (inChat ? r.sender : r.other) : { id: r.conversation_id, full_name: r.title }} size={42} />
            <span className="grow">
              <span className="top"><b className="ellipsis">{inChat ? r.sender?.full_name || r.sender?.username : conv}</b><time>{Date.now() - Date.parse(r.created_at) < 864e5 ? clock(r.created_at) : dayMonth(r.created_at)}</time></span>
              <span className="snip">{!inChat && r.kind === 'group' && <b>{(r.sender?.full_name || r.sender?.username || '').split(' ')[0]}: </b>}<Highlight text={r.body} q={q} /></span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

