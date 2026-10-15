// საძიებო სისტემები: robots.txt, sitemap.xml, index.html-ის მეტა-ტეგები
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { render as sitemap } from '../api/sitemap.js'
import sitemapHandler from '../api/sitemap.js'
import { render as robots } from '../api/robots.js'
import { siteHtml } from '../scripts/site-html.mjs'

test('sitemap: სტატიკური გვერდები ყოველთვის, საჯარო სია ფუნქციიდან, სახელები დაცულია', () => {
  const xml = sitemap('https://ezo.ge', { u: ['nino', 'bad name<x>'], m: [['11111111-1111-1111-1111-111111111111', '2026-10-01T10:00:00Z']], e: [['22222222-2222-2222-2222-222222222222', 'not a date']] })
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/)
  for (const loc of ['https://ezo.ge/', 'https://ezo.ge/privacy', 'https://ezo.ge/terms', 'https://ezo.ge/u/nino', 'https://ezo.ge/market/11111111-1111-1111-1111-111111111111', 'https://ezo.ge/events/22222222-2222-2222-2222-222222222222']) {
    assert.ok(xml.includes(`<loc>${loc}</loc>`), loc)
  }
  assert.ok(xml.includes('<lastmod>2026-10-01</lastmod>'))
  assert.ok(!xml.includes('bad name') && !xml.includes('not a date'))
  assert.equal(sitemap('https://ezo.ge', null).match(/<url>/g).length, 3)
})

test('sitemap: Supabase-ის გარეშეც პასუხობს (მოკლე ქეშით)', async () => {
  delete process.env.VITE_SUPABASE_URL
  let body = ''
  const headers = {}
  await sitemapHandler({ headers: { host: 'ezo.ge' } }, { setHeader: (k, v) => { headers[k] = v }, status: () => ({ send: (b) => { body = b } }) })
  assert.match(headers['Content-Type'], /application\/xml/)
  assert.match(headers['Cache-Control'], /s-maxage=300/)
  assert.ok(body.includes('<loc>https://ezo.ge/</loc>'))
})

test('robots: production-ზე sitemap და პირადი გვერდები დახურულია, preview-ზე ყველაფერი დახურულია', () => {
  const prod = robots('https://ezo.ge', true)
  assert.match(prod, /^User-agent: \*\nAllow: \//)
  assert.ok(prod.includes('Disallow: /inbox') && prod.includes('Disallow: /settings') && prod.includes('Disallow: /api/'))
  assert.ok(!/Disallow: \/u\/|Disallow: \/p\/|Disallow: \/market/.test(prod))
  assert.ok(prod.includes('Sitemap: https://ezo.ge/sitemap.xml'))
  assert.equal(robots('https://x.vercel.app', false), 'User-agent: *\nDisallow: /\n')
})

test('vercel.json: robots.txt და sitemap.xml ფუნქციებზე მიდის SPA-მდე', () => {
  const { rewrites } = JSON.parse(readFileSync('vercel.json', 'utf8'))
  const i = (src) => rewrites.findIndex((r) => r.source === src)
  assert.equal(rewrites[i('/robots.txt')].destination, '/api/robots')
  assert.equal(rewrites[i('/sitemap.xml')].destination, '/api/sitemap')
  assert.ok(i('/robots.txt') < rewrites.length - 1 && rewrites.at(-1).destination === '/index.html')
})

test('index.html: საიტის მისამართით — სრული og:image, og:url და JSON-LD; მის გარეშე — ფარდობითი', () => {
  const html = readFileSync('index.html', 'utf8')
  assert.match(html, /<title>ეზო — ქართული სოციალური ქსელი<\/title>/)
  assert.match(html, /<meta name="description" content="[^"]{60,160}"/)
  const withSite = siteHtml(html, 'https://ezo.ge')
  assert.ok(withSite.includes('<meta property="og:image" content="https://ezo.ge/og.png" />'))
  assert.ok(withSite.includes('<meta property="og:url" content="https://ezo.ge/" />'))
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(withSite)[1])
  assert.equal(ld['@type'], 'WebSite')
  assert.equal(ld.url, 'https://ezo.ge/')
  const noSite = siteHtml(html, '')
  assert.ok(noSite.includes('content="/og.png"'))
  assert.ok(!noSite.includes('__EZO_SITE__') && !noSite.includes('ezo:site') && !noSite.includes('ld+json'))
  assert.ok(siteHtml(html, '', 'abc_DEF-123').includes('<meta name="google-site-verification" content="abc_DEF-123" />'))
  assert.ok(!siteHtml(html, '', '').includes('google-site-verification'))
})
