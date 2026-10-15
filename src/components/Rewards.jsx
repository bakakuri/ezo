import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { Sheet } from './ui.jsx'
import { Icon } from './Icon.jsx'
import { Link } from '../lib/router.jsx'
import { api } from '../lib/api.js'
import { BADGES, badgeOf, checkinReward, levelProgress, levelTitle } from '../lib/rewards.js'

// ---- „ბროწეული“ — შიდა ვალუტის ნიშანი
export function CoinIcon({ size = 18 }) {
  const id = `coin${useId().replace(/:/g, '')}`
  return (
    <svg className="coin-ic" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <radialGradient id={id} cx="35%" cy="35%" r="75%"><stop offset="0" stopColor="#ff7a98" /><stop offset=".55" stopColor="#e0204f" /><stop offset="1" stopColor="#9a0f33" /></radialGradient>
      </defs>
      <path d="M9 5.2 8.2 2.4l2.3 1.3L12 1.6l1.5 2.1 2.3-1.3-.8 2.8z" fill="#7a0c28" />
      <circle cx="12" cy="14" r="9" fill={`url(#${id})`} />
      <path d="M7.6 12.4a5 5 0 0 1 3.4-3.6" stroke="#fff" strokeOpacity=".55" strokeWidth="1.7" strokeLinecap="round" fill="none" />
    </svg>
  )
}

export function Coins({ n, size = 16, className = '' }) {
  return <span className={`coins ${className}`}><CoinIcon size={size} /><b>{Number(n || 0).toLocaleString('en-US').replace(/,/g, ' ')}</b></span>
}

// ---- დონის რგოლი: ბროწეულისფერი რკალი ავსებს გზას შემდეგ დონემდე
export function LevelRing({ xp = 0, size = 112, stroke = 9, label = true }) {
  const { level, pct } = levelProgress(xp)
  const gid = `lr${useId().replace(/:/g, '')}`
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const [shown, setShown] = useState(0)
  useEffect(() => { const t = requestAnimationFrame(() => setShown(pct)); return () => cancelAnimationFrame(t) }, [pct])
  return (
    <span className="level-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff4f7b" /><stop offset=".5" stopColor="#df1f52" /><stop offset="1" stopColor="#8a35e8" /></linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${gid})`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - shown)} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="arc" />
      </svg>
      {label && <span className="lv"><small>დონე</small><b>{level}</b></span>}
    </span>
  )
}

export function LevelChip({ xp, streak = 0, to }) {
  const { level } = levelProgress(xp || 0)
  const body = (
    <>
      <LevelRing xp={xp || 0} size={22} stroke={3} label={false} />
      <b>დონე {level}</b>
      {streak > 0 && <span className="streak-mini"><Icon name="flame" size={14} fill />{streak}</span>}
    </>
  )
  return to ? <Link to={to} className="level-chip">{body}</Link> : <span className="level-chip">{body}</span>
}

// ---- ბეჯი-მედალიონი
export function BadgeMedal({ k, earned = true, size = 56 }) {
  const b = badgeOf(k)
  if (!b) return null
  return (
    <span className={`medal${earned ? '' : ' medal-off'}`} style={{ '--hue': b.hue, width: size, height: size }} title={b.title}>
      <Icon name={b.icon} size={Math.round(size * 0.42)} fill={earned && ['heart', 'star', 'flame'].includes(b.icon)} strokeWidth={2.1} />
    </span>
  )
}

export function BadgeShelf({ keys = [], to }) {
  if (!keys.length) return null
  const list = BADGES.filter((b) => keys.includes(b.key))
  const inner = list.map((b) => <span key={b.key} className="shelf-item"><BadgeMedal k={b.key} size={40} /><small>{b.title}</small></span>)
  return (
    <div className="badge-shelf" aria-label="მიღწევები">
      {to ? <Link to={to} className="badge-shelf-row">{inner}</Link> : <div className="badge-shelf-row">{inner}</div>}
    </div>
  )
}

// ---- 7-დღიანი სერიის ზოლი
export function StreakWeek({ streak, claimedToday }) {
  let pos = streak > 0 ? ((streak - 1) % 7) + 1 : 0 // სერიის მერამდენე დღეა 7-დღიან ციკლში
  let base = streak - pos
  if (!claimedToday && pos === 7) { base = streak; pos = 0 } // კვირა დასრულდა — დღეს ახალი იწყება
  return (
    <ol className="streak-week">
      {Array.from({ length: 7 }, (_, i) => {
        const day = i + 1
        const done = day <= pos
        const today = claimedToday ? day === pos : day === pos + 1
        return (
          <li key={day} className={`${done ? 'done' : ''}${today ? ' today' : ''}${day === 7 ? ' big' : ''}`}>
            <span className="dot">{done ? <Icon name="flame" size={16} fill /> : day === 7 ? <Icon name="gift" size={15} /> : day}</span>
            <small>+{checkinReward(base + day)}</small>
          </li>
        )
      })}
    </ol>
  )
}

// ---- დღიური ბონუსის ფანჯარა
function DailyBonus({ r, onClose }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let v = 0
    const step = Math.max(1, Math.round(r.reward / 18))
    const t = setInterval(() => { v = Math.min(r.reward, v + step); setN(v); if (v >= r.reward) clearInterval(t) }, 45)
    return () => clearInterval(t)
  }, [r.reward])
  const week = r.streak > 0 && r.streak % 7 === 0
  return (
    <Sheet onClose={onClose}>
      <div className="bonus">
        <span className="bonus-flame"><Icon name="flame" size={54} fill /><b>{r.streak}</b></span>
        <h2>{r.first ? 'მოგესალმები ეზოში!' : week ? 'მთელი კვირა ზედიზედ!' : r.streak > 1 ? `${r.streak} დღე ზედიზედ` : 'დღიური ბონუსი'}</h2>
        <p className="muted">{r.first ? 'მისასალმებელი საჩუქარი და პირველი დღის ბონუსი' : 'ხვალაც შემოდი — ბონუსი სერიასთან ერთად იზრდება'}</p>
        <span className="bonus-coins"><CoinIcon size={30} />+{n}</span>
        <StreakWeek streak={r.streak} claimedToday />
        <div className="hstack" style={{ gap: 8, width: '100%' }}>
          <Link to="/rewards" className="btn btn-soft lg" style={{ flex: 1 }} onClick={onClose}>ჯილდოები</Link>
          <button className="btn btn-accent lg" style={{ flex: 1 }} onClick={onClose}>მადლობა</button>
        </div>
      </div>
    </Sheet>
  )
}

// ---- კონტექსტი: ბალანსი და დღიური შესვლა აპის გახსნისას
const RewardsCtx = createContext({ progress: null, refresh: () => {} })
export function RewardsProvider({ children }) {
  const [progress, setProgress] = useState(null)
  const [bonus, setBonus] = useState(null)
  const once = useRef(false)
  const refresh = useCallback(() => api.myProgress().then(setProgress).catch(() => {}), [])
  useEffect(() => {
    if (once.current) return
    once.current = true
    api.dailyCheckin().then((r) => { if (r?.claimed) setBonus(r) }).catch(() => {}).finally(refresh)
  }, [refresh])
  return (
    <RewardsCtx.Provider value={{ progress, refresh }}>
      {children}
      {bonus && <DailyBonus r={bonus} onClose={() => setBonus(null)} />}
    </RewardsCtx.Provider>
  )
}
export const useRewards = () => useContext(RewardsCtx)
