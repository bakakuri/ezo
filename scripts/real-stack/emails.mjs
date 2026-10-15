// ქართული წერილების შემოწმება ნამდვილ Supabase Auth-ზე: ცალკე Auth (დადასტურება ჩართულია) ჩვენი შაბლონებით,
// წერილები მიდის ლოკალურ SMTP-ზე და მოწმდება — თემა, სახელი, ბმული/კოდი და რომ Go-ს შაბლონმა შეცდომის გარეშე იმუშავა.
// გაშვება (run.sh-იდან): node scripts/real-stack/emails.mjs <real-stack dir>   გარემო: PG*, PGDATABASE, JWT_SECRET, SERVICE_KEY
import net from 'node:net'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { TEMPLATES } from '../emails/build.mjs'

const W = resolve(process.argv[2] || '.real-stack')
const AUTH = Number(process.env.EMAIL_AUTH_PORT || 9992)
const SMTP = Number(process.env.EMAIL_SMTP_PORT || 2526)
const TPL = Number(process.env.EMAIL_TPL_PORT || 54340)
const BASE = `http://localhost:${AUTH}`
const SERVICE = process.env.SERVICE_KEY
const SECRET = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long'

// ---- SMTP მიმღები: ყველა წერილი მეხსიერებაში
const mails = []
const waiters = []
function decodeWords(s) {
  return s.replace(/=\?utf-8\?([bq])\?([^?]*)\?=\s*/gi, (_, enc, text) => enc.toLowerCase() === 'b'
    ? Buffer.from(text, 'base64').toString('utf8')
    : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'))
}
function qp(s) {
  return Buffer.from(s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8')
}
function parse(raw) {
  const split = raw.indexOf('\r\n\r\n')
  const head = raw.slice(0, split).replace(/\r\n[ \t]+/g, ' ')
  let body = raw.slice(split + 4)
  const h = Object.fromEntries(head.split('\r\n').map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]))
  const boundary = /boundary="?([^";]+)"?/i.exec(h['content-type'] || '')?.[1]
  let enc = h['content-transfer-encoding'] || ''
  if (boundary) {
    const part = body.split(`--${boundary}`).find((p) => /content-type:\s*text\/html/i.test(p)) || ''
    const i = part.indexOf('\r\n\r\n')
    enc = /content-transfer-encoding:\s*([\w-]+)/i.exec(part.slice(0, i))?.[1] || ''
    body = part.slice(i + 4)
  }
  const html = /base64/i.test(enc) ? Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8')
    : /quoted-printable/i.test(enc) ? qp(body) : Buffer.from(body, 'latin1').toString('utf8')
  return { to: h.to, from: decodeWords(h.from || ''), subject: decodeWords(h.subject || ''), html }
}
const smtp = net.createServer((sock) => {
  let data = null
  let buf = ''
  sock.write('220 ezo-test ESMTP\r\n')
  sock.on('data', (chunk) => {
    buf += chunk.toString('latin1')
    while (true) {
      if (data !== null) {
        const end = buf.indexOf('\r\n.\r\n')
        if (end < 0) return
        const msg = parse((data + buf.slice(0, end)).replace(/^\.\./gm, '.'))
        buf = buf.slice(end + 5)
        data = null
        mails.push(msg)
        waiters.splice(0).forEach((w) => w())
        sock.write('250 OK\r\n')
        continue
      }
      const nl = buf.indexOf('\r\n')
      if (nl < 0) return
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 2)
      const cmd = line.slice(0, 4).toUpperCase()
      if (cmd === 'EHLO') sock.write('250-ezo-test\r\n250 8BITMIME\r\n')
      else if (cmd === 'HELO') sock.write('250 ezo-test\r\n')
      else if (cmd === 'DATA') { data = ''; sock.write('354 go ahead\r\n') }
      else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end() }
      else sock.write('250 OK\r\n')
    }
  })
  sock.on('error', () => {})
})
await new Promise((r) => smtp.listen(SMTP, '127.0.0.1', r))

