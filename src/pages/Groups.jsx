import { useCallback, useEffect, useState } from 'react'
import { Avatar, ConfirmSheet, Empty, Loader, PersonRow, PostSkeleton, Sheet, TopBar } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { PostCard } from '../components/PostCard.jsx'
import { EventCard, GroupForm, GroupRow, EventForm } from '../components/Community.jsx'
import { useComposer } from '../components/Composer.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Link, navigate, useLocation } from '../lib/router.jsx'
import { count, initials } from '../lib/format.js'
import { useToast } from '../components/Toast.jsx'

export default function Groups() {
  const [mine, setMine] = useState(null)
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [joined, setJoined] = useState({})
  const toast = useToast()

  useEffect(() => { api.myGroups().then(setMine).catch(() => setMine([])) }, [])
  useEffect(() => {
    const t = setTimeout(() => api.discoverGroups(q).then(setList).catch(() => setList([])), q ? 250 : 0)
    return () => clearTimeout(t)
  }, [q])

  const join = async (g) => {
    try {
      const st = await api.joinGroup(g.id)
      setJoined((j) => ({ ...j, [g.id]: st }))
      toast(st === 'active' ? `შენ ხარ „${g.name}“-ის წევრი` : 'მოთხოვნა გაიგზავნა')
    } catch (e) { toast(e.message, 'error') }
  }
  const mineIds = new Set((mine || []).map((g) => g.id))

  return (
    <>
      <TopBar title="ჯგუფები" backTo="/explore">
        <button className="icon-btn" onClick={() => setCreating(true)} aria-label="ჯგუფის შექმნა"><Icon name="plus" /></button>
      </TopBar>
      {mine?.length > 0 && (
        <>
          <div className="section-title"><h2>შენი ჯგუფები</h2></div>
          <div className="group-cards">
            {mine.map((g) => (
              <Link key={g.id} to={`/groups/${g.slug}`} className="group-card">
                <div className="cv">{g.cover_url ? <img src={g.cover_url} alt="" loading="lazy" /> : null}</div>
                <div className="tx">
                  <b>{g.name}</b>
                  <small className={g.my_status === 'pending' ? 'pending' : ''}>{g.my_status === 'pending' ? 'მოთხოვნა გაგზავნილია' : `${count(g.members_count) || 0} წევრი`}</small>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
      <div className="section-title"><h2>აღმოაჩინე</h2></div>
      <div className="pad" style={{ paddingTop: 0 }}>
        <div className="searchbox"><Icon name="search" size={19} /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ჯგუფის ძებნა" aria-label="ჯგუფის ძებნა" /></div>
      </div>
      {list === null && <Loader />}
      {list?.length === 0 && <Empty icon="users" title="ასეთი ჯგუფი ჯერ არ არის" text="შექმენი პირველი." action={<button className="btn btn-primary" onClick={() => setCreating(true)}>ჯგუფის შექმნა</button>} />}
      {list?.map((g) => (
        <GroupRow key={g.id} group={g} right={
          mineIds.has(g.id) || joined[g.id]
            ? <span className="small faint">{(joined[g.id] || g.my_status) === 'pending' ? 'გაგზავნილია' : 'წევრი ხარ'}</span>
            : <button className="btn btn-primary sm" onClick={() => join(g)}>{g.privacy === 'private' ? 'მოთხოვნა' : 'გაწევრიანება'}</button>
        } />
      ))}
      {creating && <GroupForm onClose={() => setCreating(false)} />}
    </>
  )
}

const TONES = ['#9e1b32', '#2c7a73', '#6b4226', '#5b3a70', '#3a5a8c']

export function GroupPage({ slug }) {
  const { me } = useAuth()
  const { query } = useLocation()
  const toast = useToast()
  const { compose } = useComposer()
  const [g, setG] = useState(undefined)
  const [tab, setTab] = useState(query.get('tab') || 'posts')
  const [posts, setPosts] = useState(null)
  const [events, setEvents] = useState(null)
  const [members, setMembers] = useState(null)
  const [sheet, setSheet] = useState(null) // 'edit' | 'menu' | 'event' | { member }

  const load = useCallback(() => api.group(slug).then(setG).catch(() => setG(null)), [slug])
  useEffect(() => { load() }, [load])

  const member = g?.my_status === 'active'
  const admin = member && ['owner', 'admin'].includes(g?.my_role)
  const visible = g && (g.privacy === 'public' || member)

  useEffect(() => {
    if (!g || !visible) return
    if (tab === 'posts') { setPosts(null); api.groupPosts(g.id).then(setPosts).catch(() => setPosts([])) }
    if (tab === 'events') { setEvents(null); api.events({ groupId: g.id }).then(setEvents).catch(() => setEvents([])) }
    if (tab === 'members') { setMembers(null); api.groupMembers(g.id).then(setMembers).catch(() => setMembers([])) }
  }, [g?.id, tab, visible]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onPosted = (e) => { if (e.detail.group_id && e.detail.group_id === g?.id && !e.detail.parent_id) setPosts((c) => [e.detail, ...(c || [])]) }
    window.addEventListener('ezo:posted', onPosted)
    return () => window.removeEventListener('ezo:posted', onPosted)
  }, [g?.id])

  if (g === undefined) return <><TopBar title="" backTo="/groups" /><Loader /></>
  if (g === null) return <><TopBar title="ჯგუფი" backTo="/groups" /><Empty icon="users" title="ჯგუფი ვერ მოიძებნა" /></>

  const join = async () => {
    try {
      const st = await api.joinGroup(g.id)
      toast(st === 'active' ? 'მოგესალმებით ჯგუფში' : 'მოთხოვნა გაიგზავნა ადმინთან')
      load()
    } catch (e) { toast(e.message, 'error') }
  }
  const leave = async () => {
    setSheet(null)
    try { await api.leaveGroup(g.id); toast(g.my_status === 'pending' ? 'მოთხოვნა გაუქმდა' : 'ჯგუფი დატოვე'); load() } catch (e) { toast(e.message, 'error') }
  }
  const manage = async (u, action) => {
    setSheet(null)
    try {
      await api.manageMember(g.id, u.id, action)
      setMembers((list) => (action === 'remove' ? list.filter((x) => x.id !== u.id)
        : list.map((x) => (x.id === u.id ? { ...x, status: action === 'approve' ? 'active' : x.status, role: action === 'make_admin' ? 'admin' : action === 'make_member' ? 'member' : x.role } : x))))
      if (action === 'approve') setG((x) => ({ ...x, members_count: x.members_count + 1 }))
    } catch (e) { toast(e.message, 'error') }
  }
  const pending = members?.filter((m) => m.status === 'pending') || []
  const active = members?.filter((m) => m.status === 'active') || []
  const tone = TONES[[...g.id].reduce((n, c) => n + c.charCodeAt(0), 0) % TONES.length]

  return (
    <>
      <TopBar title={g.name} backTo="/groups">
        {member && <button className="icon-btn" onClick={() => setSheet('menu')} aria-label="მეტი"><Icon name="more" /></button>}
      </TopBar>
      <div className={`cover${g.cover_url ? '' : ' fallback'}`} style={g.cover_url ? undefined : { background: `linear-gradient(135deg, ${tone}, #141816)` }}>
        {g.cover_url ? <img src={g.cover_url} alt="" /> : initials(g.name).slice(0, 2)}
      </div>
      <section className="group-head">
        <h1>{g.name}</h1>
        <div className="meta"><Icon name={g.privacy === 'private' ? 'block' : 'globe'} size={15} />{g.privacy === 'private' ? 'დახურული ჯგუფი' : 'საჯარო ჯგუფი'}, {count(g.members_count) || 0} წევრი</div>
        {g.description && <p>{g.description}</p>}
        <div className="actions-row">
          {!g.my_status && <button className="btn btn-accent" onClick={join}>{g.privacy === 'private' ? 'მოთხოვნის გაგზავნა' : 'გაწევრიანება'}</button>}
          {g.my_status === 'pending' && <button className="btn btn-outline" onClick={leave}>მოთხოვნის გაუქმება</button>}
          {member && <button className="btn btn-primary" onClick={() => compose({ group: g })}><Icon name="edit" size={17} />დაწერე ჯგუფში</button>}
          {admin && <button className="btn btn-outline" onClick={() => setSheet('edit')}>რედაქტირება</button>}
        </div>
      </section>
      <div className="seg" role="tablist" style={{ marginTop: 8 }}>
        {[['posts', 'პოსტები'], ['events', 'ივენთები'], ['members', admin && pending.length ? `წევრები (${pending.length})` : 'წევრები']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {!visible && (
        <div className="locked">
          <div className="empty" style={{ padding: 0 }}><div className="art"><Icon name="block" size={26} /></div></div>
          <b>ეს დახურული ჯგუფია</b>
          <p className="small">პოსტებს, ივენთებს და წევრებს ხედავენ მხოლოდ წევრები.</p>
        </div>
      )}

      {visible && tab === 'posts' && (
        <>
          {posts === null && <PostSkeleton n={2} />}
          {posts?.length === 0 && <Empty icon="edit" title="ჯგუფში ჯერ არაფერია" text={member ? 'დაწერე პირველი პოსტი.' : 'შეუერთდი და დაწერე პირველი.'} />}
          {posts?.map((p) => <PostCard key={p.id} post={p} hideGroup onDeleted={(id) => setPosts((c) => c.filter((x) => x.id !== id))} />)}
        </>
      )}

      {visible && tab === 'events' && (
        <>
          {member && <div className="pad" style={{ paddingBottom: 0 }}><button className="btn btn-outline block" onClick={() => setSheet('event')}><Icon name="plus" size={18} />ივენთის შექმნა</button></div>}
          {events === null && <Loader />}
          {events?.length === 0 && <Empty icon="clock" title="დაგეგმილი ივენთი არ არის" />}
          {events?.map((e) => <EventCard key={e.id} event={e} />)}
        </>
      )}

      {visible && tab === 'members' && (
        <>
          {members === null && <Loader />}
          {admin && pending.length > 0 && (
            <>
              <div className="section-title"><h2>მოთხოვნები</h2></div>
              {pending.map((u) => (
                <PersonRow key={u.id} user={u} right={
                  <span className="hstack" style={{ gap: 6 }}>
                    <button className="btn btn-primary sm" onClick={() => manage(u, 'approve')}>მიღება</button>
                    <button className="btn btn-ghost sm" onClick={() => manage(u, 'remove')}>უარი</button>
                  </span>
                } />
              ))}
              <div className="section-title"><h2>წევრები</h2></div>
            </>
          )}
          {active.map((u) => (
            <PersonRow key={u.id} user={u} sub={u.bio || `@${u.username}`} right={
              <span className="hstack" style={{ gap: 6 }}>
                {u.role !== 'member' && <span className={`role-badge ${u.role}`}>{u.role === 'owner' ? 'მფლობელი' : 'ადმინი'}</span>}
                {admin && u.role !== 'owner' && u.id !== me?.id && <button className="icon-btn sm" onClick={() => setSheet({ member: u })} aria-label="მართვა"><Icon name="more" size={18} /></button>}
              </span>
            } />
          ))}
        </>
      )}

      {sheet === 'edit' && <GroupForm initial={g} onClose={() => setSheet(null)} onSaved={(ng) => setG((x) => ({ ...x, ...ng }))} />}
      {sheet === 'event' && <EventForm group={g} onClose={() => setSheet(null)} />}
      {sheet === 'menu' && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="menu">
            <button onClick={async () => { setSheet(null); const url = `${location.origin}/groups/${g.slug}`; try { if (navigator.share) await navigator.share({ url, title: g.name }); else { await navigator.clipboard.writeText(url); toast('ბმული დაკოპირდა') } } catch { /* */ } }}><Icon name="share" />გაზიარება</button>
            {g.my_role === 'owner'
              ? <button className="danger" onClick={() => setSheet('delete')}><Icon name="trash" />ჯგუფის წაშლა</button>
              : <button className="danger" onClick={leave}><Icon name="logout" />ჯგუფის დატოვება</button>}
          </div>
        </Sheet>
      )}
      {sheet === 'delete' && (
        <ConfirmSheet title="ჯგუფის წაშლა" text="წაიშლება ჯგუფი, მისი პოსტები და ივენთები. ამის დაბრუნება შეუძლებელია." confirm="წაშლა"
          onClose={() => setSheet(null)} onConfirm={async () => { await api.deleteGroup(g.id); toast('ჯგუფი წაიშალა'); navigate('/groups', { replace: true }) }} />
      )}
      {sheet?.member && (
        <Sheet title={sheet.member.full_name || sheet.member.username} onClose={() => setSheet(null)}>
          <div className="menu">
            {sheet.member.role === 'admin'
              ? <button onClick={() => manage(sheet.member, 'make_member')}><Icon name="user" />ადმინობის მოხსნა</button>
              : <button onClick={() => manage(sheet.member, 'make_admin')}><Icon name="star" />ადმინად დანიშვნა</button>}
            <button className="danger" onClick={() => manage(sheet.member, 'remove')}><Icon name="close" />ჯგუფიდან ამოშლა</button>
          </div>
        </Sheet>
      )}
    </>
  )
}

export function GroupLink({ group }) {
  return <Link to={`/groups/${group.slug}`} className="hstack small"><Avatar user={{ id: group.id, full_name: group.name }} size={20} />{group.name}</Link>
}
