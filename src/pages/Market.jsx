import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar, ConfirmSheet, Empty, Loader, Sheet, TopBar } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { ListingCard, ListingGrid, PriceTag, SaveHeart } from '../components/Listing.jsx'
import { ReportSheet } from '../components/Report.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { Link, navigate, back } from '../lib/router.jsx'
import { useToast } from '../components/Toast.jsx'
import { agoPhrase, plural, untilText } from '../lib/format.js'
import { compressImage } from '../lib/media.js'
import { CATEGORIES, CITIES, CONDITIONS, HAS_CONDITION, MAX_PHOTOS, QUICK_QUESTIONS, SORTS, STATUS, categoryOf, priceText } from '../lib/market.js'

const PAGE = 24
const NO_FILTERS = { city: null, min: null, max: null, currency: 'GEL', condition: null, sort: 'new' }
const filterCount = (f) => [f.city, f.min !== null || f.max !== null, f.condition, f.sort !== 'new'].filter(Boolean).length

// =====================================================================
//  ბაზარი: დათვალიერება, შენახული, ჩემი
// =====================================================================
export default function Market({ query }) {
  const qs = query?.toString() || ''
  const [tab, setTab] = useState(query?.get('tab') || 'browse')
  const [sellerName] = useState(query?.get('seller') || null)
  const [seller, setSeller] = useState(null)
  useEffect(() => { setTab(query?.get('tab') || 'browse') }, [qs]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (sellerName) api.profileByUsername(sellerName).then((p) => setSeller(p || false)).catch(() => setSeller(false))
  }, [sellerName])

  const pick = (t) => { setTab(t); navigate(t === 'browse' ? '/market' : `/market?tab=${t}`, { replace: true }) }

  if (sellerName) {
    return (
      <>
        <TopBar title={seller ? `${seller.full_name || seller.username} — ბაზარში` : 'ბაზარი'} backTo={seller ? `/u/${seller.username}` : '/market'} />
        {seller === null && <Loader />}
        {seller === false && <Empty icon="bag" title="მომხმარებელი ვერ მოიძებნა" />}
        {seller && <Browse key={seller.id} seller={seller} />}
      </>
    )
  }
  return (
    <>
      <TopBar title="ბაზარი" backTo="/explore">
        <Link to="/market/new" className="btn btn-accent sm market-new"><Icon name="plus" size={17} strokeWidth={2.4} />განცხადება</Link>
      </TopBar>
      <div className="seg" role="tablist">
        {[['browse', 'ყველა'], ['saved', 'შენახული'], ['mine', 'ჩემი']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>
        ))}
      </div>
      {tab === 'browse' && <Browse initialCat={query?.get('cat') || null} />}
      {tab === 'saved' && <SavedListings />}
      {tab === 'mine' && <MyListings />}
    </>
  )
}

