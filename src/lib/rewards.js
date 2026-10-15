// ქულები, დონეები, ბეჯები და „ბროწეული“ — კლიენტის ცნობარი.
// ბეჯების metric/target/coins/title უნდა ემთხვეოდეს supabase/schema.sql-ის `badges` ცხრილს (ამოწმებს tests/rewards.test.mjs).

export const BADGES = [
  { key: 'first_post', metric: 'posts', target: 1, coins: 10, title: 'პირველი სიტყვა', desc: 'დაწერე პირველი პოსტი', icon: 'edit', hue: '#3a6df0' },
  { key: 'posts_50', metric: 'posts', target: 50, coins: 50, title: 'მთხრობელი', desc: '50 პოსტი', icon: 'edit', hue: '#6d4ad8' },
  { key: 'likes_100', metric: 'likes', target: 100, coins: 40, title: 'მოსაწონი', desc: 'მიიღე 100 მოწონება', icon: 'heart', hue: '#df1f52' },
  { key: 'likes_1000', metric: 'likes', target: 1000, coins: 150, title: 'ეზოს ვარსკვლავი', desc: 'მიიღე 1000 მოწონება', icon: 'star', hue: '#e09a14' },
  { key: 'followers_50', metric: 'followers', target: 50, coins: 50, title: 'ცნობადი სახე', desc: '50 გამომწერი', icon: 'users', hue: '#0f9d8a' },
  { key: 'streak_7', metric: 'streak', target: 7, coins: 30, title: 'ერთი კვირა', desc: '7 დღე ზედიზედ შემოდი', icon: 'flame', hue: '#f2652a' },
  { key: 'streak_30', metric: 'streak', target: 30, coins: 150, title: 'ერთგული', desc: '30 დღე ზედიზედ შემოდი', icon: 'flame', hue: '#c4102f' },
  { key: 'games_10', metric: 'games', target: 10, coins: 20, title: 'მოთამაშე', desc: 'ითამაშე 10 ონლაინ თამაში', icon: 'dice', hue: '#2c7a73' },
  { key: 'wins_50', metric: 'wins', target: 50, coins: 100, title: 'ოსტატი', desc: 'მოიგე 50 თამაში', icon: 'trophy', hue: '#9a5b2e' },
  { key: 'champion', metric: 'tourney', target: 1, coins: 100, title: 'ჩემპიონი', desc: 'გაიმარჯვე ტურნირში', icon: 'trophy', hue: '#c98a12' },
  { key: 'first_sale', metric: 'sales', target: 1, coins: 20, title: 'ვაჭარი', desc: 'გაყიდე ნივთი ბაზარში', icon: 'tag', hue: '#4f9a1c' },
  { key: 'generous', metric: 'gifts', target: 10, coins: 30, title: 'გულუხვი', desc: 'აჩუქე 10 საჩუქარი', icon: 'gift', hue: '#d9468f' },
  { key: 'level_10', metric: 'level', target: 10, coins: 100, title: 'ეზოს ძველი', desc: 'მიაღწიე მე-10 დონეს', icon: 'medal', hue: '#8a35e8' },
]
export const badgeOf = (k) => BADGES.find((b) => b.key === k)

// დონე n იწყება 50·n·(n−1) XP-დან
export const levelStart = (n) => 50 * n * (n - 1)
export const levelOf = (xp) => Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.08 * Math.max(0, xp))) / 2))
export function levelProgress(xp) {
  const level = levelOf(xp)
  const from = levelStart(level)
  const to = levelStart(level + 1)
  return { level, from, to, into: xp - from, need: to - xp, pct: Math.min(1, (xp - from) / (to - from)) }
}

const TITLES = [[1, 'ახალმოსული'], [3, 'მეზობელი'], [6, 'ეზოს ბინადარი'], [10, 'ეზოს ძველი'], [15, 'ეზოს უხუცესი'], [20, 'ეზოს ლეგენდა']]
export const levelTitle = (level) => TITLES.filter(([n]) => level >= n).pop()[1]

// დღიური ბონუსი სერიის მიხედვით: 5, 7, 9, 11, 13, 15, 15… და ყოველ მე-7 დღეს +25
export const checkinReward = (streak) => 5 + 2 * Math.min(Math.max(streak, 1) - 1, 5) + (streak > 0 && streak % 7 === 0 ? 25 : 0)

export const GIFT_PRICES = { pomegranate: 0, heart: 0, churchkhela: 10, khachapuri: 15, rose: 20, wine: 25, dice: 30, star: 40, qvevri: 60, crown: 100 }
export const FREE_GIFTS_PER_DAY = 5

export const EARN_RULES = [
  { icon: 'flame', text: 'ყოველდღე შემოსვლა', xp: 10, coins: '5–15', note: 'მე-7 დღეს +25' },
  { icon: 'edit', text: 'პოსტი', xp: 5, note: 'დღეში 10 პოსტამდე' },
  { icon: 'heart', text: 'მოწონება შენს პოსტზე', xp: 1, note: 'დღეში 50-მდე' },
  { icon: 'users', text: 'ახალი გამომწერი', xp: 3 },
  { icon: 'dice', text: 'ონლაინ თამაში', xp: 5, note: 'მოგება: +10 XP და 3 ბროწეული' },
  { icon: 'trophy', text: 'ტურნირის პრიზი', coins: '50 / 30 / 20', note: '1-ლი, მე-2, მე-3 ადგილი' },
  { icon: 'tag', text: 'გაყიდვა ბაზარში', xp: 10, coins: 5 },
  { icon: 'sparkle', text: 'დღის ჭადრაკის ამოცანა', xp: 15, coins: 5 },
  { icon: 'medal', text: 'ახალი დონე', coins: 'დონე × 5' },
]

export const EVENT_LABELS = {
  checkin: 'დღიური ბონუსი', welcome: 'მისასალმებელი საჩუქარი', post: 'პოსტი', reply: 'პასუხი', like: 'მოწონება',
  follower: 'ახალი გამომწერი', game: 'თამაში', win: 'მოგება', tournament: 'ტურნირის პრიზი', sale: 'გაყიდვა',
  gift: 'საჩუქრის გაგზავნა', gift_received: 'მიღებული საჩუქარი', level: 'ახალი დონე', badge: 'მიღწევა', puzzle: 'დღის ამოცანა',
}
