// დემო API — მონაცემები მეხსიერებაშია, Supabase არ სჭირდება.
// ინტერფეისი ზუსტად ემთხვევა api.supabase.js-ს.
import { art } from './demoArt.js'
import { groupStories } from './groupStories.js'
import { demoMarket } from './demoMarket.js'
import { demoRewards } from './demoRewards.js'
import { GIFT_PRICES } from './rewards.js'
import { BOTS } from '../games/bots.js'
import { GAMES, outcome, seatsOf, SEAT_LETTERS, loto } from '../games/index.js'
import { applyAction, initFor, publicState, withMyHand, handsOf } from '../games/server.js'

// ?demoAs=u1 — დემოში სხვა მომხმარებლად შესვლა (მაგ. ზარის ორ ჩანართში შესამოწმებლად)
const ME = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('demoAs')) || 'me'
const now = Date.now()
const ago = (min) => new Date(now - min * 60000).toISOString()
let idSeq = 1000
const nid = (p = 'x') => `${p}${++idSeq}`
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms))

const people = [
  { id: 'me', username: 'giorgi', full_name: 'გიორგი', bio: 'ვაწყობ ეზოს. ნარდში არ დამიჯერო.', city: 'თბილისი', school: 'ქუთაისის მე-2 საჯარო სკოლა', grad_year: 2012, role: 'admin' },
  { id: 'u1', username: 'nino.b', full_name: 'ნინო ბერიძე', bio: 'ფოტოგრაფი · მთები და ძველი თბილისი', city: 'თბილისი', school: 'ქუთაისის მე-2 საჯარო სკოლა', grad_year: 2012 },
  { id: 'u2', username: 'luka_j', full_name: 'ლუკა ჯაფარიძე', bio: 'ჭადრაკი 1900+. მოდი, ვითამაშოთ.', city: 'ქუთაისი', school: 'ქუთაისის მე-2 საჯარო სკოლა', grad_year: 2013 },
  { id: 'u3', username: 'ana.lomidze', full_name: 'ანა ლომიძე', bio: 'ღვინო, წიგნები, ზღვა.', city: 'ბათუმი', school: 'ბათუმის მე-6 სკოლა', grad_year: 2015, is_private: true },
  { id: 'u4', username: 'dato.tsereteli', full_name: 'დათო წერეთელი', bio: 'მოგზაური. სვანეთი ჩემი მეორე სახლია.', city: 'თბილისი', school: '', grad_year: null },
  { id: 'u5', username: 'mariami', full_name: 'მარიამ გელაშვილი', bio: 'დიზაინერი · ბროწეულის ფერი მიყვარს', city: 'თბილისი', school: 'თბილისის 51-ე სკოლა', grad_year: 2016 },
  { id: 'u6', username: 'salo.k', full_name: 'სალომე ქავთარაძე', bio: 'ცეკვა და ხაჭაპური', city: 'თბილისი', school: '', grad_year: null },
  { id: 'u7', username: 'irakli.m', full_name: 'ირაკლი მჭედლიშვილი', bio: 'შაშკის ჩემპიონი უბანში (თვითგამოცხადებული)', city: 'რუსთავი', school: '', grad_year: null },
]
const profiles = new Map(people.map((p, i) => [p.id, {
  avatar_url: null, onboarded: true, followers_count: 0, following_count: 0, posts_count: 0, role: 'user', banned_until: null, ban_reason: null,
  last_seen: ago(i % 3 === 0 ? 1 : i * 37), created_at: ago(60 * 24 * 90), is_private: false, ...p,
}]))
const person = (id) => {
  const p = profiles.get(id)
  return p && { id: p.id, username: p.username, full_name: p.full_name, avatar_url: p.avatar_url, last_seen: p.last_seen }
}

const follows = new Set(['me>u1', 'me>u2', 'me>u5', 'u1>me', 'u2>me', 'u3>me', 'u4>u1', 'u5>u1', 'u6>u1', 'u7>u2', 'u1>u5'])
const recount = () => {
  for (const p of profiles.values()) {
    p.followers_count = [...follows].filter((f) => f.endsWith(`>${p.id}`)).length
    p.following_count = [...follows].filter((f) => f.startsWith(`${p.id}>`)).length
    p.posts_count = posts.filter((x) => x.author_id === p.id && !x.parent_id).length
  }
}

