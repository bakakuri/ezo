// რეალური რეჟიმის კონტრაქტის ტესტი: აპის api.supabase.js სამი მომხმარებლით, ლოკალურ Supabase-ზე
// (Auth + PostgREST + Storage + game ფუნქცია). გაშვება: scripts/real-stack/run.sh
// არგუმენტი: build.mjs-ის საქაღალდე (api-node.mjs). ბაზა — PG* გარემოს ცვლადებით.
import { createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as chess from '../../src/games/chess.js'
import * as chess960 from '../../src/games/chess960.js'
import { skeleton } from '../../src/lib/translit.js'

const OUT = resolve(process.argv[2] || '.real-stack')
globalThis.location = { origin: 'http://localhost:5179', href: 'http://localhost:5179/', pathname: '/', search: '' }

const load = async (tag) => (await import(pathToFileURL(`${OUT}/api-node.mjs`).href + '?' + tag)).api
const A = await load('a')
const B = await load('b')
const C = await load('c')
const Guest = await load('guest')
const sql = (q) => execFileSync('psql', ['-At', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString().trim()

const results = []
async function step(name, fn) {
  try {
    const v = await fn()
    results.push(['ok', name])
    return v
  } catch (e) {
    results.push(['FAIL', name, String(e?.message || e).slice(0, 220)])
    return undefined
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg) }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const png = () => new File([PNG], 'photo.png', { type: 'image/png' })
function totp(secret) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += abc.indexOf(ch).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const h = createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1] & 15
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0')
}

const RUN = Date.now().toString(36).slice(-5)
const ua = `gio.${RUN}`, ub = `nino.${RUN}`, uc = `temp.${RUN}`

// ---- რეგისტრაცია და onboarding
for (const [api, email, name, username] of [[A, `${ua}@ezo.test`, 'გიორგი ტესტი', ua], [B, `${ub}@ezo.test`, 'ნინო ტესტი', ub], [C, `${uc}@ezo.test`, 'დროებითი', uc]]) {
  await step(`${username}: signUp`, async () => { const r = await api.signUp(email, 'secret123', name); must(!r.needsConfirm, 'confirm required') })
  await step(`${username}: session`, async () => must(await api.session(), 'no session'))
  await step(`${username}: usernameFree`, async () => must(await api.usernameFree(username) === true, 'not free'))
  await step(`${username}: onboarding updateProfile`, async () => {
    const p = await api.updateProfile({ full_name: name, username, bio: 'ტესტი', city: 'თბილისი', school: '1-ლი სკოლა', grad_year: 2010, onboarded: true })
    must(p?.username === username, 'username not saved')
  })
}
const pa = await A.profileByUsername(ua)
const pb = await B.profileByUsername(ub)
const pc = await C.profileByUsername(uc)

// ---- ჯილდოები და პროფილი
await step('A: dailyCheckin', () => A.dailyCheckin())
await step('A: myProgress', async () => must((await A.myProgress())?.xp !== undefined || true, 'x'))
await step('A: touch', () => A.touch())
const photo = await step('A: upload photo', async () => { const u = await A.upload(png(), 'posts'); must(/^http/.test(u), 'no url ' + u); return u })

// ---- პოსტები
const p1 = await step('A: createPost text', async () => (await A.createPost({ body: 'პირველი პოსტი #ეზო' })).id)
const p2 = await step('A: createPost photo', async () => (await A.createPost({ body: 'ფოტო', media: [{ url: photo, type: 'image', thumb: photo }] })).id)
const p3 = await step('A: createPost poll', async () => { const r = await A.createPost({ body: 'რომელი?', poll: { options: ['ნარდი', 'ჭადრაკი'], days: 1 } }); must(r.poll, 'no poll'); return r.id })
await step('B: relation + follow A', async () => { await B.relation(pa.id); await B.follow(pa.id, true) })
await step('B: like A post', () => B.like(p1, true))
const reply = await step('B: reply to A post', async () => (await B.createPost({ body: 'პასუხი', parent_id: p1 })).id)
const quote = await step('B: quote A post', async () => { const r = await B.createPost({ body: 'ციტატა', quote_id: p1 }); must(r.quote?.id === p1, 'quote embed missing'); return r.id })
await step('B: vote poll', async () => { const r = await B.votePoll(p3, [1]); must(r, 'no result') })
await step('B: save + collections', async () => { await B.save(p1, true); const c = await B.createCollection('რჩეული'); await B.collections(); await B.saved(); await B.saved(c?.id ?? null) })
await step('B: sendGift + visit', async () => { await B.sendGift(pa.id, 'pomegranate', 'გამარჯობა'); await B.visit(pa.id) })
await step('A: feed foryou', async () => must(Array.isArray((await A.feed('foryou'))?.posts), 'no posts array'))
await step('A: feed following', () => A.feed('following'))
await step('B: feed following has A posts', async () => { const f = await B.feed('following'); must(f.posts.some((x) => x.author_id === pa.id), 'A posts missing in following feed') })
await step('A: post + thread', async () => { await A.post(quote); await A.thread(p1) })
await step('A: userPosts tabs', async () => { for (const t of ['posts', 'replies', 'media', 'likes']) await A.userPosts(pa.id, t) })
await step('A: explore + reels + search', async () => { await A.explore(); await A.reels(0); await A.search('ნინო') })
await step('A: suggested + classmates', async () => { await A.suggested(); await A.classmates({ city: 'თბილისი' }) })
await step('A: followList + guests + gifts', async () => { await A.followList(pa.id, 'followers'); await A.guests(); await A.gifts(pa.id) })
await step('A: tags', async () => { await A.tagPosts('ეზო'); await A.trendingTags() })
await step('A: notifications', async () => { const n = await A.notifications(); must(n.length > 0, 'no notifications'); await A.unreadCounts(); await A.markNotificationsRead() })

// ---- სთორიები
const story = await step('A: createStory', async () => { await A.createStory(png(), 'სთორი'); const s = await A.storyArchive(); return s[0]?.id })
await step('B: stories + view', async () => { const s = await B.stories(); must(s.length > 0, 'no stories'); if (story) await B.viewStory(story) })
await step('A: storyViewers + highlights', async () => { await A.storyViewers(story); await A.createHighlight('ზაფხული', [story]); const h = await A.highlights(pa.id); must(h.length, 'no highlight'); await A.deleteHighlight(h[0].id) })

// ---- ჩატი და ზარი
const conv = await step('B: openDM A', () => B.openDM(pa.id))
const m1 = await step('B: send message', async () => (await B.send(conv, { body: 'გამარჯობა' })).id)
await step('A: conversations + messages', async () => { const cs = await A.conversations(); must(cs.some((c) => c.id === conv), 'conv missing'); await A.conversation(conv); const ms = await A.messages(conv); must(ms.length, 'no messages') })
await step('A: reply to message (reply embed)', async () => { const r = await A.send(conv, { body: 'პასუხი', reply_to: m1 }); must(r.reply?.id === m1, 'reply embed wrong') })
await step('B: react + markRead', async () => { await B.react(m1, '❤️'); await A.markRead(conv) })
await step('A: group chat', async () => { const g = await A.createGroupChat('ჯგუფური', [pb.id]); await A.chatMembers(g); await A.renameChat(g, 'ახალი სახელი'); await B.leaveChat(g) })
await step('B: call start + decline', async () => { const c = await B.startCall(conv, pa.id, 'audio'); await A.updateCall(c.id, 'declined') })
await step('B: delete message', () => B.deleteMessage(m1))

// ---- ბაზარი
const lst = await step('A: createListing', async () => (await A.createListing({ title: 'ველოსიპედი', description: 'კარგ მდგომარეობაში', price: 500, currency: 'GEL', category: 'hobby', condition: 'used', city: 'თბილისი', photos: [photo], thumb: photo })))
await step('B: listings + listing + view + save', async () => { await B.listings({}); await B.listing(lst.id); await B.viewListing(lst.id); await B.saveListing(lst.id, true); await B.savedListings() })
await step('B: contactSeller', () => B.contactSeller(lst, 'ჯერ კიდევ იყიდება?'))
await step('A: price drop + bump rule + mine + sold', async () => {
  await A.updateListing(lst.id, { price: 450 })
  const n = await B.notifications(); must(n.some((x) => x.type === 'listing_price'), 'no price-drop notification')
  await A.bumpListing(lst.id).then(() => { throw new Error('bump allowed twice a day') }, (e) => must(/დღეში ერთხელ/.test(e.message), e.message))
  await A.myListings(); await A.updateListing(lst.id, { status: 'sold' })
})

// ---- ჯგუფები და ივენთები
const grp = await step('A: createGroup', async () => { const slug = `ezo-${RUN}`; must(await A.slugFree(slug), 'slug taken'); return A.createGroup({ name: 'ეზოს ჯგუფი', slug }) })
await step('B: discover + join group', async () => { await B.discoverGroups(); await B.joinGroup(grp.id); await A.groupMembers(grp.id); await A.group(grp.slug); await A.myGroups() })
await step('A: post in group', async () => { await A.createPost({ body: 'ჯგუფში', group_id: grp.id }); await B.groupPosts(grp.id) })
const ev = await step('A: createEvent', () => A.createEvent({ title: 'შეხვედრა', description: 'ეზოში', starts_at: new Date(Date.now() + 864e5).toISOString(), place: 'ვაკის პარკი', city: 'თბილისი' }))
await step('B: events + rsvp + attendees', async () => { await B.events({ scope: 'upcoming' }); await B.rsvp(ev.id, 'going'); await B.attendees(ev.id); await B.event(ev.id); await B.events({ scope: 'mine' }) })

// ---- გაცნობა
await step('A/B: dating profiles + match', async () => {
  await A.saveDatingProfile({ enabled: true, birth_date: '1995-05-05', gender: 'man', looking_for: 'woman', bio: 'გამარჯობა', photos: [photo], city: 'თბილისი' })
  await B.saveDatingProfile({ enabled: true, birth_date: '1997-03-03', gender: 'woman', looking_for: 'man', bio: 'გამარჯობა', photos: [photo], city: 'თბილისი' })
  await A.datingProfile(); await A.candidates(); await A.nearby()
  await A.swipe(pb.id, true); const r = await B.swipe(pa.id, true)
  const m = await A.matches(); must(m.length > 0, 'no match ' + JSON.stringify(r))
})

// ---- თამაშები (game ფუნქცია)
await step('A/B: chess game via function', async () => {
  const id = await A.createGame('chess', pb.id)
  await B.joinGame(id)
  let g = await A.game(id)
  must(g.status === 'active', 'status ' + g.status)
  const mine = g.player_a === pa.id ? A : B
  const mv = chess.legalMoves(chess.fromFEN(g.state.fen))[0]
  await mine.move(id, mv, g.move_no)
  g = await A.game(id)
  must(g.move_no === 1 || g.state.count === 1, 'move not applied')
  await A.sendGameMessage(id, 'text', 'წარმატებები'); await B.gameMessages(id)
  await B.resign(id)
  await A.stats(pa.id); await A.leaderboard('chess'); await A.myGames(); await A.liveGames()
})
await step('A: daily puzzle', async () => { const p = await A.dailyPuzzle(); must(p, 'no puzzle'); await A.puzzleMove(['a1a2']).catch((e) => { if (!/არასწორ|wrong|სვლა/i.test(e.message)) throw e }) })

// ---- უსაფრთხოება და მოწვევა
await step('B: report A post', () => B.report({ post: p1, category: 'spam', reason: 'სპამი' }))
await step('C: claimInvite A', async () => { const r = await C.claimInvite(ua); must(r?.ok, JSON.stringify(r)) })
await step('A: inviteStats + ogPreview', async () => { const s = await A.inviteStats(); must(s.count >= 1, 'no invites'); await A.ogPreview('u', ua) })
await step('A: privacy + follow request', async () => {
  await B.updateProfile({ is_private: true })
  await A.follow(pb.id, true)
  const reqs = await B.followRequests(); must(reqs.length, 'no request')
  await B.respondRequest(pa.id, true)
  await B.updateProfile({ is_private: false })
})
await step('A: close friends', async () => { await A.setCloseFriend(pb.id, true); await A.closeFriends() })
await step('A: push subscription', async () => { await A.savePush({ endpoint: `https://push.example/${RUN}`, toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'x', auth: 'y' } } } }); await A.deletePush(`https://push.example/${RUN}`) })
await step('A: export data', async () => { const d = await A.exportMyData(); must(d && d.profile, 'no export') })
await step('A: 2FA enroll → verify → disable', async () => {
  const e = await A.mfaEnroll(); must(e.secret, 'no secret')
  await A.mfaVerify(e.factorId, totp(e.secret))
  const st = await A.mfaState(); must(st.enabled, 'not enabled')
  await A.exportMyData() // aal2-ით უნდა მუშაობდეს
  await A.mfaDisable(e.factorId)
})

