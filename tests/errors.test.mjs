// შეცდომების ჟურნალის კლიენტი: რა იგზავნება და რა — არა
import { test, beforeEach } from 'node:test'
import { setImmediate as tick } from 'node:timers/promises'
import assert from 'node:assert/strict'
import { reportError, reportApiError, isSchemaError, setErrorSender, _resetForTests } from '../src/lib/errors.js'

let got = []
beforeEach(() => { got = []; _resetForTests(); setErrorSender((p) => { got.push(p) }) })

test('სქემის შეცდომები: API-ს შეუსაბამობა ითვლება, ადამიანის ქმედება — არა', () => {
  assert.equal(isSchemaError({ code: 'PGRST200', message: 'Could not find a relationship' }), true)
  assert.equal(isSchemaError({ code: 'PGRST202', message: 'Could not find the function' }), true)
  assert.equal(isSchemaError({ code: '42703', message: 'column x does not exist' }), true)
  assert.equal(isSchemaError({ code: '42501', message: 'permission denied for table push_subscriptions' }), true)
  assert.equal(isSchemaError({ code: '42501', message: 'new row violates row-level security policy for table "posts"' }), false)
  assert.equal(isSchemaError({ code: 'P0001', message: 'დღეში ერთხელ' }), false)
  assert.equal(isSchemaError({ code: '23505', message: 'duplicate key' }), false)
  assert.equal(isSchemaError({ message: 'no code' }), false)
})

test('ერთი შეცდომა ერთხელ იგზავნება, გვერდზე მაქსიმუმ 10', async () => {
  const e = new Error('boom')
  assert.equal(reportError(e, 'boundary'), true)
  assert.equal(reportError(e, 'boundary'), false)
  await tick()
  assert.equal(got.length, 1)
  assert.equal(got[0].message, 'boom')
  assert.equal(got[0].source, 'boundary')
  assert.match(got[0].stack, /boom/)
  for (let i = 0; i < 20; i++) reportError(new Error(`e${i}`))
  await tick()
  assert.equal(got.length, 10)
})

test('ხმაური არ იგზავნება: კავშირი, გაფართოებები, ცარიელი', async () => {
  for (const m of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'ResizeObserver loop completed with undelivered notifications.',
    'Script error.', 'AbortError: The user aborted a request.', 'ინტერნეტთან კავშირი ვერ დამყარდა', '', '   ']) {
    assert.equal(reportError(new Error(m)), false, m)
  }
  const ext = new Error('x is undefined')
  ext.stack = 'TypeError: x is undefined\n    at chrome-extension://abc/content.js:1:2'
  assert.equal(reportError(ext), false)
  await tick()
  assert.equal(got.length, 0)
})

test('ძველი ვერსიის ფაილები „chunk“-ად ინიშნება, კავშირის ხმაურის მიუხედავად', async () => {
  assert.equal(reportError(new TypeError('Failed to fetch dynamically imported module: https://ezo.ge/assets/Inbox-x.js'), 'boundary'), true)
  await tick()
  assert.equal(got[0].source, 'chunk')
})

test('API-ს შეცდომა: კოდი და დეტალები', async () => {
  reportApiError({ code: 'PGRST200', message: "Could not find a relationship between 'posts' and 'posts'", details: 'Searched for a foreign key', hint: null })
  await tick()
  assert.equal(got[0].source, 'api')
  assert.equal(got[0].message, "PGRST200: Could not find a relationship between 'posts' and 'posts'")
  assert.equal(got[0].stack, 'Searched for a foreign key')
})

test('სტრიქონი და უცნაური მნიშვნელობები; გამგზავნის შეცდომა აპს არ აგდებს', async () => {
  setErrorSender(() => { throw new Error('offline') })
  assert.equal(reportError('plain string'), true)
  setErrorSender(() => Promise.reject(new Error('rpc failed')))
  assert.equal(reportError({ message: 'object' }), true)
  assert.equal(reportError(null), false)
  assert.equal(reportError(undefined), false)
  await tick()
})

test('კომპონენტების ჯაჭვი დეტალებს ერთვის, გრძელი ტექსტი იჭრება', async () => {
  const e = new Error('x'.repeat(900))
  reportError(e, 'boundary', 'კომპონენტები:\nat Inbox')
  await tick()
  assert.equal(got[0].message.length, 500)
  assert.match(got[0].stack, /კომპონენტები:\nat Inbox$/)
  assert.ok(got[0].stack.length <= 4000)
})
