import { useEffect, useState } from 'react'
import { Icon } from './Icon.jsx'
import { Link } from '../lib/router.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useToast } from './Toast.jsx'
import { agoPhrase } from '../lib/format.js'
import { categoryOf, priceText, STATUS } from '../lib/market.js'

// ფასის „ბარათი“ — ბროწეულისფერი იარლიყი ნახვრეტით
export function PriceTag({ price, currency, lg = false }) {
  const kind = price === null || price === undefined ? ' deal' : Number(price) === 0 ? ' free' : ''
  return <span className={`ptag${kind}${lg ? ' lg' : ''}`}>{priceText(price, currency, { short: !lg })}</span>
}

export function CategoryIcon({ cat, size = 22 }) {
  const c = categoryOf(cat)
  return <span className="cat-ic" style={{ '--hue': c.hue }}><Icon name={c.icon} size={size} /></span>
}

export function SaveHeart({ listing, onChange, className = 'lsave' }) {
  const { me } = useAuth()
  const toast = useToast()
  const [on, setOn] = useState(listing.saved)
  useEffect(() => setOn(listing.saved), [listing.saved])
  if (listing.seller_id === me?.id) return null
  const toggle = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    const next = !on
    setOn(next)
    try {
      await api.saveListing(listing.id, next)
      onChange?.(next)
      if (next) toast('შენახულია — ფასის კლებისას შეგატყობინებ')
    } catch (er) { setOn(!next); toast(er.message, 'error') }
  }
  return (
    <button className={`${className}${on ? ' on' : ''}`} onClick={toggle} aria-pressed={on} aria-label={on ? 'შენახულიდან ამოღება' : 'შენახვა'}>
      <Icon name="heart" size={className === 'lsave' ? 18 : 22} fill={on} strokeWidth={2.2} />
    </button>
  )
}

export function ListingCard({ l, i = 0, onSaved, showStatus = true }) {
  const photo = l.thumb || l.photos?.[0]
  const c = categoryOf(l.category)
  return (
    <Link to={`/market/${l.id}`} className={`lcard${l.status === 'sold' ? ' sold' : ''}`} style={{ '--i': Math.min(i, 12) }}>
      <span className="ph">
        {photo ? <img src={photo} alt="" loading="lazy" decoding="async" /> : <span className="ph-empty" style={{ '--hue': c.hue }}><Icon name={c.icon} size={40} /></span>}
        {showStatus && l.status !== 'active' && <span className={`lstatus ${l.status}`}>{STATUS[l.status]}</span>}
        {l.hidden && <span className="lstatus hidden"><Icon name="eye" size={13} />დამალულია</span>}
        <SaveHeart listing={l} onChange={onSaved} />
        <PriceTag price={l.price} currency={l.currency} />
      </span>
      <span className="t">{l.title}</span>
      <span className="m"><span className="city"><Icon name="pin" size={13} />{l.city || 'საქართველო'}</span><span>{agoPhrase(l.bumped_at || l.created_at)}</span></span>
    </Link>
  )
}

export function ListingGrid({ items, onSaved }) {
  return (
    <div className="market-grid">
      {items.map((l, i) => <ListingCard key={l.id} l={l} i={i} onSaved={(on) => onSaved?.(l, on)} />)}
    </div>
  )
}

// ბარათი ჩატის მესიჯში („მომწერე“-დან)
export function ListingChatCard({ l, mine }) {
  return (
    <Link to={`/market/${l.id}`} className={`lchat${mine ? ' me' : ''}`} onClick={(e) => e.stopPropagation()}>
      {l.photo ? <img src={l.photo} alt="" /> : <span className="noimg"><Icon name="tag" size={20} /></span>}
      <span className="grow">
        <small>განცხადება</small>
        <b>{l.title}</b>
        <span className="pr">{priceText(l.price, l.currency)}</span>
      </span>
    </Link>
  )
}

// პროფილზე: „ბაზარში“ — ადამიანის აქტიური განცხადებები
export function ShopStrip({ user, isMe }) {
  const [items, setItems] = useState(null)
  useEffect(() => {
    api.listings({ seller: user.id, limit: 12 }).then((r) => setItems(r.filter((l) => l.status !== 'sold'))).catch(() => setItems([]))
  }, [user.id])
  if (!items?.length) return null
  return (
    <section className="shop-strip" aria-label="განცხადებები ბაზარში">
      <div className="section-title">
        <h2><Icon name="bag" size={19} />ბაზარში</h2>
        <Link to={isMe ? '/market?tab=mine' : `/market?seller=${encodeURIComponent(user.username)}`}>ყველა ({items.length})</Link>
      </div>
      <div className="shop-row">
        {items.slice(0, 8).map((l, i) => <ListingCard key={l.id} l={l} i={i} />)}
      </div>
    </section>
  )
}
