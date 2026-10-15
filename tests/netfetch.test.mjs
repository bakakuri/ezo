// სუსტი ინტერნეტი: დრო ამოიწურება, წაკითხვა ერთხელ მეორდება, ჩაწერა და ატვირთვა — არა
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { netFetch } from '../src/lib/netfetch.js'

// AbortSignal.timeout-ის ტაიმერი Node-ში პროცესს ცოცხლად არ ინახავს — ტესტის დროს ვინახავთ
let keep
before(() => { keep = setInterval(() => {}, 1000) })
after(() => clearInterval(keep))

const hang = (url, init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason)))

test('GET: ჩამოკიდებული მოთხოვნა წყდება და ერთხელ მეორდება', async () => {
  let calls = 0
  const fetchImpl = (url, init) => (++calls === 1 ? hang(url, init) : Promise.resolve(new Response('ok')))
  const r = await netFetch('https://x.supabase.co/rest/v1/posts', {}, { fetchImpl, timeout: 40, retryDelay: 5 })
  assert.equal(await r.text(), 'ok')
  assert.equal(calls, 2)
})

test('GET: ორივე ცდა თუ ჩავარდა — შეცდომა', async () => {
  let calls = 0
  const fetchImpl = (url, init) => { calls++; return hang(url, init) }
  await assert.rejects(netFetch('https://x.supabase.co/rest/v1/posts', {}, { fetchImpl, timeout: 30, retryDelay: 5 }), (e) => e.name === 'TimeoutError')
  assert.equal(calls, 2)
})

test('POST არ მეორდება (ორჯერ რომ არ ჩაიწეროს)', async () => {
  let calls = 0
  const fetchImpl = () => { calls++; return Promise.reject(new TypeError('Failed to fetch')) }
  await assert.rejects(netFetch('https://x.supabase.co/rest/v1/posts', { method: 'POST' }, { fetchImpl, retryDelay: 5 }), TypeError)
  assert.equal(calls, 1)
})

test('ფაილის ატვირთვა — დროის ლიმიტის გარეშე; გარე signal ერთიანდება', async () => {
  let seen = null
  const fetchImpl = (url, init) => { seen = init; return Promise.resolve(new Response('')) }
  await netFetch('https://x.supabase.co/storage/v1/object/posts/a.jpg', { method: 'POST', body: 'x' }, { fetchImpl })
  assert.equal(seen.signal, undefined)
  const ctl = new AbortController()
  await netFetch('https://x.supabase.co/rest/v1/posts', { signal: ctl.signal }, { fetchImpl, timeout: 1000 })
  assert.ok(seen.signal && seen.signal !== ctl.signal)
  ctl.abort()
  assert.ok(seen.signal.aborted, 'external abort must propagate')
})