function Browse({ seller = null, initialCat = null }) {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [cat, setCat] = useState(initialCat)
  const [f, setF] = useState(NO_FILTERS)
  const [items, setItems] = useState(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState(null) // 'filters' | 'city' | 'sort'
  const sentinel = useRef(null)
  const req = useRef(0)

  useEffect(() => { const t = setTimeout(() => setTerm(q), 320); return () => clearTimeout(t) }, [q])

  const params = useCallback((offset) => ({ q: term, category: cat, ...f, seller: seller?.id || null, offset, limit: PAGE }), [term, cat, f, seller])
  useEffect(() => {
    const my = ++req.current
    setItems(null)
    api.listings(params(0)).then((rows) => { if (my === req.current) { setItems(rows); setMore(rows.length === PAGE) } }).catch(() => setItems([]))
  }, [params])

  const loadMore = useCallback(async () => {
    if (busy || !more || !items) return
    setBusy(true)
    const my = req.current
    try {
      const rows = await api.listings(params(items.length))
      if (my === req.current) { setItems((cur) => [...cur, ...rows]); setMore(rows.length === PAGE) }
    } finally { setBusy(false) }
  }, [busy, more, items, params])

  useEffect(() => {
    const el = sentinel.current
    if (!el || !more) return undefined
    const io = new IntersectionObserver((e) => e[0].isIntersecting && loadMore(), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more, loadMore])

  const active = filterCount(f)
  const sortLabel = SORTS.find(([k]) => k === f.sort)?.[1]
  const priceLabel = f.min !== null || f.max !== null
    ? `${f.min ?? 0}–${f.max ?? '∞'} ${f.currency === 'USD' ? '$' : '₾'}` : null
  return (
    <>
      <div className="market-search">
        <div className="searchbox">
          <Icon name="search" size={19} />
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={seller ? 'ძებნა ამ გამყიდველთან' : 'რას ეძებ? მაგ. ველოსიპედი'} aria-label="ძებნა ბაზარში" />
        </div>
      </div>
      {!seller && (
        <div className="cat-row" role="listbox" aria-label="კატეგორიები">
          {CATEGORIES.map((c) => (
            <button key={c.key} role="option" aria-selected={cat === c.key} className={`cat${cat === c.key ? ' on' : ''}`} style={{ '--hue': c.hue }}
              onClick={() => setCat(cat === c.key ? null : c.key)}>
              <span className="ic"><Icon name={c.icon} size={24} /></span>{c.label}
            </button>
          ))}
        </div>
      )}
      <div className="chips filter-chips">
        <button className={`chip${active ? ' on' : ''}`} onClick={() => setSheet('filters')}><Icon name="sliders" size={16} />ფილტრი{active > 0 && <b className="fcount">{active}</b>}</button>
        <button className={`chip${f.city ? ' on' : ''}`} onClick={() => setSheet('city')}><Icon name="pin" size={15} />{f.city || 'მთელი საქართველო'}</button>
        <button className={`chip${f.sort !== 'new' ? ' on' : ''}`} onClick={() => setSheet('sort')}><Icon name="refresh" size={15} />{sortLabel}</button>
        {priceLabel && <button className="chip on" onClick={() => setF({ ...f, min: null, max: null })}>{priceLabel}<Icon name="close" size={14} /></button>}
        {f.condition && <button className="chip on" onClick={() => setF({ ...f, condition: null })}>{CONDITIONS[f.condition]}<Icon name="close" size={14} /></button>}
      </div>
      {items === null && <GridSkeleton />}
      {items?.length === 0 && (
        term || cat || active
          ? <Empty icon="search" title="ვერაფერი ვიპოვე" text="სცადე სხვა სიტყვა ან მოხსენი ფილტრები." action={<button className="btn btn-soft" onClick={() => { setQ(''); setCat(null); setF(NO_FILTERS) }}>ფილტრების მოხსნა</button>} />
          : <Empty icon="bag" title={seller ? 'აქტიური განცხადება არ აქვს' : 'ბაზარი ჯერ ცარიელია'} text={seller ? undefined : 'გაყიდე რაც აღარ გჭირდება — პირველი განცხადება შენი იყოს.'}
              action={seller ? undefined : <Link to="/market/new" className="btn btn-accent">განცხადების დამატება</Link>} />
      )}
      {items?.length > 0 && <ListingGrid items={items} />}
      {more && <div ref={sentinel} className="page-loader" style={{ minHeight: 80 }}>{busy && <div className="spinner" />}</div>}

      {sheet === 'filters' && <FilterSheet value={f} onApply={(v) => { setF(v); setSheet(null) }} onClose={() => setSheet(null)} />}
      {sheet === 'city' && (
        <Sheet title="ქალაქი" onClose={() => setSheet(null)}>
          <div className="menu city-menu">
            <button className={!f.city ? 'on' : ''} onClick={() => { setF({ ...f, city: null }); setSheet(null) }}><Icon name="globe" />მთელი საქართველო</button>
            {CITIES.map((c) => <button key={c} className={f.city === c ? 'on' : ''} onClick={() => { setF({ ...f, city: c }); setSheet(null) }}><Icon name="pin" />{c}{f.city === c && <Icon name="check" size={18} />}</button>)}
          </div>
        </Sheet>
      )}
      {sheet === 'sort' && (
        <Sheet title="დალაგება" onClose={() => setSheet(null)}>
          <div className="menu">
            {SORTS.map(([k, l]) => <button key={k} className={f.sort === k ? 'on' : ''} onClick={() => { setF({ ...f, sort: k }); setSheet(null) }}>{l}{f.sort === k && <Icon name="check" size={18} />}</button>)}
          </div>
        </Sheet>
      )}
    </>
  )
}

function GridSkeleton() {
  return (
    <div className="market-grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="lcard"><span className="ph skel" /><span className="skel" style={{ height: 12, width: '80%' }} /><span className="skel" style={{ height: 10, width: '50%' }} /></div>
      ))}
    </div>
  )
}

