// დღიური cron: საცავის დასუფთავება — ვერ წაშლილი ფაილები რიგში ბრუნდება, გასაღების გარეშე არაფერი ხდება
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanup } from '../api/daily.js'

function stub({ paths, failDeleteBatch = -1 }) {
  const calls = []
  let deletes = 0
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url, method: init.method, body, headers: init.headers })
    if (url.endsWith('/rpc/media_cleanup_take')) return new Response(JSON.stringify(paths))
    if (url.endsWith('/rpc/media_cleanup_return')) return new Response('null')
    if (url.endsWith('/storage/v1/object/media')) return new Response('[]', { status: deletes++ === failDeleteBatch ? 500 : 200 })
    return new Response('?', { status: 404 })
  }
  return { calls, fetchImpl }
}

test('გასაღების გარეშე — არაფერს ვშლით', async () => {
  const r = await cleanup({ url: 'https://x.supabase.co', key: '', fetchImpl: () => { throw new Error('no calls') } })
  assert.ok(r.skipped)
})

test('ფაილები იშლება ნაწილ-ნაწილ; ჩავარდნილი ნაწილი რიგში ბრუნდება', async () => {
  const paths = Array.from({ length: 5 }, (_, i) => `u/posts/${i}.jpg`)
  const { calls, fetchImpl } = stub({ paths, failDeleteBatch: 1 })
  const r = await cleanup({ url: 'https://x.supabase.co', key: 'sb_secret_abc', fetchImpl, batch: 2 })
  assert.deepEqual(r, { deleted: 3, failed: 2 })
  const dels = calls.filter((c) => c.method === 'DELETE')
  assert.deepEqual(dels.map((c) => c.body.prefixes), [['u/posts/0.jpg', 'u/posts/1.jpg'], ['u/posts/2.jpg', 'u/posts/3.jpg'], ['u/posts/4.jpg']])
  const back = calls.find((c) => c.url.endsWith('media_cleanup_return'))
  assert.deepEqual(back.body, { p_paths: ['u/posts/2.jpg', 'u/posts/3.jpg'] })
  // ახალი საიდუმლო გასაღები — მხოლოდ apikey-ში, ძველი JWT — Authorization-შიც
  assert.equal(dels[0].headers.apikey, 'sb_secret_abc')
  assert.equal(dels[0].headers.Authorization, undefined)
  const legacy = stub({ paths: ['u/a.jpg'] })
  await cleanup({ url: 'https://x.supabase.co', key: 'eyJhbGciOi.x.y', fetchImpl: legacy.fetchImpl })
  assert.equal(legacy.calls[1].headers.Authorization, 'Bearer eyJhbGciOi.x.y')
})

test('რიგი ცარიელია — საცავს არ მივმართავთ', async () => {
  const { calls, fetchImpl } = stub({ paths: [] })
  assert.deepEqual(await cleanup({ url: 'https://x.supabase.co', key: 'k', fetchImpl }), { deleted: 0, failed: 0 })
  assert.equal(calls.length, 1)
})
