// ქართული ძებნის „ჩონჩხი“: ლათინური და ქართული ერთნაირად
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skeleton, matches } from '../src/lib/translit.js'

// [ქართული, ლათინური ვარიანტები...] — ყველა ერთ ჩონჩხზე უნდა მივიდეს
export const SAME = [
  ['გიორგი', 'giorgi', 'Giorgi'],
  ['ბერიძე', 'beridze', 'Beridze'],
  ['ჭავჭავაძე', 'chavchavadze', "ch'avch'avadze"],
  ['ხათუნა', 'khatuna', 'xatuna'],
  ['ქავთარაძე', 'kavtaradze', 'qavtaradze'],
  ['შოთა', 'shota'],
  ['ცოტნე', 'tsotne', "ts'otne", 'cotne'],
  ['წერეთელი', 'tsereteli', 'wereteli'],
  ['ღვინჯილია', 'ghvinjilia'],
  ['ჟვანია', 'zhvania'],
  ['ყიფიანი', 'qipiani', 'yifiani', 'kipiani'],
  ['ფალიაშვილი', 'paliashvili', 'faliashvili', 'phaliashvili'],
  ['ნინო', 'nino'],
  ['ლაშა', 'lasha'],
  ['თამარ', 'tamar'],
  ['დათო', 'dato'],
  ['ჰერმანი', 'hermani'],
  ['ჯაბა', 'jaba'],
]

test('ქართული და ლათინური ერთნაირ ჩონჩხზე მიდის', () => {
  for (const [ka, ...lat] of SAME) for (const l of lat) assert.equal(skeleton(l), skeleton(ka), `${l} ≠ ${ka}`)
})

test('ძებნა: ნაწილით, @ და # გარეშე, დიდი ასოებით', () => {
  assert.ok(matches('გიორგი ბერიძე', 'beridz'))
  assert.ok(matches('Giorgi Beridze', 'ბერიძ'))
  assert.ok(matches('nardi.master', '@NARDI'))
  assert.ok(matches('#ნარდი', 'nard'))
  assert.ok(!matches('ნინო', 'giorgi'))
  assert.ok(!matches('ნინო', '   '))
})

test('ცარიელი და უცნაური მნიშვნელობები', () => {
  assert.equal(skeleton(null), '')
  assert.equal(skeleton(undefined), '')
  assert.equal(skeleton(123), '123')
  assert.equal(skeleton('ნინო_99.b'), 'nino_99.b')
})
