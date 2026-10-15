import { useEffect, useState } from 'react'
import { Avatar, Empty, Loader, PostSkeleton, Sheet, TopBar, PersonRow, Verified } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { PostCard } from '../components/PostCard.jsx'
import { GiftArt, GiftSheet, giftName } from '../components/Gifts.jsx'
import { useAuth } from '../lib/auth.jsx'
import { api } from '../lib/api.js'
import { Link, navigate } from '../lib/router.jsx'
import { count, seenText, agoPhrase } from '../lib/format.js'
import { useToast } from '../components/Toast.jsx'
import { GAME_LIST, GAMES } from '../games/index.js'
import { compressImage } from '../lib/media.js'
import { ReportSheet } from '../components/Report.jsx'
import { banText } from '../lib/format.js'
import { HighlightsRow } from '../components/Highlights.jsx'
import { ShopStrip } from '../components/Listing.jsx'
import { BadgeShelf, LevelChip } from '../components/Rewards.jsx'
import { ShareSheet } from '../components/Share.jsx'

const TABS = [['posts', 'პოსტები'], ['replies', 'პასუხები'], ['media', 'მედია'], ['reels', 'ვიდეოები']]

export default function Profile({ username }) {
  const { me, setProfile } = useAuth()
  const toast = useToast()
  const [p, setP] = useState(undefined)
  const [rel, setRel] = useState({ following: false, followedBy: false, requested: false, closeFriend: false })
  const [gifts, setGifts] = useState([])
  const [stats, setStats] = useState([])
  const [trophies, setTrophies] = useState([])
  const [tab, setTab] = useState('posts')
  const [posts, setPosts] = useState(null)
  const [sheet, setSheet] = useState(null) // 'gift' | 'edit' | 'more' | 'invite'
  const isMe = p && p.id === me?.id
  const [pp, setPp] = useState(null) // დონე, სერია, ბეჯები

  useEffect(() => {
    setP(undefined)
    setTab('posts')
    api.profileByUsername(username).then(async (prof) => {
      setP(prof)
      if (!prof) return
      api.visit(prof.id)
      api.gifts(prof.id).then(setGifts).catch(() => {})
      api.stats(prof.id).then(setStats).catch(() => {})
      api.trophies(prof.id).then(setTrophies).catch(() => setTrophies([]))
      api.profileProgress(prof.id).then(setPp).catch(() => setPp(null))
      if (prof.id !== me?.id) api.relation(prof.id).then(setRel).catch(() => {})
    }).catch(() => setP(null))
  }, [username, me?.id])

  const [pinTick, setPinTick] = useState(0)
  useEffect(() => {
    const on = () => setPinTick((n) => n + 1)
    window.addEventListener('ezo:pinned', on)
    return () => window.removeEventListener('ezo:pinned', on)
  }, [])
  useEffect(() => {
    if (!p) return
    setPosts(null)
    api.userPosts(p.id, tab).then(setPosts).catch(() => setPosts([]))
  }, [p?.id, tab, rel.following, pinTick]) // eslint-disable-line react-hooks/exhaustive-deps

  if (p === undefined) return <><TopBar title="" backTo="/" /><Loader /></>
  if (p === null) return <><TopBar title="პროფილი" backTo="/" /><Empty icon="user" title="ეს პროფილი არ არსებობს" text={`@${username} ვერ მოიძებნა.`} /></>

  const canSee = isMe || !p.is_private || rel.following
  const follow = async () => {
    const on = !(rel.following || rel.requested)
    if (!on && rel.following && p.is_private) { setSheet('unfollow'); return }
    await doFollow(on)
  }
  const doFollow = async (on) => {
    const was = rel
    if (!on) {
      setRel((r) => ({ ...r, following: false, requested: false }))
      if (was.following) setP((x) => ({ ...x, followers_count: x.followers_count - 1 }))
    }
    try {
      const res = await api.follow(p.id, on)
      if (on) {
        setRel((r) => ({ ...r, following: res === 'following', requested: res === 'requested' }))
        if (res === 'following') setP((x) => ({ ...x, followers_count: x.followers_count + 1 }))
        if (res === 'requested') toast('თხოვნა გაიგზავნა')
      }
    } catch (e) { setRel(was); toast(e.message, 'error') }
  }
  const toggleClose = async () => {
    const on = !rel.closeFriend
    setRel((r) => ({ ...r, closeFriend: on }))
    setSheet(null)
    try { await api.setCloseFriend(p.id, on); toast(on ? 'დაემატა ახლო მეგობრებში' : 'ამოიშალა ახლო მეგობრებიდან') } catch (e) { toast(e.message, 'error') }
  }
  const message = async () => {
    try { navigate(`/chat/${await api.openDM(p.id)}`) } catch (e) { toast(e.message, 'error') }
  }

  return (
    <>
      <TopBar title={`@${p.username}`} backTo={isMe ? undefined : '/'} hideBack={isMe}>
        {isMe
          ? <Link to="/settings" className="icon-btn" aria-label="პარამეტრები"><Icon name="settings" /></Link>
          : <button className="icon-btn" onClick={() => setSheet('more')} aria-label="მეტი"><Icon name="more" /></button>}
      </TopBar>
      <section className="profile-head">
        <div className="profile-top">
          <div className="names">
            <h1>{p.full_name || p.username}<Verified user={p} size={22} />{p.is_private && <Icon name="lock" size={20} className="name-lock" title="დახურული ანგარიში" />}</h1>
            <div className="handle small">@{p.username}{!isMe && rel.followedBy && <span className="tag-dating" style={{ marginLeft: 8, background: 'var(--bg-2)', color: 'var(--ink-2)' }}>გამოგიწერა</span>}</div>
            {pp && <LevelChip xp={pp.xp} streak={pp.streak} to={isMe ? '/rewards' : undefined} />}
          </div>
          <Avatar user={p} size={84} online />
        </div>
        {p.banned_until && banText(p.banned_until) && <div className="notice err" style={{ marginTop: 12 }}>ანგარიში შეზღუდულია {banText(p.banned_until)}</div>}
        {p.bio && <p className="profile-bio">{p.bio}</p>}
        <div className="profile-meta">
          {p.city && <span><Icon name="pin" size={15} />{p.city}</span>}
          {p.school && <span><Icon name="school" size={15} />{p.school}{p.grad_year ? `, ${p.grad_year}` : ''}</span>}
          {!isMe && p.last_seen && <span><Icon name="clock" size={15} />{seenText(p.last_seen)}</span>}
        </div>
        <div className="profile-stats">
          <Link to={`/u/${p.username}/followers`}><b>{count(p.followers_count) || 0}</b> გამომწერი</Link>
          <Link to={`/u/${p.username}/following`}><b>{count(p.following_count) || 0}</b> გამოწერილი</Link>
          <span><b>{count(p.posts_count) || 0}</b> პოსტი</span>
        </div>
        <div className="profile-actions">
          {isMe ? (
            <>
              <button className="btn btn-outline" onClick={() => setSheet('edit')}>რედაქტირება</button>
              <Link className="btn btn-outline" to="/guests"><Icon name="eye" size={18} />სტუმრები</Link>
              <Link className="btn btn-outline square" to="/saved" aria-label="შენახული"><Icon name="bookmark" size={19} /></Link>
              <button className="btn btn-outline square" onClick={() => setSheet('share')} aria-label="QR და გაზიარება"><Icon name="qr" size={19} /></button>
            </>
          ) : (
            <>
              <button className={`btn ${rel.following || rel.requested ? 'btn-outline' : 'btn-primary'}`} onClick={follow}>
                {rel.following ? 'გამოწერილია' : rel.requested ? 'მოთხოვნილია' : rel.followedBy ? 'საპასუხო გამოწერა' : 'გამოწერა'}
              </button>
              <button className="btn btn-outline" onClick={message}>მესიჯი</button>
              <button className="btn btn-outline square" onClick={() => setSheet('gift')} aria-label="საჩუქარი"><Icon name="gift" size={19} /></button>
              <button className="btn btn-outline square" onClick={() => setSheet('invite')} aria-label="თამაშში მოწვევა"><Icon name="dice" size={19} /></button>
            </>
          )}
        </div>
      </section>

      {canSee && <HighlightsRow key={p.id} user={p} isMe={isMe} />}

      {(gifts.length > 0 || stats.length > 0) && (
        <>
          {gifts.length > 0 && (
            <>
              <div className="section-title" style={{ paddingTop: 4 }}><h2 className="small">საჩუქრები <span className="faint">{gifts.length}</span></h2></div>
              <div className="gift-shelf">
                {gifts.map((g) => (
                  <Link key={g.id} to={`/u/${g.from?.username}`} className="gift-item" title={g.note || giftName(g.kind)}>
                    <span className="gift-art"><GiftArt kind={g.kind} size={38} /></span>
                    <span className="ellipsis" style={{ maxWidth: 66 }}>{g.from?.full_name?.split(' ')[0] || g.from?.username}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
          {trophies.length > 0 && (
            <div className="trophies" aria-label="ტურნირის გამარჯვებები">
              {trophies.map((t) => (
                <Link key={t.tournament?.id} to={`/t/${t.tournament?.id}`} className="trophy-chip"><Icon name="trophy" size={15} />{t.tournament?.title}</Link>
              ))}
            </div>
          )}
          {stats.length > 0 && (
            <div className="game-badges" style={{ paddingTop: 10 }}>
              {stats.map((s) => (
                <span className="game-badge" key={s.type}><Icon name="trophy" size={16} />{GAMES[s.type]?.title} <b>{s.rating}</b><span className="faint xs">{s.wins}–{s.losses}</span></span>
              ))}
            </div>
          )}
        </>
      )}

      {pp?.badges?.length > 0 && <BadgeShelf keys={pp.badges} to={isMe ? '/rewards' : undefined} />}
      {canSee && <ShopStrip key={`shop-${p.id}`} user={p} isMe={isMe} />}

      {!canSee ? (
        <div className="private-card">
          <span className="lock-art"><Icon name="lock" size={30} /></span>
          <h3>ეს ანგარიში დახურულია</h3>
          <p>{rel.requested ? 'თხოვნა გაგზავნილია. პოსტებს და სთორიებს დადასტურების შემდეგ ნახავ.' : 'გამოიწერე, რომ ნახო პოსტები და სთორიები.'}</p>
        </div>
      ) : (<>
      <div className="seg" role="tablist" style={{ marginTop: 10 }}>
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {posts === null && <PostSkeleton n={2} />}
      {posts?.length === 0 && <Empty icon={tab === 'reels' ? 'reels' : tab === 'media' ? 'image' : 'edit'} title={isMe ? 'აქ ჯერ არაფერია' : 'ჯერ არაფერი გამოუქვეყნებია'} />}
      {posts && posts.length > 0 && (tab === 'media' || tab === 'reels') ? (
        <div className="grid3">
          {posts.map((x) => (
            <Link key={x.id} to={x.kind === 'reel' ? `/reels?start=${x.id}` : `/p/${x.id}`}>
              {x.media[0]?.type === 'video'
                ? <video src={x.media[0].url} muted preload="metadata" playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={x.media[0]?.thumb || x.media[0]?.url} alt="" loading="lazy" decoding="async" />}
              <span className="stat"><Icon name={x.kind === 'reel' ? 'play' : 'heart'} size={13} fill />{count(x.like_count) || 0}</span>
            </Link>
          ))}
        </div>
      ) : posts?.map((x) => <PostCard key={x.id} post={x} onDeleted={(id) => setPosts((c) => c.filter((y) => y.id !== id))} />)}
      </>)}
      {sheet === 'unfollow' && (
        <Sheet title="გამოწერის გაუქმება?" onClose={() => setSheet(null)}>
          <div className="sheet-body vstack">
            <p className="muted">ანგარიში დახურულია — თავიდან გამოსაწერად ისევ თხოვნა დაგჭირდება.</p>
            <button className="btn btn-danger lg block" onClick={() => { setSheet(null); doFollow(false) }}>გაუქმება</button>
            <button className="btn btn-ghost block" onClick={() => setSheet(null)}>დატოვება</button>
          </div>
        </Sheet>
      )}

      {sheet === 'gift' && <GiftSheet to={p} onClose={() => setSheet(null)} />}
      {sheet === 'report' && <ReportSheet user={p.id} onClose={() => setSheet(null)} />}
      {sheet === 'ban' && (
        <Sheet title={`შეზღუდვა: @${p.username}`} onClose={() => setSheet(null)}>
          <div className="menu">
            {[[1, '1 დღით'], [7, '7 დღით'], [30, '30 დღით'], [null, 'სამუდამოდ']].map(([d, l]) => (
              <button key={l} className={d === null ? 'danger' : ''} onClick={async () => {
                setSheet(null)
                try { await api.adminBan(p.id, d, 'მოდერატორის გადაწყვეტილება'); setP((x) => ({ ...x, banned_until: d ? new Date(Date.now() + d * 864e5).toISOString() : 'infinity' })); toast('ანგარიში შეიზღუდა') } catch (e) { toast(e.message, 'error') }
              }}><Icon name="block" />{l}</button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === 'edit' && <EditProfile onClose={() => setSheet(null)} onSaved={(np) => { setP(np); setProfile(np) }} />}
      {sheet === 'invite' && <InviteSheet to={p} onClose={() => setSheet(null)} />}
      {sheet === 'share' && <ShareSheet user={p} onClose={() => setSheet(null)} />}
      {sheet === 'more' && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="menu">
            <button onClick={() => setSheet('share')}><Icon name="qr" />QR კოდი და გაზიარება</button>
            <button onClick={toggleClose}><Icon name="star" fill={rel.closeFriend} />{rel.closeFriend ? 'ახლო მეგობრებიდან ამოღება' : 'ახლო მეგობრებში დამატება'}</button>
            <button onClick={() => setSheet('report')}><Icon name="flag" />დარეპორტება</button>
            {me?.role === 'admin' && (
              <button onClick={async () => {
                setSheet(null)
                const on = !p.verified
                try { await api.adminSetVerified(p.id, on); setP((x) => ({ ...x, verified: on })); toast(on ? 'ნიშანი მიენიჭა' : 'ნიშანი მოიხსნა') } catch (e) { toast(e.message, 'error') }
              }}><Icon name="check" />{p.verified ? 'დადასტურების ნიშნის მოხსნა' : 'დადასტურების ნიშნის მინიჭება'}</button>
            )}
            {['moderator', 'admin'].includes(me?.role) && p.role === 'user' && (p.banned_until
              ? <button onClick={async () => { setSheet(null); await api.adminUnban(p.id); setP((x) => ({ ...x, banned_until: null })); toast('ბლოკი მოიხსნა') }}><Icon name="check" />ბლოკის მოხსნა</button>
              : <button onClick={() => setSheet('ban')}><Icon name="block" />ანგარიშის შეზღუდვა</button>)}
            <button className="danger" onClick={async () => { setSheet(null); await api.block(p.id); toast(`@${p.username} დაიბლოკა`); navigate('/', { replace: true }) }}><Icon name="block" />დაბლოკვა</button>
          </div>
        </Sheet>
      )}
    </>
  )
}

function InviteSheet({ to, onClose }) {
  const toast = useToast()
  const invite = async (type) => {
    try {
      const id = await api.createGame(type, to.id)
      onClose()
      navigate(`/g/${id}`)
    } catch (e) { toast(e.message, 'error') }
  }
  return (
    <Sheet title={`მოწვევა: ${to.full_name || to.username}`} onClose={onClose}>
      <div className="menu">
        {GAME_LIST.map((g) => (
          <button key={g.type} onClick={() => invite(g.type)}><Icon name="dice" /><div className="grow"><b>{g.title}</b><div className="small muted">{g.blurb}</div></div></button>
        ))}
      </div>
    </Sheet>
  )
}

function EditProfile({ onClose, onSaved }) {
  const { me } = useAuth()
  const toast = useToast()
  const [f, setF] = useState({ full_name: me.full_name, bio: me.bio || '', city: me.city || '', school: me.school || '', grad_year: me.grad_year || '', avatar_url: me.avatar_url })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  // დაბადების დღე — ცალკე ცხრილში, მხოლოდ თვე და დღე
  const [bd, setBd] = useState({ month: '', day: '', visible: true })
  const [bdLoaded, setBdLoaded] = useState(null)
  useEffect(() => {
    api.myBirthday().then((b) => { const v = b ? { month: String(b.month), day: String(b.day), visible: b.visible } : { month: '', day: '', visible: true }; setBd(v); setBdLoaded(v) }).catch(() => {})
  }, [])
  const pick = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try { setF((x) => ({ ...x, avatar_url: null })); const url = await api.upload(await compressImage(file, 600), 'avatars'); setF((x) => ({ ...x, avatar_url: url })) } catch (er) { toast(er.message, 'error') } finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true)
    try {
      const np = await api.updateProfile({ ...f, full_name: f.full_name.trim(), grad_year: f.grad_year ? Number(f.grad_year) : null })
      if (bdLoaded && JSON.stringify(bd) !== JSON.stringify(bdLoaded)) {
        await api.saveBirthday(bd.month && bd.day ? { month: Number(bd.month), day: Number(bd.day), visible: bd.visible } : null)
      }
      onSaved(np)
      toast('შენახულია')
      onClose()
    } catch (e) { toast(e.message, 'error'); setBusy(false) }
  }
  return (
    <Sheet title="პროფილის რედაქტირება" onClose={onClose} actions={<button className="btn btn-primary sm" disabled={busy} onClick={save}>შენახვა</button>}>
      <div className="sheet-body vstack">
        <label className="avatar-picker">
          <Avatar user={{ ...me, ...f }} size={72} />
          <span className="btn btn-soft"><Icon name="camera" size={18} />ფოტოს შეცვლა</span>
          <input type="file" accept="image/*" hidden onChange={pick} />
        </label>
        <label className="field"><span>სახელი</span><input className="input" value={f.full_name} onChange={set('full_name')} /></label>
        <label className="field"><span>ბიო</span><textarea className="textarea" maxLength={300} value={f.bio} onChange={set('bio')} /></label>
        <label className="field"><span>ქალაქი</span><input className="input" value={f.city} onChange={set('city')} /></label>
        <label className="field"><span>სკოლა</span><input className="input" value={f.school} onChange={set('school')} /></label>
        <label className="field"><span>დამთავრების წელი</span><input className="input" inputMode="numeric" maxLength={4} value={f.grad_year} onChange={set('grad_year')} /></label>
        <fieldset className="field birthday-field">
          <legend>დაბადების დღე</legend>
          <div className="hstack" style={{ gap: 8 }}>
            <select className="input" aria-label="დღე" value={bd.day} onChange={(e) => setBd((b) => ({ ...b, day: e.target.value }))}>
              <option value="">დღე</option>
              {Array.from({ length: daysIn(bd.month) }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
            <select className="input" aria-label="თვე" value={bd.month} onChange={(e) => setBd((b) => ({ ...b, month: e.target.value, day: Number(b.day) > daysIn(e.target.value) ? '' : b.day }))}>
              <option value="">თვე</option>
              {MONTHS_KA.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <label className="check-row"><input type="checkbox" checked={bd.visible} onChange={(e) => setBd((b) => ({ ...b, visible: e.target.checked }))} />მეგობრებმა დაბადების დღეს შეიტყონ</label>
          <small className="faint">წელი არ ინახება. ჩანს მხოლოდ თვითონ დღეს, მეგობრების მთავარ გვერდზე.</small>
        </fieldset>
      </div>
    </Sheet>
  )
}

const MONTHS_KA = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი']
const daysIn = (m) => ({ 2: 29, 4: 30, 6: 30, 9: 30, 11: 30 })[Number(m)] || 31

export function FollowList({ username, which }) {
  const [list, setList] = useState(null)
  useEffect(() => {
    api.profileByUsername(username).then((p) => p && api.followList(p.id, which)).then((l) => setList(l || [])).catch(() => setList([]))
  }, [username, which])
  return (
    <>
      <TopBar title={which === 'followers' ? 'გამომწერები' : 'გამოწერილები'} backTo={`/u/${username}`} />
      {list === null && <Loader />}
      {list?.length === 0 && <Empty icon="users" title="სია ცარიელია" />}
      {list?.map((u) => <PersonRow key={u.id} user={u} sub={u.bio || `@${u.username}`} />)}
    </>
  )
}

export function Guests() {
  const [list, setList] = useState(null)
  useEffect(() => { api.guests().then(setList).catch(() => setList([])) }, [])
  return (
    <>
      <TopBar title="სტუმრები" backTo="/" />
      <p className="pad small muted" style={{ paddingBottom: 4 }}>ვინ ნახა შენი პროფილი. შენც ჩანხარ მათ სტუმრებში, როცა ვინმეს პროფილს ხსნი.</p>
      {list === null && <Loader />}
      {list?.length === 0 && <Empty icon="eye" title="ჯერ სტუმრები არ ყოფილან" />}
      {list?.map((u) => <PersonRow key={u.id} user={u} sub={agoPhrase(u.visited_at)} />)}
    </>
  )
}
