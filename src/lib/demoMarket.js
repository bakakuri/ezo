// დემო ბაზარი — იგივე ინტერფეისი, რაც api.supabase.js-ის „ბაზრის“ ნაწილს აქვს
import { product } from './demoArt.js'

export function demoMarket({ ME, person, profiles, nid, ago, wait, notifications, emit, onSale = () => {} }) {
  const ph = (seed, kind) => product(seed, kind)
  const listings = [
    { id: 'l1', seller_id: 'u2', title: 'iPhone 13, 128GB, ლურჯი', description: 'ბატარეა 88%. ეკრანზე ერთი პატარა ნაკაწრია, ფოტოზე ჩანს. მოყვება ყუთი და ქეისი.\nტელეფონი მხოლოდ ჩემი ნახმარია.', price: 1250, currency: 'GEL', category: 'electronics', condition: 'used', city: 'თბილისი', photos: [ph(3, 'phone'), ph(0, 'phone')], created: 50, views: 84, saves: 6 },
    { id: 'l2', seller_id: 'u4', title: 'ველოსიპედი Trek Marlin 5, M ზომა', description: 'ორი სეზონი ვატარე, ახალი საბურავები და ჯაჭვი. სვანეთის გზებიც გაიარა 🙂', price: 900, currency: 'GEL', category: 'hobby', condition: 'used', city: 'ბათუმი', photos: [ph(1, 'bike'), ph(4, 'bike')], created: 300, views: 132, saves: 11 },
    { id: 'l3', seller_id: 'u5', title: 'დივანი, გასაშლელი, ვარდისფერი ხავერდი', description: 'სამადგილიანი, იშლება ორადგილიან საწოლად. ვაკეში, მე-3 სართული, ლიფტით. წაღება თქვენზეა.', price: 450, currency: 'GEL', category: 'home', condition: 'used', city: 'თბილისი', photos: [ph(0, 'sofa')], created: 160, views: 57, saves: 4 },
    { id: 'l4', seller_id: 'u1', title: 'აკუსტიკური გიტარა Yamaha F310', description: 'ბავშვმა ერთი წელი ისწავლა და მიატოვა. მოყვება ჩანთა და კაპო.', price: 380, currency: 'GEL', category: 'hobby', condition: 'used', city: 'ქუთაისი', photos: [ph(2, 'guitar')], created: 900, views: 41, saves: 2 },
    { id: 'l5', seller_id: 'u1', title: 'Canon EOS 250D + 18–55 ობიექტივი', description: '12 ათასი ჩამრთველი. ორი ბატარეა, 64GB ბარათი. ახალ კამერაზე გადავედი.', price: 1500, currency: 'GEL', category: 'electronics', condition: 'used', city: 'თბილისი', photos: [ph(3, 'camera'), ph(1, 'camera')], created: 1500, views: 210, saves: 17 },
    { id: 'l6', seller_id: 'u7', title: 'Toyota Prius 2012, 1.8 ჰიბრიდი', description: 'გარბენი 186 000 კმ. განბაჟებული, ტექდათვალიერება გავლილი. ვაჭრობა ადგილზე.', price: 8900, currency: 'USD', category: 'vehicles', condition: 'used', city: 'რუსთავი', photos: [ph(4, 'car'), ph(2, 'car')], created: 2400, views: 388, saves: 23 },
    { id: 'l7', seller_id: 'u6', title: '2-ოთახიანი ბინა ვაკეში, გრძელვადიანი ქირა', description: '62 კვ.მ, მე-7 სართული, ავეჯით და ტექნიკით. ცხოველებთან ერთად შეიძლება. კომუნალური ცალკე.', price: 750, currency: 'USD', category: 'realty', condition: null, city: 'თბილისი', photos: [ph(1, 'apartment')], created: 700, views: 512, saves: 31 },
    { id: 'l8', seller_id: 'u5', title: 'მაგიდის ლამპა, ხელნაკეთი', description: 'თვითონ ვაკეთებ. ფერს შეკვეთით შევცვლი, მზადდება 3 დღეში.', price: 85, currency: 'GEL', category: 'home', condition: 'new', city: 'თბილისი', photos: [ph(0, 'lamp'), ph(3, 'lamp')], created: 30, views: 19, saves: 3 },
    { id: 'l9', seller_id: 'u3', title: 'ბოტასები Nike Air Max, 42 ზომა', description: 'ახალი, ყუთით. ზომა არ მომერგო.', price: 220, currency: 'GEL', category: 'fashion', condition: 'new', city: 'თბილისი', photos: [ph(0, 'sneakers')], created: 1100, views: 66, saves: 5 },
    { id: 'l10', seller_id: 'u1', title: 'ბავშვის წიგნები, 12 ცალი', description: 'ზღაპრები და ენციკლოპედიები 5–9 წლისთვის. ვჩუქნი, ოღონდ თავად წაიღეთ.', price: 0, currency: 'GEL', category: 'kids', condition: 'used', city: 'ქუთაისი', photos: [ph(2, 'books')], created: 200, views: 73, saves: 9 },
    { id: 'l11', seller_id: 'u6', title: 'მონსტერა, 80 სმ', description: 'ჯანმრთელი, ქოთნით. სივრცე აღარ მყოფნის.', price: 60, currency: 'GEL', category: 'home', condition: 'used', city: 'თბილისი', photos: [ph(1, 'plant')], created: 3000, views: 28, saves: 2 },
    { id: 'l12', seller_id: 'u4', title: 'ყურსასმენები Sony WH-1000XM4', description: 'ხმაურის ჩახშობით. ყველაფერი მუშაობს, მოყვება ქეისი.', price: null, currency: 'GEL', category: 'electronics', condition: 'used', city: 'ბათუმი', photos: [ph(3, 'headphones')], created: 4000, views: 95, saves: 7, status: 'reserved' },
    { id: 'l13', seller_id: 'me', title: 'Xbox Series S + ორი ჯოისტიკი', description: 'იდეალურ მდგომარეობაშია. მოყვება 3 თამაში.', price: 650, currency: 'GEL', category: 'electronics', condition: 'used', city: 'თბილისი', photos: [ph(0, 'console'), ph(2, 'console')], created: 1300, views: 47, saves: 3, bumped: 1300 },
    { id: 'l14', seller_id: 'me', title: 'ტყავის ქურთუკი, M', description: '', price: 180, currency: 'GEL', category: 'fashion', condition: 'used', city: 'თბილისი', photos: [ph(4, 'jacket')], created: 9000, views: 120, saves: 8, status: 'sold' },
  ].map((l) => ({
    status: 'active', hidden: false, ...l, views_count: l.views, saves_count: l.saves,
    created_at: ago(l.created), updated_at: ago(l.created), bumped_at: ago(l.bumped ?? l.created),
  }))
  const saves = new Map([['l2', ago(900)], ['l5', ago(60)]]) // listing_id → created_at
  const viewed = new Set()

  notifications.push({ id: 'n9', type: 'listing_price', actor_id: 'u4', read: false, created_at: ago(90),
    data: { listing_id: 'l2', title: listings[1].title, price: 900, old_price: 1000, currency: 'GEL', photo: listings[1].photos[0] } })

  const view = (l) => ({ ...l, seller: { ...person(l.seller_id), city: profiles.get(l.seller_id)?.city }, saved: saves.has(l.id) })
  const visible = (l) => l.seller_id === ME || (!l.hidden && !(profiles.get(l.seller_id)?.banned_until))
  const byId = (id) => listings.find((l) => l.id === id && visible(l))
  const mine = (id) => { const l = listings.find((x) => x.id === id && x.seller_id === ME); if (!l) throw new Error('განცხადება ვერ მოიძებნა'); return l }
  const norm = (s = '') => s.toLowerCase()

  const methods = {
    async listings({ q = '', category = null, city = null, min = null, max = null, currency = 'GEL', condition = null, sort = 'new', seller = null, offset = 0, limit = 24 } = {}) {
      await wait(140)
      const t = norm(q.trim())
      let rows = listings.filter(visible).filter((l) => (seller ? l.seller_id === seller : l.status !== 'sold'))
      if (t) rows = rows.filter((l) => norm(l.title).includes(t) || norm(l.description).includes(t))
      if (category) rows = rows.filter((l) => l.category === category)
      if (city) rows = rows.filter((l) => l.city === city)
      if (condition) rows = rows.filter((l) => l.condition === condition)
      if (min !== null || max !== null) rows = rows.filter((l) => l.currency === currency && l.price !== null && (min === null || l.price >= min) && (max === null || l.price <= max))
      const price = (l, dir) => (l.price === null ? Infinity : dir * l.price)
      rows.sort((a, b) => {
        if (sort === 'cheap') return price(a, 1) - price(b, 1) || b.bumped_at.localeCompare(a.bumped_at)
        if (sort === 'expensive') return price(a, -1) - price(b, -1) || b.bumped_at.localeCompare(a.bumped_at)
        if (seller) return a.status.localeCompare(b.status) || b.created_at.localeCompare(a.created_at)
        return b.bumped_at.localeCompare(a.bumped_at)
      })
      return rows.slice(offset, offset + limit).map(view)
    },
    async listing(id) {
      await wait(120)
      const l = byId(id)
      if (!l) return null
      const own = listings.filter((x) => x.seller_id === l.seller_id)
      return { ...view(l), seller_stats: { active: own.filter((x) => x.status !== 'sold' && !x.hidden).length, sold: own.filter((x) => x.status === 'sold').length, since: profiles.get(l.seller_id)?.created_at } }
    },
    async myListings() { await wait(100); return listings.filter((l) => l.seller_id === ME).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(view) },
    async savedListings() {
      await wait(100)
      return [...saves.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => byId(id)).filter(Boolean).map(view)
    },
    async createListing(data) {
      await wait(300)
      const day = listings.filter((l) => l.seller_id === ME && Date.now() - Date.parse(l.created_at) < 864e5).length
      if (day >= 10) throw new Error('დღეში მაქსიმუმ 10 განცხადების დამატება შეიძლება')
      const t = new Date().toISOString()
      const l = { status: 'active', hidden: false, description: '', condition: null, photos: [], currency: 'GEL', ...data,
        title: data.title.trim().replace(/\s+/g, ' '), id: nid('l'), seller_id: ME, views_count: 0, saves_count: 0, created_at: t, updated_at: t, bumped_at: t }
      listings.unshift(l)
      return view(l)
    },
    async updateListing(id, patch) {
      await wait(200)
      const l = mine(id)
      const before = l.price
      const wasSold = l.status === 'sold'
      const { seller_id: _s, views_count: _v, saves_count: _c, hidden: _h, created_at: _a, bumped_at: _b, ...safe } = patch
      Object.assign(l, safe, { updated_at: new Date().toISOString() })
      if (patch.price !== undefined && before !== null && l.price !== null && l.price < before) emit('notif', null)
      if (!wasSold && l.status === 'sold') onSale(l.id)
      return view(l)
    },
    async deleteListing(id) { const i = listings.indexOf(mine(id)); listings.splice(i, 1); saves.delete(id) },
    async bumpListing(id) {
      const l = mine(id)
      if (l.status !== 'active') throw new Error('მხოლოდ აქტიურ განცხადებას აწევ')
      if (Date.now() - Date.parse(l.bumped_at) < 864e5) throw new Error('აწევა დღეში ერთხელ შეიძლება')
      l.bumped_at = new Date().toISOString()
      return l.bumped_at
    },
    async viewListing(id) {
      const l = byId(id)
      if (!l || l.seller_id === ME || viewed.has(id)) return
      viewed.add(id)
      l.views_count++
    },
    async saveListing(id, on) {
      const l = byId(id)
      if (!l || l.seller_id === ME) throw new Error('საკუთარ განცხადებას ვერ შეინახავ')
      if (on && !saves.has(id)) { saves.set(id, new Date().toISOString()); l.saves_count++ }
      if (!on && saves.delete(id)) l.saves_count = Math.max(0, l.saves_count - 1)
    },
    async contactSeller(listing, body) {
      const conv = await this.openDM(listing.seller_id)
      const l = byId(listing.id) || listing
      await this.send(conv, { body, meta: { listing: { id: l.id, title: l.title, price: l.price, currency: l.currency, photo: l.photos?.[0] || null, seller_id: l.seller_id } } })
      return conv
    },
  }
  return { methods, listings }
}
