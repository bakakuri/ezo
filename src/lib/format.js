// ფორმატირება ქართულად (ბრაუზერის ლოკალზე დამოკიდებულების გარეშე)

export const MONTHS_SHORT = ['იან', 'თებ', 'მარ', 'აპრ', 'მაი', 'ივნ', 'ივლ', 'აგვ', 'სექ', 'ოქტ', 'ნოე', 'დეკ']
export const MONTHS_LONG = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი']
export const WEEKDAYS = ['კვირა', 'ორშაბათი', 'სამშაბათი', 'ოთხშაბათი', 'ხუთშაბათი', 'პარასკევი', 'შაბათი']
const pad2 = (n) => String(n).padStart(2, '0')

// '12 ოქტ' | '12 ოქტომბერი' (+ წელი, თუ სხვა წელია)
export function dayMonth(date, long = false) {
  const d = typeof date === 'string' ? new Date(date) : date
  const out = `${d.getDate()} ${(long ? MONTHS_LONG : MONTHS_SHORT)[d.getMonth()]}`
  return d.getFullYear() !== new Date().getFullYear() ? `${out} ${d.getFullYear()}` : out
}

export function timeAgo(date) {
  const d = typeof date === 'string' ? new Date(date) : date
  const s = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000))
  if (s < 60) return 'ახლა'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} წთ`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} სთ`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days} დღე`
  return dayMonth(d)
}

// „5 წთ წინ“, „ახლახან“, ან თარიღი
export function agoPhrase(date) {
  const t = timeAgo(date)
  if (t === 'ახლა') return 'ახლახან'
  return /\d+ (წთ|სთ|დღე)$/.test(t) ? `${t} წინ` : t
}

export function clock(date) {
  const d = typeof date === 'string' ? new Date(date) : date
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function count(n) {
  if (!n) return ''
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace('.0', '')} ათ.`
  return `${(n / 1_000_000).toFixed(1).replace('.0', '')} მლნ`
}

export function plural(n, word) {
  return `${count(n) || 0} ${word}`
}

export function isOnline(lastSeen) {
  return lastSeen && Date.now() - new Date(lastSeen).getTime() < 5 * 60 * 1000
}

export function seenText(lastSeen) {
  if (!lastSeen) return ''
  if (isOnline(lastSeen)) return 'ონლაინ'
  return `იყო ${agoPhrase(lastSeen)}`
}

export function ageFrom(birthDate) {
  const b = new Date(birthDate)
  const now = new Date()
  let a = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--
  return a
}

// ქართულ ასოებს არ ვაქცევთ მთავრულად — ინიციალები მხედრულით რჩება
export const initials = (name = '') =>
  String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => (/[a-z]/i.test(w[0]) ? w[0].toUpperCase() : w[0])).join('') || '?'

export const USERNAME_RE = /^[a-z0-9_.]{3,24}$/

// „სამუდამოდ“ / „12 ოქტომბრამდე“ / null თუ ბლოკი ვადაგასულია
export function banText(until) {
  if (!until) return null
  if (until === 'infinity' || new Date(until).getFullYear() > 9000) return 'სამუდამოდ'
  const d = new Date(until)
  if (Number.isNaN(d.getTime()) || d < new Date()) return null
  return `${dayMonth(d, true)}-მდე`
}

// „დღეს 21:00“, „ხვალ 20:30“, „პარასკევს 21:00“, „16 ოქტ, 21:00“
export function whenText(date) {
  const d = typeof date === 'string' ? new Date(date) : date
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(d) - start(new Date())) / 864e5)
  const t = clock(d)
  if (days === 0) return `დღეს ${t}`
  if (days === 1) return `ხვალ ${t}`
  if (days === -1) return `გუშინ ${t}`
  if (days > 1 && days < 7) return `${WEEKDAYS[d.getDay()]}ს ${t}`
  return `${dayMonth(d)}, ${t}`
}

// დარჩენილი დრო: „1 სთ 12 წთ“ ან „12:04“
export function untilText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h >= 24) return `${Math.floor(h / 24)} დღე ${h % 24} სთ`
  if (h > 0) return `${h} სთ ${m} წთ`
  return `${m}:${pad2(s % 60)}`
}
