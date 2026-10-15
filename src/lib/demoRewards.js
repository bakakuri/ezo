// დემო: ქულები, დონეები, დღიური სერია, ბეჯები — იგივე ინტერფეისი, რაც api.supabase.js-ს აქვს
import { BADGES, levelOf, checkinReward, GIFT_PRICES, FREE_GIFTS_PER_DAY } from './rewards.js'

const tbilisiDay = (offset = 0) => new Date(Date.now() + offset * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Tbilisi' })

export function demoRewards({ ME, person, nid, ago, notifications, emit, metrics, isFollowing }) {
  // ?demoCheckin — დღევანდელი ბონუსი ჯერ აღებული არ არის (მე-7 დღე)
  const fresh = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demoCheckin')
  const me = { xp: 820, coins: 145, streak: fresh ? 6 : 4, best_streak: 9, last_day: fresh ? tbilisiDay(-1) : tbilisiDay(0) }
  const earned = new Map([['first_post', ago(60 * 24 * 80)], ['games_10', ago(60 * 24 * 30)], ['likes_100', ago(60 * 24 * 12)], ['streak_7', ago(60 * 24 * 3)]])
  let seq = 0
  const ev = (kind, xp, coins, min, ref = null) => ({ id: ++seq, kind, xp, coins, ref, created_at: ago(min) })
  const events = [
    ...(fresh ? [] : [ev('checkin', 10, 11, 20)]),
    ev('like', 1, 0, 45), ev('win', 10, 3, 130), ev('game', 5, 0, 130), ev('post', 5, 0, 300),
    ev('gift', 0, -20, 600, 'rose'), ev('checkin', 10, 9, 60 * 24), ev('badge', 0, 30, 60 * 24 * 3, 'streak_7'), ev('level', 0, 20, 60 * 24 * 5, '4'),
  ]
  const others = {
    u1: { xp: 2400, streak: 12, badges: ['first_post', 'likes_100', 'posts_50', 'followers_50', 'streak_7'] },
    u2: { xp: 1350, streak: 3, badges: ['first_post', 'games_10', 'wins_50'] },
    u3: { xp: 320, streak: 0, badges: ['first_post'] },
    u4: { xp: 980, streak: 1, badges: ['first_post', 'first_sale'] },
    u5: { xp: 3100, streak: 21, badges: ['first_post', 'likes_100', 'likes_1000', 'streak_7', 'generous'] },
    u6: { xp: 150, streak: 0, badges: [] },
    u7: { xp: 1900, streak: 5, badges: ['first_post', 'games_10', 'wins_50', 'champion'] },
  }
  const weekly = { me: 140, u1: 260, u2: 95, u3: 40, u4: 60, u5: 310, u6: 20, u7: 180 }

  const notify = (type, data) => {
    notifications.push({ id: nid('n'), type, actor_id: null, data, read: false, created_at: new Date().toISOString() })
    emit('notif', null)
  }
  function award(kind, xp, coins, ref = null) {
    sync()
    if (ref && events.some((e) => e.kind === kind && e.ref === ref)) return false
    const before = levelOf(me.xp)
    me.xp += xp
    me.coins += coins
    weekly.me = (weekly.me || 0) + xp
    events.unshift({ id: ++seq, kind, xp, coins, ref, created_at: new Date().toISOString() })
    const after = levelOf(me.xp)
    if (after > before) {
      me.coins += after * 5
      events.unshift({ id: ++seq, kind: 'level', xp: 0, coins: after * 5, ref: String(after), created_at: new Date().toISOString() })
      notify('level_up', { level: after, coins: after * 5 })
    }
    checkBadges()
    return true
  }
  // სერვერის მსგავსად: გაყიდვები ქულების ისტორიიდან ითვლება
  const allMetrics = () => ({ ...metrics(), streak: me.best_streak, level: levelOf(me.xp), sales: events.filter((e) => e.kind === 'sale').length })
  // დემოს საწყისი მონაცემებით უკვე მიღწეული ბეჯები — ჩუმად, ჯილდოს გარეშე
  let synced = false
  function sync() {
    if (synced) return
    synced = true
    const m = allMetrics()
    for (const b of BADGES) if (!earned.has(b.key) && (m[b.metric] || 0) >= b.target) earned.set(b.key, ago(60 * 24 * 20))
  }
  function checkBadges() {
    sync()
    const m = allMetrics()
    for (const b of BADGES) {
      if (earned.has(b.key) || (m[b.metric] || 0) < b.target) continue
      earned.set(b.key, new Date().toISOString())
      me.coins += b.coins
      events.unshift({ id: ++seq, kind: 'badge', xp: 0, coins: b.coins, ref: b.key, created_at: new Date().toISOString() })
      notify('achievement', { badge: b.key, coins: b.coins })
    }
  }

  const methods = {
    async dailyCheckin() {
      sync()
      const today = tbilisiDay(0)
      if (me.last_day === today) return { claimed: false, streak: me.streak, coins: me.coins, xp: me.xp, level: levelOf(me.xp) }
      me.streak = me.last_day === tbilisiDay(-1) ? me.streak + 1 : 1
      me.best_streak = Math.max(me.best_streak, me.streak)
      me.last_day = today
      const reward = checkinReward(me.streak)
      award('checkin', 10, reward, today)
      return { claimed: true, first: false, streak: me.streak, reward, coins: me.coins, xp: me.xp, level: levelOf(me.xp) }
    },
    async myProgress() {
      sync()
      const today = tbilisiDay(0)
      const alive = me.last_day === today || me.last_day === tbilisiDay(-1)
      return {
        xp: me.xp, coins: me.coins, streak: alive ? me.streak : 0, best_streak: me.best_streak, last_day: me.last_day,
        level: levelOf(me.xp), claimed_today: me.last_day === today,
        metrics: { ...metrics(), streak: me.best_streak, level: levelOf(me.xp) },
        badges: [...earned.entries()].map(([badge, earned_at]) => ({ badge, earned_at })),
        events: events.slice(0, 30),
      }
    },
    async profileProgress(userId) {
      sync()
      if (userId === ME) return { level: levelOf(me.xp), xp: me.xp, streak: me.streak, badges: [...earned.keys()] }
      const o = others[userId] || { xp: 0, streak: 0, badges: [] }
      return { level: levelOf(o.xp), xp: o.xp, streak: o.streak, badges: o.badges }
    },
    async xpLeaderboard(scope = 'friends') {
      return Object.entries(weekly)
        .filter(([id, xp]) => xp > 0 && (scope === 'all' || id === ME || isFollowing(id)))
        .map(([id, xp]) => ({ user: person(id), week_xp: xp, level: levelOf(id === ME ? me.xp : others[id]?.xp || 0) }))
        .sort((a, b) => b.week_xp - a.week_xp)
    },
  }

  return {
    methods,
    award,
    checkBadges,
    // საჩუქარი: უფასოზე დღიური ლიმიტი, ფასიანზე ბროწეულის ჩამოჭრა
    payForGift(kind, freeToday) {
      const price = GIFT_PRICES[kind] || 0
      if (!price) {
        if (freeToday >= FREE_GIFTS_PER_DAY) throw new Error('უფასო საჩუქარი დღეში 5-ჯერ შეიძლება — სხვები ბროწეულით იგზავნება')
        return
      }
      if (me.coins < price) throw new Error('ბროწეული არ გყოფნის')
      me.coins -= price
      events.unshift({ id: ++seq, kind: 'gift', xp: 0, coins: -price, ref: kind, created_at: new Date().toISOString() })
    },
  }
}
