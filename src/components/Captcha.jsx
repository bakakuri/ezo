import { useEffect, useRef, useState } from 'react'

// Cloudflare Turnstile — ბოტებისგან დაცვა რეგისტრაციაზე, შესვლაზე და პაროლის აღდგენაზე.
// ჩაირთვება მხოლოდ მაშინ, როცა VITE_TURNSTILE_SITE_KEY მითითებულია; Supabase-ში იმავე დროს ირთვება
// Project Settings → Authentication → Bot and Abuse Protection → CAPTCHA (Turnstile + Secret key). ჯერ საიტი, მერე Supabase — სხვაგვარად შესვლა ვერ მოხერხდება.
// ჩვეულებრივ ადამიანს არაფერი უჩანს („interaction-only“); საეჭვო შემთხვევაში ჩნდება ერთი ღილაკი.

export const CAPTCHA_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let loading = null
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SCRIPT
      s.async = true
      s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')))
      s.onerror = () => { loading = null; reject(new Error('turnstile')) }
      document.head.appendChild(s)
    })
  }
  return loading
}

const theme = () => document.documentElement.dataset.theme || 'auto'

// { box: ref კონტეინერისთვის, token(): Promise<string|undefined>, reset(), state }
export function useCaptcha() {
  const box = useRef(null)
  const widget = useRef(null)
  const token = useRef(null)
  const waiters = useRef([])
  const [state, setState] = useState(CAPTCHA_KEY ? 'loading' : 'off') // off | loading | ready | interactive | error

  useEffect(() => {
    if (!CAPTCHA_KEY) return
    let alive = true
    loadTurnstile().then((ts) => {
      if (!alive || !box.current) return
      widget.current = ts.render(box.current, {
        sitekey: CAPTCHA_KEY,
        action: 'auth',
        appearance: 'interaction-only',
        theme: theme(),
        language: 'auto',
        callback: (t) => { token.current = t; setState('ready'); waiters.current.splice(0).forEach((w) => w.resolve(t)) },
        'expired-callback': () => { token.current = null; setState('loading'); ts.reset(widget.current) },
        'before-interactive-callback': () => setState('interactive'),
        'error-callback': () => { token.current = null; setState('error'); waiters.current.splice(0).forEach((w) => w.reject(new Error(FAIL))) },
      })
    }).catch(() => { if (alive) setState('error') })
    return () => {
      alive = false
      if (widget.current != null) { try { window.turnstile?.remove(widget.current) } catch { /* */ } }
    }
  }, [])

  const get = () => {
    if (!CAPTCHA_KEY) return Promise.resolve(undefined)
    if (token.current) return Promise.resolve(token.current)
    if (state === 'error') return Promise.reject(new Error(FAIL))
    return new Promise((resolve, reject) => {
      const w = { resolve, reject }
      waiters.current.push(w)
      setTimeout(() => {
        const i = waiters.current.indexOf(w)
        if (i >= 0) { waiters.current.splice(i, 1); reject(new Error('დაადასტურე, რომ ადამიანი ხარ — ღილაკი ფორმის ქვემოთაა')) }
      }, 25000)
    })
  }
  // ტოკენი ერთჯერადია: ყოველი მცდელობის შემდეგ ახალს ვიღებთ
  const reset = () => {
    token.current = null
    if (widget.current != null && window.turnstile) { setState('loading'); try { window.turnstile.reset(widget.current) } catch { /* ფორმა უკვე დაიხურა */ } }
  }
  return { box, get, reset, state }
}

const FAIL = 'ბოტებისგან დაცვის შემოწმება ვერ ჩაიტვირთა — განაახლე გვერდი ან სცადე სხვა ინტერნეტით'

export function CaptchaBox({ captcha }) {
  if (captcha.state === 'off') return null
  return (
    <div className="captcha">
      <div ref={captcha.box} />
      {captcha.state === 'interactive' && <small>ერთი წამით — დაადასტურე, რომ ადამიანი ხარ.</small>}
      {captcha.state === 'error' && <small className="err">{FAIL}</small>}
    </div>
  )
}
