import { useCallback, useEffect, useState } from 'react'
import { TopBar, Empty, Loader, PersonRow, ConfirmSheet, PostSkeleton } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { PostCard } from '../components/PostCard.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { agoPhrase } from '../lib/format.js'
import { useToast } from '../components/Toast.jsx'

// ---- შენახული პოსტები და კოლექციები
export function Saved() {
  const toast = useToast()
  const [cols, setCols] = useState([])
  const [active, setActive] = useState(null)
  const [posts, setPosts] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const loadCols = useCallback(() => api.collections().then(setCols).catch(() => setCols([])), [])
  useEffect(() => { loadCols() }, [loadCols])
  useEffect(() => { setPosts(null); api.saved(active).then(setPosts).catch(() => setPosts([])) }, [active])
  const current = cols.find((c) => c.id === active)
  return (
    <>
      <TopBar title="შენახული" backTo="/settings">
        {current && <button className="icon-btn" aria-label="კოლექციის წაშლა" onClick={() => setConfirm(true)}><Icon name="trash" size={20} /></button>}
      </TopBar>
      <div className="chips" style={{ padding: '10px 16px 4px' }}>
        <button className={`chip${active === null ? ' on' : ''}`} onClick={() => setActive(null)}><Icon name="bookmark" size={15} />ყველა</button>
        {cols.map((c) => <button key={c.id} className={`chip${active === c.id ? ' on' : ''}`} onClick={() => setActive(c.id)}>{c.name} <small>{c.count}</small></button>)}
      </div>
      {posts === null && <PostSkeleton n={2} />}
      {posts?.length === 0 && <Empty icon="bookmark" title={current ? 'კოლექცია ცარიელია' : 'ჯერ არაფერი შეგინახავს'} text="პოსტის ქვეშ დააჭირე სანიშნეს. კოლექციაში დასამატებლად — პოსტის მენიუ → „კოლექციაში შენახვა“." />}
      {posts?.map((p) => <PostCard key={p.id} post={p} />)}
      {confirm && current && (
        <ConfirmSheet title={`წავშალო „${current.name}“?`} text="პოსტები „ყველა შენახულში“ დარჩება." onClose={() => setConfirm(false)}
          onConfirm={async () => { await api.deleteCollection(current.id); setConfirm(false); setActive(null); loadCols(); toast('კოლექცია წაიშალა') }} />
      )}
    </>
  )
}

// ---- გამოწერის თხოვნები (დახურული პროფილისთვის)
export function FollowRequests() {
  const toast = useToast()
  const [list, setList] = useState(null)
  const load = useCallback(() => api.followRequests().then(setList).catch(() => setList([])), [])
  useEffect(() => { load() }, [load])
  const respond = async (u, accept) => {
    setList((l) => l.filter((x) => x.id !== u.id))
    try { await api.respondRequest(u.id, accept); toast(accept ? `${u.full_name || u.username} დადასტურდა` : 'თხოვნა უარყოფილია') } catch (e) { toast(e.message, 'error'); load() }
  }
  return (
    <>
      <TopBar title="გამოწერის თხოვნები" backTo="/notifications" />
      {list === null && <Loader />}
      {list?.length === 0 && <Empty icon="lock" title="თხოვნები არ არის" text="როცა ანგარიში დახურულია, ახალი გამომწერები ჯერ აქ გამოჩნდებიან." />}
      {list?.map((u) => (
        <PersonRow key={u.id} user={u} sub={agoPhrase(u.requested_at)} right={(
          <span className="hstack" style={{ gap: 6 }}>
            <button className="btn btn-accent sm" onClick={() => respond(u, true)}>დადასტურება</button>
            <button className="btn btn-outline sm" onClick={() => respond(u, false)} aria-label="უარყოფა"><Icon name="close" size={16} /></button>
          </span>
        )} />
      ))}
    </>
  )
}

// ---- ახლო მეგობრები (სთორიებისთვის)
export function CloseFriends() {
  const { me } = useAuth()
  const toast = useToast()
  const [people, setPeople] = useState(null)
  const [chosen, setChosen] = useState(new Set())
  useEffect(() => {
    Promise.all([api.followList(me.id, 'followers'), api.followList(me.id, 'following'), api.closeFriends()]).then(([a, b, cf]) => {
      const map = new Map([...a, ...b, ...cf].filter(Boolean).map((p) => [p.id, p]))
      setPeople([...map.values()].filter((p) => p.id !== me.id))
      setChosen(new Set(cf.map((p) => p.id)))
    }).catch(() => setPeople([]))
  }, [me.id])
  const toggle = async (p) => {
    const on = !chosen.has(p.id)
    setChosen((s) => { const n = new Set(s); if (on) n.add(p.id); else n.delete(p.id); return n })
    try { await api.setCloseFriend(p.id, on) } catch (e) { toast(e.message, 'error') }
  }
  return (
    <>
      <TopBar title="ახლო მეგობრები" backTo="/settings" />
      <p className="pad small muted" style={{ paddingBottom: 4 }}>„ახლო მეგობრების“ სთორიებს მხოლოდ ესენი ნახავენ. სიას არავინ ხედავს და არავის ეგზავნება შეტყობინება.</p>
      {people === null && <Loader />}
      {people?.length === 0 && <Empty icon="users" title="ჯერ არავინ გყავს" text="გამოიწერე მეგობრები და აქ გამოჩნდებიან." />}
      {people?.sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id))).map((p) => (
        <PersonRow key={p.id} user={p} right={(
          <button className={`cf-toggle${chosen.has(p.id) ? ' on' : ''}`} onClick={() => toggle(p)} aria-pressed={chosen.has(p.id)}
            aria-label={chosen.has(p.id) ? 'ახლო მეგობრებიდან ამოღება' : 'ახლო მეგობრებში დამატება'}>
            <Icon name="star" size={18} fill={chosen.has(p.id)} />
          </button>
        )} />
      ))}
    </>
  )
}