function FilterSheet({ value, onApply, onClose }) {
  const [v, setV] = useState(value)
  const num = (s) => (s === '' ? null : Math.max(0, Number(s)))
  return (
    <Sheet title="ფილტრი" onClose={onClose} actions={<button className="btn btn-ghost sm" onClick={() => setV(NO_FILTERS)}>გასუფთავება</button>}>
      <div className="sheet-body vstack" style={{ gap: 18 }}>
        <div className="field"><span>ფასი</span>
          <div className="price-range">
            <input className="input" inputMode="numeric" type="number" min="0" placeholder="დან" value={v.min ?? ''} onChange={(e) => setV({ ...v, min: num(e.target.value) })} aria-label="მინიმალური ფასი" />
            <span className="faint">—</span>
            <input className="input" inputMode="numeric" type="number" min="0" placeholder="მდე" value={v.max ?? ''} onChange={(e) => setV({ ...v, max: num(e.target.value) })} aria-label="მაქსიმალური ფასი" />
            <div className="cur-seg" role="radiogroup" aria-label="ვალუტა">
              {[['GEL', '₾'], ['USD', '$']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={v.currency === k} className={v.currency === k ? 'on' : ''} onClick={() => setV({ ...v, currency: k })}>{l}</button>)}
            </div>
          </div>
        </div>
        <div className="field"><span>მდგომარეობა</span>
          <div className="chips inline">
            {[[null, 'ნებისმიერი'], ['new', 'ახალი'], ['used', 'მეორადი']].map(([k, l]) => (
              <button key={l} type="button" className={`chip${v.condition === k ? ' on' : ''}`} onClick={() => setV({ ...v, condition: k })}>{l}</button>
            ))}
          </div>
        </div>
        <div className="field"><span>ქალაქი</span>
          <select className="select" value={v.city || ''} onChange={(e) => setV({ ...v, city: e.target.value || null })}>
            <option value="">მთელი საქართველო</option>
            {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field"><span>დალაგება</span>
          <div className="chips inline">
            {SORTS.map(([k, l]) => <button key={k} type="button" className={`chip${v.sort === k ? ' on' : ''}`} onClick={() => setV({ ...v, sort: k })}>{l}</button>)}
          </div>
        </div>
        <button className="btn btn-accent lg block" onClick={() => onApply(v)}>ჩვენება</button>
      </div>
    </Sheet>
  )
}

function SavedListings() {
  const [items, setItems] = useState(null)
  useEffect(() => { api.savedListings().then(setItems).catch(() => setItems([])) }, [])
  if (items === null) return <GridSkeleton />
  if (!items.length) return <Empty icon="heart" title="შენახული განცხადებები არ გაქვს" text="დააჭირე გულს ფოტოზე — ფასის კლებისას შეგატყობინებ." />
  return (
    <div className="market-grid">
      {items.map((l, i) => <ListingCard key={l.id} l={l} i={i} onSaved={(on) => !on && setItems((cur) => cur.filter((x) => x.id !== l.id))} />)}
    </div>
  )
}

function MyListings() {
  const [items, setItems] = useState(null)
  useEffect(() => { api.myListings().then(setItems).catch(() => setItems([])) }, [])
  if (items === null) return <GridSkeleton />
  if (!items.length) {
    return <Empty icon="tag" title="ჯერ არაფერს ყიდი" text="ფოტო, ფასი, ქალაქი — და განცხადება მზადაა. მყიდველები პირდაპირ მოგწერენ." action={<Link to="/market/new" className="btn btn-accent">განცხადების დამატება</Link>} />
  }
  const live = items.filter((l) => l.status !== 'sold')
  const views = items.reduce((n, l) => n + l.views_count, 0)
  return (
    <>
      <div className="my-stats">
        <div><b>{live.length}</b><span>აქტიური</span></div>
        <div><b>{items.length - live.length}</b><span>გაყიდული</span></div>
        <div><b>{views}</b><span>ნახვა</span></div>
      </div>
      <div className="market-grid">
        {items.map((l, i) => <ListingCard key={l.id} l={l} i={i} />)}
      </div>
    </>
  )
}

// =====================================================================
//  ერთი განცხადება
// =====================================================================
export function ListingPage({ id }) {
  const { me } = useAuth()
  const toast = useToast()
  const [l, setL] = useState(undefined)
  const [similar, setSimilar] = useState([])
  const [sheet, setSheet] = useState(null) // 'menu' | 'report' | 'delete' | 'owner'
  const [lightbox, setLightbox] = useState(null)

  useEffect(() => {
    api.listing(id).then((x) => {
      setL(x)
      if (!x) return
      if (x.seller_id !== me.id) api.viewListing(id).catch(() => {})
      api.listings({ category: x.category, limit: 9 }).then((r) => setSimilar(r.filter((s) => s.id !== id).slice(0, 6))).catch(() => {})
    }).catch(() => setL(null))
  }, [id, me.id])

  if (l === undefined) return <><TopBar title="" backTo="/market" /><Loader /></>
  if (l === null) return <><TopBar title="განცხადება" backTo="/market" /><Empty icon="bag" title="განცხადება ვერ მოიძებნა" text="შეიძლება წაიშალა ან გამყიდველმა დამალა." action={<Link to="/market" className="btn btn-soft">ბაზარში დაბრუნება</Link>} /></>

  const own = l.seller_id === me.id
  const c = categoryOf(l.category)
  const share = async () => {
    const url = `${location.origin}/market/${l.id}`
    try { if (navigator.share) await navigator.share({ url, title: `${l.title} — ${priceText(l.price, l.currency)}` }); else { await navigator.clipboard.writeText(url); toast('ბმული დაკოპირდა') } } catch { /* */ }
  }
  const patch = async (p, msg) => {
    const prev = l
    setL((x) => ({ ...x, ...p }))
    try { const n = await api.updateListing(l.id, p); setL((x) => ({ ...x, ...n })); if (msg) toast(msg) } catch (e) { setL(prev); toast(e.message, 'error') }
  }

  return (
    <>
      <TopBar title="" backTo="/market" lined={false}>
        <span className="hstack" style={{ gap: 4 }}>
          <button className="icon-btn" onClick={share} aria-label="გაზიარება"><Icon name="share" /></button>
          <button className="icon-btn" onClick={() => setSheet('menu')} aria-label="მეტი"><Icon name="more" /></button>
        </span>
      </TopBar>
      <Gallery photos={l.photos} sold={l.status === 'sold'} cat={c} onOpen={setLightbox} />

      <section className="listing-head">
        <div className="hstack" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <PriceTag price={l.price} currency={l.currency} lg />
          <SaveHeart listing={l} className="lsave-lg" onChange={(on) => setL((x) => ({ ...x, saved: on, saves_count: x.saves_count + (on ? 1 : -1) }))} />
        </div>
        <h1 className="listing-title">{l.title}</h1>
        <div className="listing-chips">
          {l.status !== 'active' && <span className={`lchip st-${l.status}`}>{STATUS[l.status]}</span>}
          <Link to={`/market?cat=${l.category}`} className="lchip" style={{ '--hue': c.hue }}><Icon name={c.icon} size={15} />{c.label}</Link>
          {l.condition && <span className="lchip">{CONDITIONS[l.condition]}</span>}
        </div>
        <div className="listing-facts">
          <span><Icon name="pin" size={15} />{l.city || 'საქართველო'}</span>
          <span><Icon name="clock" size={15} />{agoPhrase(l.created_at)}</span>
          <span><Icon name="eye" size={15} />{plural(l.views_count, 'ნახვა')}</span>
          {l.saves_count > 0 && <span><Icon name="heart" size={15} />{l.saves_count} შენახვა</span>}
        </div>
      </section>

      {own ? <OwnerPanel l={l} onPatch={patch} onEdit={() => navigate(`/market/${l.id}/edit`)} onDelete={() => setSheet('delete')} onBumped={(t) => setL((x) => ({ ...x, bumped_at: t }))} />
        : l.status === 'sold'
          ? <div className="sold-banner"><Icon name="check" size={20} strokeWidth={2.4} /><div><b>ეს ნივთი უკვე გაიყიდა</b><small>ქვემოთ ნახე მსგავსი განცხადებები</small></div></div>
          : <ContactCard l={l} />}

      {l.description && (
        <section className="listing-desc">
          <h2>აღწერა</h2>
          <p className="pre">{l.description}</p>
        </section>
      )}

      <SellerCard l={l} own={own} />
      {!own && (
        <p className="safety"><Icon name="shield" size={20} /><span>წინასწარ ფულს ნუ გადარიცხავ უცნობ ადამიანზე. შეხვდით ხალხმრავალ ადგილას და ნივთი გადახდამდე ნახე.</span></p>
      )}

      {similar.length > 0 && (
        <section>
          <div className="section-title"><h2>მსგავსი განცხადებები</h2><Link to={`/market?cat=${l.category}`}>ყველა</Link></div>
          <ListingGrid items={similar} />
        </section>
      )}

      {lightbox !== null && <Lightbox photos={l.photos} start={lightbox} onClose={() => setLightbox(null)} />}
      {sheet === 'menu' && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="menu">
            <button onClick={() => { setSheet(null); share() }}><Icon name="share" />გაზიარება</button>
            {own && <button onClick={() => navigate(`/market/${l.id}/edit`)}><Icon name="edit" />რედაქტირება</button>}
            {own && <button className="danger" onClick={() => setSheet('delete')}><Icon name="trash" />წაშლა</button>}
            {!own && <button onClick={() => setSheet('report')}><Icon name="flag" />დარეპორტება</button>}
          </div>
        </Sheet>
      )}
      {sheet === 'report' && <ReportSheet listing={l.id} user={l.seller_id} onClose={() => setSheet(null)} />}
      {sheet === 'delete' && (
        <ConfirmSheet title="განცხადების წაშლა" text="განცხადება და მისი სტატისტიკა სამუდამოდ წაიშლება. თუ ნივთი გაყიდე, ჯობია „გაიყიდა“ მონიშნო." onClose={() => setSheet(null)}
          onConfirm={async () => { await api.deleteListing(l.id); toast('განცხადება წაიშალა'); navigate('/market?tab=mine', { replace: true }) }} />
      )}
    </>
  )
}

