import { useEffect, useReducer } from 'react'

// ტრაფიკის დაზოგვა სუსტ ინტერნეტზე: 'auto' — როცა ტელეფონზე „მონაცემების დაზოგვაა“ ჩართული ან ქსელი ნელია,
// 'on' — ყოველთვის, 'off' — არასდროს. დაზოგვისას: ფიდში პატარა ფოტოები, ვიდეო თავისით არ ირთვება,
// ბმულის ბარათზე სურათი არ იტვირთება და გვერდები წინასწარ არ ჩამოიტვირთება.

const KEY = 'ezo.saver'
const subs = new Set()
const emit = () => subs.forEach((f) => f())
const conn = () => (typeof navigator !== 'undefined' ? navigator.connection : null)

export function saverSetting() {
  try { return localStorage.getItem(KEY) || 'auto' } catch { return 'auto' }
}
export function setSaver(v) {
  try { localStorage.setItem(KEY, v) } catch { /* */ }
  emit()
}

// slow-2g, 2g, 3g — Chrome-ის შეფასებით (დაყოვნება და სიჩქარე); Safari-ს ეს ინფორმაცია არ აქვს
export function slowNetwork() {
  const c = conn()
  return Boolean(c && (c.saveData || /^(slow-2g|2g|3g)$/.test(c.effectiveType || '')))
}

export function saving() {
  const s = saverSetting()
  return s === 'on' || (s === 'auto' && slowNetwork())
}

export function useSaver() {
  const [, bump] = useReducer((x) => x + 1, 0)
  useEffect(() => {
    subs.add(bump)
    const c = conn()
    c?.addEventListener?.('change', bump)
    return () => { subs.delete(bump); c?.removeEventListener?.('change', bump) }
  }, [])
  return saving()
}

// წინასწარ ჩატვირთვა: როცა ბრაუზერი თავისუფალია და ინტერნეტი კარგია — შემდეგი გვერდების კოდი
export function prefetchWhenIdle(loaders, delay = 2500) {
  if (typeof window === 'undefined' || saving()) return () => {}
  let cancelled = false
  const run = () => {
    if (cancelled || saving() || navigator.onLine === false) return
    loaders.reduce((p, load) => p.then(() => (cancelled ? null : load().catch(() => null))), Promise.resolve())
  }
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1))
  const t = setTimeout(() => idle(run, { timeout: 4000 }), delay)
  return () => { cancelled = true; clearTimeout(t) }
}
