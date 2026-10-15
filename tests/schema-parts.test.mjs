import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { splitSchema, partHeader } from '../scripts/split-schema.mjs'

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')

test('schema parts: committed parts equal a fresh split of schema.sql', () => {
  const fresh = splitSchema(schema)
  fresh.forEach((p, i) => {
    const committed = readFileSync(new URL(`../supabase/parts/schema-${i + 1}.sql`, import.meta.url), 'utf8')
    assert.equal(committed, p, `supabase/parts/schema-${i + 1}.sql მოძველდა — გაუშვი node scripts/split-schema.mjs`)
  })
})

test('schema parts: together they are exactly schema.sql, each small enough to paste', () => {
  const parts = splitSchema(schema)
  assert.equal(parts.length, 4)
  const joined = parts.map((p, i) => p.slice(partHeader(i + 1, 4).length)).join('')
  assert.equal(joined, schema)
  for (const p of parts) assert.ok(p.length < 70000, `ნაწილი ძალიან დიდია: ${p.length}`)
})
