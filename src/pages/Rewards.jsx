import { useEffect, useState } from 'react'
import { Avatar, Empty, Loader, TopBar } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { BadgeMedal, CoinIcon, Coins, LevelRing, StreakWeek, useRewards } from '../components/Rewards.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Link } from '../lib/router.jsx'
import { agoPhrase } from '../lib/format.js'
import { BADGES, EARN_RULES, EVENT_LABELS, badgeOf, levelProgress, levelTitle } from '../lib/rewards.js'

export default function Rewards() {
  const { me } = useAuth()
  const { refresh: refreshCtx } = useRewards()
  const [p, setP] = useState(null)
  const [scope, setScope] = useState('friends')
  const [board, setBoard] = useState(null)
  const [badgeOpen, setBadgeOpen] = useState(null)

  useEffect(() => { api.myProgress().then(setP).catch(() => setP(false)); refreshCtx() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setBoard(null); api.xpLeaderboard(scope).then(setBoard).catch(() => setBoard([])) }, [scope])

  if (p === null) return <><TopBar title="ჯილდოები" backTo={`/u/${me.username}`} /><Loader /></>
  if (p === false) return <><TopBar title="ჯილდოები" backTo={`/u/${me.username}`} /><Empty icon="medal" title="ვერ ჩაიტვირთა" text="სცადე ცოტა ხანში." /></>

  const lp = levelProgress(p.xp)
  const earned = new Map(p.badges.map((b) => [b.badge, b.earned_at]))
  const metric = (b) => Math.min(b.target, Number(p.metrics?.[b.metric] || 0))
  const open = badgeOpen && badgeOf(badgeOpen)

  return (
    <>
      <TopBar title="ჯილდოები" backTo={`/u/${me.username}`} />

      <section className="rw-hero">
        <LevelRing xp={p.xp} size={124} stroke={10} />
        <div className="rw-hero-text">
          <small>{levelTitle(lp.level)}</small>
          <h1>{lp.into.toLocaleString('en-US')} <span>/ {(lp.to - lp.from).toLocaleString('en-US')} XP</span></h1>
          <p>მე-{lp.level + 1} დონემდე დარჩა {lp.need}{'\u00a0'}XP</p>
          <div className="rw-pills">
            <Coins n={p.coins} size={18} className="pill" />
            <span className="pill streak"><Icon name="flame" size={17} fill />{p.streak} დღე</span>
          </div>
        </div>
      </section>

      <section className="rw-card">
        <div className="rw-card-head">
          <h2><Icon name="flame" size={20} fill />დღიური სერია</h2>
          <span className="faint small">რეკორდი: {p.best_streak}</span>
        </div>
        <StreakWeek streak={p.streak} claimedToday={p.claimed_today} />
        <p className="small muted">{p.claimed_today ? 'დღევანდელი ბონუსი აღებულია. ხვალ სერია გაგრძელდება.' : 'შემოდი ყოველდღე — მე-7 დღეს +25 ბროწეული.'}</p>
      </section>

      <section>
        <div className="section-title"><h2>მიღწევები <span className="faint">{earned.size}/{BADGES.length}</span></h2></div>
        <div className="badge-grid">
          {BADGES.map((b, i) => {
            const got = earned.has(b.key)
            const m = metric(b)
            return (
              <button key={b.key} className={`badge-tile${got ? ' got' : ''}`} style={{ '--i': i }} onClick={() => setBadgeOpen(b.key)}>
                <BadgeMedal k={b.key} earned={got} size={54} />
                <b>{b.title}</b>
                {got ? <small className="earned"><Icon name="check" size={12} strokeWidth={3} />მიღებულია</small>
                  : <span className="bar" aria-label={`${m}/${b.target}`}><i style={{ width: `${(m / b.target) * 100}%` }} /></span>}
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <div className="section-title"><h2>კვირის ლიდერები</h2></div>
        <div className="seg" role="tablist" style={{ marginTop: -6 }}>
          {[['friends', 'მეგობრები'], ['all', 'ყველა']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={scope === k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{l}</button>
          ))}
        </div>
        {board === null && <Loader />}
        {board?.length === 0 && <p className="pad small muted">ამ კვირაში ჯერ ქულა არავის დაუგროვებია.</p>}
        <ol className="board">
          {board?.map((r, i) => (
            <li key={r.user.id} className={r.user.id === me.id ? 'me' : ''} style={{ '--i': i }}>
              <span className={`rank${i < 3 ? ` r${i + 1}` : ''}`}>{i + 1}</span>
              <Link to={`/u/${r.user.username}`} className="who">
                <Avatar user={r.user} size={40} />
                <span><b>{r.user.full_name || r.user.username}</b><small>დონე {r.level}</small></span>
              </Link>
              <span className="wxp">{r.week_xp}<small>XP</small></span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rw-card">
        <div className="rw-card-head"><h2><Icon name="sparkle" size={20} />როგორ დავაგროვო</h2></div>
        <ul className="earn-list">
          {EARN_RULES.map((r) => (
            <li key={r.text}>
              <span className="ic"><Icon name={r.icon} size={18} /></span>
              <span className="grow"><b>{r.text}</b>{r.note && <small>{r.note}</small>}</span>
              <span className="gain">
                {r.xp && <em>+{r.xp} XP</em>}
                {r.coins && <em className="c"><CoinIcon size={13} />{r.coins}</em>}
              </span>
            </li>
          ))}
        </ul>
        <p className="xs faint">ბროწეულით საჩუქრებს აგზავნი. ის ფულით არ იყიდება და ფულად არ იცვლება.</p>
      </section>

      {p.events?.length > 0 && (
        <section>
          <div className="section-title"><h2>ისტორია</h2></div>
          <ul className="history">
            {p.events.map((e) => (
              <li key={e.id}>
                <span className="grow">
                  <b>{EVENT_LABELS[e.kind] || e.kind}{e.kind === 'badge' && badgeOf(e.ref) ? `: ${badgeOf(e.ref).title}` : ''}{e.kind === 'level' ? ` ${e.ref}` : ''}</b>
                  <small>{agoPhrase(e.created_at)}</small>
                </span>
                {e.xp !== 0 && <em className="x">+{e.xp} XP</em>}
                {e.coins !== 0 && <em className={e.coins < 0 ? 'neg' : 'c'}>{e.coins > 0 ? '+' : '−'}{Math.abs(e.coins)}<CoinIcon size={13} /></em>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {open && (
        <div className="badge-pop" role="dialog" aria-modal="true" aria-label={open.title} onClick={() => setBadgeOpen(null)}>
          <div className="badge-pop-card" onClick={(e) => e.stopPropagation()}>
            <BadgeMedal k={open.key} earned={earned.has(open.key)} size={96} />
            <h3>{open.title}</h3>
            <p>{open.desc}</p>
            {earned.has(open.key)
              ? <span className="small faint">მიღებულია {agoPhrase(earned.get(open.key))}</span>
              : <span className="bar wide"><i style={{ width: `${(metric(open) / open.target) * 100}%` }} /><small>{metric(open)} / {open.target}</small></span>}
            <span className="reward"><CoinIcon size={18} />+{open.coins} ბროწეული</span>
            <button className="btn btn-soft block" onClick={() => setBadgeOpen(null)}>დახურვა</button>
          </div>
        </div>
      )}
    </>
  )
}