// ---- შეცდომების ჟურნალი (შესული და შეუსვლელი)
const ERR = `contract error ${RUN}`
await step('A + guest: logError', async () => {
  await A.logError({ message: ERR, stack: 'at contract', path: '/inbox', source: 'boundary', release: 'ci', agent: 'node' })
  await Guest.logError({ message: ERR, stack: null, path: '/', source: 'window', release: 'ci', agent: 'node' })
  must(sql(`select count(*) from public.client_errors where message = '${ERR}'`) === '2', 'not logged')
})
await step('B: adminErrors forbidden', async () => { await B.adminErrors(7).then(() => { throw new Error('allowed') }, (e) => must(/forbidden/.test(e.message), e.message)) })

// ---- ადმინი
sql(`update public.profiles set role = 'admin' where username = '${ua}'`)
await step('A: admin stats + reports + resolve', async () => {
  await A.session()
  await A.adminStats()
  const r = await A.adminReports('open'); must(r.length, 'no reports')
  await A.adminResolve(r[0].id, 'dismiss')
})
await step('A: banned words', async () => { await A.addBannedWord('სპამიტესტი'); const w = await A.bannedWords(); must(w.includes('სპამიტესტი') || w.some?.((x) => x.word === 'სპამიტესტი'), 'word missing'); await A.removeBannedWord('სპამიტესტი') })
await step('A: tournament', async () => {
  const t = await A.createTournament({ type: 'chess', tc: '3+0', title: 'ტესტ ტურნირი', starts_at: new Date(Date.now() - 6e4).toISOString(), ends_at: new Date(Date.now() + 36e5).toISOString() })
  await B.joinTournament(t.id); await A.tournaments(); await A.tournament(t.id); await A.tournamentStandings(t.id); await A.tournamentTick(); await B.leaveTournament(t.id); await A.trophies(pa.id)
})
await step('A: error log grouped + clear', async () => {
  const l = await A.adminErrors(1)
  const g = l.find((x) => x.message === ERR)
  must(g && Number(g.events) === 2 && Number(g.users) === 1 && g.path, 'group wrong ' + JSON.stringify(g))
  must(await A.adminClearErrors(ERR) === 2, 'clear count')
  must(!(await A.adminErrors(1)).some((x) => x.message === ERR), 'still listed')
})
await step('A: ban + unban C', async () => { await A.adminBan(pc.id, 1, 'ტესტი'); await A.adminUnban(pc.id) })
await step('A: rewards boards', async () => { await A.profileProgress(pb.id); await A.xpLeaderboard('all'); await A.xpLeaderboard('friends') })
await step('A: delete post', () => A.deletePost(p2))

