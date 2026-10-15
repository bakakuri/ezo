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
  const [section, setSection] = useState('reports')
  const [tab, setTab] = useState('open')
  const [stats, setStats] = useState(null)
  const [list, setList] = useState(null)
  const [banFor, setBanFor] = useState(null)
  const [errCount, setErrCount] = useState(0)
  const reportsTab = section === 'reports'

  const load = useCallback(() => {
    setList(null)
    if (reportsTab) api.adminReports(tab).then(setList).catch((e) => { toast(e.message, 'error'); setList([]) })
    api.adminStats().then(setStats).catch(() => {})
  }, [tab, reportsTab, toast])
  useEffect(() => { load() }, [load])
  useEffect(() => { api.adminErrors(1).then((l) => setErrCount(l.length)).catch(() => {}) }, [])

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
          <div><b>{stats.posts_24h}</b><span>პოსტი <span className="nowrap">24 სთ-ში</span></span></div>
          <div><b>{stats.new_users_7d}</b><span>ახალი 7 დღეში</span></div>
          <div><b>{stats.banned}</b><span>შეზღუდული</span></div>
          <div><b>{stats.active_games}</b><span>აქტიური თამაში</span></div>
        </div>
      )}
      <div className="seg" role="tablist">
        {[['reports', 'რეპორტები'], ['words', 'სიტყვები'], ['errors', 'შეცდომები']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={section === k} className={section === k ? 'on' : ''} onClick={() => setSection(k)}>
            {l}{k === 'errors' && errCount > 0 && <span className="tab-count" aria-label={`${errCount} ბოლო 24 საათში`}>{errCount}</span>}
          </button>
        ))}
      </div>
      {section === 'words' && <BannedWords />}
      {section === 'errors' && <ErrorLog onCount={setErrCount} />}
      {reportsTab && (
        <div className="chips admin-filter" role="group" aria-label="რეპორტის სტატუსი">
          {[['open', 'ღია'], ['resolved', 'დახურული'], ['dismissed', 'უარყოფილი']].map(([k, l]) => (
            <button key={k} className={`chip${tab === k ? ' on' : ''}`} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      )}
      {reportsTab && list === null && <Loader />}
      {reportsTab && list?.length === 0 && <Empty icon="check" title={tab === 'open' ? 'ღია რეპორტები არ არის' : 'სია ცარიელია'} />}
      {reportsTab && list?.map((r) => {
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

// შეცდომების ჟურნალი: ერთნაირი შეცდომები ერთად, ბოლო ჩანაწერის დეტალებით
const SOURCES = { boundary: 'ეკრანი ჩავარდა', window: 'სკრიპტი', promise: 'მოთხოვნა', api: 'API / სქემა', chunk: 'ძველი ვერსია' }
const PERIODS = [[1, '24 საათი', '24 საათში'], [7, '7 დღე', '7 დღეში'], [30, '30 დღე', '30 დღეში']]

function device(ua = '') {
  if (!ua) return null
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null
  const br = /SamsungBrowser/.test(ua) ? 'Samsung' : /Edg\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : null
  return [os, br].filter(Boolean).join(', ') || null
}

function ErrorLog({ onCount }) {
  const toast = useToast()
  const [days, setDays] = useState(7)
  const [list, setList] = useState(null)
  useEffect(() => {
    let live = true
    setList(null)
    api.adminErrors(days).then((l) => {
      if (!live) return
      setList(l)
      if (days === 1) onCount(l.length)
    }).catch((e) => { if (live) { toast(e.message, 'error'); setList([]) } })
    return () => { live = false }
  }, [days, toast, onCount])

  const clear = async (e) => {
    try {
      await api.adminClearErrors(e.message)
      setList((l) => l.filter((x) => x.message !== e.message))
      if (Date.now() - Date.parse(e.last_at) < 864e5) onCount((n) => Math.max(0, n - 1))
      toast('შეცდომა მონიშნულია მოგვარებულად')
    } catch (er) { toast(er.message, 'error') }
  }

  return (
    <section className="error-log">
      <div className="chips admin-filter" role="group" aria-label="პერიოდი">
        {PERIODS.map(([d, l]) => <button key={d} className={`chip${days === d ? ' on' : ''}`} aria-pressed={days === d} onClick={() => setDays(d)}>{l}</button>)}
      </div>
      {list === null && <Loader />}
      {list?.length === 0 && <Empty icon="check" title="შეცდომები არ არის" text={`ბოლო ${PERIODS.find(([d]) => d === days)[2]} აპს შეცდომა არ ჰქონია.`} />}
      {list?.map((e) => (
        <article key={e.message} className="err-card">
          <div className="err-meta">
            <span className="count">{e.events}-ჯერ</span>
            <span className={`err-src ${e.source}`}>{SOURCES[e.source] || e.source}</span>
            {e.users > 0 && <span className="faint">{e.users} ადამიანთან</span>}
            <span className="faint grow-end">{timeAgo(e.last_at)}</span>
          </div>
          <code className="err-msg">{e.message}</code>
          <dl className="err-facts">
            {e.path && <><dt>გვერდი</dt><dd>{e.path}</dd></>}
            {device(e.user_agent) && <><dt>მოწყობილობა</dt><dd>{device(e.user_agent)}</dd></>}
            {e.release && <><dt>ვერსია</dt><dd>{e.release}</dd></>}
            {e.events > 1 && <><dt>პირველად</dt><dd>{timeAgo(e.first_at)} წინ</dd></>}
          </dl>
          {e.stack && (
            <details className="err-stack">
              <summary>დეტალები</summary>
              <pre>{e.stack}</pre>
            </details>
          )}
          <div className="acts">
            <button className="btn btn-outline sm" onClick={() => clear(e)}><Icon name="check" size={15} />მოგვარებულია</button>
          </div>
        </article>
      ))}
    </section>
  )
}
