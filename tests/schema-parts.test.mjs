import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { splitSchema, partHeader, PARTS } from '../scripts/split-schema.mjs'

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
const parts = splitSchema(schema)

test('schema parts: committed parts equal a fresh split of schema.sql', () => {
  const files = readdirSync(new URL('../supabase/parts/', import.meta.url)).filter((f) => /^schema-\d+\.sql$/.test(f))
  assert.equal(files.length, PARTS, 'supabase/parts-ში ზედმეტი ან დაკლებული ფაილია — გაუშვი node scripts/split-schema.mjs')
  parts.forEach((p, i) => {
    const committed = readFileSync(new URL(`../supabase/parts/schema-${i + 1}.sql`, import.meta.url), 'utf8')
    assert.equal(committed, p, `supabase/parts/schema-${i + 1}.sql მოძველდა — გაუშვი node scripts/split-schema.mjs`)
  })
})

test('schema parts: together they are exactly schema.sql, small, and never cut inside a $$ body', () => {
  assert.equal(parts.length, PARTS)
  const bodies = parts.map((p, i) => p.slice(partHeader(i + 1, PARTS).length))
  assert.equal(bodies.join(''), schema)
  for (const b of bodies) {
    assert.ok(b.length < 35000, `ნაწილი ძალიან დიდია: ${b.length}`)
    assert.equal((b.match(/\$\$/g) || []).length % 2, 0, 'ნაწილი ფუნქციის შუაში იჭრება')
  }
})