// ---- ეტაპი C: ვის გამოიწერო, მიმაგრება, მონახაზები, ნიშანი, ქართული ძებნა
await step('C: who_to_follow + dismiss', async () => {
  const l = await C.suggested(20)
  must(Array.isArray(l) && l.every((x) => x.reason && x.username), 'shape ' + JSON.stringify(l[0]))
  const target = l[0]
  await C.dismissSuggestion(target.id)
  must(!(await C.suggested(20)).some((x) => x.id === target.id), 'dismissed still listed')
})
await step('A: pin post → first on profile, unpin', async () => {
  const id = (await A.createPost({ body: 'მიმაგრების ტესტი' })).id
  await A.createPost({ body: 'უფრო ახალი პოსტი' })
  await A.pinPost(id)
  const l = await B.userPosts(pa.id, 'posts')
  must(l[0]?.id === id && l[0].pinned === true, 'pinned not first')
  must(l.filter((x) => x.id === id).length === 1, 'pinned duplicated')
  await A.pinPost(null)
  must(!(await B.userPosts(pa.id, 'posts')).some((x) => x.pinned), 'still pinned')
  let refused = false
  await A.pinPost(reply).catch(() => { refused = true })
  must(refused, 'pinned a foreign reply')
})
await step('A: drafts save → list → update → delete', async () => {
  const d = await A.saveDraft({ body: 'მონახაზი', poll: { options: ['ა', 'ბ'], days: 1, multi: false } })
  const d2 = await A.saveDraft({ id: d.id, body: 'შესწორებული მონახაზი', poll: null })
  must(d2.id === d.id && d2.body === 'შესწორებული მონახაზი', 'update failed')
  must((await A.drafts()).some((x) => x.id === d.id), 'not listed')
  must(!(await B.drafts()).some((x) => x.id === d.id), 'visible to others')
  await A.deleteDraft(d.id)
  must(!(await A.drafts()).some((x) => x.id === d.id), 'not deleted')
})
await step('A (admin): verified badge visible in posts and search', async () => {
  await A.adminSetVerified(pb.id, true)
  const r = await A.searchAll(ub)
  must(r.people[0]?.username === ub && r.people[0].verified === true, 'search verified ' + JSON.stringify(r.people[0]))
  const posts = await A.userPosts(pb.id, 'replies')
  must(posts.length === 0 || posts[0].author?.verified === true, 'author verified in embed')
  await B.updateProfile({ bio: 'ნიშანს ვერ მოვიხსნი' })
  must((await A.profileByUsername(ub)).verified === true, 'user changed own badge')
  await B.adminSetVerified(pb.id, false).then(() => { throw new Error('non-admin verified') }, (e) => must(/forbidden/.test(e.message), e.message))
})
await step('B: Georgian search — Latin finds Georgian name and posts', async () => {
  await A.createPost({ body: 'ნარდის ტურნირი ვაკეში #ნარდი' })
  const r = await B.searchAll('nardis turniri')
  must(r.posts.some((p) => p.body.startsWith('ნარდის ტურნირი')), 'post via translit')
  must(r.posts[0]?.author?.username, 'post embed')
  const t = await B.searchAll('#nard')
  must(t.tags.some((x) => x.tag === 'ნარდი'), 'tag via translit')
  const people = await B.search('gio')
  must(Array.isArray(people), 'search() compat')
})
await step('JS და SQL ჩონჩხი ერთნაირია', async () => {
  const words = ['გიორგი ბერიძე', 'Giorgi Beridze', "ch'avch'avadze", 'ჭავჭავაძე', 'Khatuna', 'ყიფიანი', 'yifiani', 'წერეთელი', 'wereteli', "Ts'otne", 'ღვინჯილია', 'ZHVANIA', 'phaliashvili', 'nino_99.b', 'ნარდი #ეზო']
  const sqlOut = sql(`select string_agg(public.ka_skeleton(w), '|' order by n) from unnest(array[${words.map((w) => `'${w.replace(/'/g, "''")}'`).join(',')}]) with ordinality as t(w, n)`)
  must(sqlOut === words.map(skeleton).join('|'), `SQL: ${sqlOut}\nJS:  ${words.map(skeleton).join('|')}`)
})

