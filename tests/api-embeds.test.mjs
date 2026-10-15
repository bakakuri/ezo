import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// PostgREST 14: თავის თავზე მიბმული კავშირი კავშირის სახელით არ მოიძებნება (PGRST200),
// table!column კი საპირისპირო მიმართულებას (სიას) აბრუნებს — სწორია მხოლოდ სვეტი (quote:quote_id).
// შემოწმებულია რეალურ PostgREST 14.1-ზე.
const src = readFileSync(new URL('../src/lib/api.supabase.js', import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

test('api: self-relations are embedded by column (quote, reply)', () => {
  assert.ok(src.includes('quote:quote_id('), 'POST-ში ციტატა: quote:quote_id(...)')
  assert.ok(src.includes('reply:reply_to('), 'MSG-ში პასუხი: reply:reply_to(...)')
  for (const bad of [/posts!posts_\w+_fkey/, /messages!messages_\w+_fkey/, /posts!(quote_id|parent_id|root_id)/, /messages!reply_to/]) {
    assert.ok(!bad.test(src), `აკრძალული ჩაწერა: ${bad}`)
  }
})
