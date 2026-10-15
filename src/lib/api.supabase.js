import { supabase as sb } from './supabase.js'
import { groupStories } from './groupStories.js'
import { withMyHand, HIDDEN } from '../games/server.js'
import { isSchemaError, reportApiError } from './errors.js'

// Supabase-ზე მომუშავე API. ინტერფეისი ზუსტად ემთხვევა api.demo.js-ს.

// თავის თავზე მიბმული კავშირები (ციტატა, პასუხი): PostgREST-ში მხოლოდ სვეტით (quote:quote_id) — კავშირის სახელს ვერ პოულობს,
// posts!quote_id კი საპირისპირო მიმართულებას (სიას) აბრუნებს
const PERSON = 'id,username,full_name,avatar_url,last_seen,verified'
const POST = `*, author:profiles!posts_author_id_fkey(${PERSON}),
  quote:quote_id(id,body,media,created_at,author:profiles!posts_author_id_fkey(${PERSON})),
  group:groups!posts_group_id_fkey(id,slug,name,privacy), poll:polls(*)`
const MSG = `*, reply:reply_to(id,body,sender_id,media_type,deleted_at), reactions:message_reactions(user_id,emoji)`
const GROUP = 'id,slug,name,description,cover_url,privacy,owner_id,members_count,created_at'
const EVENT = `*, host:profiles!events_host_id_fkey(${PERSON}), group:groups!events_group_id_fkey(id,slug,name)`
const LISTING = `*, seller:profiles!listings_seller_id_fkey(${PERSON},city)`
const GAME = `*, a:profiles!games_player_a_fkey(${PERSON}), b:profiles!games_player_b_fkey(${PERSON}),
  c:profiles!games_player_c_fkey(${PERSON}), d:profiles!games_player_d_fkey(${PERSON})`

let me = null

// ---- Realtime არხები
// supabase-js იმავე სახელის არხს მეორედ არ ქმნის — უკვე გამოწერილს აბრუნებს, და მასზე .on('postgres_changes' | 'presence')
// შეცდომას აგდებს; დახურვისას კი ყველა იმავე სახელის არხს შლის. ამიტომ:
// 1) ბაზის ცვლილებების არხებს სახელი სხვასთან არ უნდა დაემთხვეს — ყოველ გამოწერას უნიკალურ სახელს ვაძლევთ;
let chanSeq = 0
const pgChannel = (name) => sb.channel(`${name}:${Date.now().toString(36)}${(++chanSeq).toString(36)}`)
// 2) broadcast/presence არხებს (ტიპინი, მაყურებლები) სახელი ორივე მხარეს ერთი სჭირდება — ერთ არხს ყველა გამომწერი იზიარებს,
//    ბოლოს წასულის შემდეგ კი ცოტა ხანს ღიაა, რომ სწრაფად დაბრუნებულმა იგივე გააგრძელოს.
const sharedChannels = new Map()
function joinShared(name, opts, init) {
  let s = sharedChannels.get(name)
  if (s) {
    clearTimeout(s.closing)
    s.closing = null
  } else {
    s = { ch: sb.channel(name, opts), subs: new Set(), closing: null, joined: false }
    sharedChannels.set(name, s)
    init(s)
  }
  return s
}
function leaveShared(name, sub, onIdle) {
  const s = sharedChannels.get(name)
  if (!s) return
  s.subs.delete(sub)
  if (s.subs.size || s.closing) return
  onIdle?.(s)
  s.closing = setTimeout(() => {
    sharedChannels.delete(name)
    sb.removeChannel(s.ch)
  }, 20000)
}

async function gameFn(body) {
  const { data, error } = await sb.functions.invoke('game', { body })
  if (error) {
    let msg = error.message
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* */ }
    if (error.name === 'FunctionsFetchError' || error.name === 'FunctionsRelayError') {
      msg = 'თამაშის სერვერი მიუწვდომელია. შეამოწმე, რომ Edge Function „game“ გაშვებულია.'
    }
    throw new Error(msg)
  }
  return data
}
const uid = () => me
const ok = ({ data, error }) => {
  if (error) {
    if (isSchemaError(error)) reportApiError(error)
    throw new Error(humanError(error.message))
  }
  return data
}

function humanError(msg = '') {
  if (/Invalid login credentials/i.test(msg)) return 'ელფოსტა ან პაროლი არასწორია'
  if (/already registered/i.test(msg)) return 'ეს ელფოსტა უკვე რეგისტრირებულია'
  if (/Email not confirmed/i.test(msg)) return 'დაადასტურე ელფოსტა — ბმული წერილში გამოგიგზავნეთ'
  if (/duplicate key.*username/i.test(msg)) return 'ეს მომხმარებლის სახელი დაკავებულია'
  if (/Password should be/i.test(msg)) return 'პაროლი მინიმუმ 6 სიმბოლო უნდა იყოს'
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'ინტერნეტთან კავშირი ვერ დამყარდა'
  return msg
}

// გამოკითხვის მდგომარეობა: { options, multi, closes_at, counts[], mine[], total, closed }
function pollView(poll, rows = []) {
  if (!poll) return null
  const counts = poll.options.map((_, i) => Number(rows.find((r) => r.option === i)?.votes || 0))
  const mine = rows.filter((r) => r.mine).map((r) => r.option)
  return { ...poll, counts, mine, total: counts.reduce((a, b) => a + b, 0), closed: Date.parse(poll.closes_at) <= Date.now() }
}

// მოწონებები, შენახვები და გამოკითხვის შედეგები ერთად
async function withLikes(posts) {
  if (!posts?.length || !uid()) return posts || []
  const ids = posts.map((p) => p.id)
  const pollIds = posts.filter((p) => p.poll).map((p) => p.id)
  const [liked, saved, votes] = await Promise.all([
    sb.from('likes').select('post_id').eq('user_id', uid()).in('post_id', ids).then(ok),
    sb.from('saves').select('post_id').eq('user_id', uid()).in('post_id', ids).then(ok),
    pollIds.length ? sb.rpc('poll_results', { p_posts: pollIds }).then(ok) : [],
  ])
  const set = new Set(liked.map((l) => l.post_id))
  const sv = new Set(saved.map((l) => l.post_id))
  return posts.map((p) => ({ ...p, liked: set.has(p.id), saved: sv.has(p.id), poll: pollView(p.poll, votes.filter((v) => v.post_id === p.id)) }))
}