// ---- შაბლონები HTTP-ით (Auth მათ URL-იდან კითხულობს)
const tplServer = http.createServer((req, res) => {
  const f = resolve('supabase/email-templates', req.url.replace(/^\//, '').replace(/[^\w.-]/g, ''))
  if (!existsSync(f)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(readFileSync(f))
})
await new Promise((r) => tplServer.listen(TPL, '127.0.0.1', r))

// ---- მეორე Auth: დადასტურება ჩართული, ჩვენი შაბლონები და თემები, უსაფრთხოების შეტყობინებები ჩართული
const env = {
  PATH: process.env.PATH,
  GOTRUE_API_HOST: '127.0.0.1', PORT: String(AUTH), API_EXTERNAL_URL: BASE,
  GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_NAMESPACE: 'auth',
  DATABASE_URL: `postgres://supabase_auth_admin:authadmin@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE}?search_path=auth&sslmode=disable`,
  GOTRUE_DB_MIGRATIONS_PATH: `${W}/auth/migrations`,
  GOTRUE_SITE_URL: 'http://localhost:5173', GOTRUE_URI_ALLOW_LIST: 'http://localhost:5173/**',
  GOTRUE_JWT_SECRET: SECRET, GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_AUD: 'authenticated',
  GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_ADMIN_ROLES: 'service_role',
  GOTRUE_DISABLE_SIGNUP: 'false', GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'false',
  GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED: 'false', GOTRUE_MAILER_OTP_EXP: '3600',
  GOTRUE_MFA_TOTP_ENROLL_ENABLED: 'true', GOTRUE_MFA_TOTP_VERIFY_ENABLED: 'true',
  GOTRUE_RATE_LIMIT_EMAIL_SENT: '1000', GOTRUE_SMTP_MAX_FREQUENCY: '1ns',
  GOTRUE_SMTP_HOST: '127.0.0.1', GOTRUE_SMTP_PORT: String(SMTP), GOTRUE_SMTP_ADMIN_EMAIL: 'noreply@ezo.test', GOTRUE_SMTP_SENDER_NAME: 'ეზო',
  GOTRUE_LOG_LEVEL: 'warn',
}
for (const t of TEMPLATES) {
  env[`GOTRUE_MAILER_TEMPLATES_${t.env}`] = `http://127.0.0.1:${TPL}/${t.key}.html`
  env[`GOTRUE_MAILER_SUBJECTS_${t.env}`] = t.subject
  if (t.notification) env[`GOTRUE_MAILER_NOTIFICATIONS_${t.notification}_ENABLED`] = 'true'
}
const auth = spawn(`${W}/auth/auth`, [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let authLog = ''
auth.stdout.on('data', (d) => { authLog += d })
auth.stderr.on('data', (d) => { authLog += d })
const stop = (code) => { auth.kill(); smtp.close(); tplServer.close(); process.exit(code) }
for (let i = 0; ; i++) {
  try { if ((await fetch(`${BASE}/health`)).ok) break } catch { /* */ }
  if (i > 60) { console.log('Auth ვერ ჩაირთო\n' + authLog.slice(-2000)); stop(1) }
  await new Promise((r) => setTimeout(r, 500))
}

// ---- დამხმარეები
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, redirect: 'manual', headers: { apikey: SERVICE, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* */ }
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 200)}`)
  return { status: r.status, json, location: r.headers.get('location') }
}
async function mailFor(to, subject) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const i = mails.findIndex((m) => m.to.includes(to) && m.subject === subject)
    if (i >= 0) return mails.splice(i, 1)[0]
    await new Promise((r) => { waiters.push(r); setTimeout(r, 300) })
  }
  throw new Error(`წერილი „${subject}“ ${to}-ზე არ მოვიდა. მოვიდა: ${mails.map((m) => `${m.to} | ${m.subject}`).join('; ') || 'არაფერი'}`)
}
const linkIn = (html) => /href="(http:\/\/localhost:\d+\/verify\?[^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&')
const codeIn = (html) => /class="code"[^>]*>\s*(\d{6})\s*</.exec(html)?.[1]
function totp(secret) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += abc.indexOf(ch).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const h = createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1] & 15
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0')
}
const T = Object.fromEntries(TEMPLATES.map((t) => [t.key, t]))
const results = []
const checked = new Set()
async function expect(key, to, checks = []) {
  const m = await mailFor(to, T[key].subject)
  const problems = []
  if (/\{\{|\}\}/.test(m.html)) problems.push('შაბლონის ცვლადი დარჩა')
  if (!m.html.includes('ეზო — ქართული სოციალური ქსელი')) problems.push('ქვედა ხაზი აკლია')
  if (!m.from.includes('ეზო')) problems.push(`გამგზავნი: ${m.from}`)
  for (const [ok, what] of checks) if (!ok(m.html)) problems.push(what)
  if (problems.length) throw new Error(`${key}: ${problems.join(', ')}`)
  checked.add(key)
  return m
}
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]) } catch (e) { results.push(['FAIL', name, String(e.message || e).slice(0, 300)]) }
}

// ---- სცენარი
const RUN = Date.now().toString(36).slice(-5)
const email = `mail.${RUN}@ezo.test`
const email2 = `mail2.${RUN}@ezo.test`
let session = null
let password = 'secret123'

await step('რეგისტრაცია → დადასტურების წერილი → ბმულით დადასტურება', async () => {
  const r = await call('POST', '/signup', { email, password, data: { full_name: 'ნინო ბერიძე' } })
  if (r.json?.access_token) throw new Error('დადასტურების გარეშე შევიდა')
  const m = await expect('confirmation', email, [[(h) => h.includes('გამარჯობა, ნინო ბერიძე!'), 'სახელი აკლია'], [(h) => h.includes(email), 'ელფოსტა აკლია'], [linkIn, 'ბმული აკლია']])
  const v = await call('GET', linkIn(m.html).replace(/^http:\/\/localhost:\d+/, ''))
  if (!/access_token=/.test(v.location || '')) throw new Error('ბმულმა არ დაადასტურა: ' + v.location)
  session = (await call('POST', '/token?grant_type=password', { email, password })).json
})
await step('პაროლის აღდგენა', async () => {
  await call('POST', '/recover', { email })
  await expect('recovery', email, [[(h) => h.includes(email), 'ელფოსტა აკლია'], [linkIn, 'ბმული აკლია']])
})
await step('შესვლის ბმული და კოდი', async () => {
  await call('POST', '/otp', { email, create_user: false })
  await expect('magic_link', email, [[codeIn, 'კოდი აკლია'], [linkIn, 'ბმული აკლია'], [(h) => h.includes('გამარჯობა, ნინო ბერიძე!'), 'სახელი აკლია']])
})
await step('დადასტურების კოდი (reauthenticate)', async () => {
  await call('GET', '/reauthenticate', null, session.access_token)
  await expect('reauthentication', email, [[codeIn, 'კოდი აკლია']])
})
await step('პაროლის შეცვლა → შეტყობინება', async () => {
  password = 'secret456'
  await call('PUT', '/user', { password }, session.access_token)
  await expect('password_changed_notification', email, [[(h) => h.includes(email), 'ელფოსტა აკლია'], [(h) => h.includes('href="http://localhost:5173"'), 'საიტის ბმული აკლია']])
})
await step('2FA ჩართვა და გამორთვა → ორი შეტყობინება', async () => {
  const f = (await call('POST', '/factors', { factor_type: 'totp', friendly_name: 'ტელეფონი' }, session.access_token)).json
  const ch = (await call('POST', `/factors/${f.id}/challenge`, {}, session.access_token)).json
  const aal2 = (await call('POST', `/factors/${f.id}/verify`, { challenge_id: ch.id, code: totp(f.totp.secret) }, session.access_token)).json
  await expect('mfa_factor_enrolled_notification', email)
  await call('DELETE', `/factors/${f.id}`, null, aal2.access_token)
  await expect('mfa_factor_unenrolled_notification', email)
  session = aal2
})
await step('ელფოსტის შეცვლა → დადასტურება → შეტყობინება', async () => {
  await call('PUT', '/user', { email: email2 }, session.access_token)
  const m = await expect('email_change', email2, [[(h) => h.includes(email) && h.includes(email2), 'ორივე მისამართი უნდა ჩანდეს'], [linkIn, 'ბმული აკლია']])
  await call('GET', linkIn(m.html).replace(/^http:\/\/localhost:\d+/, ''))
  // შეტყობინება ძველ მისამართზე მიდის
  await expect('email_changed_notification', email, [[(h) => h.includes(email) && h.includes(email2), 'ძველი და ახალი მისამართი']])
})
await step('მოწვევა (ადმინი)', async () => {
  const inv = `invite.${RUN}@ezo.test`
  await call('POST', '/invite', { email: inv }, SERVICE)
  await expect('invite', inv, [[linkIn, 'ბმული აკლია']])
})

const fails = results.filter((r) => r[0] === 'FAIL')
const missing = TEMPLATES.filter((t) => !checked.has(t.key)).map((t) => t.key)
console.log(`წერილები: ${results.length - fails.length}/${results.length} სცენარი, შემოწმდა ${checked.size}/${TEMPLATES.length} შაბლონი`)
for (const f of fails) console.log(`FAIL ${f[1]} :: ${f[2]}`)
if (missing.length) console.log(`შეუმოწმებელი: ${missing.join(', ')}`)
if (fails.length && /error/i.test(authLog)) console.log(authLog.split('\n').filter((l) => /error/i.test(l)).slice(-5).join('\n'))
stop(fails.length || missing.length ? 1 : 0)
