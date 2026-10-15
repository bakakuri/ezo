// Vercel Function: ბმულის „ბარათი“ (Open Graph) Facebook-ის, Messenger-ის, Telegram-ის და სხვა ბოტებისთვის.
// vercel.json ბოტების მოთხოვნებს აქ გადმოამისამართებს; ადამიანები ჩვეულებრივ აპს ხედავენ.
// საჭირო ცვლადები (Vercel → Settings → Environment Variables): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
// მონაცემები მოდის SQL ფუნქციიდან og_preview — მხოლოდ საჯარო შიგთავსი.
import { rpc, originOf } from './_rpc.js'

const ROUTES = [
  [/^\/p\/([0-9a-f-]{36})$/i, 'p'],
  [/^\/u\/([a-z0-9_.]{3,24})$/, 'u'],
  [/^\/invite\/([a-z0-9_.]{3,24})$/, 'i'],
  [/^\/market\/([0-9a-f-]{36})$/i, 'm'],
  [/^\/events\/([0-9a-f-]{36})$/i, 'e'],
  [/^\/t\/([0-9a-f-]{36})$/i, 't'],
]
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const preview = (kind, key) => rpc('og_preview', { p_kind: kind, p_key: key })

export function render({ origin, path, data }) {
  const title = data?.title || 'ეზო — ქართული სოციალური ქსელი'
  const desc = data?.description || 'მეგობრები, ვიდეოები, ბაზარი, გაცნობა და ნარდი ერთ ადგილას.'
  const image = data?.image && /^https:\/\//.test(data.image) ? data.image : `${origin}/og.png`
  const url = origin + path
  return `<!doctype html>
<html lang="ka"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:site_name" content="ეზო">
<meta property="og:type" content="${path.startsWith('/u/') ? 'profile' : 'website'}">
<meta property="og:locale" content="ka_GE">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="${data?.image ? 'summary' : 'summary_large_image'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
</head><body><h1>${esc(title)}</h1><p>${esc(desc)}</p><a href="${esc(url)}">ეზოში გახსნა</a></body></html>`
}

export default async function handler(req, res) {
  const origin = originOf(req)
  const raw = new URL(req.url, origin).searchParams.get('path') || '/'
  const path = raw.startsWith('/') ? raw.split('?')[0] : '/'
  let data = null
  for (const [re, kind] of ROUTES) {
    const m = path.match(re)
    if (m) { data = await preview(kind, decodeURIComponent(m[1])); break }
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600')
  res.status(200).send(render({ origin, path, data }))
}
