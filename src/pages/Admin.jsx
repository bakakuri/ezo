import { useCallback, useEffect, useState } from 'react'
import { Avatar, Empty, Loader, Sheet, TopBar } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Link } from '../lib/router.jsx'
import { timeAgo, banText } from '../lib/format.js'
import { categoryName } from '../components/Report.jsx'
import { priceText } from '../lib/market.js'
import { useToast } from '../components/Toast.jsx'

export default function Admin() {
  const { me } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState('open')
  const [stats, setStats] = useState(null)
  const [list, setList] = useState(null)
  const [banFor, setBanFor] = useState(null)

  const load = useCallback(() => {
    setList(null)
    if (tab !== 'words') api.adminReports(tab).then(setList).catch((e) => { toast(e.message, 'error'); setList([]) })
    api.adminStats().then(setStats).catch(() => {})
  }, [tab, toast])
  useEffect(() => { load() }, [load])

  if (!['moderator', 'admin'].includes(me?.role)) {
    return <><TopBar title="მოდერაცია" backTo="/settings" /><Empty icon="block" title="წვდომა არ გაქვს" text="ეს გვერდი მხოლოდ მოდერატორებისთვისაა." /></>
  }

  const resolve = async (r, action, days = null) => {
    try {
      await api.adminResolve(r.id, action, days)
      setList((l) => l.filter((x) => x.id !== r.id))
      setStats((s) => s && { ...s, open_reports: Math.max(0, s.open_reports - 1) })
      toast({ dismiss: 'რეპორტი უარყოფილია', hide_post: 'პოსტი დაიმალა', delete_post: 'პოსტი წაიშალა', hide_listing: 'განცხადება დაიმალა', delete_listing: 'განცხადება წაიშალა', ban: 'ანგარიში შეიზღუდა' }[action])
    } catch (e) { toast(e.message, 'error') }
  }

  return (
    <>
      <TopBar title="მოდერაცია" backTo="/settings" />
      {stats && (
        <div className="stat-row">
          <div><b>{stats.open_reports}</b><span>ღია რეპორტი</span></div>
          <div><b>{stats.users}</b><span>მომხმარებელი</span></div>
          <div><b>{stats.posts_24h}</b><span>პოსტი 24 სთ-ში</span></div>
          <div><b>{stats.new_users_7d}</b><span>ახალი 7 დღეში</span></div>
          <div><b>{stats.banned}</b><span>შეზღუდული</span></div>
          <div><b>{stats.active_games}</b><span>აქტიური თამაში</span></div>
        </div>
      )}
      <div className="seg" role="tablist">
        {[['open', 'ღია'], ['resolved', 'დახურული'], ['dismissed', 'უარყოფილი'], ['words', 'სიტყვები']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'words' && <BannedWords />}
      {tab !== 'words' && list === null && <Loader />}
      {tab !== 'words' && list?.length === 0 && <Empty icon="check" title={tab === 'open' ? 'ღია რეპორტები არ არის' : 'სია ცარიელია'} />}
      {tab !== 'words' && list?.map((r) => {
        const t = r.target_user
        const post = r.target_post
        const listing = r.target_listing
        const img = post?.media?.find((m) => m.type === 'image')?.url
        return (
          <article key={r.id} className="report-card">
            <div className="why">
              <span className="count">{r.reports_count} რეპორტი</span>
              <b>{categoryName(r.category)}</b>
              <span className="faint">{timeAgo(r.created_at)}</span>
            </div>
            {r.reason && r.reason !== r.category && <p className="small muted">„{r.reason}“ — @{r.reporter?.username}</p>}
            <div className="target">
              {t && (
                <Link to={`/u/${t.username}`} className="hstack">
                  <Avatar user={t} size={32} />
                  <b>{t.full_name || t.username}</b>
                  <span className="faint small">@{t.username}</span>
                  {banText(t.banned_until) && <span className="tag-dating">შეზღუდულია {banText(t.banned_until)}</span>}
                </Link>
              )}
              {post && (
                <Link to={`/p/${post.id}`} style={{ display: 'block', marginTop: 8 }}>
                  {post.hidden && <span className="tag-dating" style={{ marginBottom: 6, display: 'inline-block' }}>დამალულია</span>}
                  <p className="pre small">{post.body || (post.kind === 'reel' ? 'ვიდეო' : 'ფოტო')}</p>
                  {img && <img src={img} alt="" />}
                </Link>
              )}
              {r.target_post && !post && <p className="small faint">პოსტი უკვე წაშლილია</p>}
              {listing && (
                <Link to={`/market/${listing.id}`} className="report-listing">
                  {listing.photo && <img src={listing.photo} alt="" />}
                  <span className="grow">
                    <small>განცხადება{listing.hidden ? ', დამალულია' : ''}</small>
                    <b>{listing.title}</b>
                    <span>{priceText(listing.price, listing.currency)}</span>
                  </span>
                </Link>
              )}
            </div>
            {tab === 'open' ? (
              <div className="acts">
                <button className="btn btn-outline sm" onClick={() => resolve(r, 'dismiss')}>დარღვევა არ არის</button>
                {post && !post.hidden && <button className="btn btn-outline sm" onClick={() => resolve(r, 'hide_post')}><Icon name="eye" size={15} />დამალვა</button>}
                {post && <button className="btn btn-danger sm" onClick={() => resolve(r, 'delete_post')}><Icon name="trash" size={15} />წაშლა</button>}
                {listing && !listing.hidden && <button className="btn btn-outline sm" onClick={() => resolve(r, 'hide_listing')}><Icon name="eye" size={15} />დამალვა</button>}
                {listing && <button className="btn btn-danger sm" onClick={() => resolve(r, 'delete_listing')}><Icon name="trash" size={15} />განცხადების წაშლა</button>}
                {t && t.role === 'user' && <button className="btn btn-danger sm" onClick={() => setBanFor(r)}><Icon name="block" size={15} />შეზღუდვა</button>}
              </div>
            ) : <p className="xs faint">გადაწყვეტილება: {{ dismiss: 'უარყოფილია', hide_post: 'პოსტი დაიმალა', delete_post: 'პოსტი წაიშალა', hide_listing: 'განცხადება დაიმალა', delete_listing: 'განცხადება წაიშალა', ban: 'შეზღუდვა' }[r.action] || r.action}</p>}
          </article>
        )
      })}
      {banFor && (
        <Sheet title={`შეზღუდვა: @${banFor.target_user.username}`} onClose={() => setBanFor(null)}>
          <div className="menu">
            {[[1, '1 დღით'], [7, '7 დღით'], [30, '30 დღით'], [null, 'სამუდამოდ']].map(([d, l]) => (
              <button key={l} className={d === null ? 'danger' : ''} onClick={() => { const r = banFor; setBanFor(null); resolve(r, 'ban', d) }}>
                <Icon name="block" />{l}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  )
}

// აკრძალული სიტყვები: პოსტებში, მესიჯებში, განცხადებებში და პროფილში ვერ გამოიყენება
function BannedWords() {
  const toast = useToast()
  const [words, setWords] = useState(null)
  const [w, setW] = useState('')
  const load = () => api.bannedWords().then(setWords).catch((e) => { toast(e.message, 'error'); setWords([]) })
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (e) => {
    e.preventDefault()
    if (w.trim().length < 2) return
    try { await api.addBannedWord(w); setW(''); load(); toast('სიტყვა დაემატა') } catch (er) { toast(er.message, 'error') }
  }
  return (
    <section className="banned-words">
      <p className="small muted">ტექსტი, რომელიც ამ სიტყვებს შეიცავს, არ გამოქვეყნდება (დიდ-პატარა ასოს განსხვავების გარეშე, სიტყვის ნაწილიც ითვლება).</p>
      <form className="hstack" style={{ gap: 8 }} onSubmit={add}>
        <input className="input" maxLength={60} value={w} onChange={(e) => setW(e.target.value)} placeholder="ახალი სიტყვა ან ფრაზა" aria-label="ახალი აკრძალული სიტყვა" />
        <button className="btn btn-primary" disabled={w.trim().length < 2}>დამატება</button>
      </form>
      {words === null && <Loader />}
      {words?.length === 0 && <p className="small faint">სია ცარიელია.</p>}
      <div className="word-chips">
        {words?.map((x) => (
          <span key={x.word} className="word-chip">{x.word}
            <button onClick={async () => { await api.removeBannedWord(x.word); load() }} aria-label={`წაშლა: ${x.word}`}><Icon name="close" size={13} /></button>
          </span>
        ))}
      </div>
    </section>
  )
}