function Gallery({ photos, sold, cat, onOpen }) {
  const [i, setI] = useState(0)
  const track = useRef(null)
  const onScroll = () => {
    const el = track.current
    if (el) setI(Math.round(el.scrollLeft / el.clientWidth))
  }
  const go = (d) => track.current?.scrollBy({ left: d * track.current.clientWidth, behavior: 'smooth' })
  if (!photos?.length) return <div className="gallery empty" style={{ '--hue': cat.hue }}><Icon name={cat.icon} size={64} /></div>
  return (
    <div className={`gallery${sold ? ' sold' : ''}`}>
      <div className="track" ref={track} onScroll={onScroll}>
        {photos.map((p, k) => (
          <button key={k} className="slide" onClick={() => onOpen(k)} aria-label={`ფოტო ${k + 1} — გადიდება`}>
            <img src={p} alt="" loading={k ? 'lazy' : 'eager'} decoding="async" />
          </button>
        ))}
      </div>
      {photos.length > 1 && (
        <>
          <span className="count">{i + 1}/{photos.length}</span>
          <div className="dots" aria-hidden="true">{photos.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
          {i > 0 && <button className="nav prev" onClick={() => go(-1)} aria-label="წინა ფოტო"><Icon name="back" size={20} /></button>}
          {i < photos.length - 1 && <button className="nav next" onClick={() => go(1)} aria-label="შემდეგი ფოტო"><Icon name="back" size={20} className="flip-x" /></button>}
        </>
      )}
      {sold && <span className="sold-stamp">გაიყიდა</span>}
    </div>
  )
}

function Lightbox({ photos, start, onClose }) {
  const track = useRef(null)
  useEffect(() => {
    const el = track.current
    if (el) el.scrollLeft = start * el.clientWidth
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') el?.scrollBy({ left: el.clientWidth, behavior: 'smooth' })
      if (e.key === 'ArrowLeft') el?.scrollBy({ left: -el.clientWidth, behavior: 'smooth' })
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [start, onClose])
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="ფოტოები">
      <div className="track" ref={track}>{photos.map((p, k) => <div key={k} className="slide"><img src={p} alt="" /></div>)}</div>
      <button className="icon-btn close" onClick={onClose} aria-label="დახურვა"><Icon name="close" /></button>
    </div>
  )
}

function ContactCard({ l }) {
  const toast = useToast()
  const [text, setText] = useState(`გამარჯობა! ${QUICK_QUESTIONS[0]}`)
  const [busy, setBusy] = useState(false)
  const send = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    try {
      const conv = await api.contactSeller(l, text.trim())
      navigate(`/chat/${conv}`)
    } catch (er) { toast(er.message, 'error'); setBusy(false) }
  }
  const first = (l.seller?.full_name || l.seller?.username || '').split(' ')[0]
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) send(e) }
  return (
    <form className="contact-card" onSubmit={send}>
      <h3><Icon name="chat" size={20} />მიწერე {first}ს</h3>
      <div className="chips inline quick-qs">
        {QUICK_QUESTIONS.map((qq) => <button key={qq} type="button" className={`chip${text.endsWith(qq) ? ' on' : ''}`} onClick={() => setText(`გამარჯობა! ${qq}`)}>{qq}</button>)}
      </div>
      <textarea className="textarea" rows={2} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} aria-label="მესიჯი გამყიდველს" />
      <button className="btn btn-accent lg block" disabled={busy || !text.trim()}>{busy ? <span className="spinner sm" /> : <Icon name="send" size={19} />}მომწერე</button>
    </form>
  )
}

