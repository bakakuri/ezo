import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

// supabase-js realtime-ის ქცევის ზუსტი ასლი (realtime-js RealtimeClient/RealtimeChannel):
// - channel(name) იმავე სახელის არსებულ არხს აბრუნებს;
// - .on('postgres_changes' | 'presence') joined/joining არხზე აგდებს შეცდომას;
// - subscribe() მხოლოდ დახურულ არხზე იწყებს შეერთებას;
// - removeChannel ასინქრონულია და დახურვისას ყველა იმავე სახელის არხს შლის.
const FAKE = `
class Ch {
  constructor(topic, client) { this.topic = topic; this.client = client; this.state = 'closed'; this.bindings = []; this.tracked = null }
  on(type, filter, cb) {
    if ((this.state === 'joined' || this.state === 'joining') && (type === 'presence' || type === 'postgres_changes'))
      throw new Error('cannot add \`' + type + '\` callbacks for ' + this.topic + ' after \`subscribe()\`.')
    this.bindings.push({ type, filter, cb }); return this
  }
  subscribe(cb) {
    if (this.state === 'closed') { this.state = 'joining'; queueMicrotask(() => { this.state = 'joined'; cb && cb('SUBSCRIBED') }) }
    return this
  }
  async unsubscribe() { this.state = 'leaving'; await new Promise((r) => setTimeout(r, 20)); this.state = 'closed'; this.client._remove(this); return 'ok' }
  send(msg) { this.client.sent.push({ topic: this.topic, msg }) }
  track(p) { this.tracked = p; return Promise.resolve('ok') }
  untrack() { this.tracked = null; return Promise.resolve('ok') }
  presenceState() { return {} }
  emit(type, event, payload) { for (const b of this.bindings) if (b.type === type && (b.filter.event === event || b.filter.event === '*')) b.cb({ payload }) }
}
const client = {
  channels: [], sent: [], created: 0,
  channel(name, opts) {
    const t = 'realtime:' + name
    const e = this.channels.find((c) => c.topic === t)
    if (e) return e
    const c = new Ch(t, this); this.channels.push(c); this.created++; return c
  },
  _remove(ch) { this.channels = this.channels.filter((c) => c.topic !== ch.topic) },
  removeChannel(ch) { return ch.unsubscribe() },
  getChannels() { return this.channels },
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
}
export const supabase = client
export const DEMO = false
`

const root = fileURLToPath(new URL('..', import.meta.url))
async function loadApi() {
  const dir = mkdtempSync(join(tmpdir(), 'ezo-rt-'))
  writeFileSync(join(dir, 'fake-supabase.js'), FAKE)
  const out = join(dir, 'api.mjs')
  await build({
    entryPoints: [join(root, 'src/lib/api.supabase.js')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
    plugins: [{ name: 'fake', setup(b) { b.onResolve({ filter: /\/supabase\.js$/ }, () => ({ path: pathToFileURL(join(dir, 'fake-supabase.js')).href, external: true })) } }],
  })
  const mod = await import(pathToFileURL(out).href + '?' + Math.random())
  const fake = await import(pathToFileURL(join(dir, 'fake-supabase.js')).href)
  return { api: mod.api, client: fake.supabase }
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

test('realtime: two screens can listen to notifications at once (inbox + unread badge)', async () => {
  const { api, client } = await loadApi()
  const off1 = api.subscribeNotifications(() => {})
  await tick()
  const off2 = api.subscribeNotifications(() => {}) // ძველ კოდში აქ ვარდებოდა
  await tick()
  assert.equal(client.channels.length, 2)
  off1(); off2()
  await tick(40)
  assert.equal(client.channels.length, 0)
})

test('realtime: re-opening the same chat and game right away does not crash', async () => {
  const { api } = await loadApi()
  for (const sub of [(cb) => api.subscribeMessages('c1', cb), (cb) => api.subscribeGame('g1', cb), (cb) => api.subscribeTournament('t1', cb), (cb) => api.subscribeGameMessages('g1', cb)]) {
    const off = sub(() => {})
    await tick()
    off()
    sub(() => {}) // ძველი ჯერ იხურება — ახალი სახელით უნდა გაიხსნას
  }
})

test('realtime: typing channel is shared and keeps working while one listener leaves', async () => {
  const { api, client } = await loadApi()
  const got = []
  const offA = api.subscribeTyping('c1', (on) => got.push(['a', on]))
  const offB = api.subscribeTyping('c1', (on) => got.push(['b', on]))
  await tick()
  assert.equal(client.created, 1)
  const ch = client.channels[0]
  ch.emit('broadcast', 'typing', { user: 'someone', on: true })
  assert.deepEqual(got, [['a', true], ['b', true]])
  offA()
  ch.emit('broadcast', 'typing', { user: 'someone', on: false })
  assert.deepEqual(got.at(-1), ['b', false])
  api.sendTyping('c1', true)
  assert.equal(client.sent.length, 1)
  offB()
  const offC = api.subscribeTyping('c1', () => {}) // სწრაფად დაბრუნება — იგივე არხი
  assert.equal(client.created, 1)
  offC()
})

test('realtime: spectator who becomes a player keeps one presence channel and the new role', async () => {
  const { api, client } = await loadApi()
  const off1 = api.watchGame('g1', 'spectator', () => {})
  await tick()
  assert.equal(client.channels[0].tracked?.role, 'spectator')
  off1()
  const off2 = api.watchGame('g1', 'player', () => {}) // ძველ კოდში: presence callbacks after subscribe → შეცდომა
  assert.equal(client.created, 1)
  assert.equal(client.channels[0].tracked?.role, 'player')
  off2()
  assert.equal(client.channels[0].tracked, null)
})
