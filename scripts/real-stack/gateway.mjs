// Supabase-ის მსგავსი gateway ლოკალური ტესტებისთვის:
// /rest/v1 → PostgREST, /auth/v1 → Auth (GoTrue), /storage/v1 → ფაილები დისკზე (RLS-ით), /functions/v1/game → Edge Function Node-ში
// გარემო: GATEWAY_PORT, PGRST_PORT, AUTH_PORT, STORE_DIR, GAME_FN (აწყობილი game ფუნქცია), SERVICE_KEY, PG* (psql-ისთვის)
import http from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const PORT = Number(process.env.GATEWAY_PORT || 54321)
const PGRST = Number(process.env.PGRST_PORT || 3000)
const AUTH = Number(process.env.AUTH_PORT || 9999)
const STORE = process.env.STORE_DIR
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info,prefer,range,accept-profile,content-profile,x-supabase-api-version,x-upsert,cache-control,x-region',
  'Access-Control-Expose-Headers': 'content-range,x-total-count,content-location,preference-applied',
}

// Edge Function „game“: იგივე კოდი, Node-ში (Deno-ს მინიმალური ჩანაცვლებით)
process.env.SUPABASE_URL = `http://localhost:${PORT}`
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SERVICE_KEY
globalThis.Deno = { env: { get: (k) => process.env[k] }, serve: (h) => { globalThis.__game = h } }
if (process.env.GAME_FN) await import(pathToFileURL(process.env.GAME_FN).href)

const cleanHeaders = (h) => Object.fromEntries(Object.entries(h).filter(([k]) => !k.startsWith('access-control-')))
function proxy(req, res, port, path, body) {
  const headers = { ...req.headers }
  delete headers.host
  const p = http.request({ host: '127.0.0.1', port, path, method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode, { ...cleanHeaders(r.headers), ...CORS })
    r.pipe(res)
  })
  p.on('error', (e) => { res.writeHead(502, CORS); res.end(String(e)) })
  p.end(body)
}
async function runFn(req, res, body) {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  const r = await globalThis.__game(new Request(`http://localhost${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body }))
  res.writeHead(r.status, { ...cleanHeaders(Object.fromEntries(r.headers)), ...CORS })
  res.end(Buffer.from(await r.arrayBuffer()))
}
const psql = (q) => execFileSync('psql', ['-At', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString()
const sub = (token) => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub || null } catch { return null } }
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'audio/webm' }

http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const url = new URL(req.url, 'http://x')
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
    if (url.pathname === '/functions/v1/game') return runFn(req, res, body).catch((e) => { res.writeHead(500, CORS); res.end(String(e)) })
    if (url.pathname.startsWith('/rest/v1/')) return proxy(req, res, PGRST, req.url.slice(8), body)
    if (url.pathname.startsWith('/auth/v1/')) return proxy(req, res, AUTH, req.url.slice(8), body)
    let m
    if ((m = url.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/))) {
      const f = join(STORE, m[1], decodeURIComponent(m[2]))
      if (!existsSync(f)) { res.writeHead(404, CORS); return res.end() }
      res.writeHead(200, { ...CORS, 'Content-Type': TYPES[f.split('.').pop().toLowerCase()] || 'application/octet-stream' })
      return res.end(readFileSync(f))
    }
    if ((m = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/)) && (req.method === 'POST' || req.method === 'PUT')) {
      const bucket = m[1]
      const name = decodeURIComponent(m[2])
      const owner = sub((req.headers.authorization || '').replace(/^Bearer /, ''))
      // როგორც Storage-ში: ჩანაწერი მომხმარებლის როლით, storage.objects-ის RLS-ით
      try {
        psql(`begin; set local role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: owner, role: 'authenticated' })}', true); insert into storage.objects (bucket_id, name, owner) values ('${bucket.replace(/'/g, "''")}', '${name.replace(/'/g, "''")}', ${owner ? `'${owner}'` : 'null'}); commit;`)
      } catch {
        res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }))
      }
      // storage-js ფაილს multipart/form-data-თი აგზავნის — ვიღებთ თვითონ ფაილის ნაწილს
      let data = body
      const ct = req.headers['content-type'] || ''
      const bm = ct.match(/boundary=([^;]+)/)
      if (ct.startsWith('multipart/form-data') && bm) {
        const parts = body.toString('latin1').split(`--${bm[1]}`).filter((x) => x.includes('\r\n\r\n'))
        const part = parts.find((x) => /filename=/.test(x)) || parts.at(-1)
        data = Buffer.from(part.slice(part.indexOf('\r\n\r\n') + 4, part.lastIndexOf('\r\n')), 'latin1')
      }
      const f = join(STORE, bucket, name)
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, data)
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ Key: `${bucket}/${name}`, path: name, id: name }))
    }
    if ((m = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)$/)) && req.method === 'DELETE') {
      // როგორც Storage-ში: service გასაღებით — ყველაფერი, მომხმარებლით — storage.objects-ის RLS-ით (მხოლოდ თავისი)
      const { prefixes = [] } = JSON.parse(body.toString() || '{}')
      const bucket = m[1].replace(/'/g, "''")
      const token = (req.headers.authorization || '').replace(/^Bearer /, '')
      const service = [token, req.headers.apikey].includes(process.env.SERVICE_KEY)
      const list = prefixes.map((p) => `'${String(p).replace(/'/g, "''")}'`).join(',') || "''"
      const del = `delete from storage.objects where bucket_id = '${bucket}' and name in (${list}) returning name`
      let removed = []
      try {
        const outp = service ? psql(del) : psql(`begin; set local role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: sub(token), role: 'authenticated' })}', true); ${del}; commit;`)
        removed = outp.split('\n').filter((l) => prefixes.includes(l))
      } catch { removed = [] }
      for (const p of removed) rmSync(join(STORE, m[1], p), { force: true })
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(removed.map((name) => ({ name, bucket_id: m[1] }))))
    }
    res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: 'not available in the local gateway', path: url.pathname }))
  })
}).listen(PORT, '127.0.0.1', () => console.log(`gateway on ${PORT}`))
