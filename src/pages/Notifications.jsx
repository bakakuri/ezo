import { useEffect, useState } from 'react'
import { Avatar, Empty, Loader, TopBar } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { api } from '../lib/api.js'
import { Link } from '../lib/router.jsx'
import { timeAgo } from '../lib/format.js'
import { useUnread } from '../components/Shell.jsx'
import { Swatch } from '../components/games/Swatch.jsx'
import { priceText } from '../lib/market.js'
import { badgeOf } from '../lib/rewards.js'
import { BadgeMedal, CoinIcon } from '../components/Rewards.jsx'

const KIND = {
  like: { icon: 'heart', color: 'var(--accent)', text: 'მოიწონა შენი პოსტი' },
  reply: { icon: 'reply', color: '#3a5a8c', text: 'გიპასუხა' },
  quote: { icon: 'repost', color: '#5b3a70', text: 'გაგიზიარა ციტატით' },
  mention: { icon: 'at', color: '#2f6f8f', text: 'მოგიხსენია პოსტში' },
  follow: { icon: 'user', color: 'var(--teal)', text: 'გამოგიწერა' },
  gift: { icon: 'gift', color: '#c77d12', text: 'საჩუქარი გამოგიგზავნა' },
  match: { icon: 'flame', color: 'var(--accent)', text: 'თქვენ ერთმანეთი მოიწონეთ' },
  game_invite: { icon: 'dice', color: 'var(--teal)', text: 'თამაშში გეპატიჟება' },
  group_request: { icon: 'users', color: '#3a5a8c', text: 'ითხოვს გაწევრიანებას' },
  group_approved: { icon: 'users', color: 'var(--teal)', text: 'მიგიღო ჯგუფში' },
  event_rsvp: { icon: 'clock', color: 'var(--accent)', text: 'მოდის შენს ივენთზე' },
  follow_request: { icon: 'lock', color: '#6d4ad8', text: 'გამოწერას გთხოვს' },
  follow_accept: { icon: 'check', color: 'var(--teal)', text: 'დაგიდასტურა გამოწერა' },
  tournament_start: { icon: 'trophy', color: '#c98a12', text: '' },
  tournament_end: { icon: 'trophy', color: '#c98a12', text: '' },
  listing_price: { icon: 'tag', color: '#0f9d8a', text: '' },
  achievement: { icon: 'medal', color: '#8a35e8', text: '' },
  level_up: { icon: 'arrowUp', color: '#df1f52', text: '' },
}

function RewardText({ n }) {
  const d = n.data || {}
  const coins = d.coins ? <> <span className="notif-coins">+{d.coins}<CoinIcon size={13} /></span></> : null
  if (n.type === 'level_up') return <>ახალ დონეზე გადახვედი: <b>დონე {d.level}</b>!{coins}</>
  return <>ახალი მიღწევა: <b>{badgeOf(d.badge)?.title || d.badge}</b>{coins}</>
}

function TournamentText({ n }) {
  const title = n.tournament?.title || n.data?.title || 'ტურნირი'
  if (n.type === 'tournament_start') return <><b>{title}</b> დაიწყო — შემოდი და ითამაშე</>
  const place = n.data?.place
  if (place === 1) return <>🏆 გაიმარჯვე ტურნირში <b>{title}</b>!</>
  return <><b>{title}</b> დასრულდა. შენი ადგილი: მე-{place}{n.data?.players ? ` (${n.data.players}-დან)` : ''}. გაიმარჯვა <b>{n.actor?.full_name || n.actor?.username}</b></>
}

function PriceDropText({ n }) {
  const d = n.data || {}
  return <>შენახულ განცხადებას <b>{d.title}</b> ფასი დაუკლეს: <b className="price-new">{priceText(d.price, d.currency)}</b> <s className="faint">{priceText(d.old_price, d.currency)}</s></>
}

const linkFor = (n) => {
  if (n.type === 'listing_price' && n.data?.listing_id) return `/market/${n.data.listing_id}`
  if (n.type === 'achievement' || n.type === 'level_up') return '/rewards'
  if (n.tournament_id) return `/t/${n.tournament_id}`
  if (n.type === 'follow_request') return '/requests'
  if (n.type === 'game_invite' && n.game_id) return `/g/${n.game_id}`
  if (n.type === 'match') return '/dating?tab=matches'
  if (n.type === 'group_request' && n.group) return `/groups/${n.group.slug}?tab=members`
  if (n.group) return `/groups/${n.group.slug}`
  if (n.event) return `/events/${n.event.id}`
  if (n.type === 'gift') return '/u/' + (n.actor?.username || '')
  if (n.post_id) return `/p/${n.post_id}`
  return `/u/${n.actor?.username}`
}

export default function Notifications() {
  const [list, setList] = useState(null)
  const unread = useUnread()
  useEffect(() => {
    api.notifications().then((l) => {
      setList(l)
      if (l.some((n) => !n.read)) api.markNotificationsRead().then(unread.refresh)
    }).catch(() => setList([]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <TopBar title="შეტყობინებები" backTo="/" />
      {list === null && <Loader />}
      {list?.length === 0 && <Empty icon="bell" title="ჯერ არაფერი" text="მოწონებები, პასუხები, საჩუქრები და მოწვევები აქ გამოჩნდება." />}
      {list?.map((n) => {
        const k = KIND[n.type] || KIND.like
        const thumb = n.type === 'listing_price' ? n.data?.photo : n.post?.media?.[0]?.type === 'image' ? n.post.media[0].thumb || n.post.media[0].url : null
        return (
          <Link key={n.id} to={linkFor(n)} className={`notif${n.read ? '' : ' unread'}`}>
            <span style={{ position: 'relative' }}>
              {n.actor ? <Avatar user={n.actor} size={44} />
                : n.type === 'achievement' ? <BadgeMedal k={n.data?.badge} size={44} />
                  : n.type === 'level_up' ? <span className="notif-level">{n.data?.level}</span>
                    : <span className="notif-swatch"><Swatch type={n.tournament?.type || n.data?.game || 'nardi'} /></span>}
              <span className="kind" style={{ background: k.color }}><Icon name={k.icon} size={12} fill={k.icon === 'heart' || k.icon === 'flame'} strokeWidth={2.4} /></span>
            </span>
            <div className="text">
              {n.type.startsWith('tournament') ? <TournamentText n={n} /> : n.type === 'listing_price' ? <PriceDropText n={n} /> : n.type === 'achievement' || n.type === 'level_up' ? <RewardText n={n} /> : <><b>{n.actor?.full_name || n.actor?.username}</b> {k.text}</>}
              {n.group && <> <b>{n.group.name}</b></>}
              {n.event && <> <b>{n.event.title}</b></>}
              {n.post?.body && n.type !== 'like' && <div className="faint ellipsis">{n.post.body}</div>}
              <div className="faint xs">{timeAgo(n.created_at)}</div>
            </div>
            {thumb ? <img className="thumb" src={thumb} alt="" /> : n.type === 'game_invite' ? <span className="btn btn-accent sm">თამაში</span> : n.type === 'follow_request' ? <span className="btn btn-accent sm">ნახვა</span> : <span />}
          </Link>
        )
      })}
    </>
  )
}
