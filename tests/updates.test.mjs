// განახლების ფაილები (supabase/updates) ზუსტად ემთხვევა schema.sql-ის შესაბამის ნაწილს
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const files = readdirSync('supabase/updates').filter((f) => f.endsWith('.sql'))

test('განახლებები არსებობს', () => assert.ok(files.length > 0))
for (const f of files) {
  test(`განახლება ${f} schema.sql-შია, უცვლელად`, () => {
    const text = readFileSync(`supabase/updates/${f}`, 'utf8')
    const body = text.slice(text.indexOf('\n\n') + 2)
    assert.ok(body.length > 200, 'ცარიელია')
    assert.ok(schema.includes(body), `${f} განსხვავდება schema.sql-ისგან`)
    assert.equal((body.match(/\$\$/g) || []).length % 2, 0)
  })
}