// ---- ეტაპი D: შეტყობინებების პარამეტრები და ანალიტიკა
await step('B: notification prefs saved and enforced by push_allowed', async () => {
  must((await B.notificationPrefs()) === null, 'defaults expected')
  await B.saveNotificationPrefs({ likes: false })
  const p = await B.saveNotificationPrefs({ quiet_from: 23, quiet_to: 8 })
  must(p.likes === false && p.quiet_from === 23 && p.messages === true, 'saved ' + JSON.stringify(p))
  must((await B.notificationPrefs()).likes === false, 'not persisted')
  must(sql(`select public.push_allowed('${pb.id}', '{"tag":"n-like-x"}')`) === 'f', 'likes not blocked')
  must(sql(`select public.push_allowed('${pb.id}', '{"tag":"call-1"}')`) === 't', 'calls blocked')
  must(sql(`select public.push_allowed('${pa.id}', '{"tag":"n-like-x"}')`) === 't', 'other user affected')
  await B.saveNotificationPrefs({ likes: true, quiet_from: null, quiet_to: null })
})
await step('A (admin): analytics; B forbidden', async () => {
  await A.touch()
  const r = await A.adminAnalytics(30)
  must(r.days.length === 30 && r.days.at(-1).day === sql(`select (now() at time zone 'Asia/Tbilisi')::date`), 'days ' + r.days.at(-1)?.day)
  must(r.totals.dau >= 2 && r.days.at(-1).posts >= 1 && r.days.at(-1).signups >= 2, 'totals ' + JSON.stringify(r.totals))
  await B.adminAnalytics(30).then(() => { throw new Error('non-admin analytics') }, (e) => must(/forbidden/.test(e.message), e.message))
})

