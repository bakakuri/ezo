import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import handler, { render } from '../api/og.js'

test('og: escapes content and falls back to the default image', () => {
  const html = render({ origin: 'https://ezo.ge', path: '/p/x', data: { title: '<script>"x"</script>', description: 'a & b', image: 'http://insecure/x.png' } })
  assert.ok(html.includes('&lt;script&gt;&quot;x&quot;&lt;/script&gt;'))
  assert.ok(html.includes('a &amp; b'))
  assert.ok(html.includes('content="https://ezo.ge/og.png"'))
  assert.ok(!html.includes('<script>'))
})

test('og: handler without Supabase env renders the generic card', async () => {
  let body = ''
  const headers = {}
  const res = { setHeader: (k, v) => { headers[k] = v }, status: () => ({ send: (b) => { body = b } }) }
  await handler({ url: '/api/og?path=/u/giorgi', headers: { host: 'ezo.ge' } }, res)
  assert.match(headers['Content-Type'], /text\/html/)
  assert.ok(body.includes('og:title'))
  assert.ok(body.includes('https://ezo.ge/u/giorgi'))
})

test('vercel.json sends only bots to the OG function and keeps the SPA fallback', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  const bots = cfg.rewrites.find((r) => r.destination.startsWith('/api/og'))
  const spa = cfg.rewrites.at(-1)
  assert.equal(bots.destination, '/api/og?path=/:kind/:key')
  assert.ok(new RegExp(bots.has[0].value).test('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'))
  assert.ok(!new RegExp(bots.has[0].value).test('Mozilla/5.0 (Linux; Android 14) Chrome/128 Mobile Safari/537.36'))
  assert.equal(spa.destination, '/index.html')
})

test('og: publishable key goes only in apikey, legacy anon JWT also as Bearer', async () => {
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, opts) => { calls.push({ url, headers: opts.headers }); return { ok: true, json: async () => ({ title: 'ნინო' }) } }
  const res = { setHeader() {}, status: () => ({ send() {} }) }
  try {
    process.env.VITE_SUPABASE_URL = 'https://x.supabase.co'
    for (const key of ['sb_publishable_abc123', 'eyJhbGciOiJIUzI1NiJ9.e30.sig']) {
      process.env.VITE_SUPABASE_ANON_KEY = key
      await handler({ url: '/api/og?path=/u/nino.b', headers: { host: 'ezo.ge' } }, res)
    }
  } finally {
    globalThis.fetch = realFetch
    delete process.env.VITE_SUPABASE_URL
    delete process.env.VITE_SUPABASE_ANON_KEY
  }
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/rpc/og_preview')
  assert.equal(calls[0].headers.apikey, 'sb_publishable_abc123')
  assert.equal(calls[0].headers.Authorization, undefined)
  assert.equal(calls[1].headers.Authorization, 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig')
})
