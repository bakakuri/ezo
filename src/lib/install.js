import { useEffect, useReducer } from 'react'

// „დააყენე ეზო“: Android/Chrome-ზე სისტემური ფანჯარა (beforeinstallprompt), iPhone-ზე — ინსტრუქცია.
// მოვლენა გვერდის ჩატვირთვისთანავე მოდის, ამიტომ მოდული main.jsx-ში ადრევე იტვირთება.

let deferred = null
let installedNow = false
const subs = new Set()
const emit = () => subs.forEach((f) => f())
const read = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, v) } catch { /* პირადი რეჟიმი */ } }

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; emit() })
  window.addEventListener('appinstalled', () => { deferred = null; installedNow = true; write('ezo.installed', '1'); emit() })
  // ვიზიტების რაოდენობა (სესიაში ერთხელ) — ბანერი პირველივე შემოსვლაზე არ ჩანს
  try {
    if (!sessionStorage.getItem('ezo.visit')) {
      sessionStorage.setItem('ezo.visit', '1')
      write('ezo.visits', String((Number(read('ezo.visits')) || 0) + 1))
    }
  } catch { /* */ }
}

export const isStandalone = () => typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true)

export const isIOS = () => typeof navigator !== 'undefined' &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

// 'installed' | 'prompt' (Chrome/Edge/Samsung) | 'ios' (ხელით, „გაზიარება“ მენიუდან) | 'none'
export function installState() {
  if (installedNow || isStandalone()) return 'installed'
  if (deferred) return 'prompt'
  if (isIOS()) return 'ios'
  return 'none'
}

export async function promptInstall() {
  const e = deferred
  if (!e) return 'none'
  deferred = null // ერთი მოვლენა მხოლოდ ერთხელ გამოიყენება; Chrome შემდეგ ახალს გამოგზავნის
  emit()
  await e.prompt()
  const choice = await e.userChoice.catch(() => ({ outcome: 'dismissed' }))
  return choice.outcome
}

export function useInstall() {
  const [, bump] = useReducer((x) => x + 1, 0)
  useEffect(() => { subs.add(bump); return () => { subs.delete(bump) } }, [])
  return installState()
}

// ბანერი: მეორე ვიზიტიდან, „არა ახლა“-ს შემდეგ — 14 დღით ჩუმად
const SNOOZE = 14 * 864e5
export const bannerWanted = () => (Number(read('ezo.visits')) || 0) >= 2 && Date.now() - (Number(read('ezo.install.snooze')) || 0) > SNOOZE
export const snoozeBanner = () => write('ezo.install.snooze', String(Date.now()))