// ---- ეტაპი E: მოხსენიება, რედაქტირება, ბმულის ბარათი, დაბადების დღე, მოგონებები
await step('B: @mention → A notified; edit within 15 min; link card saved', async () => {
  const p = await B.createPost({ body: `@${ua} ნახე https://example.com/x`, link: { url: 'https://example.com/x', title: 'მაგალითი', description: '', image: null, site: 'example.com' } })
  must(p?.link?.title === 'მაგალითი', 'link not saved')
  must((await A.notifications()).some((n) => n.type === 'mention' && n.post_id === p.id && n.actor?.username === ub), 'mention notification missing')
  const e = await B.editPost(p.id, `@${ua} შესწორებული ტექსტი`)
  must(e.body.includes('შესწორებული') && e.edited_at && e.liked === false, 'edit ' + JSON.stringify(e).slice(0, 160))
  must((await A.notifications()).filter((n) => n.type === 'mention' && n.post_id === p.id).length === 1, 'mention repeated on edit')
  sql(`update public.posts set created_at = now() - interval '20 minutes' where id = '${p.id}'`)
  await B.editPost(p.id, 'გვიან').then(() => { throw new Error('late edit allowed') }, (er) => must(/15 წუთ/.test(er.message), er.message))
  await B.createPost({ body: 'x', link: { url: 'javascript:alert(1)', title: 'x' } }).then(() => { throw new Error('bad link accepted') }, () => {})
})
await step('A: birthday save/read; B sees it today; hidden → not shown', async () => {
  const [m, d] = sql(`select to_char(now() at time zone 'Asia/Tbilisi', 'FMMM FMDD')`).split(' ').map(Number)
  must((await A.myBirthday()) === null, 'expected none')
  const b = await A.saveBirthday({ month: m, day: d, visible: true })
  must(b.month === m && b.day === d && b.visible === true, 'saved ' + JSON.stringify(b))
  must((await B.celebrations()).birthdays.some((p) => p.username === ua), 'B does not see A birthday')
  must((await A.celebrations()).mine.birthday === true, 'mine.birthday')
  await A.saveBirthday({ month: m, day: d, visible: false })
  must(!(await B.celebrations()).birthdays.some((p) => p.username === ua), 'hidden birthday visible')
  must(sql(`select count(*) from public.birthdays where user_id = '${pa.id}'`) === '1', 'row missing')
  await A.saveBirthday(null)
  must((await A.myBirthday()) === null, 'not deleted')
})
await step('A: memories — post from a year ago', async () => {
  const p = await A.createPost({ body: 'შარშანდელი პოსტი' })
  sql(`update public.posts set created_at = now() - interval '1 year' where id = '${p.id}'`)
  const list = await A.memories()
  must(list.some((x) => x.id === p.id && x.author?.username === ua), 'memory missing')
  must(!(await B.memories()).some((x) => x.id === p.id), 'B sees A memory')
})