function OwnerPanel({ l, onPatch, onEdit, onDelete, onBumped }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const nextBump = Date.parse(l.bumped_at) + 864e5 - Date.now()
  const bump = async () => {
    setBusy(true)
    try { const t = await api.bumpListing(l.id); onBumped(t || new Date().toISOString()); toast('განცხადება სიის თავში აიწია') } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <section className="owner-panel">
      <div className="status-seg" role="radiogroup" aria-label="სტატუსი">
        {Object.entries(STATUS).map(([k, label]) => (
          <button key={k} role="radio" aria-checked={l.status === k} className={`st-${k}${l.status === k ? ' on' : ''}`}
            onClick={() => l.status !== k && onPatch({ status: k }, k === 'sold' ? 'მოგილოცავ გაყიდვას! 🎉' : k === 'reserved' ? 'მონიშნულია დაჯავშნილად' : 'განცხადება ისევ აქტიურია')}>{label}</button>
        ))}
      </div>
      <div className="owner-actions">
        <button className="btn btn-soft" onClick={onEdit}><Icon name="edit" size={17} />შეცვლა</button>
        <button className="btn btn-soft" disabled={busy || l.status !== 'active' || nextBump > 0} onClick={bump}><Icon name="rocket" size={17} />აწევა</button>
        <button className="btn btn-danger square" onClick={onDelete} aria-label="წაშლა"><Icon name="trash" size={18} /></button>
      </div>
      <p className="owner-hint">
        {l.status !== 'active' ? 'აწევა მხოლოდ აქტიურ განცხადებას შეუძლია.'
          : nextBump > 0 ? `სიის თავში ხელახლა აწევა შეგიძლია ${untilText(nextBump)}-ში.` : 'აწევა განცხადებას სიის თავში დააბრუნებს. დღეში ერთხელ.'}
      </p>
      {l.hidden && <p className="small" style={{ color: 'var(--accent)' }}>მოდერატორმა განცხადება დამალა — სხვები ვეღარ ხედავენ.</p>}
    </section>
  )
}

