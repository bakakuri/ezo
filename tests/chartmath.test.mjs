import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayLabel, compact, niceMax } from '../src/lib/chartmath.js'

test('ღერძის ზღვარი მრგვალია და შუა ხაზი მთელი რიცხვია', () => {
  for (const [v, want] of [[0, 2], [1, 2], [3, 4], [7, 10], [11, 20], [37, 40], [99, 100], [101, 200], [1234, 2000], [4800, 5000]]) {
    const m = niceMax(v)
    assert.equal(m, want, `niceMax(${v})`)
    assert.ok(m >= v && Number.isInteger(m / 2))
  }
})

test('რიცხვის შემოკლება და თარიღი ქართულად', () => {
  assert.equal(compact(950), '950')
  assert.equal(compact(1000), '1K')
  assert.equal(compact(1250), '1.3K')
  assert.equal(compact(12900), '13K')
  assert.equal(dayLabel('2026-10-15'), '15 ოქტ')
  assert.equal(dayLabel('2026-01-01T00:00:00Z'), '1 იან')
})