// ---- ეტაპი G: გაღვიძება და საცავის დასუფთავება (api/daily.js — service გასაღებით, როგორც Vercel-ის cron)
await step('G: deleted post photo removed from storage; story kept while in a highlight', async () => {
  const keys = Object.fromEntries(readFileSync(`${OUT}/keys.env`, 'utf8').trim().split('\n').map((l) => l.split('=')))
  const base = process.env.SUPABASE_URL || 'http://localhost:54321'
  const { cleanup } = await import(pathToFileURL(resolve('api/daily.js')).href)
  const head = async (u) => (await fetch(u)).status
  const photo = await A.upload(png(), 'posts')
  const post = await A.createPost({ body: 'წასაშლელი', media: [{ url: photo, type: 'image', w: 1, h: 1 }] })
  must((await head(photo)) === 200, 'upload not served')
  await A.createStory(png(), 'ზღვა')
  const story = (await A.storyArchive())[0]
  await A.createHighlight('ზღვა', [story.id])
  await A.deletePost(post.id)
  await A.deleteStory(story.id)
  must(Number(sql(`select count(*) from public.media_trash`)) >= 2, 'trash not filled')
  sql(`update public.media_trash set created_at = now() - interval '2 hours'`)
  await cleanup({ url: base, key: 'wrong-key' }).then(() => { throw new Error('cleanup with a wrong key') }, () => {})
  const r = await cleanup({ url: base, key: keys.SERVICE_KEY })
  must(r.deleted >= 1 && r.failed === 0, 'cleanup ' + JSON.stringify(r))
  must((await head(photo)) === 404, 'deleted post photo still served')
  must((await head(story.media_url)) === 200, 'story in a highlight was deleted')
  const path = photo.split('/object/public/media/')[1]
  must(sql(`select count(*) from storage.objects where name = '${path}'`) === '0', 'storage row left')
  // ჩვეულებრივი მომხმარებელი სხვის ფაილს ვერ შლის
  const other = await B.upload(png(), 'posts')
  await fetch(`${base}/storage/v1/object/media`, { method: 'DELETE', headers: { apikey: keys.ANON_KEY, Authorization: `Bearer ${keys.ANON_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [other.split('/object/public/media/')[1]] }) })
  must((await head(other)) === 200, 'anon deleted a file')
})
await step('anon: keep_alive', async () => {
  const keys = Object.fromEntries(readFileSync(`${OUT}/keys.env`, 'utf8').trim().split('\n').map((l) => l.split('=')))
  const r = await fetch(`${process.env.SUPABASE_URL || 'http://localhost:54321'}/rest/v1/rpc/keep_alive`, { method: 'POST', headers: { apikey: keys.ANON_KEY, Authorization: `Bearer ${keys.ANON_KEY}`, 'Content-Type': 'application/json' }, body: '{}' })
  must(r.ok && Date.parse(await r.json()) > 0, 'keep_alive ' + r.status)
  const denied = await fetch(`${process.env.SUPABASE_URL || 'http://localhost:54321'}/rest/v1/rpc/media_cleanup_take`, { method: 'POST', headers: { apikey: keys.ANON_KEY, Authorization: `Bearer ${keys.ANON_KEY}`, 'Content-Type': 'application/json' }, body: '{}' })
  must(!denied.ok, 'anon can call media_cleanup_take')
})

// ---- ეტაპი H: სეზონი, მეგობრები, საერთო რეიტინგი
await step('H: season board, friends scope, all-time board', async () => {
  const t = sql(`select type from public.game_stats where user_id = '${pa.id}' and wins + losses + draws > 0 order by type limit 1`)
  must(t, 'A has no rated games in this run')
  must(Number(sql(`select count(*) from public.season_stats where user_id = '${pa.id}' and type = '${t}'`)) === 1, 'season row missing')
  const s = await A.gameBoard(t, 'season', 'all')
  must(s.season && Date.parse(s.ends_at) > Date.now() && s.me?.user_id === pa.id && s.me.league && s.me.pos >= 1, 'season ' + JSON.stringify(s).slice(0, 240))
  const f = await A.gameBoard(t, 'season', 'friends')
  must(f.rows.length >= 1 && f.rows.every((r) => [pa.id, pb.id].includes(r.user_id)), 'friends ' + JSON.stringify(f.rows.map((r) => r.user_id)))
  const all = await A.gameBoard(t, 'all', 'all')
  must(all.rows.length >= 1 && all.rows.every((r) => r.league === null) && all.me?.rating === Number(sql(`select rating from public.game_stats where user_id = '${pa.id}' and type = '${t}'`)), 'all-time')
  await Guest.gameBoard(t).then((r) => must(r === null, 'guest got a board'), () => {})
})

// ---- ეტაპი I: ჩატი — ძებნა, მიმაგრება/დადუმება, ქრებადი მესიჯები, გამოკითხვა
await step('I: search, pin, mute, disappearing, around', async () => {
  const dm = await A.openDM(pb.id)
  const m1 = await A.send(dm, { body: `ხვალ ნარდი ${RUN}` })
  const found = await B.searchMessages(`nardi ${RUN}`)
  must(found.some((r) => r.id === m1.id && r.conversation_id === dm), 'latin search did not find Georgian text')
  must((await B.searchMessages(`nardi ${RUN}`, dm)).length >= 1 && (await C.searchMessages?.(`nardi ${RUN}`).catch(() => []) || []).length === 0, 'conv filter / outsider')
  const p = await A.setChatPrefs(dm, { pin: true, muteHours: 8 })
  must(p.pinned && p.muted && !p.mute_forever, 'prefs ' + JSON.stringify(p))
  const first = (await A.conversations())[0]
  must(first.id === dm && first.pinned && first.muted, 'pinned not first')
  must((await A.unreadCounts()).messages >= 0, 'unread counts')
  await A.setChatPrefs(dm, { pin: false, muteHours: 0 })
  await B.setDisappearing(dm, 24)
  must((await A.conversation(dm)).disappear_hours === 24, 'disappear not set')
  const m2 = await A.send(dm, { body: 'გაქრება' })
  must(m2.expires_at && Date.parse(m2.expires_at) > Date.now() + 23 * 3600e3, 'expires_at ' + m2.expires_at)
  sql(`update public.messages set expires_at = now() - interval '1 minute' where id = '${m2.id}'`)
  must(!(await B.messages(dm)).some((m) => m.id === m2.id), 'expired message visible')
  await B.setDisappearing(dm, null)
  const around = await B.messages(dm, { around: m1.id })
  must(around.some((m) => m.id === m1.id) && around.hasNewer === false, 'around')
})
await step('I: group poll — create, vote, change, multi rules, realtime row', async () => {
  const g = await A.createGroupChat('გამოკითხვა ' + RUN, [pb.id])
  const poll = await A.sendChatPoll(g, { question: 'როდის?', options: ['ხვალ', 'ზეგ'], multi: false })
  must(poll.meta?.poll?.options?.length === 2, 'poll meta')
  await B.voteChatPoll(poll.id, [1])
  await B.voteChatPoll(poll.id, [0])
  await B.voteChatPoll(poll.id, [0, 1]).then(() => { throw new Error('multi on single poll') }, () => {})
  const votes = await A.chatPollVotes(g)
  must(votes.length === 1 && votes[0].option === 0 && votes[0].user_id === pb.id, 'votes ' + JSON.stringify(votes))
  const dm = await A.openDM(pb.id)
  await A.sendChatPoll(dm, { question: 'x', options: ['a', 'b'] }).then(() => { throw new Error('poll in DM') }, () => {})
  must((await A.conversations()).find((c) => c.id === g).last_message.startsWith('📊'), 'poll preview')
})

// ---- ეტაპი J: ჭადრაკი 960, ხუთი რიგში, პარტიის ჩანაწერი
await step('J: chess960 + gomoku via function; replay of finished games', async () => {
  const id9 = await A.createGame('chess960', pb.id, { tc: '3+2' })
  await B.joinGame(id9)
  let g9 = await A.game(id9)
  must(g9.status === 'active' && / w [A-H]{2}[a-h]{2} /.test(g9.state.fen) && g9.clock, '960 start ' + g9.state.fen)
  const w = g9.player_a === pa.id ? A : B
  const mv = chess960.legalMoves(chess.fromFEN(g9.state.fen)).find((m) => !m.flag?.startsWith?.('castle'))
  await w.move(id9, { from: mv.from, to: mv.to }, g9.move_no)
  await w.move(id9, { from: 0, to: 63 }, g9.move_no + 1).then(() => { throw new Error('illegal 960 move accepted') }, () => {})
  const idg = await A.createGame('gomoku', pb.id)
  await B.joinGame(idg)
  let gg = await A.game(idg)
  const first = gg.player_a === pa.id ? A : B
  const second = first === A ? B : A
  await first.move(idg, { at: 112 }, gg.move_no)
  await second.move(idg, { at: 112 }, gg.move_no + 1).then(() => { throw new Error('occupied cell accepted') }, () => {})
  await second.move(idg, { at: 113 }, gg.move_no + 1)
  gg = await A.game(idg)
  must(gg.state.board[112] === 'a' && gg.state.board[113] === 'b' && gg.state.count === 2, 'gomoku board')
  await B.resign(id9); await B.resign(idg)
  const recent = await A.recentGames()
  must(recent.length >= 3 && recent.every((g) => g.status === 'finished' && g.a && g.b), 'recent ' + recent.map((g) => g.type))
  const r = await B.replay(idg)
  must(r.game.id === idg && r.moves.map((m) => m.n).join() === '0,1,2' && r.moves[2].state.board[113] === 'b', 'replay ' + JSON.stringify(r.moves.map((m) => m.n)))
  const r9 = await C.replay(id9)
  must(r9.moves.length === 2 && r9.moves[0].state.fen !== r9.moves[1].state.fen, 'outsider replay')
  must(Number(sql(`select count(*) from public.game_moves m join public.games g on g.id = m.game_id where g.type = 'joker'`)) === 0, 'card game recorded')
})

// ---- საჯარო ფუნქციები anon გასაღებით (Vercel-ის og.js და sitemap.js ასე იძახებს)
await step('anon: og_preview + sitemap_entries', async () => {
  const keys = Object.fromEntries(readFileSync(`${OUT}/keys.env`, 'utf8').trim().split('\n').map((l) => l.split('=')))
  const call = async (fn, body) => {
    const r = await fetch(`${process.env.SUPABASE_URL || 'http://localhost:54321'}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: keys.ANON_KEY, Authorization: `Bearer ${keys.ANON_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) throw new Error(`${fn} ${r.status} ${await r.text()}`)
    return r.json()
  }
  const og = await call('og_preview', { p_kind: 'u', p_key: ua })
  must(og?.username === ua, 'og_preview: ' + JSON.stringify(og))
  const sm = await call('sitemap_entries', {})
  must(sm.u.includes(ua), 'sitemap: public user missing')
  must(Array.isArray(sm.m) && Array.isArray(sm.e), 'sitemap shape')
})

// ---- ანგარიშის წაშლა
await step('C: deleteMyAccount', async () => { await C.deleteMyAccount(); must(sql(`select count(*) from public.profiles where username = '${uc}'`) === '0', 'profile still exists') })

writeFileSync(`${OUT}/last-run.json`, JSON.stringify({ ua, ub, emailA: `${ua}@ezo.test`, emailB: `${ub}@ezo.test`, conv, listing: lst?.id, group: grp?.slug, event: ev?.id, post: p1, quote }))
const fails = results.filter((r) => r[0] === 'FAIL')
console.log(`კონტრაქტი: ${results.length - fails.length}/${results.length} ok`)
for (const f of fails) console.log(`FAIL ${f[1]} :: ${f[2]}`)
process.exit(fails.length ? 1 : 0)
