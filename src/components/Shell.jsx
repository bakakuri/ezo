import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Link, useLocation } from '../lib/router.jsx'
import { Icon, Mark } from './Icon.jsx'
import { Avatar } from './ui.jsx'
import { useAuth } from '../lib/auth.jsx'
import { api } from '../lib/api.js'
import { useComposer } from './Composer.jsx'
import { SuggestList } from './Suggest.jsx'

const UnreadCtx = createContext({ notifications: 0, messages: 0, refresh: () => {} })

export function UnreadProvider({ children }) {
  const [counts, setCounts] = useState({ notifications: 0, messages: 0 })
  const refresh = useCallback(() => api.unreadCounts().then(setCounts).catch(() => {}), [])
  useEffect(() => {
    refresh()
    const off = api.subscribeNotifications(() => refresh())
    const t = setInterval(refresh, 60_000)
    return () => { off?.(); clearInterval(t) }
  }, [refresh])
  return <UnreadCtx.Provider value={{ ...counts, refresh }}>{children}</UnreadCtx.Provider>
}
export const useUnread = () => useContext(UnreadCtx)

const NAV = [
  { to: '/', icon: 'home', label: 'მთავარი' },
  { to: '/explore', icon: 'search', label: 'ძიება' },
  { to: '/reels', icon: 'reels', label: 'ვიდეოები' },
  { to: '/games', icon: 'dice', label: 'თამაშები' },
]
const isActive = (path, to) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`))

export function BottomNav({ dark = false }) {
  const { path } = useLocation()
  const { me } = useAuth()
  return (
    <nav className={`bottomnav${dark ? ' dark' : ''}`} aria-label="მთავარი ნავიგაცია">
      {NAV.map((n) => {
        const on = isActive(path, n.to)
        return (
          <Link key={n.to} to={n.to} className={on ? 'active' : ''} aria-label={n.label} aria-current={on ? 'page' : undefined}>
            <Icon name={n.icon} size={26} fill={on && (n.icon === 'home' || n.icon === 'dice')} strokeWidth={on ? 2.3 : 1.8} />
          </Link>
        )
      })}
      <Link to={`/u/${me?.username}`} className={path === `/u/${me?.username}` ? 'active' : ''} aria-label="პროფილი">
        <Avatar user={me} size={28} />
      </Link>
    </nav>
  )
}

export function SideNav() {
  const { path } = useLocation()
  const { me } = useAuth()
  const { chooser } = useComposer()
  const unread = useUnread()
  const items = [
    ...NAV,
    { to: '/groups', icon: 'users', label: 'ჯგუფები' },
    { to: '/events', icon: 'clock', label: 'ივენთები' },
    { to: '/market', icon: 'bag', label: 'ბაზარი' },
    { to: '/rewards', icon: 'medal', label: 'ჯილდოები' },
    { to: '/dating', icon: 'flame', label: 'გაცნობა' },
    { to: '/inbox', icon: 'chat', label: 'მესიჯები', badge: unread.messages },
    { to: '/notifications', icon: 'bell', label: 'შეტყობინებები', badge: unread.notifications },
  ]
  return (
    <nav className="sidenav" aria-label="მთავარი ნავიგაცია">
      <Link to="/" className="wordmark"><Mark size={30} /><span>ეზო</span></Link>
      {items.map((n) => {
        const on = isActive(path, n.to)
        return (
          <Link key={n.to} to={n.to} className={on ? 'active' : ''}>
            <Icon name={n.icon} size={24} fill={on && ['home', 'dice', 'flame'].includes(n.icon)} strokeWidth={on ? 2.3 : 1.8} />
            {n.label}
            {n.badge > 0 && <span className="badge">{n.badge}</span>}
          </Link>
        )
      })}
      <Link to={`/u/${me?.username}`} className={path === `/u/${me?.username}` ? 'active' : ''}>
        <Avatar user={me} size={26} />პროფილი
      </Link>
      <button className="btn btn-primary lg create" onClick={chooser}><Icon name="plus" size={20} />შექმნა</button>
      <span className="grow" />
      <Link to="/settings"><Icon name="settings" size={22} />პარამეტრები</Link>
    </nav>
  )
}

export function Aside() {
  const [games, setGames] = useState([])
  useEffect(() => {
    api.myGames().then(setGames).catch(() => {})
  }, [])
  return (
    <aside className="aside">
      {games.length > 0 && (
        <div className="aside-card">
          <h3>შენი თამაშები</h3>
          {games.slice(0, 4).map((g) => <GameLine key={g.id} g={g} />)}
        </div>
      )}
      <div className="aside-card">
        <h3>შეიძლება იცნობდე</h3>
        <SuggestList limit={5} />
      </div>
      <p className="aside-foot">ეზო · ქართული სოციალური ქსელი</p>
    </aside>
  )
}

function GameLine({ g }) {
  const { me } = useAuth()
  const opp = g.player_a === me?.id ? g.b : g.a
  const titles = { nardi: 'ნარდი', chess: 'ჭადრაკი', checkers: 'შაშკი', domino: 'დომინო' }
  const myTurn = g.turn === me?.id
  return (
    <Link to={`/g/${g.id}`} className="person-row">
      <Avatar user={opp} size={38} />
      <div className="who"><b>{titles[g.type]}</b><small>{opp ? `vs ${opp.full_name || opp.username}` : 'მოწინააღმდეგეს ველოდებით'}</small></div>
      {myTurn && <span className="tag-dating" style={{ background: 'var(--teal-soft)', color: 'var(--teal)' }}>შენი სვლა</span>}
    </Link>
  )
}

export function HomeTopActions() {
  const unread = useUnread()
  const { chooser } = useComposer()
  return (
    <>
      <button className="icon-btn hide-desk" onClick={chooser} aria-label="შექმნა"><Icon name="plus" /></button>
      <Link to="/dating" className="icon-btn hide-desk" aria-label="გაცნობა"><Icon name="flame" /></Link>
      <Link to="/notifications" className="icon-btn hide-desk" aria-label="შეტყობინებები">
        <Icon name="bell" />{unread.notifications > 0 && <span className="badge">{unread.notifications}</span>}
      </Link>
      <Link to="/inbox" className="icon-btn hide-desk" aria-label="მესიჯები">
        <Icon name="chat" />{unread.messages > 0 && <span className="badge">{unread.messages}</span>}
      </Link>
    </>
  )
}
