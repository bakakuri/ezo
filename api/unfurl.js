// Vercel Function: ბმულის ბარათი — გვერდის სათაური, აღწერა და სურათი (Open Graph / Twitter / <title>).
// /api/unfurl?url=https://… → { url, title, description, image, site }
// დაცვა: მხოლოდ http/https და 80/443 პორტი, შიდა/პირადი მისამართები იბლოკება (გადამისამართების შემდეგაც),
// 4 წამი, მაქსიმუმ 512 KB, მხოლოდ HTML.
import dns from 'node:dns/promises'
import net from 'node:net'

const MAX_BYTES = 512 * 1024
const TIMEOUT = 4000

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const v = ip.toLowerCase()
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7))
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') ||
    v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff')
}

export async function checkUrl(raw, lookup = dns.lookup) {
  let u
  try { u = new URL(raw) } catch { throw new Error('ბმული არასწორია') }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('მხოლოდ http და https')
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('პორტი დაუშვებელია')
  if (u.username || u.password) throw new Error('ბმული არასწორია')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) throw new Error('შიდა მისამართი')
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('შიდა მისამართი')
  return u
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export const decode = (s = '') => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
const clean = (s, n) => {
  const t = decode(String(s || '')).replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

export function parseMeta(html, base) {
  const head = html.slice(0, 200000)
  const metas = {}
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const attr = (k) => new RegExp(`\\b${k}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
    const key = attr('property') || attr('name')
    const val = attr('content')
    if (!key || !val) continue
    const k = (key[2] ?? key[3] ?? key[4]).toLowerCase()
    if (!(k in metas)) metas[k] = val[2] ?? val[3] ?? val[4]
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]
  const title = clean(metas['og:title'] || metas['twitter:title'] || titleTag, 140)
  const description = clean(metas['og:description'] || metas['twitter:description'] || metas.description, 240)
  let image = metas['og:image:secure_url'] || metas['og:image'] || metas['twitter:image'] || metas['twitter:image:src'] || ''
  try { image = image ? new URL(decode(image), base).href : '' } catch { image = '' }
  if (!/^https:\/\//.test(image) || image.length > 600) image = ''
  const site = clean(metas['og:site_name'], 60) || new URL(base).hostname.replace(/^www\./, '')
  return { title, description, image: image || null, site }
}

export async function unfurl(raw, { fetchImpl = fetch, lookup = dns.lookup } = {}) {
  let u = await checkUrl(raw, lookup)
  let res
  for (let hop = 0; hop < 4; hop++) {
    res = await fetchImpl(u.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EzoBot/1.0; +https://ezo.ge)', Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'ka,en;q=0.8' },
    })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      u = await checkUrl(new URL(res.headers.get('location'), u).href, lookup)
      continue
    }
    break
  }
  if (!res.ok) throw new Error(`გვერდი ვერ ჩაიტვირთა (${res.status})`)
  if (!/text\/html|application\/xhtml/i.test(res.headers.get('content-type') || '')) throw new Error('ეს გვერდი არაა')
  // მხოლოდ თავი — მაქსიმუმ 512 KB
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  reader.cancel().catch(() => {})
  const html = new TextDecoder('utf-8').decode(Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, MAX_BYTES))
  const meta = parseMeta(html, u.href)
  if (!meta.title) throw new Error('სათაური ვერ მოიძებნა')
  return { url: u.href.slice(0, 600), ...meta }
}

export default async function handler(req, res) {
  const raw = new URL(req.url, 'https://x').searchParams.get('url') || ''
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  try {
    const data = await unfurl(raw)
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    res.status(200).send(JSON.stringify(data))
  } catch (e) {
    res.setHeader('Cache-Control', 'public, s-maxage=600')
    res.status(422).send(JSON.stringify({ error: String(e?.message || e).slice(0, 200) }))
  }
}