// ბაზარი: ჩემი შენახულები
async function withListingSaves(rows) {
  if (!rows.length) return rows
  const saved = ok(await sb.from('listing_saves').select('listing_id').eq('user_id', me).in('listing_id', rows.map((l) => l.id)))
  const set = new Set(saved.map((x) => x.listing_id))
  return rows.map((l) => ({ ...l, saved: set.has(l.id) }))
}
const like = (q) => q.replace(/[%_,()*.\\]/g, ' ').trim()

async function withRsvp(events) {
  if (!events?.length) return events || []
  const mine = ok(await sb.from('event_rsvps').select('event_id,status').eq('user_id', uid()).in('event_id', events.map((e) => e.id)))
  const map = Object.fromEntries(mine.map((r) => [r.event_id, r.status]))
  return events.map((e) => ({ ...e, my_rsvp: map[e.id] || null }))
}

export const api = {
  demo: false,

  // ---- ავტორიზაცია
  async session() {
    const { data } = await sb.auth.getSession()
    me = data.session?.user?.id || null
    return data.session
  },
  onAuth(cb) {
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      me = session?.user?.id || null
      cb(session, event)
    })
    return () => data.subscription.unsubscribe()
  },
  async signInWithGoogle() {
    ok(await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } }))
  },
  async updatePassword(password) {
    ok(await sb.auth.updateUser({ password }))
  },
  async signUp(email, password, fullName) {
    const res = ok(await sb.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: location.origin } }))
    return { needsConfirm: !res.session }
  },
  async signIn(email, password) {
    ok(await sb.auth.signInWithPassword({ email, password }))
  },
  async resetPassword(email) {
    ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin }))
  },
  async signOut() {
    await sb.auth.signOut()
  },

  // ---- პროფილი
  async profile(id) {
    return ok(await sb.from('profiles').select('*').eq('id', id).maybeSingle())
  },
  async profileByUsername(username) {
    return ok(await sb.from('profiles').select('*').eq('username', username).maybeSingle())
  },
  async usernameFree(username) {
    const data = ok(await sb.from('profiles').select('id').eq('username', username).maybeSingle())
    return !data || data.id === uid()
  },
  async updateProfile(patch) {
    return ok(await sb.from('profiles').update(patch).eq('id', uid()).select().single())
  },
  async touch() {
    if (uid()) await sb.rpc('touch_last_seen')
  },

  // ---- მედია
  async upload(file, folder = 'misc') {
    const ext = (file.name?.split('.').pop() || file.type.split('/')[1] || 'bin').toLowerCase()
    const path = `${uid()}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    ok(await sb.storage.from('media').upload(path, file, { contentType: file.type, upsert: false }))
    return sb.storage.from('media').getPublicUrl(path).data.publicUrl
  },

  // ---- პოსტები
  async feed(mode, cursor) {
    const q = mode === 'following'
      ? sb.rpc('feed_following', { p_before: cursor || new Date().toISOString(), p_limit: 20 })
      : sb.rpc('feed_foryou', { p_offset: cursor || 0, p_limit: 20 })
    const posts = ok(await q.select(POST))
    const next = mode === 'following'
      ? posts.at(-1)?.created_at
      : (cursor || 0) + posts.length
    return { posts: await withLikes(posts), next: posts.length === 20 ? next : null }
  },
  async reels(offset = 0) {
    const posts = ok(await sb.rpc('reels_feed', { p_offset: offset, p_limit: 10 }).select(POST))
    return withLikes(posts)
  },
  async explore() {
    return withLikes(ok(await sb.rpc('explore_media', { p_limit: 30 }).select(POST)))
  },
  async post(id) {
    const p = ok(await sb.from('posts').select(POST).eq('id', id).maybeSingle())
    return p ? (await withLikes([p]))[0] : null
  },
  async thread(id) {
    const post = await this.post(id)
    if (!post) return null
    const rootId = post.root_id || post.id
    const all = ok(await sb.from('posts').select(POST).eq('root_id', rootId).order('created_at'))
    let parent = null
    if (post.parent_id) parent = await this.post(post.parent_id)
    return { post, parent, replies: await withLikes(all.filter((r) => r.parent_id === post.id || r.root_id === post.id)) }
  },
  async createPost({ body = '', media = [], kind = 'post', parent_id = null, quote_id = null, group_id = null, poll = null }) {
    const row = ok(await sb.from('posts').insert({ author_id: uid(), body, media, kind, parent_id, quote_id, group_id }).select(POST).single())
    if (poll) {
      const closes_at = new Date(Date.now() + (poll.days || 1) * 864e5).toISOString()
      const created = ok(await sb.from('polls').insert({ post_id: row.id, options: poll.options, multi: Boolean(poll.multi), closes_at }).select().single())
      return { ...row, liked: false, saved: false, poll: pollView(created) }
    }
    return { ...row, liked: false, saved: false }
  },
  async votePoll(postId, options) {
    ok(await sb.rpc('vote_poll', { p_post: postId, p_options: options }))
    const [poll, rows] = await Promise.all([
      sb.from('polls').select('*').eq('post_id', postId).single().then(ok),
      sb.rpc('poll_results', { p_posts: [postId] }).then(ok),
    ])
    return pollView(poll, rows)
  },

  // ---- შენახული პოსტები და კოლექციები
  async save(postId, on, collectionId = null) {
    if (on) ok(await sb.from('saves').upsert({ user_id: uid(), post_id: postId, collection_id: collectionId }))
    else ok(await sb.from('saves').delete().eq('user_id', uid()).eq('post_id', postId))
  },
  async saved(collectionId = null) {
    let q = sb.from('saves').select(`created_at, collection_id, post:posts(${POST})`).eq('user_id', uid()).order('created_at', { ascending: false }).limit(100)
    if (collectionId) q = q.eq('collection_id', collectionId)
    return withLikes(ok(await q).map((r) => r.post).filter(Boolean))
  },
  async collections() {
    const rows = ok(await sb.from('collections').select('*, saves(count)').eq('owner_id', uid()).order('created_at'))
    return rows.map((c) => ({ ...c, count: c.saves?.[0]?.count || 0 }))
  },
  async createCollection(name) {
    return ok(await sb.from('collections').insert({ owner_id: uid(), name: name.trim() }).select().single())
  },
  async deleteCollection(id) { ok(await sb.from('collections').delete().eq('id', id)) },
  async deletePost(id) {
    ok(await sb.from('posts').delete().eq('id', id))
  },
  async like(postId, on) {
    if (on) ok(await sb.from('likes').upsert({ user_id: uid(), post_id: postId }, { ignoreDuplicates: true }))
    else ok(await sb.from('likes').delete().eq('user_id', uid()).eq('post_id', postId))
  },
  async userPosts(userId, tab = 'posts') {
    let q = sb.from('posts').select(POST).eq('author_id', userId).is('parent_id', null).order('created_at', { ascending: false }).limit(40)
    if (tab === 'reels') q = q.eq('kind', 'reel')
    else if (tab === 'replies') q = sb.from('posts').select(POST).eq('author_id', userId).not('parent_id', 'is', null).order('created_at', { ascending: false }).limit(40)
    else if (tab !== 'media') q = q.eq('kind', 'post')
    let rows = ok(await q)
    if (tab === 'media') rows = rows.filter((p) => p.media?.length)
    // მიმაგრებული პოსტი — პირველი
    if (tab === 'posts') {
      const prof = ok(await sb.from('profiles').select('pinned_post_id').eq('id', userId).maybeSingle())
      const pid = prof?.pinned_post_id
      if (pid) {
        const pinned = rows.find((p) => p.id === pid) || ok(await sb.from('posts').select(POST).eq('id', pid).maybeSingle())
        if (pinned) rows = [{ ...pinned, pinned: true }, ...rows.filter((p) => p.id !== pid)]
      }
    }
    return withLikes(rows)
  },
  async pinPost(id) { ok(await sb.rpc('pin_post', { p_post: id })) },

  // ---- ადამიანები
  async relation(id) {
    const [a, b, r, cf] = await Promise.all([
      sb.from('follows').select('follower_id').eq('follower_id', uid()).eq('following_id', id).maybeSingle(),
      sb.from('follows').select('follower_id').eq('follower_id', id).eq('following_id', uid()).maybeSingle(),
      sb.from('follow_requests').select('requester_id').eq('requester_id', uid()).eq('target_id', id).maybeSingle(),
      sb.from('close_friends').select('friend_id').eq('owner_id', uid()).eq('friend_id', id).maybeSingle(),
    ])
    return { following: Boolean(a.data), followedBy: Boolean(b.data), requested: Boolean(r.data), closeFriend: Boolean(cf.data) }
  },
  // აბრუნებს 'following' | 'requested' | 'none'
  async follow(id, on) {
    if (on) return ok(await sb.rpc('follow_user', { p_target: id }))
    ok(await sb.rpc('unfollow_user', { p_target: id }))
    return 'none'
  },
  async followRequests() {
    const rows = ok(await sb.from('follow_requests').select(`created_at, p:profiles!follow_requests_requester_id_fkey(${PERSON},bio)`)
      .eq('target_id', uid()).order('created_at', { ascending: false }))
    return rows.map((r) => ({ ...r.p, requested_at: r.created_at }))
  },
  async respondRequest(userId, accept) {
    ok(await sb.rpc('respond_follow_request', { p_requester: userId, p_accept: accept }))
  },
  async closeFriends() {
    const rows = ok(await sb.from('close_friends').select(`p:profiles!close_friends_friend_id_fkey(${PERSON})`).eq('owner_id', uid()))
    return rows.map((r) => r.p)
  },
  async setCloseFriend(id, on) {
    if (on) ok(await sb.from('close_friends').upsert({ owner_id: uid(), friend_id: id }))
    else ok(await sb.from('close_friends').delete().eq('owner_id', uid()).eq('friend_id', id))
  },
  async followList(id, which) {
    if (which === 'followers') {
      const rows = ok(await sb.from('follows').select(`p:profiles!follows_follower_id_fkey(${PERSON},bio)`).eq('following_id', id).limit(200))
      return rows.map((r) => r.p)
    }
    const rows = ok(await sb.from('follows').select(`p:profiles!follows_following_id_fkey(${PERSON},bio)`).eq('follower_id', id).limit(200))
    return rows.map((r) => r.p)
  },
  // ძებნა ყველაფერზე: ქართულად ან ლათინურად („giorgi“ = „გიორგი“), უმნიშვნელო შეცდომითაც
  async searchAll(q) {
    const r = ok(await sb.rpc('search_all', { p_q: q, p_limit: 20 }))
    let posts = []
    if (r.posts?.length) {
      const rows = ok(await sb.from('posts').select(POST).in('id', r.posts))
      const order = new Map(r.posts.map((id, i) => [id, i]))
      posts = await withLikes(rows.sort((a, b) => order.get(a.id) - order.get(b.id)))
    }
    return { ...r, posts }
  },
  async search(q) { return (await this.searchAll(q)).people },
  async classmates({ school, year, city }) {
    let q = sb.from('profiles').select('*').eq('onboarded', true).neq('id', uid()).limit(60)
    if (school) q = q.ilike('school', `%${school.trim()}%`)
    if (year) q = q.eq('grad_year', Number(year))
    if (city) q = q.ilike('city', `%${city.trim()}%`)
    return ok(await q)
  },
  // ვის გამოიწერო — მიზეზით: follows_you | invite | classmate | mutual (+via) | school | city | new | popular
  async suggested(limit = 12) {
    return ok(await sb.rpc('who_to_follow', { p_limit: limit }))
  },
  async dismissSuggestion(id) { ok(await sb.rpc('dismiss_suggestion', { p_user: id })) },

  // ---- მონახაზები
  async drafts() { return ok(await sb.from('drafts').select('*').order('updated_at', { ascending: false })) },
  async saveDraft({ id = null, body = '', poll = null, group_id = null }) {
    if (id) return ok(await sb.from('drafts').update({ body, poll, group_id }).eq('id', id).select().single())
    return ok(await sb.from('drafts').insert({ body, poll, group_id }).select().single())
  },
  async deleteDraft(id) { ok(await sb.from('drafts').delete().eq('id', id)) },

  // ---- სთორიები
  async stories() {
    const following = ok(await sb.from('follows').select('following_id').eq('follower_id', uid()))
    const ids = [uid(), ...following.map((f) => f.following_id)]
    const rows = ok(await sb.from('stories').select(`*, author:profiles!stories_author_id_fkey(${PERSON})`)
      .in('author_id', ids).gt('expires_at', new Date().toISOString()).order('created_at'))
    const seen = rows.length
      ? new Set(ok(await sb.from('story_views').select('story_id').eq('viewer_id', uid()).in('story_id', rows.map((r) => r.id))).map((v) => v.story_id))
      : new Set()
    return groupStories(rows.map((r) => ({ ...r, seen: seen.has(r.id) })), uid())
  },
  async createStory(file, caption = '', audience = 'all') {
    const url = await this.upload(file, 'stories')
    ok(await sb.from('stories').insert({ author_id: uid(), media_url: url, media_type: file.type.startsWith('video') ? 'video' : 'image', caption, audience }))
  },
  // ჩემი ყველა სთორი (არქივი, ჰაილაითებისთვის)
  async storyArchive() {
    return ok(await sb.from('stories').select('*').eq('author_id', uid()).order('created_at', { ascending: false }).limit(120))
  },
  async highlights(userId) {
    return ok(await sb.from('highlights').select('*, items:highlight_items(*)').eq('owner_id', userId)
      .order('created_at').order('created_at', { referencedTable: 'highlight_items' }))
  },
  async createHighlight(title, storyIds) {
    return ok(await sb.rpc('create_highlight', { p_title: title, p_stories: storyIds }))
  },
  async deleteHighlight(id) { ok(await sb.from('highlights').delete().eq('id', id)) },
  async storyViewers(id) {
    const rows = ok(await sb.from('story_views').select(`viewed_at, viewer:profiles!story_views_viewer_id_fkey(${PERSON})`)
      .eq('story_id', id).order('viewed_at', { ascending: false }).limit(200))
    return rows.filter((r) => r.viewer && r.viewer.id !== uid()).map((r) => ({ ...r.viewer, viewed_at: r.viewed_at }))
  },
  async deleteStory(id) {
    ok(await sb.from('stories').delete().eq('id', id))
  },
  async viewStory(id) {
    await sb.from('story_views').upsert({ story_id: id, viewer_id: uid() }, { ignoreDuplicates: true })
  },

  // ---- სტუმრები, საჩუქრები
  async visit(id) {
    if (id !== uid()) await sb.rpc('record_visit', { p_profile: id })
  },
  async guests() {
    const rows = ok(await sb.from('profile_visits').select(`visited_at, visitor:profiles!profile_visits_visitor_id_fkey(${PERSON})`)
      .eq('profile_id', uid()).order('visited_at', { ascending: false }).limit(100))
    return rows.map((r) => ({ ...r.visitor, visited_at: r.visited_at }))
  },
  async sendGift(to, kind, note) {
    ok(await sb.from('gifts').insert({ from_id: uid(), to_id: to, kind, note }))
  },
  async gifts(userId) {
    return ok(await sb.from('gifts').select(`*, from:profiles!gifts_from_id_fkey(${PERSON})`).eq('to_id', userId)
      .order('created_at', { ascending: false }).limit(60))
  },

  // ---- შეტყობინებები
  async notifications() {
    return ok(await sb.from('notifications').select(`*, actor:profiles!notifications_actor_id_fkey(${PERSON}), post:posts(id,body,media), group:groups(slug,name), event:events(id,title), tournament:tournaments(id,title,type)`)
      .eq('user_id', uid()).order('created_at', { ascending: false }).limit(80))
  },
  async markNotificationsRead() {
    await sb.from('notifications').update({ read: true }).eq('user_id', uid()).eq('read', false)
  },
  async unreadCounts() {
    const [n, convs] = await Promise.all([
      sb.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', uid()).eq('read', false),
      sb.rpc('my_conversations'),
    ])
    return { notifications: n.count || 0, messages: (convs.data || []).filter((c) => c.unread).length }
  },
  subscribeNotifications(cb) {
    const ch = pgChannel(`notif:${uid()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid()}` }, (p) => cb(p.new))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => cb(null))
      .subscribe()
    return () => sb.removeChannel(ch)
  },

  // ---- ჩატი
  async conversations() {
    return ok(await sb.rpc('my_conversations'))
  },
  async openDM(userId) {
    return ok(await sb.rpc('get_or_create_dm', { p_other: userId }))
  },
  async conversation(id) {
    const all = ok(await sb.rpc('my_conversations'))
    const c = all.find((x) => x.id === id) || null
    if (c?.other?.id) {
      const v = ok(await sb.from('profiles').select('verified').eq('id', c.other.id).maybeSingle())
      c.other = { ...c.other, verified: Boolean(v?.verified) }
    }
    return c
  },
  async messages(convId) {
    const rows = ok(await sb.from('messages').select(MSG).eq('conversation_id', convId).order('created_at', { ascending: false }).limit(150))
    return rows.reverse()
  },
  async send(convId, { body = '', media_url = null, media_type = null, reply_to = null, meta = {} }) {
    return ok(await sb.from('messages').insert({ conversation_id: convId, sender_id: uid(), body, media_url, media_type, reply_to, meta }).select(MSG).single())
  },
  // მოვლენები: { kind: 'message:new' | 'message:update' | 'reaction:set' | 'reaction:remove', row }
  subscribeMessages(convId, cb) {
    const ch = pgChannel(`conv:${convId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, (p) => cb({ kind: 'message:new', row: p.new }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, (p) => cb({ kind: 'message:update', row: p.new }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions', filter: `conversation_id=eq.${convId}` }, (p) => {
        cb(p.eventType === 'DELETE' ? { kind: 'reaction:remove', row: p.old } : { kind: 'reaction:set', row: p.new })
      })
      .subscribe()
    return () => sb.removeChannel(ch)
  },
  async react(messageId, emoji) {
    if (emoji) ok(await sb.from('message_reactions').upsert({ message_id: messageId, user_id: uid(), emoji }))
    else ok(await sb.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', uid()))
  },
  async deleteMessage(id) { ok(await sb.rpc('delete_message', { p_id: id })) },
  async createGroupChat(title, memberIds) { return ok(await sb.rpc('create_group_chat', { p_title: title, p_members: memberIds })) },
  async chatMembers(convId) { return ok(await sb.rpc('chat_members', { p_conv: convId })) },
  async addChatMembers(convId, ids) { ok(await sb.rpc('add_chat_members', { p_conv: convId, p_members: ids })) },
  async leaveChat(convId) { ok(await sb.rpc('leave_chat', { p_conv: convId })) },
  async renameChat(convId, title) { ok(await sb.rpc('rename_chat', { p_conv: convId, p_title: title })) },

  // ---- ზარები
  async startCall(convId, calleeId, kind) {
    return ok(await sb.from('calls').insert({ conversation_id: convId, caller_id: uid(), callee_id: calleeId, kind }).select().single())
  },
  async updateCall(id, status) {
    ok(await sb.from('calls').update({ status }).eq('id', id))
  },
  onIncomingCall(cb) {
    const ch = pgChannel(`calls-in:${uid()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: `callee_id=eq.${uid()}` }, async (p) => {
        const caller = ok(await sb.from('profiles').select(PERSON).eq('id', p.new.caller_id).maybeSingle())
        cb({ ...p.new, caller })
      })
      .subscribe()
    return () => sb.removeChannel(ch)
  },
  onCallChange(id, cb) {
    const ch = pgChannel(`call-row:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${id}` }, (p) => cb(p.new))
      .subscribe()
    return () => sb.removeChannel(ch)
  },
  // SDP/ICE გაცვლა. არხის სახელი = ზარის შემთხვევითი id
  callChannel(id) {
    return new Promise((resolve) => {
      const handlers = new Set()
      const ch = sb.channel(`call:${id}`, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'sig' }, ({ payload }) => handlers.forEach((h) => h(payload)))
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve({
          send: (type, payload) => ch.send({ type: 'broadcast', event: 'sig', payload: { type, payload } }),
          onMessage: (h) => { handlers.add(h); return () => handlers.delete(h) },
          close: () => sb.removeChannel(ch),
        })
      })
    })
  },
  async markRead(convId) {
    await sb.rpc('mark_read', { p_conv: convId })
  },
  subscribeTyping(convId, cb) {
    const name = `typing:${convId}`
    const s = joinShared(name, { config: { broadcast: { self: false } } }, (sh) => {
      sh.ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload.user !== uid()) sh.subs.forEach((f) => f(payload.on))
      }).subscribe()
    })
    s.subs.add(cb)
    return () => leaveShared(name, cb)
  },
  sendTyping(convId, isOn) {
    sharedChannels.get(`typing:${convId}`)?.ch.send({ type: 'broadcast', event: 'typing', payload: { user: uid(), on: isOn } })
  },

  // ---- გაცნობა
  async datingProfile() {
    return ok(await sb.from('dating_profiles').select('*').eq('user_id', uid()).maybeSingle())
  },
  async saveDatingProfile(data) {
    return ok(await sb.from('dating_profiles').upsert({ ...data, user_id: uid() }).select().single())
  },
  async candidates() {
    return ok(await sb.rpc('dating_candidates', { p_limit: 20 }))
  },
  async nearby() {
    return ok(await sb.rpc('dating_nearby', { p_limit: 40 }))
  },
  async swipe(targetId, liked) {
    ok(await sb.from('swipes').upsert({ swiper_id: uid(), target_id: targetId, liked }, { ignoreDuplicates: true }))
    if (!liked) return { match: null }
    const a = [uid(), targetId].sort()
    const m = ok(await sb.from('matches').select('id,conversation_id').eq('user_a', a[0]).eq('user_b', a[1]).maybeSingle())
    return { match: m }
  },
  async matches() {
    return ok(await sb.rpc('my_matches'))
  },

  // ---- თამაშები (Edge Function „game“ ამოწმებს ყველა სვლას)
  async myGames() {
    const u = uid()
    return ok(await sb.from('games').select(GAME)
      .or(`player_a.eq.${u},player_b.eq.${u},player_c.eq.${u},player_d.eq.${u},invited.eq.${u},invites.cs.{${u}}`)
      .in('status', ['waiting', 'active']).order('updated_at', { ascending: false }).limit(30))
  },
  async game(id) {
    const g = ok(await sb.from('games').select(GAME).eq('id', id).maybeSingle())
    if (!g || !HIDDEN.has(g.type)) return g
    const seat = ['a', 'b', 'c', 'd'].find((s) => g[`player_${s}`] === uid() && !(g.bots || []).includes(s))
    if (!seat || g.status === 'finished') return g
    const hand = ok(await sb.from('game_hands').select('tiles').eq('game_id', id).eq('seat', seat).maybeSingle())
    return { ...g, state: withMyHand(g.type, g.state, seat, hand?.tiles) }
  },
  // opts: { tc, mode, invites }
  async createGame(type, invite = null, opts = {}) {
    return (await gameFn({ op: 'create', type, invite, invites: opts.invites, tc: opts.tc || undefined, mode: opts.mode })).id
  },
  async joinRandom(type, opts = {}) {
    return (await gameFn({ op: 'random', type, tc: opts.tc || undefined, mode: opts.mode, tournament: opts.tournament })).id
  },
  async startTable(id) {
    await gameFn({ op: 'start', id })
  },
  async flag(id) {
    return gameFn({ op: 'flag', id })
  },
  // ლოტო: შემდეგი კასრი (სერვერი თვითონ ამოწმებს დროს)
  async tick(id) {
    return gameFn({ op: 'tick', id })
  },
  // ახლა მიმდინარე საჯარო თამაშები (ყურებისთვის)
  async liveGames() {
    const rows = ok(await sb.from('games').select(GAME).eq('status', 'active').eq('is_public', true).order('updated_at', { ascending: false }).limit(24))
    return rows.filter((g) => ![g.player_a, g.player_b, g.player_c, g.player_d].includes(uid())).slice(0, 12)
  },
  async gameMessages(id) {
    const rows = ok(await sb.from('game_messages').select(`*, p:profiles(${PERSON})`).eq('game_id', id).order('created_at', { ascending: false }).limit(40))
    return rows.reverse()
  },
  async sendGameMessage(id, kind, body) {
    ok(await sb.from('game_messages').insert({ game_id: id, user_id: uid(), kind, body }))
  },
  subscribeGameMessages(id, cb) {
    const ch = pgChannel(`gm:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_messages', filter: `game_id=eq.${id}` }, async (p) => {
        const { data } = await sb.from('profiles').select(PERSON).eq('id', p.new.user_id).maybeSingle()
        cb({ ...p.new, p: data })
      })
      .subscribe()
    return () => sb.removeChannel(ch)
  },
  // ვინ უყურებს: Realtime presence (role: player | spectator)
  watchGame(id, role, onCount) {
    const name = `watch:${id}`
    const sub = { role, onCount }
    const roleNow = (sh) => [...sh.subs].at(-1)?.role
    const s = joinShared(name, { config: { presence: { key: uid() } } }, (sh) => {
      sh.ch.on('presence', { event: 'sync' }, () => {
        const metas = Object.values(sh.ch.presenceState()).map((list) => list[0])
        const n = metas.filter((m) => m?.role === 'spectator').length
        sh.subs.forEach((x) => x.onCount(n))
      }).subscribe(async (st) => {
        if (st !== 'SUBSCRIBED') return
        sh.joined = true
        if (roleNow(sh)) await sh.ch.track({ role: roleNow(sh) })
      })
    })
    s.subs.add(sub)
    if (s.joined) s.ch.track({ role })
    return () => leaveShared(name, sub, (sh) => { if (sh.joined) sh.ch.untrack() })
  },
  async dailyPuzzle() { return ok(await sb.rpc('daily_puzzle')) },
  async puzzleMove(moves) { return ok(await sb.rpc('puzzle_move', { p_moves: moves })) },
  async joinGame(id) {
    await gameFn({ op: 'join', id })
  },
  async move(id, action, moveNo) {
    return gameFn({ op: 'move', id, action, move_no: moveNo })
  },
  async resign(id) {
    await gameFn({ op: 'resign', id })
  },
  subscribeGame(id, cb) {
    const ch = pgChannel(`game:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${id}` }, () => cb())
      .subscribe()
    return () => sb.removeChannel(ch)
  },
  async stats(userId) {
    return ok(await sb.from('game_stats').select('*').eq('user_id', userId))
  },
  async leaderboard(type) {
    return ok(await sb.from('game_stats').select(`*, p:profiles(${PERSON})`).eq('type', type).order('rating', { ascending: false }).limit(20))
  },

  // ---- ტურნირები (არენა)
  async tournaments() {
    const since = new Date(Date.now() - 7 * 864e5).toISOString()
    const list = ok(await sb.from('tournaments').select('*, tournament_players(count)').gte('ends_at', since)
      .order('starts_at', { ascending: true }).limit(30))
    const done = list.filter((t) => Date.parse(t.ends_at) <= Date.now()).map((t) => t.id)
    const top = done.length ? ok(await sb.from('tournament_players').select(`tournament_id, score, p:profiles(${PERSON})`)
      .in('tournament_id', done).gt('games', 0).order('score', { ascending: false })) : []
    return list.map((t) => ({ ...t, players_count: t.tournament_players?.[0]?.count || 0, winner: top.find((r) => r.tournament_id === t.id)?.p || null }))
  },
  async tournament(id) {
    return ok(await sb.from('tournaments').select('*').eq('id', id).maybeSingle())
  },
  async tournamentStandings(id) {
    return ok(await sb.from('tournament_players').select(`*, p:profiles(${PERSON})`).eq('tournament_id', id)
      .order('score', { ascending: false }).order('wins', { ascending: false }).order('joined_at').limit(200))
  },
  async joinTournament(id) { ok(await sb.rpc('join_tournament', { p_id: id })) },
  // დაწყების/დასრულების დამუშავება (pg_cron-ის გარეშეც მუშაობს — გვერდის გახსნისას)
  async tournamentTick() { return ok(await sb.rpc('tournament_tick')) },
  async trophies(userId) {
    return ok(await sb.from('tournament_players').select('place, score, tournament:tournaments(id,title,type,ends_at)')
      .eq('user_id', userId).eq('place', 1).limit(20))
  },
  async leaveTournament(id) { ok(await sb.rpc('leave_tournament', { p_id: id })) },
  async createTournament(data) {
    return ok(await sb.from('tournaments').insert({ ...data, created_by: uid() }).select().single())
  },
  subscribeTournament(id, cb) {
    const ch = pgChannel(`tour:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_players', filter: `tournament_id=eq.${id}` }, () => cb())
      .subscribe()
    return () => sb.removeChannel(ch)
  },

  // ---- უსაფრთხოება
  async block(id) {
    ok(await sb.from('blocks').upsert({ blocker_id: uid(), blocked_id: id }, { ignoreDuplicates: true }))
    await sb.from('follows').delete().eq('follower_id', uid()).eq('following_id', id)
  },
  async report({ user = null, post = null, listing = null, category = 'other', reason = '' }) {
    ok(await sb.from('reports').insert({ reporter_id: uid(), target_user: user, target_post: post, target_listing: listing, category, reason: reason || category }))
  },

  // ---- Push
  async savePush(sub) {
    const j = sub.toJSON()
    ok(await sb.from('push_subscriptions').upsert(
      { user_id: uid(), endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) },
      { onConflict: 'endpoint' },
    ))
  },
  async deletePush(endpoint) {
    await sb.from('push_subscriptions').delete().eq('endpoint', endpoint)
  },

  // ---- ჯგუფები
  async myGroups() {
    const rows = ok(await sb.from('group_members').select(`role,status,g:groups(${GROUP})`).eq('user_id', uid()).order('created_at', { ascending: false }))
    return rows.filter((r) => r.g).map((r) => ({ ...r.g, my_role: r.role, my_status: r.status }))
  },
  async discoverGroups(q = '') {
    let x = sb.from('groups').select(GROUP).order('members_count', { ascending: false }).limit(30)
    if (q.trim()) x = x.ilike('name', `%${q.replace(/[%,()]/g, ' ').trim()}%`)
    return ok(await x)
  },
  async group(slug) {
    const g = ok(await sb.from('groups').select(GROUP).eq('slug', slug).maybeSingle())
    if (!g) return null
    const m = ok(await sb.from('group_members').select('role,status').eq('group_id', g.id).eq('user_id', uid()).maybeSingle())
    return { ...g, my_role: m?.role || null, my_status: m?.status || null }
  },
  async slugFree(slug) {
    return !ok(await sb.from('groups').select('id').eq('slug', slug).maybeSingle())
  },
  async createGroup({ name, slug, description = '', privacy = 'public', cover_url = null }) {
    return ok(await sb.from('groups').insert({ name, slug, description, privacy, cover_url, owner_id: uid() }).select(GROUP).single())
  },
  async updateGroup(id, patch) {
    return ok(await sb.from('groups').update(patch).eq('id', id).select(GROUP).single())
  },
  async deleteGroup(id) { ok(await sb.from('groups').delete().eq('id', id)) },
  async joinGroup(id) { return ok(await sb.rpc('join_group', { p_group: id })) },
  async leaveGroup(id) { ok(await sb.rpc('leave_group', { p_group: id })) },
  async groupPosts(id) {
    return withLikes(ok(await sb.from('posts').select(POST).eq('group_id', id).is('parent_id', null).order('created_at', { ascending: false }).limit(40)))
  },
  async groupMembers(id) {
    const rows = ok(await sb.from('group_members').select(`role,status,created_at,p:profiles(${PERSON},bio)`).eq('group_id', id).limit(300))
    return rows.filter((r) => r.p).map((r) => ({ ...r.p, role: r.role, status: r.status }))
  },
  async manageMember(groupId, userId, action) {
    ok(await sb.rpc('manage_member', { p_group: groupId, p_user: userId, p_action: action }))
  },

  // ---- ივენთები
  async events({ scope = 'upcoming', groupId = null } = {}) {
    let rows
    if (scope === 'mine') {
      const r = ok(await sb.from('event_rsvps').select('event_id').eq('user_id', uid()))
      const ids = r.map((x) => x.event_id)
      rows = ok(await sb.from('events').select(EVENT).or(`host_id.eq.${uid()}${ids.length ? `,id.in.(${ids.join(',')})` : ''}`).order('starts_at').limit(60))
    } else {
      let q = sb.from('events').select(EVENT).gte('starts_at', new Date(Date.now() - 6 * 3600e3).toISOString()).order('starts_at').limit(60)
      if (groupId) q = q.eq('group_id', groupId)
      rows = ok(await q)
    }
    return withRsvp(rows)
  },
  async event(id) {
    const e = ok(await sb.from('events').select(EVENT).eq('id', id).maybeSingle())
    return e ? (await withRsvp([e]))[0] : null
  },
  async createEvent(data) {
    return ok(await sb.from('events').insert({ ...data, host_id: uid() }).select(EVENT).single())
  },
  async updateEvent(id, patch) { return ok(await sb.from('events').update(patch).eq('id', id).select(EVENT).single()) },
  async deleteEvent(id) { ok(await sb.from('events').delete().eq('id', id)) },
  async rsvp(eventId, status) {
    if (!status) ok(await sb.from('event_rsvps').delete().eq('event_id', eventId).eq('user_id', uid()))
    else ok(await sb.from('event_rsvps').upsert({ event_id: eventId, user_id: uid(), status }))
  },
  async attendees(eventId) {
    const rows = ok(await sb.from('event_rsvps').select(`status, p:profiles(${PERSON})`).eq('event_id', eventId).limit(300))
    return rows.filter((r) => r.p).map((r) => ({ ...r.p, status: r.status }))
  },

  // ---- ბაზარი
  async listings({ q = '', category = null, city = null, min = null, max = null, currency = 'GEL', condition = null, sort = 'new', seller = null, offset = 0, limit = 24 } = {}) {
    let x = sb.from('listings').select(LISTING)
    if (seller) x = x.eq('seller_id', seller)
    else x = x.in('status', ['active', 'reserved'])
    if (like(q)) x = x.or(`title.ilike.%${like(q)}%,description.ilike.%${like(q)}%`)
    if (category) x = x.eq('category', category)
    if (city) x = x.eq('city', city)
    if (condition) x = x.eq('condition', condition)
    if (min !== null || max !== null) {
      x = x.eq('currency', currency)
      if (min !== null) x = x.gte('price', min)
      if (max !== null) x = x.lte('price', max)
    }
    if (sort === 'cheap') x = x.order('price', { ascending: true, nullsFirst: false })
    else if (sort === 'expensive') x = x.order('price', { ascending: false, nullsFirst: false })
    if (seller) x = x.order('status').order('created_at', { ascending: false })
    else x = x.order('bumped_at', { ascending: false })
    return withListingSaves(ok(await x.range(offset, offset + limit - 1)))
  },
  async listing(id) {
    const l = ok(await sb.from('listings').select(LISTING).eq('id', id).maybeSingle())
    if (!l) return null
    const [withSaved] = await withListingSaves([l])
    const stats = ok(await sb.rpc('seller_stats', { p_user: l.seller_id }))
    return { ...withSaved, seller_stats: stats }
  },
  async myListings() {
    return withListingSaves(ok(await sb.from('listings').select(LISTING).eq('seller_id', uid()).order('created_at', { ascending: false }).limit(100)))
  },
  async savedListings() {
    const rows = ok(await sb.from('listing_saves').select(`created_at, l:listings(${LISTING})`).eq('user_id', uid()).order('created_at', { ascending: false }).limit(100))
    return rows.filter((r) => r.l).map((r) => ({ ...r.l, saved: true }))
  },
  async createListing(data) {
    return ok(await sb.from('listings').insert({ ...data, seller_id: uid() }).select(LISTING).single())
  },
  async updateListing(id, patch) {
    return ok(await sb.from('listings').update(patch).eq('id', id).select(LISTING).single())
  },
  async deleteListing(id) { ok(await sb.from('listings').delete().eq('id', id)) },
  async bumpListing(id) { return ok(await sb.rpc('bump_listing', { p_id: id })) },
  async viewListing(id) { await sb.rpc('view_listing', { p_id: id }) },
  async saveListing(id, on) {
    if (on) ok(await sb.from('listing_saves').upsert({ user_id: uid(), listing_id: id }, { ignoreDuplicates: true }))
    else ok(await sb.from('listing_saves').delete().eq('user_id', uid()).eq('listing_id', id))
  },
  // „მომწერე“: DM გამყიდველთან + განცხადების ბარათი მესიჯში
  async contactSeller(listing, body) {
    const conv = await this.openDM(listing.seller_id)
    await this.send(conv, { body, meta: { listing: { id: listing.id } } })
    return conv
  },

  // ---- გაზიარება და მოწვევა
  async ogPreview(kind, key) { return ok(await sb.rpc('og_preview', { p_kind: kind, p_key: key })) },
  async claimInvite(username) { return ok(await sb.rpc('claim_invite', { p_username: username })) },
  async inviteStats() { return ok(await sb.rpc('invite_stats')) },

  // ---- ორფაქტორიანი შესვლა (TOTP)
  async mfaState() {
    const [{ data: lvl }, { data: f }] = await Promise.all([sb.auth.mfa.getAuthenticatorAssuranceLevel(), sb.auth.mfa.listFactors()])
    const totp = f?.totp?.find((x) => x.status === 'verified') || null
    return { enabled: Boolean(totp), factorId: totp?.id || null, needsCode: lvl?.nextLevel === 'aal2' && lvl?.currentLevel !== 'aal2' }
  },
  async mfaEnroll() {
    const { data: f } = await sb.auth.mfa.listFactors()
    for (const x of f?.all || []) if (x.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: x.id })
    const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `ეზო ${Date.now().toString(36)}` })
    if (error) throw new Error(humanError(error.message))
    return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri }
  },
  async mfaVerify(factorId, code) {
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code })
    if (error) throw new Error('კოდი არასწორია ან ვადა გაუვიდა')
  },
  async mfaVerifyLogin(code) {
    const { data: f } = await sb.auth.mfa.listFactors()
    const totp = f?.totp?.find((x) => x.status === 'verified')
    if (!totp) return
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: totp.id, code })
    if (error) throw new Error('კოდი არასწორია ან ვადა გაუვიდა')
  },
  async mfaDisable(factorId) {
    const { error } = await sb.auth.mfa.unenroll({ factorId })
    if (error) throw new Error(humanError(error.message))
  },

  // ---- ჩემი მონაცემები
  async exportMyData() { return ok(await sb.rpc('export_my_data')) },
  async deleteMyAccount() {
    // ფაილები საცავიდან (საუკეთესო მცდელობით), მერე ანგარიში
    try {
      const root = uid()
      const { data: folders } = await sb.storage.from('media').list(root, { limit: 100 })
      for (const f of folders || []) {
        const { data: files } = await sb.storage.from('media').list(`${root}/${f.name}`, { limit: 1000 })
        const paths = (files || []).map((x) => `${root}/${f.name}/${x.name}`)
        if (paths.length) await sb.storage.from('media').remove(paths)
      }
    } catch { /* ფაილები არ არის */ }
    ok(await sb.rpc('delete_my_account'))
    await sb.auth.signOut()
  },
  async bannedWords() { return ok(await sb.from('banned_words').select('*').order('created_at', { ascending: false })) },
  async addBannedWord(w) { ok(await sb.from('banned_words').insert({ word: w.trim().toLowerCase() })) },
  async removeBannedWord(w) { ok(await sb.from('banned_words').delete().eq('word', w)) },

  // ---- ქულები და მიღწევები
  async dailyCheckin() { return ok(await sb.rpc('daily_checkin')) },
  async myProgress() {
    const [p, badges, events] = await Promise.all([
      sb.rpc('my_progress'),
      sb.from('user_badges').select('badge,earned_at').eq('user_id', uid()),
      sb.from('progress_events').select('id,kind,xp,coins,ref,created_at').eq('user_id', uid()).order('created_at', { ascending: false }).limit(30),
    ])
    return { ...ok(p), badges: ok(badges), events: ok(events) }
  },
  async profileProgress(userId) { return ok(await sb.rpc('profile_progress', { p_user: userId })) },
  async xpLeaderboard(scope = 'friends') {
    const rows = ok(await sb.rpc('xp_leaderboard', { p_scope: scope }))
    return rows.map((r) => ({ user: { id: r.user_id, username: r.username, full_name: r.full_name, avatar_url: r.avatar_url }, week_xp: Number(r.week_xp), level: r.level }))
  },

  // ---- #თეგები
  async tagPosts(tag) {
    return withLikes(ok(await sb.rpc('tag_posts', { p_tag: tag, p_limit: 40 }).select(POST)))
  },
  async trendingTags() {
    return ok(await sb.rpc('trending_tags', { p_limit: 12 }))
  },

  // ---- მოდერაცია
  async adminStats() { return ok(await sb.rpc('admin_stats')) },
  async adminReports(status = 'open') { return ok(await sb.rpc('admin_reports', { p_status: status })) },
  async adminResolve(id, action, days = null, note = null) {
    ok(await sb.rpc('admin_resolve', { p_report: id, p_action: action, p_days: days, p_note: note }))
  },
  async adminBan(userId, days = null, note = null) { ok(await sb.rpc('admin_ban', { p_user: userId, p_days: days, p_note: note })) },
  async adminUnban(userId) { ok(await sb.rpc('admin_unban', { p_user: userId })) },
  async adminSetVerified(userId, on) { ok(await sb.rpc('admin_set_verified', { p_user: userId, p_on: on })) },
  async adminAnalytics(days = 30) { return ok(await sb.rpc('admin_analytics', { p_days: days })) },

  // ---- შეტყობინებების პარამეტრები (Push): რომელი კატეგორია მოვიდეს და ჩუმი საათები. სერვერი ამოწმებს
  async notificationPrefs() { return ok(await sb.from('notification_prefs').select('*').eq('user_id', uid()).maybeSingle()) },
  async saveNotificationPrefs(patch) {
    return ok(await sb.from('notification_prefs').upsert({ user_id: uid(), ...patch, updated_at: new Date().toISOString() }).select().single())
  },

  // შეცდომების ჟურნალი (ჩაწერისას შეცდომა არ ისვრის — ჟურნალი აპს არ უნდა შეეხოს)
  async logError(e) {
    await sb.rpc('log_client_error', { p_message: e.message, p_stack: e.stack, p_path: e.path, p_source: e.source, p_release: e.release, p_agent: e.agent })
  },
  async adminErrors(days = 7) { return ok(await sb.rpc('admin_errors', { p_days: days })) },
  async adminClearErrors(message) { return ok(await sb.rpc('admin_clear_errors', { p_message: message })) },
}
