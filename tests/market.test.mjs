import { test } from 'node:test'
import assert from 'node:assert/strict'
import { priceText, categoryOf, CATEGORIES, HAS_CONDITION } from '../src/lib/market.js'

test('price text: lari, dollars, free, negotiable', () => {
  assert.equal(priceText(1250, 'GEL'), '1 250 ₾')
  assert.equal(priceText(85, 'GEL'), '85 ₾')
  assert.equal(priceText(8900, 'USD'), '$8 900')
  assert.equal(priceText(1234567, 'USD'), '$1 234 567')
  assert.equal(priceText(19.5, 'GEL'), '19.50 ₾')
  assert.equal(priceText('1100.00', 'GEL'), '1 100 ₾')
  assert.equal(priceText(0, 'GEL'), 'უფასოდ')
  assert.equal(priceText(null, 'GEL'), 'ფასი შეთანხმებით')
  assert.equal(priceText(null, 'GEL', { short: true }), 'შეთანხმებით')
})

test('categories: unique keys, fallback, condition only for goods', () => {
  assert.equal(new Set(CATEGORIES.map((c) => c.key)).size, CATEGORIES.length)
  assert.equal(categoryOf('vehicles').label, 'ავტომობილები')
  assert.equal(categoryOf('nope').key, 'other')
  for (const k of ['realty', 'services', 'animals']) assert.equal(HAS_CONDITION.has(k), false)
  assert.equal(HAS_CONDITION.has('electronics'), true)
})