function tagsOf(t = '') {
  return [...new Set([...t.matchAll(/#([A-Za-z0-9_ა-ჿ]{2,40})/g)].map((m) => m[1].toLowerCase()))]
}

// ---- ჯგუფები და ივენთები
const groups = [
  { id: 'g1', slug: 'kutaisi-2-2012', name: 'ქუთაისის მე-2 სკოლა, 2012', description: 'ჩვენი კლასის და პარალელურების ჯგუფი. შეხვედრები, ძველი ფოტოები, სიახლეები.', privacy: 'private', owner_id: 'u1', cover: [16, 'city'] },
  { id: 'g2', slug: 'nardi-club', name: 'ნარდის კლუბი', description: 'ვთამაშობთ ონლაინ და ვაკის პარკში. ტურნირები ყოველ პარასკევს.', privacy: 'public', owner_id: 'u7', cover: [4, 'vine'] },
  { id: 'g3', slug: 'tbilisi-photo', name: 'თბილისის ფოტოგრაფები', description: 'ძველი უბნები, აივნები, ქუჩის ფოტოგრაფია. ყოველკვირეული თემა.', privacy: 'public', owner_id: 'u5', cover: [2, 'city'] },
  { id: 'g4', slug: 'svaneti-hiking', name: 'ლაშქრობა სვანეთში', description: 'მარშრუტები, გიდები, ერთად წასვლა.', privacy: 'public', owner_id: 'u4', cover: [3, 'mountains'] },
].map(({ cover, ...g }) => ({ ...g, cover_url: art(cover[0], cover[1]), created_at: ago(60 * 24 * 30) }))
const memberships = [
  ['g1', 'u1', 'owner'], ['g1', 'me', 'member'], ['g1', 'u2', 'member'], ['g1', 'u3', 'pending'],
  ['g2', 'u7', 'owner'], ['g2', 'u2', 'member'], ['g2', 'u3', 'member'], ['g2', 'u6', 'member'],
  ['g3', 'u5', 'owner'], ['g3', 'me', 'admin'], ['g3', 'u1', 'member'], ['g3', 'u6', 'member'],
  ['g4', 'u4', 'owner'], ['g4', 'u1', 'member'],
].map(([group_id, user_id, role]) => ({ group_id, user_id, role: role === 'pending' ? 'member' : role, status: role === 'pending' ? 'pending' : 'active' }))
const memberOf = (gid, uid = ME) => memberships.find((m) => m.group_id === gid && m.user_id === uid && m.status === 'active')
const canSee = (gid) => !gid || groups.find((g) => g.id === gid)?.privacy === 'public' || Boolean(memberOf(gid))
const groupView = (g) => {
  const m = memberships.find((x) => x.group_id === g.id && x.user_id === ME)
  return { ...g, members_count: memberships.filter((x) => x.group_id === g.id && x.status === 'active').length, my_role: m?.role || null, my_status: m?.status || null }
}
const day = (d, h, min = 0) => { const t = new Date(); t.setDate(t.getDate() + d); t.setHours(h, min, 0, 0); return t.toISOString() }
const untilFriday = ((5 - new Date().getDay() + 7) % 7) || 7
const events = [
  { id: 'e1', title: 'კლასის შეხვედრა — 12 წელი', description: 'ვიკრიბებით ყველა, ვინც 2012-ში დაამთავრა. მოიტანეთ ძველი ფოტოები!', starts_at: day(11, 19), ends_at: day(11, 23), place: 'რესტორანი „ფაეტონი“', city: 'ქუთაისი', host_id: 'u1', group_id: 'g1', cover: [16, 'city'] },
  { id: 'e2', title: 'პარასკევის ნარდის ტურნირი', description: 'მოკლე ნარდი, 16 მონაწილე, ოლიმპიური სისტემა. გამარჯვებულს — ჩურჩხელების ყუთი.', starts_at: day(untilFriday, 18), ends_at: day(untilFriday, 22), place: 'ვაკის პარკი, ფანჩატურთან', city: 'თბილისი', host_id: 'u7', group_id: 'g2', cover: [4, 'vine'] },
  { id: 'e3', title: 'ფოტო-გასეირნება ძველ თბილისში', description: 'სოლოლაკიდან აბანოთუბნამდე. ვიღებთ აივნებს და ეზოებს.', starts_at: day(6, 11), ends_at: day(6, 15), place: 'თავისუფლების მოედანი', city: 'თბილისი', host_id: 'u5', group_id: null, cover: [7, 'city'] },
  { id: 'e4', title: 'ლაშქრობა: მესტია — ჭალაადის მყინვარი', description: 'მარტივი მარშრუტი, 4 საათი. ტრანსპორტი მესტიიდან.', starts_at: day(17, 8), ends_at: null, place: 'მესტია, ცენტრალური მოედანი', city: 'მესტია', host_id: 'u4', group_id: 'g4', cover: [3, 'mountains'] },
].map(({ cover, ...e }) => ({ ...e, cover_url: art(cover[0], cover[1]), created_at: ago(60 * 24 * 3) }))
const rsvps = [['e1', 'me', 'going'], ['e1', 'u2', 'going'], ['e1', 'u1', 'going'], ['e2', 'u2', 'going'], ['e2', 'u3', 'interested'], ['e2', 'u6', 'going'], ['e3', 'u1', 'interested'], ['e3', 'u6', 'going'], ['e4', 'u1', 'going']]
  .map(([event_id, user_id, status]) => ({ event_id, user_id, status }))
const eventView = (e) => ({
  ...e, host: person(e.host_id), group: e.group_id ? (({ id, slug, name }) => ({ id, slug, name }))(groups.find((g) => g.id === e.group_id)) : null,
  going_count: rsvps.filter((r) => r.event_id === e.id && r.status === 'going').length,
  interested_count: rsvps.filter((r) => r.event_id === e.id && r.status === 'interested').length,
  my_rsvp: rsvps.find((r) => r.event_id === e.id && r.user_id === ME)?.status || null,
})

const img = (seed, kind, tall) => ({ url: art(seed, kind, tall), type: 'image', w: 1080, h: tall ? 1920 : 1350 })
const posts = [
  { id: 'p1', author_id: 'u1', body: 'უშგული დილის შვიდზე. ნისლი ზუსტად ათ წუთს გაგრძელდა და მერე მზემ ყველაფერი გადაწყვიტა. #სვანეთი #მთები', media: [img(3, 'mountains'), img(8, 'mountains')], created: 50, likes: 214 },
  { id: 'p2', author_id: 'u2', body: 'ვინმე ჭადრაკზე? ეზოში თამაშები დაემატა, 1+0 არ არის, მაგრამ მატი ისევ მატია.', media: [], created: 95, likes: 31 },
  { id: 'p3', author_id: 'u5', body: 'ძველი თბილისის აივნები ფერებით. ამ სერიაზე ერთი თვე ვიმუშავე. #თბილისი', media: [img(2, 'city')], created: 180, likes: 402 },
  { id: 'p4', author_id: 'u3', body: 'ბათუმში ზღვა დღეს წყნარია. ვინც ჩამოდის — ბულვარზე ვარ.', media: [img(4, 'sea')], created: 300, likes: 88 },
  { id: 'p5', author_id: 'u4', body: 'თრედი: 5 ადგილი სვანეთში, რომელიც გზამკვლევებში არ წერია 🧵 #სვანეთი', media: [], created: 420, likes: 156 },
  { id: 'p6', author_id: 'u6', body: 'ბროწეულის წვენი + ცოტა ტარხუნა. მერე მადლობას მეტყვით.', media: [img(5, 'still')], created: 600, likes: 73 },
  { id: 'p7', author_id: 'u7', body: 'შაშკი რომ რუსული წესებით ითამაშება და დამკა შორს დადის — ეს ვიცოდით, არა? ეზოში სწორედ ასეა.', media: [], created: 800, likes: 19 },
  { id: 'p8', author_id: 'u1', body: 'რთველი კახეთში. ხელები ისევ იისფერი მაქვს. #რთველი #კახეთი', media: [img(1, 'vine'), img(6, 'vine'), img(11, 'still')], created: 1300, likes: 530 },
  { id: 'p9', author_id: 'me', body: 'ეზო გავხსენი. აქ არის ფიდი, ვიდეოები, გაცნობა და ნარდი. დანარჩენს თქვენ გვეტყვით.', media: [], created: 30, likes: 12 },
  { id: 'p10', author_id: 'u2', body: 'ეს აივნები ჩემი ბავშვობაა.', media: [], quote_id: 'p3', created: 150, likes: 22 },
  { id: 'p11', author_id: 'u7', body: 'ეზოში რომელი თამაში დავამატოთ შემდეგ? 🎲', media: [], created: 65, likes: 27 },
  { id: 'r1', author_id: 'u4', body: '1. ადიში — მყინვარიდან ჩამოსული მდინარე ცხენით უნდა გადალახო.', parent_id: 'p5', created: 419, likes: 40 },
  { id: 'r2', author_id: 'u4', body: '2. ტვიბერის მყინვარი — ბილიკი ნაკლებადაა ცნობილი, ხედი კი ბევრად უკეთესია.', parent_id: 'r1', created: 418, likes: 31 },
  { id: 'r3', author_id: 'u1', body: 'ადიში წელს ორჯერ ვცადე, მეორედ გამოვიდა.', parent_id: 'r1', created: 300, likes: 9 },
  { id: 'r4', author_id: 'u3', body: 'რა მაგარი ფერებია 🔥', parent_id: 'p3', created: 170, likes: 4 },
  { id: 'r5', author_id: 'me', body: 'მოდი, ვითამაშოთ — ნარდზე გეპატიჟები.', parent_id: 'p2', created: 80, likes: 2 },
  { id: 'v1', author_id: 'u1', kind: 'reel', body: 'მთის გზა 60 წამში', media: [img(3, 'mountains', true)], created: 240, likes: 1204 },
  { id: 'v2', author_id: 'u5', kind: 'reel', body: 'როგორ ვხატავ აივნებს', media: [img(7, 'city', true)], created: 500, likes: 640 },
  { id: 'v3', author_id: 'u3', kind: 'reel', body: 'ბათუმის მზის ჩასვლა', media: [img(9, 'sea', true)], created: 700, likes: 980 },
  { id: 'gp1', author_id: 'u1', group_id: 'g1', body: 'ხალხო, 25 ოქტომბერს ვიკრიბებით! ივენთი დავამატე — მონიშნეთ, ვინ მოდის. #კლასელები', media: [], created: 75, likes: 14 },
  { id: 'gp2', author_id: 'u7', group_id: 'g2', body: 'პარასკევს ვაკის პარკში ტურნირია. ვინც მარსს ვერ იტანს, არ მოვიდეს 😄 #ნარდი', media: [], created: 210, likes: 41 },
  { id: 'gp3', author_id: 'u5', group_id: 'g3', body: 'ამ კვირის თემა: ფანჯრები და აივნები. #თბილისი', media: [img(14, 'city')], created: 330, likes: 63 },
  { id: 'v4', author_id: 'u6', kind: 'reel', body: 'ხაჭაპური ორ წუთში (თითქმის)', media: [img(10, 'still', true)], created: 900, likes: 2210 },
].map((p) => ({
  kind: 'post', parent_id: null, quote_id: null, group_id: null, repost_count: 0, reply_count: 0,
  ...p, like_count: p.likes, created_at: ago(p.created), hashtags: tagsOf(p.body),
}))
for (const p of posts) {
  if (p.parent_id) {
    const parent = posts.find((x) => x.id === p.parent_id)
    parent.reply_count++
    p.root_id = parent.root_id || parent.id
  } else p.root_id = null
  if (p.quote_id) posts.find((x) => x.id === p.quote_id).repost_count++
}
const likes = new Set(['me>p1', 'me>p3'])
recount()

// ---- გამოკითხვები, შენახული, ახლო მეგობრები, თხოვნები
const polls = new Map([
  ['p11', { post_id: 'p11', options: ['ბურა', 'ლოტო', 'ჭადრაკის ამოცანები'], multi: false, closes_at: new Date(now + 2 * 864e5).toISOString(), votes: [41, 17, 23], mine: [] }],
])
const pollView = (p) => {
  const x = polls.get(p.id)
  if (!x) return null
  const counts = x.votes.map((v, i) => v + (x.mine.includes(i) ? 1 : 0))
  return { post_id: x.post_id, options: x.options, multi: x.multi, closes_at: x.closes_at, counts, mine: x.mine.slice(), total: counts.reduce((a, b) => a + b, 0), closed: Date.parse(x.closes_at) <= Date.now() }
}
const collections = [{ id: 'col1', owner_id: 'me', name: 'რეცეპტები', created_at: ago(3000) }]
const saves = [{ post_id: 'p6', collection_id: 'col1', created_at: ago(500) }, { post_id: 'p1', collection_id: null, created_at: ago(40) }]
const closeFriendsSet = new Set(['u1', 'u5'])
const theirCloseFriends = new Set(['u5']) // ვის „ახლო მეგობრებშიც“ ვარ მე
const followRequests = [] // { requester_id, target_id, created_at }
const canSeeAuthor = (a) => a === ME || !profiles.get(a)?.is_private || follows.has(`${ME}>${a}`)
const visiblePost = (p) => p.group_id || p.parent_id || canSeeAuthor(p.author_id)

const enrich = (p) => {
  if (!p) return null
  const q = p.quote_id ? posts.find((x) => x.id === p.quote_id) : null
  const g = p.group_id ? groups.find((x) => x.id === p.group_id) : null
  return {
    ...p,
    group: g ? { id: g.id, slug: g.slug, name: g.name, privacy: g.privacy } : null,
    author: person(p.author_id),
    quote: q ? { id: q.id, body: q.body, media: q.media, created_at: q.created_at, author: person(q.author_id) } : null,
    liked: likes.has(`${ME}>${p.id}`),
    saved: saves.some((s) => s.post_id === p.id),
    poll: pollView(p),
  }
}

const stories = [
  ['u1', 3, 'mountains', 40], ['u1', 12, 'vine', 35], ['u5', 7, 'city', 90], ['u3', 9, 'sea', 200],
  ['u2', 5, 'still', 260], ['u4', 13, 'mountains', 330], ['me', 15, 'sea', 120],
  ['u5', 11, 'still', 30, 'close'], ['me', 2, 'city', 60 * 30, 'all'],
].map(([a, seed, kind, min, audience = 'all'], i) => ({
  id: `s${i}`, author_id: a, media_url: art(seed, kind, true), media_type: 'image', caption: '', created_at: ago(min), seen: false, audience,
  expires_at: new Date(now - min * 60000 + 864e5).toISOString(),
}))
const highlights = [
  { id: 'h1', owner_id: 'u1', title: 'სვანეთი', items: [[3, 'mountains'], [12, 'mountains'], [8, 'mountains']] },
  { id: 'h2', owner_id: 'u1', title: 'რთველი', items: [[1, 'vine'], [6, 'vine']] },
  { id: 'h3', owner_id: 'me', title: 'ზღვა', items: [[15, 'sea'], [4, 'sea']] },
].map((h, k) => ({
  id: h.id, owner_id: h.owner_id, title: h.title, created_at: ago(5000 - k), cover_url: art(h.items[0][0], h.items[0][1], true),
  items: h.items.map(([seed, kind], i) => ({ id: `${h.id}i${i}`, highlight_id: h.id, media_url: art(seed, kind, true), media_type: 'image', caption: '', created_at: ago(9000 - i) })),
}))

const notifications = [
  { id: 'n1', type: 'like', actor_id: 'u1', post_id: 'p9', created: 5 },
  { id: 'n2', type: 'follow', actor_id: 'u3', created: 40 },
  { id: 'n3', type: 'gift', actor_id: 'u5', created: 70 },
  { id: 'n4', type: 'reply', actor_id: 'u2', post_id: 'p9', created: 120 },
  { id: 'n5', type: 'game_invite', actor_id: 'u2', created: 160 },
  { id: 'n6', type: 'match', actor_id: 'u6', created: 400, read: true },
  { id: 'n7', type: 'event_rsvp', actor_id: 'u2', event_id: 'e1', created: 25 },
  { id: 'n8', type: 'tournament_end', actor_id: 'u7', tournament_id: 't3', data: { title: 'შაშკის თასი', game: 'checkers', place: 3, players: 5, score: 8 }, created: 21 * 60 },
].map((n) => ({ read: false, ...n, created_at: ago(n.created) }))

const storyViews = [['s6', 'u1', 20], ['s6', 'u3', 45], ['s6', 'u5', 60], ['s6', 'u2', 95]]
const visits = [['u3', 12], ['u7', 95], ['u1', 300], ['u6', 1200]]
const gifts = [
  { id: 'g1', from_id: 'u5', to_id: 'me', kind: 'pomegranate', note: 'ეზოს გახსნას გილოცავ!', created_at: ago(70) },
  { id: 'g2', from_id: 'u1', to_id: 'me', kind: 'churchkhela', note: '', created_at: ago(2000) },
  { id: 'g3', from_id: 'u2', to_id: 'me', kind: 'dice', note: 'რევანში მომიწევს', created_at: ago(4000) },
]

const convs = [
  { id: 'c1', other: 'u1', kind: 'dm', msgs: [['u1', 'ფოტოები გამოგიგზავნე, ნახე?', 200], ['me', 'კი, უშგული საოცარია', 190], ['u1', 'შემდეგ ჯერზე ერთად წავიდეთ 🙂', 15]] },
  { id: 'c2', other: 'u2', kind: 'dm', msgs: [['u2', 'ჭადრაკი 10 წუთში?', 60], ['me', 'წამოვედი', 58]] },
  { id: 'c3', other: 'u6', kind: 'dating', msgs: [['u6', 'გამარჯობა! წყვილი ვართ 😄', 380]] },
  { id: 'c4', kind: 'group', title: 'ეზოს გუნდი', members: ['me', 'u1', 'u2', 'u5'], msgs: [
    ['me', 'შექმნა ჩატი „ეზოს გუნდი“', 600, { system: true }],
    ['u5', 'ახალი იკონები მოვამზადე, ნახეთ', 90],
    ['u2', 'ბროწეული ძალიან კარგად გამოვიდა', 85],
    ['u1', 'პარასკევს ვხვდებით?', 40],
    ['me', 'კი, 7-ზე', 35, {}, 3],
  ] },
]
const conversations = new Map()
const messages = new Map()
const reactions = [] // { message_id, user_id, emoji }
for (const c of convs) {
  const list = []
  for (const [snd, body, min, meta = {}, replyIdx] of c.msgs) {
    list.push({ id: nid('m'), conversation_id: c.id, sender_id: snd, body, media_url: null, media_type: null, created_at: ago(min), meta, deleted_at: null, reply_to: replyIdx !== undefined ? list[replyIdx].id : null })
  }
  messages.set(c.id, list)
  conversations.set(c.id, { id: c.id, kind: c.kind, other: c.other, title: c.title, members: c.members || ['me', c.other], read_at: c.id === 'c1' || c.id === 'c4' ? ago(100) : ago(0) })
}
reactions.push({ message_id: messages.get('c4')[1].id, user_id: 'u2', emoji: '🔥' }, { message_id: messages.get('c4')[1].id, user_id: 'u1', emoji: '🔥' }, { message_id: messages.get('c1')[1].id, user_id: 'u1', emoji: '❤️' })
const msgView = (m) => {
  const list = messages.get(m.conversation_id) || []
  const r = m.reply_to ? list.find((x) => x.id === m.reply_to) : null
  return { ...m, reply: r ? { id: r.id, body: r.body, sender_id: r.sender_id, media_type: r.media_type, deleted_at: r.deleted_at } : null,
    reactions: reactions.filter((x) => x.message_id === m.id).map(({ user_id, emoji }) => ({ user_id, emoji })) }
}
const lastText = (m) => (m.deleted_at ? 'წაშლილი მესიჯი' : m.media_type === 'image' ? '📷 ფოტო' : m.media_type === 'audio' ? '🎙 ხმოვანი'
  : m.meta?.call ? (['missed', 'declined', 'busy'].includes(m.meta.call.status) ? '📞 გამოტოვებული ზარი' : '📞 ზარი')
  : m.meta?.story ? `↩ სთორზე: ${m.body}` : m.meta?.listing ? `🏷 ${m.body}` : m.body)

// ---- ზარები დემოში: სხვა ჩანართთან BroadcastChannel-ით, ან სიმულაცია
const calls = new Map()
const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ezo-demo') : null
const present = new Set()
bc?.addEventListener('message', (e) => {
  const m = e.data
  if (m.t === 'who') bc.postMessage({ t: 'here', user: ME })
  if (m.t === 'here') present.add(m.user)
  if (m.t === 'call-invite' && m.call.callee_id === ME) { calls.set(m.call.id, m.call); emit('incoming-call', { ...m.call, caller: person(m.call.caller_id) }) }
  if (m.t === 'call-update') { const c = calls.get(m.call.id); if (c) Object.assign(c, m.call); emit(`call:${m.call.id}`, m.call) }
  if (m.t === 'sig') emit(`sig:${m.id}`, m.msg)
})
bc?.postMessage({ t: 'here', user: ME })

const dating = { profile: null, swipes: new Map() }
const datingPool = [
  ['u6', 26, 'woman', 'ცეკვა, ხაჭაპური და კარგი მუსიკა. ვეძებ ვინმეს, ვინც ნარდში დამამარცხებს.', ['ცეკვა', 'მოგზაურობა', 'ნარდი'], 'still', 5],
  ['u5', 27, 'woman', 'დიზაინერი. დილით ყავა, საღამოს გამოფენა.', ['ხელოვნება', 'ყავა', 'კინო'], 'city', 2],
  ['u3', 29, 'woman', 'ბათუმი, ზღვა და წიგნები.', ['ზღვა', 'წიგნები', 'ღვინო'], 'sea', 4],
  ['u1', 31, 'woman', 'ფოტოგრაფი. მთები ჩემი თერაპიაა.', ['ფოტო', 'ლაშქრობა'], 'mountains', 3],
  ['u4', 32, 'man', 'მოგზაური, სვანეთი ჩემი მეორე სახლია.', ['ლაშქრობა', 'ცხენები'], 'mountains', 13],
  ['u7', 28, 'man', 'შაშკი, ფეხბურთი, მწვადი.', ['სპორტი', 'შაშკი'], 'vine', 6],
  ['u2', 30, 'man', 'ჭადრაკი და ფიზიკა.', ['ჭადრაკი', 'მეცნიერება'], 'still', 11],
]
const card = ([id, age, gender, bio, interests, kind, seed]) => ({
  ...person(id), age, gender, bio, interests, city: profiles.get(id).city,
  photos: [art(seed, kind, true), art(seed + 20, 'city', true)],
})
const matchesList = [{ id: 'mt1', conversation_id: 'c3', created_at: ago(400), uid: 'u6' }]

const games = new Map()
const gameMsgs = new Map() // game_id → [{ id, game_id, user_id, kind, body, created_at, p }]
const puzzleState = new Map() // day → { solved, attempts }
function pushGameMsg(id, user, kind, body) {
  const m = { id: nid('gm'), game_id: id, user_id: user, kind, body, created_at: new Date().toISOString(), p: person(user) }
  if (!gameMsgs.has(id)) gameMsgs.set(id, [])
  gameMsgs.get(id).push(m)
  emit(`gm:${id}`, m)
}
const stats = new Map([
  ['me:nardi', { type: 'nardi', rating: 1236, wins: 14, losses: 9, draws: 0 }],
  ['me:chess', { type: 'chess', rating: 1180, wins: 6, losses: 8, draws: 2 }],
  ['me:joker', { type: 'joker', rating: 1214, wins: 3, losses: 5, draws: 0 }],
])

// ---- ტურნირები (არენა)
const minutesFrom = (m) => new Date(now + m * 60000).toISOString()
const tournaments = [
  { id: 't1', type: 'nardi', tc: null, title: 'საღამოს ნარდის არენა', description: 'ერთი საათი, რამდენი პარტიაც მოგესურვება. გამარჯვებულს ეზოს ბროწეულის ბეჯი.', starts_at: minutesFrom(-25), ends_at: minutesFrom(35), created_by: 'me', group_id: null, created_at: ago(2000), start_notified_at: minutesFrom(-25) },
  { id: 't2', type: 'chess', tc: '3+2', title: 'პარასკევის ბლიცი', description: 'ჭადრაკი 3+2. მოდი ცოტა ადრე, რომ არ დაგაგვიანდეს.', starts_at: day(untilFriday, 21), ends_at: day(untilFriday, 22), created_by: 'me', group_id: null, created_at: ago(900) },
  { id: 't3', type: 'checkers', tc: null, title: 'შაშკის თასი', description: '', starts_at: day(-1, 20), ends_at: day(-1, 21), created_by: 'u7', group_id: null, created_at: ago(5000), start_notified_at: day(-1, 20), finished_at: day(-1, 21) },
  { id: 't0', type: 'nardi', tc: null, title: 'ზაფხულის ნარდის თასი', description: '', starts_at: day(-60, 20), ends_at: day(-60, 22), created_by: 'me', group_id: null, created_at: ago(90000), start_notified_at: day(-60, 20), finished_at: day(-60, 22) },
  { id: 't4', type: 'durak', tc: null, title: 'დურაკის ღამე', description: 'ჩამატებითი დურაკი, ორნი მაგიდასთან.', starts_at: day(1, 22), ends_at: day(1, 23, 30), created_by: 'me', group_id: null, created_at: ago(300) },
]
const tplayers = [
  ['t1', 'u7', 8, 5, 4, 2], ['t1', 'u2', 6, 4, 3, 0], ['t1', 'u1', 4, 3, 2, 1], ['t1', 'u5', 2, 3, 1, 0], ['t1', 'u3', 0, 2, 0, 0],
  ['t2', 'u2', 0, 0, 0, 0], ['t2', 'u7', 0, 0, 0, 0], ['t2', 'u4', 0, 0, 0, 0],
  ['t3', 'u7', 14, 7, 6, 3], ['t3', 'u2', 10, 6, 5, 0], ['t3', 'me', 8, 6, 4, 0], ['t3', 'u1', 6, 5, 3, 0], ['t3', 'u3', 2, 4, 1, 0],
  ['t0', 'me', 16, 8, 7, 4], ['t0', 'u7', 12, 8, 6, 0], ['t0', 'u2', 9, 7, 4, 1],
  ['t4', 'u3', 0, 0, 0, 0],
].map(([tournament_id, user_id, score, g, wins, streak], i) => ({ tournament_id, user_id, score, games: g, wins, streak, joined_at: ago(100 - i) }))
// ადგილები დასრულებულ ტურნირებში
for (const t of tournaments) {
  if (!t.finished_at) continue
  tplayers.filter((r) => r.tournament_id === t.id && r.games > 0).sort((a, b) => b.score - a.score || b.wins - a.wins)
    .forEach((r, i) => { r.place = i + 1 })
}
// pg_cron-ის იმიტაცია: დაწყება/დასრულება და შეტყობინებები
function demoTick() {
  const n = Date.now()
  let changed = 0
  for (const t of tournaments) {
    const mine = tplayers.find((r) => r.tournament_id === t.id && r.user_id === ME)
    if (!t.start_notified_at && Date.parse(t.starts_at) <= n && Date.parse(t.ends_at) > n) {
      t.start_notified_at = new Date().toISOString()
      if (mine) notifications.unshift({ id: nid('n'), type: 'tournament_start', actor_id: null, tournament_id: t.id, data: { title: t.title, game: t.type }, read: false, created_at: new Date().toISOString() })
      changed++
    }
    if (!t.finished_at && Date.parse(t.ends_at) <= n) {
      t.finished_at = new Date().toISOString()
      const played = tplayers.filter((r) => r.tournament_id === t.id && r.games > 0).sort((a, b) => b.score - a.score || b.wins - a.wins)
      played.forEach((r, i) => { r.place = i + 1 })
      if (mine?.place) {
        notifications.unshift({ id: nid('n'), type: 'tournament_end', actor_id: played[0].user_id, tournament_id: t.id,
          data: { title: t.title, game: t.type, place: mine.place, players: played.length, score: mine.score }, read: false, created_at: new Date().toISOString() })
      }
      changed++
    }
  }
  if (changed) { emit('notif', null); tournaments.forEach((t) => emit(`tour:${t.id}`)) }
  return changed
}
if (typeof setInterval !== 'undefined') setInterval(demoTick, 15_000)
const standings = (tid) => tplayers.filter((r) => r.tournament_id === tid)
  .sort((a, b) => b.score - a.score || b.wins - a.wins || a.joined_at.localeCompare(b.joined_at))
  .map((r) => ({ ...r, p: person(r.user_id) }))
function arenaScore(g) {
  const t = tournaments.find((x) => x.id === g.tournament_id)
  if (!t || g.created_at >= t.ends_at) return
  for (const u of [g.player_a, g.player_b]) {
    let r = tplayers.find((x) => x.tournament_id === t.id && x.user_id === u)
    if (!r) { r = { tournament_id: t.id, user_id: u, score: 0, games: 0, wins: 0, streak: 0, joined_at: new Date().toISOString() }; tplayers.push(r) }
    if (!g.winner) { r.score += r.streak >= 2 ? 2 : 1; r.streak = 0 } else if (g.winner === u) { r.score += r.streak >= 2 ? 4 : 2; r.wins++; r.streak++ } else r.streak = 0
    r.games++
  }
  emit(`tour:${t.id}`)
}

// ---- მოვლენები (Realtime-ის იმიტაცია)
const listeners = new Map()
const on = (key, cb) => {
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key).add(cb)
  return () => listeners.get(key)?.delete(cb)
}
const emit = (key, payload, extra) => listeners.get(key)?.forEach((cb) => cb(payload, extra))

const demoSession = { on: true }
const demoMfa = { enabled: false, verified: true }
// მოწვევა მხოლოდ ერთხელ და მხოლოდ ახალ ანგარიშზე (როგორც claim_invite სერვერზე)
const demoInvite = { fresh: false, by: null }
const bannedWords = ['კაზინო']
// შეცდომების ჟურნალის მაგალითები (ახალი ჩანაწერები ზემოთ)
const clientErrors = [
  ...[12, 40, 95].map((m, i) => ({ message: 'PGRST200: Could not find a relationship between \'posts\' and \'posts\' in the schema cache', stack: 'Searched for a foreign key relationship between \'posts\' and \'posts\' using the hint \'posts_quote_id_fkey\'',
    path: '/', source: 'api', release: 'e55ab27', agent: 'Mozilla/5.0 (Linux; Android 14; 23090RA98G) Chrome/129.0 Mobile Safari/537.36', user_id: `u${i % 2}`, created_at: ago(m) })),
  { message: 'Failed to fetch dynamically imported module: https://ezo-ten.vercel.app/assets/Inbox-Bx3k9.js', stack: null, path: '/inbox', source: 'chunk', release: '48b99a1',
    agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', user_id: 'u2', created_at: ago(60 * 26) },
]
const pushOn = { value: false }
const reports = [
  { id: 'rp1', reporter_id: 'u3', target_post: 'p7', target_user: null, category: 'spam', reason: 'რეკლამა', status: 'open', created_at: ago(30) },
  { id: 'rp2', reporter_id: 'u5', target_post: 'p7', target_user: null, category: 'spam', reason: '', status: 'open', created_at: ago(55) },
  { id: 'rp3', reporter_id: 'u1', target_post: null, target_user: 'u7', category: 'fake', reason: 'სხვისი ფოტოებია', status: 'open', created_at: ago(140) },
  { id: 'rp4', reporter_id: 'u2', target_post: null, target_user: 'u3', target_listing: 'l9', category: 'fake', reason: 'ყალბი ბოტასებია, ფოტო ინტერნეტიდანაა', status: 'open', created_at: ago(75) },
]
const reportKey = (r) => (r.target_post ? `p:${r.target_post}` : r.target_listing ? `l:${r.target_listing}` : `u:${r.target_user}`)
function adminList(status) {
  const seen = new Map()
  for (const r of reports.filter((x) => x.status === status)) {
    const key = reportKey(r)
    if (!seen.has(key)) seen.set(key, { ...r, reports_count: 0 })
    seen.get(key).reports_count++
  }
  return [...seen.values()].map((r) => {
    const post = r.target_post ? posts.find((p) => p.id === r.target_post) : null
    const listing = r.target_listing ? market.listings.find((l) => l.id === r.target_listing) : null
    const target = profiles.get(r.target_user || post?.author_id || listing?.seller_id)
    return {
      ...r, reporter: person(r.reporter_id),
      target_user: target && { ...person(target.id), banned_until: target.banned_until, role: target.role },
      target_post: post && { id: post.id, body: post.body, media: post.media, hidden: Boolean(post.hidden), kind: post.kind, created_at: post.created_at },
      target_listing: listing && { id: listing.id, title: listing.title, price: listing.price, currency: listing.currency, photo: listing.photos[0] || null, description: listing.description.slice(0, 300), hidden: listing.hidden, created_at: listing.created_at },
    }
  })
}
const MARKET_REPLIES = ['კი, ჯერ იყიდება 🙂 როდის გინდა ნახვა?', 'გამარჯობა! კი, ხელმისაწვდომია. ფასზე ცოტას დაგიკლებ', 'სამწუხაროდ უკვე ვიღაცამ დაჯავშნა, თუ გადაიფიქრა მოგწერ']
const REPLIES = ['😄', 'მართლა?', 'კარგი, ვნახოთ', 'აუცილებლად!', 'ახლა ვერ ვლაპარაკობ, მერე მოგწერ', 'ნარდზე ხომ არ წამოხვალ?']

function rankForYou(list) {
  const h = (p) => (Date.now() - new Date(p.created_at).getTime()) / 3600000
  return [...list].sort((a, b) => (b.like_count * 2 + b.reply_count * 3 + 1) / Math.pow(h(b) + 2, 1.4) -
    (a.like_count * 2 + a.reply_count * 3 + 1) / Math.pow(h(a) + 2, 1.4))
}

const rewards = demoRewards({
  ME, person, nid, ago, notifications, emit,
  isFollowing: (id) => follows.has(`${ME}>${id}`),
  metrics: () => {
    const mine = posts.filter((p) => p.author_id === ME)
    const st = [...stats.entries()].filter(([k]) => k.startsWith('me:')).map(([, v]) => v)
    return {
      posts: mine.filter((p) => !p.parent_id).length,
      likes: mine.reduce((n, p) => n + (p.like_count || 0), 0),
      followers: [...follows].filter((f) => f.endsWith(`>${ME}`)).length,
      games: st.reduce((n, s) => n + s.wins + s.losses + s.draws, 0),
      wins: st.reduce((n, s) => n + s.wins, 0),
      tourney: tplayers.filter((r) => r.user_id === ME && r.place === 1).length,
      gifts: gifts.filter((g) => g.from_id === ME).length,
    }
  },
})
const market = demoMarket({ ME, person, profiles, nid, ago, wait, notifications, emit, onSale: (id) => rewards.award('sale', 10, 5, id) })

export const api = {
  demo: true,
  ...market.methods,
  ...rewards.methods,

  // დემოში გასვლა/შესვლა მუშაობს, რომ ავტორიზაციის ეკრანიც ჩანდეს
  async session() { return demoSession.on ? { user: { id: ME } } : null },
  onAuth(cb) { return on('auth', cb) },
  async signUp() { demoSession.on = true; demoInvite.fresh = true; emit('auth', { user: { id: ME } }, 'SIGNED_IN'); return { needsConfirm: false } },
  async signInWithGoogle() { demoSession.on = true; emit('auth', { user: { id: ME } }, 'SIGNED_IN') },
  async updatePassword() {},
  async signIn() { demoSession.on = true; demoMfa.verified = false; emit('auth', { user: { id: ME } }) },
  async resetPassword() {},
  async signOut() { demoSession.on = false; emit('auth', null) },

  // ---- გაზიარება, მოწვევა, 2FA, ჩემი მონაცემები (დემო)
  async ogPreview(kind, key) {
    const p = [...profiles.values()].find((x) => x.username === key)
    if (!p || !['u', 'i'].includes(kind)) return null
    return { title: kind === 'i' ? `${p.full_name} გეპატიჟება ეზოში` : p.full_name, description: p.bio, image: p.avatar_url, name: p.full_name, username: p.username }
  },
  async claimInvite(username) {
    const p = [...profiles.values()].find((x) => x.username === username)
    if (!p || p.id === ME) return { ok: false, reason: 'unknown' }
    if (!demoInvite.fresh || demoInvite.by) return { ok: false, reason: 'old' }
    demoInvite.by = p.id
    follows.add(`${ME}>${p.id}`)
    follows.add(`${p.id}>${ME}`)
    recount()
    rewards.award('invited', 0, 10, 'invited')
    return { ok: true, inviter: p.username }
  },
  async inviteStats() { return { count: 3, recent: ['u1', 'u3', 'u6'].map(person) } },
  async mfaState() { return { enabled: demoMfa.enabled, factorId: demoMfa.enabled ? 'demo-factor' : null, needsCode: demoMfa.enabled && !demoMfa.verified } },
  async mfaEnroll() {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    const secret = Array.from({ length: 32 }, () => abc[Math.floor(Math.random() * 32)]).join('')
    const u = profiles.get(ME).username
    return { factorId: 'demo-factor', qr: null, secret, uri: `otpauth://totp/${encodeURIComponent(`ეზო:${u}`)}?secret=${secret}&issuer=${encodeURIComponent('ეზო')}` }
  },
  async mfaVerify(factorId, code) {
    await wait(300)
    if (!/^\d{6}$/.test(code)) throw new Error('კოდი არასწორია ან ვადა გაუვიდა')
    demoMfa.enabled = true
    demoMfa.verified = true
  },
  async mfaVerifyLogin(code) {
    await wait(300)
    if (!/^\d{6}$/.test(code)) throw new Error('კოდი არასწორია ან ვადა გაუვიდა')
    demoMfa.verified = true
    emit('auth', { user: { id: ME } }, 'MFA_CHALLENGE_VERIFIED')
  },
  async mfaDisable() { demoMfa.enabled = false },
  async exportMyData() {
    await wait(300)
    const me = profiles.get(ME)
    return {
      exported_at: new Date().toISOString(), profile: { ...me },
      posts: posts.filter((p) => p.author_id === ME).map(({ id, body, media, kind, parent_id, created_at }) => ({ id, body, media, kind, parent_id, created_at })),
      following: [...follows].filter((f) => f.startsWith(`${ME}>`)).map((f) => profiles.get(f.split('>')[1])?.username),
      followers: [...follows].filter((f) => f.endsWith(`>${ME}`)).map((f) => profiles.get(f.split('>')[0])?.username),
      listings: market.listings.filter((l) => l.seller_id === ME),
      gifts_sent: gifts.filter((g) => g.from_id === ME),
    }
  },
  async deleteMyAccount() { await wait(400); demoSession.on = false; emit('auth', null) },
  async bannedWords() { return bannedWords.map((word) => ({ word, created_at: ago(60) })) },
  async addBannedWord(w) { const x = w.trim().toLowerCase(); if (x.length < 2) throw new Error('ძალიან მოკლეა'); if (!bannedWords.includes(x)) bannedWords.unshift(x) },
  async removeBannedWord(w) { const i = bannedWords.indexOf(w); if (i >= 0) bannedWords.splice(i, 1) },

  async profile(id) { await wait(); return { ...profiles.get(id) } },
  async profileByUsername(u) { await wait(); const p = [...profiles.values()].find((x) => x.username === u); return p ? { ...p } : null },
  async usernameFree(u) { return ![...profiles.values()].some((x) => x.username === u && x.id !== ME) },
  async updateProfile(patch) {
    const p = profiles.get(ME)
    const wasPrivate = p.is_private
    Object.assign(p, patch)
    if (wasPrivate && p.is_private === false) {
      for (const r of followRequests.filter((x) => x.target_id === ME)) follows.add(`${r.requester_id}>${ME}`)
      for (let i = followRequests.length - 1; i >= 0; i--) if (followRequests[i].target_id === ME) followRequests.splice(i, 1)
      recount()
    }
    if (!wasPrivate && p.is_private) {
      // დემო: დახურვის შემდეგ ვიღაც თხოვნას გამოგიგზავნის
      setTimeout(() => {
        if (!profiles.get(ME).is_private || follows.has(`u7>${ME}`)) return
        followRequests.push({ requester_id: 'u7', target_id: ME, created_at: new Date().toISOString() })
        notifications.unshift({ id: nid('n'), type: 'follow_request', actor_id: 'u7', read: false, created_at: new Date().toISOString() })
        emit('notif', null)
      }, 2500)
    }
    return { ...p }
  },
  async touch() {},

  async upload(file) {
    return await new Promise((res) => {
      const r = new FileReader()
      r.onload = () => res(r.result)
      r.readAsDataURL(file)
    })
  },

  async feed(mode, cursor) {
    await wait(250)
    let list = posts.filter((p) => !p.parent_id && p.kind === 'post' && !p.hidden && canSee(p.group_id) && visiblePost(p))
    if (mode === 'following') {
      list = list.filter((p) => p.author_id === ME || follows.has(`${ME}>${p.author_id}`) || memberOf(p.group_id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    } else list = rankForYou(list)
    return { posts: list.map(enrich), next: cursor ? null : null }
  },
  async reels() { await wait(200); return rankForYou(posts.filter((p) => p.kind === 'reel' && visiblePost(p))).map(enrich) },
  async explore() { await wait(200); return rankForYou(posts.filter((p) => !p.parent_id && p.media.length && canSee(p.group_id) && visiblePost(p))).map(enrich) },
  async post(id) { return enrich(posts.find((p) => p.id === id)) },
  async thread(id) {
    await wait(150)
    const post = posts.find((p) => p.id === id)
    if (!post) return null
    const desc = posts.filter((p) => p.parent_id === id || (post.root_id === null && p.root_id === id))
    return { post: enrich(post), parent: enrich(posts.find((p) => p.id === post.parent_id)), replies: desc.map(enrich) }
  },
  async createPost({ body = '', media = [], kind = 'post', parent_id = null, quote_id = null, group_id = null, poll = null }) {
    if (bannedWords.some((w) => body.toLowerCase().includes(w))) throw new Error('ტექსტი შეიცავს აკრძალულ სიტყვას')
    const parent = parent_id && posts.find((p) => p.id === parent_id)
    const p = {
      id: nid('p'), author_id: ME, body, media, kind: parent ? 'post' : kind, parent_id, quote_id, group_id, hashtags: tagsOf(body),
      root_id: parent ? parent.root_id || parent.id : null, like_count: 0, reply_count: 0, repost_count: 0, created_at: new Date().toISOString(),
    }
    posts.unshift(p)
    if (poll) polls.set(p.id, { post_id: p.id, options: poll.options, multi: Boolean(poll.multi), closes_at: new Date(Date.now() + (poll.days || 1) * 864e5).toISOString(), votes: poll.options.map(() => 0), mine: [] })
    if (parent) parent.reply_count++
    if (quote_id) posts.find((x) => x.id === quote_id).repost_count++
    recount()
    rewards.award(parent ? 'reply' : 'post', parent ? 2 : 5, 0)
    return enrich(p)
  },
  async deletePost(id) {
    const i = posts.findIndex((p) => p.id === id)
    if (i >= 0) posts.splice(i, 1)
    recount()
  },
  async like(postId, isOn) {
    const k = `${ME}>${postId}`
    const p = posts.find((x) => x.id === postId)
    if (isOn && !likes.has(k)) { likes.add(k); p.like_count++ }
    if (!isOn && likes.has(k)) { likes.delete(k); p.like_count-- }
  },
  async votePoll(postId, options) {
    await wait(150)
    const x = polls.get(postId)
    if (Date.parse(x.closes_at) <= Date.now()) throw new Error('გამოკითხვა დასრულებულია')
    if (!x.multi && options.length > 1) throw new Error('მხოლოდ ერთი პასუხი')
    x.mine = [...new Set(options)]
    return pollView({ id: postId })
  },
  async save(postId, on, collectionId = null) {
    const i = saves.findIndex((s) => s.post_id === postId)
    if (i >= 0) saves.splice(i, 1)
    if (on) saves.unshift({ post_id: postId, collection_id: collectionId, created_at: new Date().toISOString() })
  },
  async saved(collectionId = null) {
    await wait(120)
    return saves.filter((s) => !collectionId || s.collection_id === collectionId).map((s) => enrich(posts.find((p) => p.id === s.post_id))).filter(Boolean)
  },
  async collections() { return collections.map((c) => ({ ...c, count: saves.filter((s) => s.collection_id === c.id).length })) },
  async createCollection(name) { const c = { id: nid('col'), owner_id: ME, name: name.trim(), created_at: new Date().toISOString() }; collections.push(c); return c },
  async deleteCollection(id) {
    const i = collections.findIndex((c) => c.id === id)
    if (i >= 0) collections.splice(i, 1)
    saves.forEach((s) => { if (s.collection_id === id) s.collection_id = null })
  },
  async userPosts(userId, tab = 'posts') {
    await wait(150)
    if (!canSeeAuthor(userId)) return tab === 'replies' ? posts.filter((p) => p.author_id === userId && p.parent_id).map(enrich) : []
    let list = posts.filter((p) => p.author_id === userId)
    if (tab === 'replies') list = list.filter((p) => p.parent_id)
    else {
      list = list.filter((p) => !p.parent_id)
      if (tab === 'reels') list = list.filter((p) => p.kind === 'reel')
      else if (tab === 'media') list = list.filter((p) => p.media.length)
      else list = list.filter((p) => p.kind === 'post')
    }
    return list.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(enrich)
  },

  async relation(id) {
    return {
      following: follows.has(`${ME}>${id}`), followedBy: follows.has(`${id}>${ME}`),
      requested: followRequests.some((r) => r.requester_id === ME && r.target_id === id), closeFriend: closeFriendsSet.has(id),
    }
  },
  async follow(id, isOn) {
    if (!isOn) {
      follows.delete(`${ME}>${id}`)
      const i = followRequests.findIndex((r) => r.requester_id === ME && r.target_id === id)
      if (i >= 0) followRequests.splice(i, 1)
      recount()
      return 'none'
    }
    if (profiles.get(id)?.is_private) {
      if (!followRequests.some((r) => r.requester_id === ME && r.target_id === id)) {
        followRequests.push({ requester_id: ME, target_id: id, created_at: new Date().toISOString() })
        // დემო: 4 წამში დაგიდასტურებს
        setTimeout(() => {
          const i = followRequests.findIndex((r) => r.requester_id === ME && r.target_id === id)
          if (i < 0) return
          followRequests.splice(i, 1)
          follows.add(`${ME}>${id}`)
          recount()
          notifications.unshift({ id: nid('n'), type: 'follow_accept', actor_id: id, read: false, created_at: new Date().toISOString() })
          emit('notif', null)
        }, 4000)
      }
      return 'requested'
    }
    follows.add(`${ME}>${id}`)
    recount()
    return 'following'
  },
  async followRequests() {
    return followRequests.filter((r) => r.target_id === ME).map((r) => ({ ...person(r.requester_id), bio: profiles.get(r.requester_id).bio, requested_at: r.created_at }))
  },
  async respondRequest(userId, accept) {
    const i = followRequests.findIndex((r) => r.requester_id === userId && r.target_id === ME)
    if (i < 0) return
    followRequests.splice(i, 1)
    const n = notifications.findIndex((x) => x.type === 'follow_request' && x.actor_id === userId)
    if (n >= 0) notifications.splice(n, 1)
    if (accept) { follows.add(`${userId}>${ME}`); recount() }
    emit('notif', null)
  },
  async closeFriends() { return [...closeFriendsSet].map(person) },
  async setCloseFriend(id, on) { if (on) closeFriendsSet.add(id); else closeFriendsSet.delete(id) },
  async followList(id, which) {
    const ids = [...follows].filter((f) => (which === 'followers' ? f.endsWith(`>${id}`) : f.startsWith(`${id}>`)))
      .map((f) => (which === 'followers' ? f.split('>')[0] : f.split('>')[1]))
    return ids.map((x) => ({ ...person(x), bio: profiles.get(x).bio }))
  },
  async search(q) {
    await wait(120)
    const t = q.trim().toLowerCase()
    if (!t) return []
    return [...profiles.values()].filter((p) => p.username.includes(t) || p.full_name.toLowerCase().includes(t))
  },
  async classmates({ school, year, city }) {
    await wait(150)
    return [...profiles.values()].filter((p) => p.id !== ME &&
      (!school || p.school.toLowerCase().includes(school.toLowerCase().trim())) &&
      (!year || p.grad_year === Number(year)) &&
      (!city || p.city.includes(city.trim())))
  },
  async suggested() {
    return [...profiles.values()].filter((p) => p.id !== ME && !follows.has(`${ME}>${p.id}`))
  },

  async stories() {
    await wait(100)
    const n = Date.now()
    return groupStories(stories.filter((s) => Date.parse(s.expires_at) > n && canSeeAuthor(s.author_id)
      && (s.audience === 'all' || s.author_id === ME || (s.author_id === 'u5' && theirCloseFriends.has('u5'))))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((s) => ({ ...s, author: person(s.author_id) })), ME)
  },
  async createStory(file, caption = '', audience = 'all') {
    const url = await this.upload(file)
    stories.push({ id: nid('s'), author_id: ME, media_url: url, media_type: file.type.startsWith('video') ? 'video' : 'image', caption, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 864e5).toISOString(), seen: true, audience })
  },
  async storyArchive() { return stories.filter((s) => s.author_id === ME).sort((a, b) => b.created_at.localeCompare(a.created_at)) },
  async highlights(userId) { await wait(80); return canSeeAuthor(userId) ? highlights.filter((h) => h.owner_id === userId) : [] },
  async createHighlight(title, storyIds) {
    const items = stories.filter((s) => storyIds.includes(s.id) && s.author_id === ME && s.audience === 'all')
    if (!items.length) throw new Error('აირჩიე საჯარო სთორი')
    const id = nid('h')
    highlights.push({ id, owner_id: ME, title: title.trim(), created_at: new Date().toISOString(), cover_url: items[0].media_url,
      items: items.map((s, i) => ({ id: `${id}i${i}`, highlight_id: id, media_url: s.media_url, media_type: s.media_type, caption: s.caption, created_at: s.created_at })) })
    return id
  },
  async deleteHighlight(id) { const i = highlights.findIndex((h) => h.id === id); if (i >= 0) highlights.splice(i, 1) },
  async storyViewers(id) {
    await wait(120)
    return storyViews.filter(([s]) => s === id).map(([, u, min]) => ({ ...person(u), viewed_at: ago(min) }))
  },
  async deleteStory(id) { const i = stories.findIndex((x) => x.id === id); if (i >= 0) stories.splice(i, 1) },
  async viewStory(id) { const s = stories.find((x) => x.id === id); if (s) s.seen = true },

  async visit() {},
  async guests() { return visits.map(([id, min]) => ({ ...person(id), visited_at: ago(min) })) },
  async sendGift(to, kind, note) {
    const freeToday = gifts.filter((g) => g.from_id === ME && !GIFT_PRICES[g.kind] && Date.now() - Date.parse(g.created_at) < 864e5).length
    rewards.payForGift(kind, freeToday)
    gifts.unshift({ id: nid('g'), from_id: ME, to_id: to, kind, note, created_at: new Date().toISOString() })
    rewards.checkBadges()
  },
  async gifts(userId) { return gifts.filter((g) => g.to_id === userId).map((g) => ({ ...g, from: person(g.from_id) })) },

  async notifications() {
    await wait(150)
    return notifications.map((n) => ({
      ...n, actor: person(n.actor_id), post: n.post_id ? posts.find((p) => p.id === n.post_id) : null,
      group: n.group_id ? groups.find((g) => g.id === n.group_id) : null, event: n.event_id ? events.find((e) => e.id === n.event_id) : null,
      tournament: n.tournament_id ? tournaments.find((t) => t.id === n.tournament_id) || null : null,
    })).sort((a, b) => b.created_at.localeCompare(a.created_at))
  },
  async markNotificationsRead() { notifications.forEach((n) => { n.read = true }); emit('notif', null) },
  async unreadCounts() {
    const list = await this.conversations()
    return { notifications: notifications.filter((n) => !n.read).length, messages: list.filter((c) => c.unread).length }
  },
  subscribeNotifications(cb) { return on('notif', cb) },

  async conversations() {
    return [...conversations.values()].filter((c) => c.members.includes(ME)).map((c) => {
      const list = messages.get(c.id)
      const last = list[list.length - 1]
      const others = c.members.filter((u) => u !== ME)
      return {
        id: c.id, kind: c.kind, updated_at: last?.created_at || ago(0),
        last_message: last ? lastText(last) : null,
        last_sender: last?.sender_id, last_sender_name: last ? profiles.get(last.sender_id)?.full_name.split(' ')[0] : null,
        unread: Boolean(last && last.sender_id !== ME && last.created_at > c.read_at),
        other: c.kind === 'group' ? null : person(others[0]),
        title: c.title || null, avatar_url: null, my_role: c.kind === 'group' && c.members[0] === ME ? 'admin' : 'member',
        members_count: c.members.length, members: others.slice(0, 3).map(person),
      }
    }).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  },
  async openDM(userId) {
    const found = [...conversations.values()].find((c) => c.kind !== 'group' && c.members.includes(userId) && c.members.includes(ME))
    if (found) return found.id
    const id = nid('c')
    conversations.set(id, { id, kind: 'dm', other: userId, members: [ME, userId], read_at: new Date().toISOString() })
    messages.set(id, [])
    return id
  },
  async conversation(id) { return (await this.conversations()).find((c) => c.id === id) || null },
  async messages(id) { await wait(100); return (messages.get(id) || []).map(msgView) },
  async send(convId, { body = '', media_url = null, media_type = null, reply_to = null, meta = {} }) {
    const m = { id: nid('m'), conversation_id: convId, sender_id: ME, body, media_url, media_type, reply_to, meta, deleted_at: null, created_at: new Date().toISOString() }
    messages.get(convId).push(m)
    emit(`conv:${convId}`, { kind: 'message:new', row: m })
    emit('notif', null)
    const c = conversations.get(convId)
    const replier = c.members.filter((u) => u !== ME)[Math.floor(Math.random() * (c.members.length - 1))]
    setTimeout(() => emit(`typing:${convId}`, true), 600)
    setTimeout(() => {
      const pool = meta?.listing ? MARKET_REPLIES : REPLIES
      const r = { id: nid('m'), conversation_id: convId, sender_id: replier, body: pool[Math.floor(Math.random() * pool.length)], media_url: null, media_type: null, reply_to: null, meta: {}, deleted_at: null, created_at: new Date().toISOString() }
      messages.get(convId).push(r)
      emit(`typing:${convId}`, false)
      emit(`conv:${convId}`, { kind: 'message:new', row: r })
      emit('notif', null)
      // ზოგჯერ რეაქციაც
      if (Math.random() < 0.5) {
        reactions.push({ message_id: m.id, user_id: replier, emoji: '❤️' })
        emit(`conv:${convId}`, { kind: 'reaction:set', row: { message_id: m.id, user_id: replier, emoji: '❤️' } })
      }
    }, 1900)
    return msgView(m)
  },
  subscribeMessages(convId, cb) { return on(`conv:${convId}`, cb) },
  async react(messageId, emoji) {
    const i = reactions.findIndex((r) => r.message_id === messageId && r.user_id === ME)
    if (i >= 0) reactions.splice(i, 1)
    if (emoji) reactions.push({ message_id: messageId, user_id: ME, emoji })
  },
  async deleteMessage(id) {
    for (const list of messages.values()) {
      const m = list.find((x) => x.id === id && x.sender_id === ME)
      if (m) { Object.assign(m, { body: '', media_url: null, media_type: null, meta: {}, deleted_at: new Date().toISOString() }); return }
    }
    throw new Error('მესიჯის წაშლა ვერ მოხერხდა')
  },
  async createGroupChat(title, memberIds) {
    const id = nid('c')
    conversations.set(id, { id, kind: 'group', title, members: [ME, ...memberIds], read_at: new Date().toISOString() })
    messages.set(id, [{ id: nid('m'), conversation_id: id, sender_id: ME, body: `შექმნა ჩატი „${title}“`, meta: { system: true }, media_url: null, media_type: null, reply_to: null, deleted_at: null, created_at: new Date().toISOString() }])
    return id
  },
  async chatMembers(convId) {
    const c = conversations.get(convId)
    return c.members.map((u, i) => ({ ...person(u), role: i === 0 ? 'admin' : 'member' }))
  },
  async addChatMembers(convId, ids) {
    const c = conversations.get(convId)
    for (const u of ids) if (!c.members.includes(u)) c.members.push(u)
    await this.send(convId, { body: `დაამატა: ${ids.map((u) => profiles.get(u)?.full_name.split(' ')[0]).join(', ')}`, meta: { system: true } })
  },
  async leaveChat(convId) { const c = conversations.get(convId); c.members = c.members.filter((u) => u !== ME) },
  async renameChat(convId, title) { conversations.get(convId).title = title },

  async startCall(convId, calleeId, kind) {
    const call = { id: nid('call'), conversation_id: convId, caller_id: ME, callee_id: calleeId, kind, status: 'ringing', created_at: new Date().toISOString() }
    calls.set(call.id, call)
    present.delete(calleeId)
    bc?.postMessage({ t: 'who' })
    await wait(350)
    if (present.has(calleeId)) bc.postMessage({ t: 'call-invite', call })
    else call.simulated = true
    return call
  },
  async updateCall(id, status) {
    const c = calls.get(id)
    if (!c) return
    c.status = status
    if (status === 'accepted') c.answered_at = new Date().toISOString()
    bc?.postMessage({ t: 'call-update', call: { id, status } })
    if (['ended', 'missed', 'declined', 'busy'].includes(status) && c.caller_id === ME) {
      const dur = c.answered_at ? Math.round((Date.now() - new Date(c.answered_at)) / 1000) : 0
      const st = status === 'ended' && !c.answered_at ? 'missed' : status
      const m = { id: nid('m'), conversation_id: c.conversation_id, sender_id: c.caller_id, body: '', media_url: null, media_type: null, reply_to: null, deleted_at: null, meta: { call: { id, kind: c.kind, status: st, duration: dur } }, created_at: new Date().toISOString() }
      messages.get(c.conversation_id)?.push(m)
      emit(`conv:${c.conversation_id}`, { kind: 'message:new', row: m })
    }
  },
  onIncomingCall(cb) { return on('incoming-call', cb) },
  onCallChange(id, cb) { return on(`call:${id}`, cb) },
  async callChannel(id) {
    return {
      send: (type, payload) => bc?.postMessage({ t: 'sig', id, msg: { type, payload } }),
      onMessage: (h) => on(`sig:${id}`, h),
      close: () => {},
    }
  },
  subscribeTyping(convId, cb) { return on(`typing:${convId}`, cb) },
  sendTyping() {},
  async markRead(convId) { const c = conversations.get(convId); if (c) c.read_at = new Date().toISOString(); emit('notif', null) },

  async datingProfile() { return dating.profile },
  async saveDatingProfile(data) { dating.profile = { ...data, user_id: ME }; return dating.profile },
  async candidates() {
    await wait(200)
    const pref = dating.profile?.looking_for || 'everyone'
    return datingPool.filter((d) => !dating.swipes.has(d[0]) && (pref === 'everyone' || pref === d[2])).map(card)
  },
  async nearby() {
    await wait(150)
    return datingPool.filter((d) => profiles.get(d[0]).city === (dating.profile?.city || 'თბილისი')).map(card)
  },
  async swipe(targetId, liked) {
    dating.swipes.set(targetId, liked)
    // დემოში ყოველი მეორე მოწონება ორმხრივია
    if (liked && [...dating.swipes.values()].filter(Boolean).length % 2 === 1) {
      const convId = await this.openDM(targetId)
      conversations.get(convId).kind = 'dating'
      const m = { id: nid('mt'), conversation_id: convId, created_at: new Date().toISOString(), uid: targetId }
      matchesList.unshift(m)
      return { match: { id: m.id, conversation_id: convId } }
    }
    return { match: null }
  },
  async matches() {
    return matchesList.map((m) => ({ id: m.id, conversation_id: m.conversation_id, created_at: m.created_at, other: card(datingPool.find((d) => d[0] === m.uid)) }))
  },

  async myGames() {
    return [...games.values()].filter((g) => ['waiting', 'active'].includes(g.status) && seatOfMe(g)).map(gameView)
  },
  async game(id) { return games.has(id) ? gameView(games.get(id)) : null },
  async createGame(type, invite, opts = {}) {
    if (seatsOf(type) > 2) return newTable(type, { mode: opts.mode, invites: opts.invites || (invite ? [invite] : []), isPublic: false }).id
    if (opts.tc && !['chess', 'checkers'].includes(type)) throw new Error('ასეთი დროის კონტროლი არ არის')
    return newGame(type, invite || 'u2', { tc: opts.tc }).id
  },
  async joinRandom(type, opts = {}) {
    await wait(200)
    if (seatsOf(type) > 2) {
      const open = [...games.values()].find((g) => g.type === type && g.status === 'waiting' && g.is_public && g.player_a === ME)
      return (open || newTable(type, { mode: opts.mode || 'quick', invites: [], isPublic: true })).id
    }
    if (opts.tournament) {
      const t = tournaments.find((x) => x.id === opts.tournament)
      const n = Date.now()
      if (n < Date.parse(t.starts_at)) throw new Error('ტურნირი ჯერ არ დაწყებულა')
      if (n >= Date.parse(t.ends_at)) throw new Error('ტურნირი დასრულდა')
      if (!tplayers.some((r) => r.tournament_id === t.id && r.user_id === ME)) throw new Error('ჯერ შეუერთდი ტურნირს')
      const active = [...games.values()].find((g) => g.tournament_id === t.id && g.status === 'active')
      if (active) return active.id
      const pool = tplayers.filter((r) => r.tournament_id === t.id && r.user_id !== ME).map((r) => r.user_id)
      return newGame(type, pool[Math.floor(Math.random() * pool.length)] || 'u2', { tc: t.tc, tournament: t.id }).id
    }
    const opponents = { nardi: 'u7', chess: 'u2', checkers: 'u7', domino: 'u3', longnardi: 'u4', durak: 'u6' }
    return newGame(type, opponents[type] || 'u2', { tc: opts.tc }).id
  },
  async joinGame(id) {
    const g = games.get(id)
    if (g && g.status === 'waiting' && (g.seats || 2) > 2 && !seatOfMe(g)) takeSeat(g, ME)
  },
  async startTable(id) {
    const g = games.get(id)
    if (!g || g.status !== 'waiting') throw new Error('თამაში უკვე დაწყებულია')
    g.bots = seatList(g).filter((s) => !g[`player_${s}`])
    activate(g)
  },
  async move(id, action, moveNo) {
    await wait(120)
    const g = games.get(id)
    const seat = seatOfMe(g)
    if (g.status !== 'active' || g.turn !== ME) throw new Error('შენი რიგი არ არის')
    if (typeof moveNo === 'number' && moveNo !== g.move_no) throw new Error('დაფა განახლდა — სცადე ხელახლა')
    if (tickClock(g, seat)) return { over: true }
    applyFull(g, applyAction(g.type, g.full, action))
    return { move_no: g.move_no }
  },
  async flag(id) {
    const g = games.get(id)
    if (!g?.clock || g.status !== 'active') return { ok: false }
    const c = g.clock
    if (c.at == null) {
      if (Date.now() - Date.parse(g.updated_at) < 60_000) throw new Error('პირველი სვლის დრო ჯერ არ ამოწურულა')
      g.status = 'cancelled'; g.result = 'abort'; g.turn = null; emit(`game:${id}`)
      return { ok: true }
    }
    const seat = GAMES[g.type].seatOf(g.full)
    if (c[seat] - (Date.now() - c.at) > 0) throw new Error('დრო ჯერ არ ამოწურულა')
    finishGame(g, seat === 'a' ? 'b' : 'a', 'timeout')
    emit(`game:${id}`)
    return { ok: true }
  },
  async resign(id) {
    const g = games.get(id)
    if (g.status === 'waiting') { g.status = 'cancelled'; emit(`game:${id}`); return }
    if ((g.seats || 2) > 2) {
      g.bots = [...g.bots, seatOfMe(g)]
      g.left = ME
      emit(`game:${id}`)
      scheduleBots(g)
      return
    }
    finishGame(g, g.player_a === ME ? 'b' : 'a', 'resign')
    emit(`game:${id}`)
  },
  subscribeGame(id, cb) { return on(`game:${id}`, cb) },
  async tick(id) {
    const g = games.get(id)
    if (!g || g.type !== 'loto' || g.status !== 'active' || !seatOfMe(g)) return { ok: false }
    if (!loto.due(g.full, Date.now())) return { ok: false }
    applyFull(g, loto.draw(g.full, Date.now()))
    return { ok: true, move_no: g.move_no }
  },
  async liveGames() {
    await wait(120)
    return [...games.values()].filter((g) => g.status === 'active' && g.is_public && !seatOfMe(g) && g.left !== ME).map(gameView)
  },
  async gameMessages(id) { await wait(80); return (gameMsgs.get(id) || []).slice(-40) },
  async sendGameMessage(id, kind, body) {
    const g = games.get(id)
    if (!g || g.status !== 'active') throw new Error('თამაში დასრულებულია')
    if (kind === 'text' && !seatOfMe(g)) throw new Error('ჩატი მხოლოდ მოთამაშეებისთვისაა')
    const recent = (gameMsgs.get(id) || []).filter((m) => m.user_id === ME && Date.now() - Date.parse(m.created_at) < 10_000)
    if (recent.length >= 8) throw new Error('ცოტა ნელა — ძალიან ხშირად წერ')
    pushGameMsg(id, ME, kind, body.trim())
    // მეტოქე ხანდახან პასუხობს
    const others = seatList(g).map((s) => g[`player_${s}`]).filter((u) => u && u !== ME && !(g.bots || []).includes(seatList(g).find((s) => g[`player_${s}`] === u)))
    if (others.length && Math.random() < 0.6) {
      setTimeout(() => {
        if (g.status !== 'active') return
        const u = others[Math.floor(Math.random() * others.length)]
        if (kind === 'text') pushGameMsg(id, u, 'text', ['ჰაჰა, ვნახოთ 😄', 'კარგი სვლა იყო', 'ახლა ჩემი რიგია!'][Math.floor(Math.random() * 3)])
        else pushGameMsg(id, u, 'emoji', ['😂', '🔥', '😮', '🤝'][Math.floor(Math.random() * 4)])
      }, 1300)
    }
  },
  subscribeGameMessages(id, cb) { return on(`gm:${id}`, cb) },
  watchGame(id, role, onCount) {
    const g = games.get(id)
    const n = g && !seatOfMe(g) ? 3 + (id.length % 5) : 0
    setTimeout(() => onCount(n), 300)
    // ყურებისას სხვა მაყურებლებიც რეაგირებენ
    const t = g && !seatOfMe(g) ? setInterval(() => {
      if (g.status !== 'active') return
      const u = ['u3', 'u5', 'u6', 'u1'][Math.floor(Math.random() * 4)]
      pushGameMsg(id, u, 'emoji', ['👍', '😮', '🔥', '😂'][Math.floor(Math.random() * 4)])
    }, 5200) : null
    return () => clearInterval(t)
  },
  async dailyPuzzle() {
    await wait(120)
    const { puzzleFor, tbilisiDate } = await import('../games/puzzles.js')
    const day = tbilisiDate()
    const p = puzzleFor(day)
    const r = puzzleState.get(day) || { solved: false, attempts: 0 }
    return { day, id: p.id, title: p.title, fen: p.fen, moves: Math.ceil(p.solution.length / 2), solved: r.solved, attempts: r.attempts,
      solution: r.solved ? p.solution : null, solvers: 37 + (r.solved ? 1 : 0) }
  },
  async puzzleMove(moves) {
    await wait(150)
    const { puzzleFor, tbilisiDate } = await import('../games/puzzles.js')
    const day = tbilisiDate()
    const p = puzzleFor(day)
    const n = moves.length
    if (!n || n % 2 === 0 || n > p.solution.length) throw new Error('არასწორი სვლა')
    const r = puzzleState.get(day) || { solved: false, attempts: 0 }
    puzzleState.set(day, r)
    if (moves.some((m, i) => m !== p.solution[i])) { if (!r.solved) r.attempts++; return { correct: false } }
    if (n === p.solution.length) {
      if (!r.solved) { r.solved = true; r.attempts++; rewards.award('puzzle', 15, 5, day) }
      return { correct: true, solved: true, attempts: r.attempts, solvers: 38 }
    }
    return { correct: true, solved: false, reply: p.solution[n] }
  },
  async stats(userId = ME) { return userId === ME ? [...stats.entries()].filter(([k]) => k.startsWith('me:')).map(([, v]) => v) : [] },
  async leaderboard(type) {
    const base = { nardi: 1320, chess: 1460, checkers: 1290, domino: 1250, longnardi: 1305, durak: 1270, joker: 1340 }[type] || 1250
    return ['u2', 'u7', 'u1', ME, 'u3', 'u5'].map((id, i) => ({
      user_id: id, type, rating: id === ME ? (stats.get(`me:${type}`)?.rating || 1200) : base - i * 37,
      wins: 30 - i * 4, losses: 10 + i, draws: 1, p: person(id),
    })).sort((a, b) => b.rating - a.rating)
  },

  async tournaments() {
    await wait(120)
    return tournaments.filter((t) => Date.parse(t.ends_at) > Date.now() - 7 * 864e5).map((t) => ({
      ...t, players_count: standings(t.id).length,
      winner: Date.parse(t.ends_at) <= Date.now() ? standings(t.id).find((r) => r.games > 0)?.p || null : null,
    }))
  },
  async tournament(id) { await wait(80); return tournaments.find((t) => t.id === id) || null },
  async tournamentStandings(id) { await wait(80); return standings(id) },
  async joinTournament(id) {
    const t = tournaments.find((x) => x.id === id)
    if (Date.parse(t.ends_at) <= Date.now()) throw new Error('ტურნირი დასრულდა')
    if (!tplayers.some((r) => r.tournament_id === id && r.user_id === ME)) {
      tplayers.push({ tournament_id: id, user_id: ME, score: 0, games: 0, wins: 0, streak: 0, joined_at: new Date().toISOString() })
    }
    emit(`tour:${id}`)
  },
  async leaveTournament(id) {
    const i = tplayers.findIndex((r) => r.tournament_id === id && r.user_id === ME && r.games === 0)
    if (i >= 0) tplayers.splice(i, 1)
    emit(`tour:${id}`)
  },
  async createTournament(data) {
    if (!['admin', 'moderator'].includes(profiles.get(ME)?.role)) throw new Error('ტურნირს ადმინი ქმნის')
    const t = { id: nid('t'), ...data, created_by: ME, created_at: new Date().toISOString() }
    tournaments.push(t)
    return t
  },
  subscribeTournament(id, cb) { return on(`tour:${id}`, cb) },
  async tournamentTick() { return demoTick() },
  async trophies(userId) {
    return tplayers.filter((r) => r.user_id === userId && r.place === 1)
      .map((r) => ({ place: 1, score: r.score, tournament: tournaments.find((t) => t.id === r.tournament_id) }))
  },

  async myGroups() { return memberships.filter((m) => m.user_id === ME).map((m) => groupView(groups.find((g) => g.id === m.group_id))) },
  async discoverGroups(q = '') {
    await wait(120)
    return groups.filter((g) => !q.trim() || g.name.toLowerCase().includes(q.trim().toLowerCase())).map(groupView).sort((a, b) => b.members_count - a.members_count)
  },
  async group(slug) { await wait(120); const g = groups.find((x) => x.slug === slug); return g ? groupView(g) : null },
  async slugFree(slug) { return !groups.some((g) => g.slug === slug) },
  async createGroup({ name, slug, description = '', privacy = 'public', cover_url = null }) {
    const g = { id: nid('g'), slug, name, description, privacy, cover_url, owner_id: ME, created_at: new Date().toISOString() }
    groups.unshift(g)
    memberships.push({ group_id: g.id, user_id: ME, role: 'owner', status: 'active' })
    return groupView(g)
  },
  async updateGroup(id, patch) { const g = groups.find((x) => x.id === id); Object.assign(g, patch); return groupView(g) },
  async deleteGroup(id) { const i = groups.findIndex((x) => x.id === id); if (i >= 0) groups.splice(i, 1) },
  async joinGroup(id) {
    const g = groups.find((x) => x.id === id)
    const status = g.privacy === 'public' ? 'active' : 'pending'
    if (!memberships.some((m) => m.group_id === id && m.user_id === ME)) memberships.push({ group_id: id, user_id: ME, role: 'member', status })
    return status
  },
  async leaveGroup(id) {
    if (groups.find((x) => x.id === id)?.owner_id === ME) throw new Error('მფლობელი ჯგუფს ვერ დატოვებს')
    const i = memberships.findIndex((m) => m.group_id === id && m.user_id === ME)
    if (i >= 0) memberships.splice(i, 1)
  },
  async groupPosts(id) {
    await wait(150)
    if (!canSee(id)) return []
    return posts.filter((p) => p.group_id === id && !p.parent_id).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(enrich)
  },
  async groupMembers(id) {
    const admin = ['owner', 'admin'].includes(memberships.find((m) => m.group_id === id && m.user_id === ME)?.role)
    return memberships.filter((m) => m.group_id === id && (m.status === 'active' || admin)).map((m) => ({ ...person(m.user_id), bio: profiles.get(m.user_id).bio, role: m.role, status: m.status }))
  },
  async manageMember(groupId, userId, action) {
    const i = memberships.findIndex((m) => m.group_id === groupId && m.user_id === userId)
    if (i < 0) return
    if (action === 'approve') memberships[i].status = 'active'
    if (action === 'remove') memberships.splice(i, 1)
    if (action === 'make_admin') memberships[i].role = 'admin'
    if (action === 'make_member') memberships[i].role = 'member'
  },
  async events({ scope = 'upcoming', groupId = null } = {}) {
    await wait(150)
    let list = events.filter((e) => canSee(e.group_id))
    if (scope === 'mine') list = list.filter((e) => e.host_id === ME || rsvps.some((r) => r.event_id === e.id && r.user_id === ME))
    else list = list.filter((e) => new Date(e.starts_at) > Date.now() - 6 * 3600e3 && (!groupId || e.group_id === groupId))
    return list.sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map(eventView)
  },
  async event(id) { await wait(120); const e = events.find((x) => x.id === id); return e && canSee(e.group_id) ? eventView(e) : null },
  async createEvent(data) {
    const e = { id: nid('e'), going_count: 0, interested_count: 0, created_at: new Date().toISOString(), ...data, host_id: ME }
    events.push(e)
    return eventView(e)
  },
  async updateEvent(id, patch) { const e = events.find((x) => x.id === id); Object.assign(e, patch); return eventView(e) },
  async deleteEvent(id) { const i = events.findIndex((x) => x.id === id); if (i >= 0) events.splice(i, 1) },
  async rsvp(eventId, status) {
    const i = rsvps.findIndex((r) => r.event_id === eventId && r.user_id === ME)
    if (i >= 0) rsvps.splice(i, 1)
    if (status) rsvps.push({ event_id: eventId, user_id: ME, status })
  },
  async attendees(eventId) { return rsvps.filter((r) => r.event_id === eventId).map((r) => ({ ...person(r.user_id), status: r.status })) },
  async tagPosts(tag) {
    await wait(150)
    const t = tag.replace(/^#/, '').toLowerCase()
    return posts.filter((p) => !p.parent_id && !p.hidden && canSee(p.group_id) && p.hashtags?.includes(t)).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(enrich)
  },
  async trendingTags() {
    const counts = new Map()
    for (const p of posts) if (!p.hidden && canSee(p.group_id)) for (const t of p.hashtags || []) counts.set(t, (counts.get(t) || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag, n]) => ({ tag, posts: n }))
  },

  async block() {},
  async report({ user = null, post = null, listing = null, category = 'other', reason = '' }) {
    reports.unshift({ id: nid('rp'), reporter_id: ME, target_user: user, target_post: post, target_listing: listing, category, reason, status: 'open', created_at: new Date().toISOString() })
  },

  async savePush() { pushOn.value = true },
  async deletePush() { pushOn.value = false },

  async adminStats() {
    return { users: profiles.size, new_users_7d: 3, posts_24h: posts.filter((p) => Date.now() - new Date(p.created_at) < 864e5).length,
      open_reports: adminList('open').length, banned: [...profiles.values()].filter((p) => p.banned_until).length, active_games: [...games.values()].filter((g) => g.status === 'active').length }
  },
  async adminReports(status = 'open') { await wait(150); return adminList(status) },
  async adminResolve(id, action, days = null, note = null) {
    const r = reports.find((x) => x.id === id)
    const key = reportKey(r)
    const li = r.target_listing ? market.listings.findIndex((l) => l.id === r.target_listing) : -1
    if (action === 'delete_listing' && li >= 0) market.listings.splice(li, 1)
    if (action === 'hide_listing' && li >= 0) market.listings[li].hidden = true
    if (action === 'delete_post') { const i = posts.findIndex((p) => p.id === r.target_post); if (i >= 0) posts.splice(i, 1) }
    if (action === 'hide_post') { const p = posts.find((x) => x.id === r.target_post); if (p) p.hidden = true }
    if (action === 'ban') await this.adminBan(r.target_user || posts.find((p) => p.id === r.target_post)?.author_id, days, note || r.category)
    reports.filter((x) => x.status === 'open' && reportKey(x) === key)
      .forEach((x) => { x.status = action === 'dismiss' ? 'dismissed' : 'resolved'; x.action = action })
  },
  async adminBan(userId, days = null, note = null) {
    const p = profiles.get(userId)
    if (p) { p.banned_until = days ? new Date(Date.now() + days * 864e5).toISOString() : 'infinity'; p.ban_reason = note }
  },
  async adminUnban(userId) { const p = profiles.get(userId); if (p) { p.banned_until = null; p.ban_reason = null } },

  async logError(e) { clientErrors.unshift({ ...e, user_id: ME, created_at: new Date().toISOString() }) },
  async adminErrors(days = 7) {
    await wait(120)
    const since = Date.now() - days * 864e5
    const groups = new Map()
    for (const e of clientErrors) {
      if (Date.parse(e.created_at) < since) continue
      const g = groups.get(e.message)
      if (g) { g.events++; g.ids.add(e.user_id); if (e.created_at < g.first_at) g.first_at = e.created_at; continue }
      groups.set(e.message, { message: e.message, source: e.source, events: 1, ids: new Set([e.user_id]), first_at: e.created_at, last_at: e.created_at,
        path: e.path, stack: e.stack, release: e.release, user_agent: e.agent })
    }
    return [...groups.values()].map(({ ids, ...g }) => ({ ...g, users: ids.size }))
  },
  async adminClearErrors(message) {
    const n = clientErrors.length
    for (let i = clientErrors.length - 1; i >= 0; i--) if (clientErrors[i].message === message) clientErrors.splice(i, 1)
    return n - clientErrors.length
  },
}

const seatList = (g) => SEAT_LETTERS.slice(0, g.seats || 2)
const seatOfMe = (g) => seatList(g).find((s) => g[`player_${s}`] === ME && !(g.bots || []).includes(s)) || null

function gameView(g) {
  const { full, ...rest } = g
  const seat = seatOfMe(g)
  const pub = g.status === 'finished' && g.type === 'domino' ? full : publicState(g.type, full)
  const mine = seat && g.status !== 'finished' ? handsOf(g.type, full)?.[seat] : null
  const view = { ...rest, state: withMyHand(g.type, pub, seat, mine) }
  for (const s of seatList(g)) view[s] = g[`player_${s}`] ? person(g[`player_${s}`]) : null
  return view
}

const baseGame = (type, extra) => ({
  id: nid('game'), type, status: 'active', is_public: true, seats: seatsOf(type), player_a: ME, player_b: null, player_c: null, player_d: null,
  invited: null, invites: [], bots: [], options: {}, tc: null, clock: null, tournament_id: null,
  winner: null, result: null, move_no: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra,
})

function newGame(type, opponent, { tc = null, tournament = null } = {}) {
  const TC = { '1+0': [1, 0], '3+0': [3, 0], '3+2': [3, 2], '5+0': [5, 0], '10+0': [10, 0] }[tc]
  const g = baseGame(type, {
    player_b: opponent, full: initFor(type), tc: TC ? tc : null, tournament_id: tournament,
    clock: TC ? { a: TC[0] * 60000, b: TC[0] * 60000, inc: TC[1] * 1000, at: null } : null,
  })
  g.turn = GAMES[type].seatOf(g.full) === 'a' ? ME : opponent
  games.set(g.id, g)
  scheduleBots(g)
  return g
}

// ჯოკერის მაგიდა: მოწვეულები დემოში თავისით „სხდებიან“
function newTable(type, { mode = 'quick', invites = [], isPublic }) {
  const g = baseGame(type, { status: 'waiting', is_public: isPublic, invites, options: { mode }, full: initFor(type, undefined, { mode }) })
  games.set(g.id, g)
  const arrivals = invites.length ? invites : isPublic ? ['u1', 'u5'] : []
  arrivals.slice(0, 3).forEach((u, i) => setTimeout(() => {
    if (g.status !== 'waiting') return
    takeSeat(g, u)
    emit(`game:${g.id}`)
  }, 1400 + i * 1300))
  return g
}

function takeSeat(g, u) {
  const free = ['b', 'c', 'd'].find((s) => !g[`player_${s}`])
  if (!free) throw new Error('მაგიდა სავსეა')
  g[`player_${free}`] = u
  g.move_no++
  if (['b', 'c', 'd'].every((s) => g[`player_${s}`])) activate(g)
}

function activate(g) {
  g.status = 'active'
  g.updated_at = new Date().toISOString()
  const seat = GAMES[g.type].seatOf(g.full)
  g.turn = g[`player_${seat}`]
  emit(`game:${g.id}`)
  scheduleBots(g)
}

function tickClock(g, seat) {
  const c = g.clock
  if (!c) return false
  const t = Date.now()
  if (c.at != null) {
    const left = c[seat] - (t - c.at)
    if (left <= 0) { finishGame(g, seat === 'a' ? 'b' : 'a', 'timeout'); emit(`game:${g.id}`); return true }
    c[seat] = left + c.inc
  }
  c.at = t
  return false
}

function applyFull(g, next) {
  g.full = next
  g.move_no++
  g.updated_at = new Date().toISOString()
  const o = outcome(g.type, next)
  if (o.over) finishGame(g, o.winner, o.result)
  else g.turn = g[`player_${GAMES[g.type].seatOf(next)}`] || null
  emit(`game:${g.id}`)
  scheduleBots(g)
}

const botSeat = (g) => {
  const seat = GAMES[g.type].seatOf(g.full)
  return seat && seat !== seatOfMe(g) ? seat : null
}

function scheduleBots(g) {
  if (g.status !== 'active' || !botSeat(g)) return
  const watched = !seatOfMe(g) && g.left !== ME // სხვების თამაში — უფრო ნელა, რომ ყურება საინტერესო იყოს
  const delay = watched ? 2200 + Math.random() * 1800 : g.clock ? 700 + Math.random() * 1600 : g.type === 'joker' ? 750 : 1000
  setTimeout(() => botTurn(g), delay)
}

function finishGame(g, winnerSeat, result) {
  g.status = 'finished'
  g.turn = null
  g.result = result
  g.winner = winnerSeat ? g[`player_${winnerSeat}`] || null : null
  const mine = seatOfMe(g) || (g.left === ME ? 'left' : null)
  if (g.tournament_id) arenaScore(g)
  if (!mine) return
  const k = `me:${g.type}`
  const s = stats.get(k) || { type: g.type, rating: 1200, wins: 0, losses: 0, draws: 0 }
  if (!winnerSeat) { s.draws++ } else if (winnerSeat === mine) { s.wins++; s.rating += 12 } else { s.losses++; s.rating -= 12 }
  stats.set(k, s)
}

function botTurn(g) {
  const seat = g.status === 'active' && botSeat(g)
  if (!seat) return
  if (tickClock(g, seat)) return
  applyFull(g, BOTS[g.type](g.full))
}

// ---- სხვების მიმდინარე თამაშები (ყურებისთვის): ორივე მხარეს კომპიუტერი თამაშობს
function seedLive(type, a, b, moves = 0) {
  const g = baseGame(type, { player_a: a, player_b: b, full: initFor(type), created_at: ago(9), updated_at: ago(1) })
  for (let i = 0; i < moves && !outcome(type, g.full).over; i++) g.full = BOTS[type](g.full)
  g.move_no = moves
  g.turn = g[`player_${GAMES[type].seatOf(g.full)}`] || null
  games.set(g.id, g)
  scheduleBots(g)
}
if (typeof window !== 'undefined') {
  seedLive('chess', 'u2', 'u7', 14)
  seedLive('nardi', 'u5', 'u1', 6)
  seedLive('bura', 'u4', 'u6', 3)
}
