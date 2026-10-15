// სუსტ ინტერნეტზე: მოთხოვნა 25 წამზე მეტხანს არ „ეკიდება“ (ფაილის ატვირთვის გარდა),
// წაკითხვა (GET) კავშირის წყვეტისას ერთხელ თავიდან იცდება
const TIMEOUT = 25000
export async function netFetch(input, init = {}, { fetchImpl = (...a) => fetch(...a), timeout = TIMEOUT, retryDelay = 1200 } = {}) {
  const url = typeof input === 'string' ? input : input?.url || String(input)
  const method = String(init.method || input?.method || 'GET').toUpperCase()
  const upload = method !== 'GET' && /\/storage\/v1\/object\//.test(url)
  const attempt = () => {
    if (upload || typeof AbortSignal === 'undefined' || !AbortSignal.timeout) return fetchImpl(input, init)
    const t = AbortSignal.timeout(timeout)
    if (init.signal && !AbortSignal.any) return fetchImpl(input, init)
    return fetchImpl(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, t]) : t })
  }
  try {
    return await attempt()
  } catch (e) {
    if (method !== 'GET' || init.signal?.aborted || (typeof navigator !== 'undefined' && navigator.onLine === false)) throw e
    await new Promise((r) => setTimeout(r, retryDelay))
    return attempt()
  }
}
