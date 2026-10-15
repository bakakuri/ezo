import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BADGES, levelOf, levelStart, levelProgress, levelTitle, checkinReward, GIFT_PRICES } from '../src/lib/rewards.js'

const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')

test('badge catalog matches the database seed', () => {
  const block = sql.slice(sql.indexOf('insert into public.badges'), sql.indexOf('on conflict (key) do update set metric'))
  const rows = [...block.matchAll(/\('(\w+)', '(\w+)', (\d+), (\d+), '([^']+)', (\d+)\)/g)]
    .map(([, key, metric, target, coins, title]) => ({ key, metric, target: +target, coins: +coins, title }))
  assert.equal(rows.length, BADGES.length)
  for (const r of rows) {
    const b = BADGES.find((x) => x.key === r.key)
    assert.ok(b, r.key)
    assert.deepEqual({ key: b.key, metric: b.metric, target: b.target, coins: b.coins, title: b.title }, r)
  }
})

test('gift prices match the database', () => {
  const fn = sql.slice(sql.indexOf('function public.gift_price'), sql.indexOf('function public.before_gift'))
  for (const [kind, price] of Object.entries(GIFT_PRICES)) {
    if (price === 0) assert.ok(!fn.includes(`'${kind}'`), `${kind} should be free`)
    else assert.match(fn, new RegExp(`when '${kind}' then ${price}\\b`))
  }
})

test('levels: thresholds and progress', () => {
  assert.equal(levelOf(0), 1)
  assert.equal(levelOf(99), 1)
  assert.equal(levelOf(100), 2)
  assert.equal(levelOf(299), 2)
  assert.equal(levelOf(300), 3)
  assert.equal(levelOf(4500), 10)
  for (let n = 1; n < 40; n++) assert.equal(levelOf(levelStart(n)), n)
  const p = levelProgress(820)
  assert.deepEqual([p.level, p.from, p.to, p.need], [4, 600, 1000, 180])
  assert.equal(levelTitle(1), 'ახალმოსული')
  assert.equal(levelTitle(12), 'ეზოს ძველი')
})

test('daily bonus grows and peaks on the 7th day', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 14].map(checkinReward), [5, 7, 9, 11, 13, 15, 40, 15, 40])
})
