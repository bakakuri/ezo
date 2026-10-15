import test from 'node:test'
import assert from 'node:assert/strict'
import { qrMatrix, qrPath } from '../src/lib/qr.js'

// სტრუქტურული შემოწმება: ზომა, საძიებო კვადრატები, დროის ზოლები, ფორმატის და ვერსიის ბიტები ორივე ადგილას
const finderAt = (m, x0, y0) => {
  for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
    const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3))
    if (m[y0 + dy][x0 + dx] !== (d !== 2)) return false
  }
  return true
}
const formatA = (m) => {
  const bits = []
  for (let i = 0; i <= 5; i++) bits.push(m[i][8])
  bits.push(m[7][8], m[8][8], m[8][7])
  for (let i = 9; i < 15; i++) bits.push(m[8][14 - i])
  return bits
}
const formatB = (m) => {
  const n = m.length
  const bits = []
  for (let i = 0; i < 8; i++) bits.push(m[8][n - 1 - i])
  for (let i = 8; i < 15; i++) bits.push(m[n - 15 + i][8])
  return bits
}
const bchFormatOk = (bits) => {
  const v = bits.reduce((a, b, i) => a | ((b ? 1 : 0) << i), 0) ^ 0x5412
  let rem = v >>> 10
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((v >>> 10) << 10 | rem) === v && (v >>> 13) === 0 // M = 00
}

const samples = {
  1: 'https://ezo.ge',
  3: 'https://ezo.ge/u/giorgi.beridze',
  5: 'https://ezo.ge/invite/' + 'n'.repeat(60),
  7: 'x'.repeat(110),
  8: `otpauth://totp/${encodeURIComponent('ეზო:giorgi')}?secret=${'A'.repeat(32)}&issuer=${encodeURIComponent('ეზო')}`,
  9: 'z'.repeat(170),
  10: 'w'.repeat(200),
}

for (const [version, text] of Object.entries(samples)) {
  test(`QR ვერსია ${version}: სტრუქტურა სწორია`, () => {
    const m = qrMatrix(text)
    const n = m.length
    assert.equal(n, 17 + 4 * Number(version))
    assert.ok(finderAt(m, 0, 0) && finderAt(m, n - 7, 0) && finderAt(m, 0, n - 7), 'finder patterns')
    for (let i = 8; i < n - 8; i++) {
      assert.equal(m[6][i], i % 2 === 0, `timing row ${i}`)
      assert.equal(m[i][6], i % 2 === 0, `timing col ${i}`)
    }
    assert.equal(m[n - 8][8], true, 'dark module')
    assert.deepEqual(formatA(m), formatB(m), 'format copies match')
    assert.ok(bchFormatOk(formatA(m)), 'format BCH')
    if (Number(version) >= 7) {
      for (let i = 0; i < 18; i++) {
        const a = n - 11 + (i % 3)
        const b = Math.floor(i / 3)
        assert.equal(m[b][a], m[a][b], `version bit ${i}`)
      }
    }
  })
}

test('QR: ძალიან გრძელი ტექსტი შეცდომას აგდებს', () => {
  assert.throws(() => qrMatrix('x'.repeat(400)), /ძალიან გრძელია/)
})

test('QR: path და quiet zone', () => {
  const m = qrMatrix('ezo')
  const { d, size } = qrPath(m, 4)
  assert.equal(size, m.length + 8)
  assert.equal((d.match(/M/g) || []).length, m.flat().filter(Boolean).length)
})