function SellerCard({ l, own }) {
  const s = l.seller
  const st = l.seller_stats || {}
  if (!s) return null
  const year = st.since ? new Date(st.since).getFullYear() : null
  return (
    <Link to={`/u/${s.username}`} className="seller-card">
      <Avatar user={s} size={52} online />
      <div className="grow">
        <small>{own ? 'შენი განცხადება' : 'გამყიდველი'}</small>
        <b>{s.full_name || s.username}</b>
        <span className="seller-stats">
          {year && <span><Icon name="clock" size={13} />ეზოზე {year} წლიდან</span>}
          <span><Icon name="tag" size={13} />{st.active ?? 0} აქტიური</span>
          {st.sold > 0 && <span><Icon name="check" size={13} />{st.sold} გაყიდული</span>}
        </span>
      </div>
      <Icon name="back" size={18} className="flip-x" />
    </Link>
  )
}

// =====================================================================
//  ახალი განცხადება / რედაქტირება
// =====================================================================
export function ListingForm({ id = null }) {
  const { me } = useAuth()
  const toast = useToast()
  const fileRef = useRef(null)
  const [ready, setReady] = useState(!id)
  const [f, setF] = useState({ title: '', category: null, condition: 'used', priceMode: 'price', price: '', currency: 'GEL', description: '', city: me.city || '' })
  const [photos, setPhotos] = useState([]) // { key, url, uploading }
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)

  useEffect(() => {
    if (!id) return
    api.listing(id).then((l) => {
      if (!l || l.seller_id !== me.id) { toast('განცხადება ვერ მოიძებნა', 'error'); navigate('/market', { replace: true }); return }
      setF({ title: l.title, category: l.category, condition: l.condition || 'used', priceMode: l.price === null ? 'deal' : Number(l.price) === 0 ? 'free' : 'price',
        price: l.price && Number(l.price) > 0 ? String(Number(l.price)) : '', currency: l.currency, description: l.description || '', city: l.city || '' })
      setPhotos(l.photos.map((url, k) => ({ key: `p${k}`, url, thumb: k === 0 ? l.thumb : null })))
      setReady(true)
    })
  }, [id, me.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = async (e) => {
    const files = [...(e.target.files || [])].filter((x) => x.type.startsWith('image/')).slice(0, MAX_PHOTOS - photos.length)
    e.target.value = ''
    for (const file of files) {
      const key = `${Date.now()}-${Math.random()}`
      const preview = URL.createObjectURL(file)
      setPhotos((p) => [...p, { key, url: preview, uploading: true }])
      try {
        const [url, thumb] = await Promise.all([
          api.upload(await compressImage(file, 1600), 'market'),
          api.upload(await compressImage(file, 480, 0.74), 'thumbs').catch(() => null),
        ])
        setPhotos((p) => p.map((x) => (x.key === key ? { key, url, thumb } : x)))
      } catch (er) {
        setPhotos((p) => p.filter((x) => x.key !== key))
        toast(er.message || 'ფოტო ვერ აიტვირთა', 'error')
      } finally { URL.revokeObjectURL(preview) }
    }
  }
  const makeCover = (k) => setPhotos((p) => [p[k], ...p.filter((_, j) => j !== k)])
  const removePhoto = (k) => setPhotos((p) => p.filter((_, j) => j !== k))

  const priceNum = f.priceMode === 'price' ? Number(f.price) : null
  const errors = {
    title: f.title.trim().length < 3 ? 'მინიმუმ 3 ასო' : null,
    category: !f.category ? 'აირჩიე კატეგორია' : null,
    price: f.priceMode === 'price' && (!f.price || !(priceNum > 0)) ? 'მიუთითე ფასი ან აირჩიე „შეთანხმებით“' : null,
    photos: !photos.length ? 'დაამატე ერთი ფოტო მაინც' : null,
    city: !f.city.trim() ? 'მიუთითე ქალაქი' : null,
  }
  const invalid = Object.values(errors).some(Boolean)
  const uploading = photos.some((p) => p.uploading)

  const submit = async (e) => {
    e.preventDefault()
    setTried(true)
    if (invalid || uploading) return
    setBusy(true)
    const data = {
      title: f.title.trim(), category: f.category, description: f.description.trim(), city: f.city.trim(),
      condition: HAS_CONDITION.has(f.category) ? f.condition : null,
      price: f.priceMode === 'deal' ? null : f.priceMode === 'free' ? 0 : Math.round(priceNum * 100) / 100,
      currency: f.currency, photos: photos.map((p) => p.url), thumb: photos[0]?.thumb || null,
    }
    try {
      if (id) { await api.updateListing(id, data); toast('ცვლილებები შენახულია'); back(`/market/${id}`) }
      else { const l = await api.createListing(data); toast('განცხადება გამოქვეყნდა'); navigate(`/market/${l.id}`, { replace: true }) }
    } catch (er) { toast(er.message, 'error'); setBusy(false) }
  }
  const err = (k) => tried && errors[k] && <span className="hint err">{errors[k]}</span>

  if (!ready) return <><TopBar title="რედაქტირება" backTo="/market" /><Loader /></>
  return (
    <>
      <TopBar title={id ? 'რედაქტირება' : 'ახალი განცხადება'} backTo={id ? `/market/${id}` : '/market'} />
      <form className="lform" onSubmit={submit} noValidate>
        <div className="field">
          <span>ფოტოები <span className="faint">{photos.length}/{MAX_PHOTOS}</span></span>
          <div className="photo-row">
            {photos.map((p, k) => (
              <div key={p.key} className={`pthumb${k === 0 ? ' cover' : ''}`}>
                <img src={p.url} alt="" />
                {p.uploading && <span className="up"><span className="spinner sm" /></span>}
                {k === 0 ? <span className="cover-label">მთავარი</span> : <button type="button" className="mk-cover" onClick={() => makeCover(k)}>მთავარად</button>}
                <button type="button" className="x" onClick={() => removePhoto(k)} aria-label="ფოტოს წაშლა"><Icon name="close" size={14} strokeWidth={2.6} /></button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button type="button" className="padd" onClick={() => fileRef.current?.click()}>
                <Icon name="camera" size={26} /><span>{photos.length ? 'დამატება' : 'ფოტოს დამატება'}</span>
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={addFiles} />
          {err('photos') || <span className="hint">პირველი ფოტო სიაში ჩანს. კარგი შუქი და სუფთა ფონი ყიდის.</span>}
        </div>

        <label className="field"><span>სათაური</span>
          <input className="input" maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="მაგ. ველოსიპედი Trek, M ზომა" />
          {err('title')}
        </label>

        <div className="field"><span>კატეგორია</span>
          <div className="cat-pick">
            {CATEGORIES.map((c) => (
              <button key={c.key} type="button" className={f.category === c.key ? 'on' : ''} style={{ '--hue': c.hue }} aria-pressed={f.category === c.key}
                onClick={() => setF({ ...f, category: c.key })}>
                <span className="ic"><Icon name={c.icon} size={17} /></span>{c.label}
              </button>
            ))}
          </div>
          {err('category')}
        </div>

        {f.category && HAS_CONDITION.has(f.category) && (
          <div className="field"><span>მდგომარეობა</span>
            <div className="chips inline">
              {Object.entries(CONDITIONS).map(([k, l]) => <button key={k} type="button" className={`chip${f.condition === k ? ' on' : ''}`} onClick={() => setF({ ...f, condition: k })}>{l}</button>)}
            </div>
          </div>
        )}

        <div className="field"><span>ფასი</span>
          <div className="chips inline">
            {[['price', 'ფასით'], ['deal', 'შეთანხმებით'], ['free', 'უფასოდ']].map(([k, l]) => (
              <button key={k} type="button" className={`chip${f.priceMode === k ? ' on' : ''}`} onClick={() => setF({ ...f, priceMode: k })}>{l}</button>
            ))}
          </div>
          {f.priceMode === 'price' && (
            <div className="price-input">
              <input className="input" type="number" inputMode="decimal" min="0" step="any" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="0" aria-label="ფასი" />
              <div className="cur-seg" role="radiogroup" aria-label="ვალუტა">
                {[['GEL', '₾'], ['USD', '$']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={f.currency === k} className={f.currency === k ? 'on' : ''} onClick={() => setF({ ...f, currency: k })}>{l}</button>)}
              </div>
            </div>
          )}
          {f.priceMode === 'free' && <span className="hint">ნივთს აჩუქებ — „უფასოდ“ ცალკე იარლიყით გამოჩნდება.</span>}
          {err('price')}
        </div>

        <label className="field"><span>აღწერა <span className="faint">(არასავალდებულო)</span></span>
          <textarea className="textarea" maxLength={3000} rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })}
            placeholder="მდგომარეობა, ზომა, რა მოყვება, როგორ შეიძლება ნახვა" />
        </label>

        <label className="field"><span>ქალაქი</span>
          <input className="input" list="market-cities" maxLength={40} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="თბილისი" />
          <datalist id="market-cities">{CITIES.map((c) => <option key={c} value={c} />)}</datalist>
          {err('city')}
        </label>

        <button className="btn btn-accent lg block" disabled={busy || uploading}>
          {uploading ? 'ფოტოები იტვირთება…' : id ? 'შენახვა' : 'გამოქვეყნება'}
        </button>
        {!id && <p className="xs faint" style={{ textAlign: 'center' }}>აკრძალულია იარაღის, წამლების, ცოცხალი ველური ცხოველების და ყალბი ნივთების გაყიდვა.</p>}
      </form>
    </>
  )
}
