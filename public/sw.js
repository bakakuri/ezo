// ეზო — სერვის-ვორკერი: Push შეტყობინებები, offline რეჟიმი, შრიფტის და ფოტოების ქეში
const CACHE = 'ezo-v5'
const FONTS = 'ezo-fonts-v1'
const IMAGES = 'ezo-img-v1'
const KEEP = [CACHE, FONTS, IMAGES]
const MAX_IMAGES = 250

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/icon-192.png', '/manifest.webmanifest', '/og.png'])).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!KEEP.includes(k)) await caches.delete(k)
    await self.clients.claim()
  })())
})

async function trim(name, max) {
  const c = await caches.open(name)
  const keys = await c.keys()
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i])
}

// ჯერ ქეში, მერე ქსელი (ცვალებადი არაა: შრიფტის ფაილები, ატვირთული ფოტოები)
function cacheFirst(req, name, max) {
  return caches.open(name).then(async (c) => {
    const hit = await c.match(req)
    if (hit) return hit
    const res = await fetch(req).catch(() => Response.error())
    // HTML JS/CSS ფაილის ადგილას (ძველი ვერსიის chunk) არასდროს შევინახოთ
    const html = (res.headers.get('content-type') || '').includes('text/html') && req.mode !== 'navigate'
    if ((res.ok || res.type === 'opaque') && !html) {
      c.put(req, res.clone())
      if (max) trim(name, max)
    }
    return res
  })
}

// ქეშიდან მყისიერად, ფონზე განახლება (Google Fonts CSS)
function staleWhileRevalidate(req, name) {
  return caches.open(name).then(async (c) => {
    const hit = await c.match(req)
    // <link rel=stylesheet> crossorigin-ის გარეშეა — პასუხი opaque-ია, ისიც ვინახავთ
    const fresh = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res }).catch(() => hit || Response.error())
    return hit || fresh
  })
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.hostname === 'fonts.googleapis.com') { e.respondWith(staleWhileRevalidate(req, FONTS)); return }
  if (url.hostname === 'fonts.gstatic.com') { e.respondWith(cacheFirst(req, FONTS)); return }
  if (url.pathname.includes('/storage/v1/object/public/') && req.destination === 'image') { e.respondWith(cacheFirst(req, IMAGES, MAX_IMAGES)); return }
  if (url.origin !== location.origin) return
  // გვერდები: ჯერ ქსელი, offline — შენახული აპი
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone()
      caches.open(CACHE).then((c) => c.put('/', copy))
      return res
    }).catch(() => caches.match('/')))
    return
  }
  // ჰეშიანი ფაილები (/assets/…) და იკონები: ჯერ ქეში
  if (url.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest|woff2?)$/.test(url.pathname)) {
    e.respondWith(cacheFirst(req, CACHE))
  }
})

self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { data = { body: e.data && e.data.text() } }
  e.waitUntil((async () => {
    // თუ აპი ახლა ღიაა და ჩანს, შეტყობინებას არ ვაჩვენებთ
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (wins.some((w) => w.visibilityState === 'visible')) return
    await self.registration.showNotification(data.title || 'ეზო', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || '/' },
    })
  })())
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const target = new URL(e.notification.data?.url || '/', location.origin).href
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if ('focus' in w) {
        await w.focus()
        if ('navigate' in w) await w.navigate(target).catch(() => {})
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})
