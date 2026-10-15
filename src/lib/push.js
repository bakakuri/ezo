// Web Push: სერვის-ვორკერი + გამოწერა. VAPID საჯარო გასაღები → VITE_VAPID_PUBLIC_KEY
import { api } from './api.js'

const KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

// 'unsupported' | 'unconfigured' | 'denied' | 'on' | 'off'
export async function pushStatus() {
  if (api.demo) return (await demoState()) ? 'on' : 'off'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if (!KEY) return 'unconfigured'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

let demoOn = false
const demoState = async () => demoOn

export async function enablePush() {
  if (api.demo) { demoOn = true; await api.savePush(); return 'on' }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off'
  const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register('/sw.js'))
  await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(KEY) }))
  await api.savePush(sub)
  return 'on'
}

export async function disablePush() {
  if (api.demo) { demoOn = false; await api.deletePush(); return 'off' }
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await api.deletePush(sub.endpoint).catch(() => {})
    await sub.unsubscribe().catch(() => {})
  }
  return 'off'
}

function toKey(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
