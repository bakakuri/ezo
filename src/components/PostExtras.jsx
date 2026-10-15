import { useEffect, useState } from 'react'
import { Sheet } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { api } from '../lib/api.js'
import { untilText, plural } from '../lib/format.js'
import { useToast } from './Toast.jsx'

// ---- გამოკითხვა პოსტში
export function PollView({ postId, poll: initial, own }) {
  const [poll, setPoll] = useState(initial)
  const [pick, setPick] = useState([])
  const [busy, setBusy] = useState(false)
  const [changing, setChanging] = useState(false)
  const toast = useToast()
  useEffect(() => setPoll(initial), [initial])
  if (!poll) return null
  const voted = poll.mine.length > 0
  const showResults = (voted || poll.closed || own) && !changing
  const max = Math.max(...poll.counts)

  const vote = async (options) => {
    setBusy(true)
    try { setPoll(await api.votePoll(postId, options)); setChanging(false); setPick([]) } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const left = Date.parse(poll.closes_at) - Date.now()
  const stop = (e) => e.stopPropagation()

  return (
    <div className="poll" onClick={stop}>
      {poll.options.map((o, i) => {
        const pct = poll.total ? Math.round((poll.counts[i] / poll.total) * 100) : 0
        if (showResults) {
          return (
            <div key={i} className={`poll-row result${poll.mine.includes(i) ? ' mine' : ''}${poll.counts[i] === max && max > 0 ? ' top' : ''}`}>
              <i style={{ '--w': `${pct}%` }} />
              <span className="txt">{o}{poll.mine.includes(i) && <Icon name="check" size={15} strokeWidth={2.6} />}</span>
              <b>{pct}%</b>
            </div>
          )
        }
        const on = pick.includes(i)
        return (
          <button key={i} className={`poll-row option${on ? ' on' : ''}`} disabled={busy}
            onClick={() => (poll.multi ? setPick((p) => (on ? p.filter((x) => x !== i) : [...p, i])) : vote([i]))}>
            {poll.multi && <span className="box">{on && <Icon name="check" size={14} strokeWidth={3} />}</span>}
            <span className="txt">{o}</span>
          </button>
        )
      })}
      <div className="poll-foot">
        <span>{plural(poll.total, 'ხმა')}, {poll.closed ? 'დასრულდა' : `დარჩა ${untilText(left)}`}{poll.multi ? ', რამდენიმე პასუხი' : ''}</span>
        {!showResults && poll.multi && <button className="btn btn-accent sm" disabled={!pick.length || busy} onClick={() => vote(pick)}>ხმის მიცემა</button>}
        {showResults && voted && !poll.closed && <button className="link-btn" onClick={() => { setPick(poll.mine); setChanging(true) }}>შეცვლა</button>}
        {changing && <button className="link-btn" onClick={() => setChanging(false)}>გაუქმება</button>}
      </div>
    </div>
  )
}

// ---- გამოკითხვის შექმნა (Composer-ში)
export function PollEditor({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch })
  const setOpt = (i, v) => set({ options: value.options.map((o, j) => (j === i ? v : o)) })
  return (
    <div className="poll-editor">
      {value.options.map((o, i) => (
        <div key={i} className="opt">
          <input className="input" maxLength={80} value={o} placeholder={`პასუხი ${i + 1}`} onChange={(e) => setOpt(i, e.target.value)} />
          {value.options.length > 2 && <button className="icon-btn sm" aria-label="პასუხის წაშლა" onClick={() => set({ options: value.options.filter((_, j) => j !== i) })}><Icon name="close" size={16} /></button>}
        </div>
      ))}
      {value.options.length < 4 && <button className="btn btn-ghost sm" onClick={() => set({ options: [...value.options, ''] })}><Icon name="plus" size={16} />პასუხის დამატება</button>}
      <div className="chips inline">
        {[[1, '1 დღე'], [3, '3 დღე'], [7, '1 კვირა']].map(([d, l]) => (
          <button key={d} type="button" className={`chip${value.days === d ? ' on' : ''}`} onClick={() => set({ days: d })}>{l}</button>
        ))}
        <button type="button" className={`chip${value.multi ? ' on' : ''}`} onClick={() => set({ multi: !value.multi })}><Icon name="check" size={14} />რამდენიმე პასუხი</button>
      </div>
    </div>
  )
}
export const pollReady = (p) => p && p.options.filter((o) => o.trim()).length >= 2 && p.options.every((o) => o.trim().length <= 80)

// ---- კოლექციაში შენახვა
export function SaveSheet({ postId, onClose, onSaved }) {
  const toast = useToast()
  const [list, setList] = useState(null)
  const [name, setName] = useState('')
  useEffect(() => { api.collections().then(setList).catch(() => setList([])) }, [])
  const saveTo = async (collectionId) => {
    try { await api.save(postId, true, collectionId); onSaved?.(); toast('შეინახა'); onClose() } catch (e) { toast(e.message, 'error') }
  }
  const create = async () => {
    if (!name.trim()) return
    try { const c = await api.createCollection(name); await saveTo(c.id) } catch (e) { toast(e.message, 'error') }
  }
  return (
    <Sheet title="შენახვა" onClose={onClose}>
      <div className="menu" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => saveTo(null)}><Icon name="bookmark" /><div className="grow"><b>ყველა შენახული</b></div></button>
        {list?.map((c) => (
          <button key={c.id} onClick={() => saveTo(c.id)}><Icon name="bookmark" /><div className="grow"><b>{c.name}</b><div className="small muted">{plural(c.count, 'პოსტი')}</div></div></button>
        ))}
        <form className="new-collection" onSubmit={(e) => { e.preventDefault(); create() }}>
          <input className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="ახალი კოლექცია" />
          <button className="btn btn-primary" disabled={!name.trim()}>შექმნა</button>
        </form>
      </div>
    </Sheet>
  )
}
