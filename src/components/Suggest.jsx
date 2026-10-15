import { useEffect, useState } from 'react'
import { Avatar, PersonRow, Verified } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { Link } from '../lib/router.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useToast } from './Toast.jsx'
import { count } from '../lib/format.js'

// რატომ გთავაზობთ ამ ადამიანს (who_to_follow-ის reason)
export function reasonText(p, me) {
  switch (p.reason) {
    case 'follows_you': return 'გამოგიწერა'
    case 'invite': return p.id === me?.invited_by ? 'მოგიწვია ეზოში' : 'შენი მოწვევით მოვიდა'
    case 'classmate': return p.grad_year ? `კლასელი, ${p.grad_year}` : 'კლასელი'
    case 'mutual': return p.via ? `საერთო: ${p.via}${p.mutual > 1 ? ` და კიდევ ${p.mutual - 1}` : ''}` : `${p.mutual} საერთო`
    case 'school': return 'იგივე სკოლა'
    case 'city': return 'შენი ქალაქიდან'
    case 'new': return 'ახალია ეზოში'
    default: return p.followers_count ? `${count(p.followers_count)} გამომწერი` : `@${p.username}`
  }
}

// გამოწერა/„არ მაინტერესებს“ ერთი სიისთვის
export function useSuggestions(limit = 12) {
  const toast = useToast()
  const [people, setPeople] = useState(null)
  const [followed, setFollowed] = useState({})
  useEffect(() => { api.suggested(limit).then(setPeople).catch(() => setPeople([])) }, [limit])
  const follow = async (p) => {
    const on = !followed[p.id]
    setFollowed((f) => ({ ...f, [p.id]: on }))
    try { await api.follow(p.id, on) } catch (e) { setFollowed((f) => ({ ...f, [p.id]: !on })); toast(e.message, 'error') }
  }
  const dismiss = async (p) => {
    setPeople((list) => list.filter((x) => x.id !== p.id))
    try { await api.dismissSuggestion(p.id) } catch { /* შემდეგ ჯერზე ისევ გამოჩნდება */ }
  }
  return { people, followed, follow, dismiss }
}

const followLabel = (p, on) => (on ? 'გამოწერილია' : p.reason === 'follows_you' ? 'საპასუხოდ' : 'გამოწერა')

// ჰორიზონტალური ზოლი ფიდში
export function SuggestStrip({ title = 'შეიძლება იცნობდე' }) {
  const { me } = useAuth()
  const { people, followed, follow, dismiss } = useSuggestions(12)
  if (!people?.length) return null
  return (
    <section className="suggest-strip" aria-label={title}>
      <div className="section-title"><h2>{title}</h2><Link to="/explore?tab=people">ყველა</Link></div>
      <div className="chips suggest-row">
        {people.map((p) => (
          <div key={p.id} className="suggest-card">
            <button className="suggest-x" onClick={() => dismiss(p)} aria-label={`არ მაინტერესებს: ${p.full_name || p.username}`}><Icon name="close" size={14} /></button>
            <Link to={`/u/${p.username}`} className="suggest-who">
              <Avatar user={p} size={64} />
              <b className="ellipsis">{p.full_name || p.username}<Verified user={p} size={14} /></b>
              <span className="xs faint suggest-why">{reasonText(p, me)}</span>
            </Link>
            <button className={`btn sm block ${followed[p.id] ? 'btn-outline' : 'btn-primary'}`} onClick={() => follow(p)}>{followLabel(p, followed[p.id])}</button>
          </div>
        ))}
      </div>
    </section>
  )
}

// სია (გვერდითა სვეტი, „ძებნა“-ს ჩანართი)
export function SuggestList({ limit = 5, dismissible = true }) {
  const { me } = useAuth()
  const { people, followed, follow, dismiss } = useSuggestions(limit)
  if (people === null) return null
  if (!people.length) return <p className="pad small faint">ახლა შემოთავაზება არ გვაქვს — მეგობრებს ძებნით იპოვი.</p>
  return people.map((p) => (
    <PersonRow key={p.id} user={p} sub={reasonText(p, me)} right={
      <div className="hstack" style={{ gap: 4 }}>
        <button className={`btn sm ${followed[p.id] ? 'btn-outline' : 'btn-primary'}`} onClick={() => follow(p)}>{followLabel(p, followed[p.id])}</button>
        {dismissible && <button className="icon-btn sm" onClick={() => dismiss(p)} aria-label={`არ მაინტერესებს: ${p.full_name || p.username}`}><Icon name="close" size={16} /></button>}
      </div>
    } />
  ))
}
