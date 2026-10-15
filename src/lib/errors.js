// შეცდომების ჟურნალი: აპის შეცდომები იგზავნება ადმინ პანელში („შეცდომები“).
// თითო შეცდომა გვერდზე ერთხელ, მაქსიმუმ 10; ხმაური (გაფართოებები, კავშირის გაწყვეტა) არ იგზავნება.
// გამგზავნს api.js აყენებს (setErrorSender), რომ ეს ფაილი api-ზე არ იყოს დამოკიდებული.

const NOISE = /ResizeObserver loop|^Script error\.?$|Non-Error promise rejection|AbortError|aborted|Failed to fetch|NetworkError|Load failed|Network request failed|ინტერნეტთან კავშირი/i
const EXTENSION = /(chrome|moz|safari(-web)?)-extension:\/\//
const CHUNK = /dynamically imported module|Importing a module script failed|module script|Loading chunk|Loading CSS chunk/i
const LIMIT = 10

let sender = null
const sent = new Set()

export function setErrorSender(fn) { sender = fn }

// სერვერის შეცდომები, რომლებიც სქემის/API-ს შეუსაბამობაზე მიუთითებს (და არა ადამიანის ქმედებაზე)
export function isSchemaError(error) {
  const code = String(error?.code || '')
  if (/^PGRST2\d\d$/.test(code)) return true // ურთიერთობა, ფუნქცია ან სვეტი ვერ მოიძებნა
  if (['42703', '42883', '42P01', '42P17', '42804'].includes(code)) return true
  return code === '42501' && /^permission denied/i.test(error?.message || '') // grants აკლია (RLS-ის უარი არ ითვლება)
}

export function release() {
  try { return typeof __EZO_RELEASE__ === 'string' ? __EZO_RELEASE__ : null } catch { return null } // eslint-disable-line no-undef
}

export function reportError(error, source = 'window', extra = '') {
  try {
    const message = String(error?.message ?? error ?? '').trim().slice(0, 500)
    const chunk = CHUNK.test(message)
    if (!message || (!chunk && NOISE.test(message))) return false
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
    let stack = typeof error?.stack === 'string' ? error.stack : ''
    if (EXTENSION.test(stack)) return false
    if (extra) stack = `${stack}\n\n${extra}`.trim()
    if (source !== 'api' && chunk) source = 'chunk'
    const key = `${source}|${message}`
    if (sent.has(key) || sent.size >= LIMIT) return false
    sent.add(key)
    const payload = {
      message,
      stack: stack ? stack.slice(0, 4000) : null,
      path: typeof location !== 'undefined' ? location.pathname : null,
      source,
      release: release(),
      agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    }
    Promise.resolve().then(() => sender?.(payload)).catch(() => {})
    return true
  } catch {
    return false // ჟურნალი აპს არასდროს უნდა ჩააგდოს
  }
}

export function reportApiError(error) {
  const details = [error.details, error.hint].filter(Boolean).join('\n')
  return reportError({ message: `${error.code}: ${error.message}`, stack: details }, 'api')
}

let installed = false
export function installErrorReporter() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => { if (e.error || e.message) reportError(e.error || e.message, 'window') })
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'))
}

export function _resetForTests() { sent.clear() }
