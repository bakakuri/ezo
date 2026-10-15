// API-ს შემოწმება რეალურ PostgREST-ზე: აპის და Edge Function-ების ყველა მოთხოვნა (select/embed, rpc, ფილტრები,
// ჩასაწერი ველები, realtime გამოწერები) მოწმდება გაშვებულ PostgREST-ზე და ბაზის კატალოგზე.
// გაშვება: PGRST_URL=http://localhost:3000 JWT_SECRET=… PGHOST=… PGUSER=… PGDATABASE=… node scripts/api-check/check.mjs
//   --app src/lib/api.supabase.js --server supabase/functions/game/index.ts supabase/functions/push/index.ts
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { transformSync } from 'esbuild'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'

const BASE = process.env.PGRST_URL || 'http://localhost:3000'
const SECRET = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long'

// ---- არგუმენტები
const files = { app: [], server: [] }
let mode = 'app'
for (const a of process.argv.slice(2)) {
  if (a === '--app') mode = 'app'
  else if (a === '--server') mode = 'server'
  else files[mode].push(a)
}

// ---- 1. ამოკრება
function extract(file) {
  let src = readFileSync(file, 'utf8')
  if (file.endsWith('.ts')) src = transformSync(src, { loader: 'ts', format: 'esm' }).code
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const consts = {}
  const evalStr = (n) => {
    if (!n) return null
    if (n.type === 'Literal' && typeof n.value === 'string') return n.value
    if (n.type === 'Identifier' && n.name in consts) return consts[n.name]
    if (n.type === 'TemplateLiteral') {
      let s = ''
      for (let i = 0; i < n.quasis.length; i++) {
        s += n.quasis[i].value.cooked
        if (i < n.expressions.length) { const v = evalStr(n.expressions[i]); if (v === null) return null; s += v }
      }
      return s
    }
    return null
  }
  walk.full(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') { const v = evalStr(n.init); if (v !== null) consts[n.id.name] = v }
  })
  // ჯაჭვში ქვემოთ: .from('t') ან .rpc('f', {...})
  const base = (call) => {
    let n = call.callee?.object
    while (n) {
      if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression') {
        const m = n.callee.property.name
        if (m === 'from') return { table: evalStr(n.arguments[0]) ?? '<dynamic>' }
        if (m === 'rpc') return { rpc: evalStr(n.arguments[0]), args: keys(n.arguments[1]).keys }
        n = n.callee.object
      } else if (n.type === 'MemberExpression') n = n.object
      else break
    }
    return null
  }
  const keys = (n) => {
    if (!n) return { keys: [], partial: false }
    if (n.type === 'ArrayExpression' && n.elements[0]?.type === 'ObjectExpression') return keys(n.elements[0])
    if (n.type !== 'ObjectExpression') return { keys: [], partial: true }
    const ks = []
    let partial = false
    for (const p of n.properties) {
      if (p.type === 'SpreadElement') partial = true
      else ks.push(p.key.type === 'Identifier' ? p.key.name : p.key.value)
    }
    return { keys: ks, partial }
  }
  const FILTERS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy', 'order', 'not', 'overlaps', 'textSearch'])
  const out = { selects: [], rpcSelects: [], filters: [], writes: [], rpcs: [], realtime: [], unresolved: [] }
  const at = (n) => `${file}:${n.loc.start.line}`
  walk.full(ast, (n) => {
    if (n.type === 'ObjectExpression') {
      const props = Object.fromEntries(n.properties.filter((p) => p.type === 'Property' && p.key).map((p) => [p.key.name ?? p.key.value, p.value]))
      if (props.schema && props.table) {
        let col = null
        const f = props.filter
        if (f?.type === 'TemplateLiteral') col = /^(\w+)=/.exec(f.quasis[0].value.cooked)?.[1] ?? null
        else if (f) col = /^(\w+)=/.exec(evalStr(f) || '')?.[1] ?? null
        out.realtime.push({ at: at(n), table: evalStr(props.table), col })
      }
    }
    if (n.type !== 'CallExpression' || n.callee.type !== 'MemberExpression' || n.callee.computed) return
    const m = n.callee.property.name
    if (m === 'rpc') {
      const k = keys(n.arguments[1])
      out.rpcs.push({ at: at(n), name: evalStr(n.arguments[0]), args: k.keys, partial: k.partial })
      return
    }
    const b = base(n)
    if (!b) return
    if (m === 'select') {
      const s = n.arguments[0] ? evalStr(n.arguments[0]) : '*'
      if (s === null) out.unresolved.push(`${at(n)} select`)
      else if (b.rpc) out.rpcSelects.push({ at: at(n), rpc: b.rpc, args: b.args, select: s.replace(/\s+/g, '') })
      else out.selects.push({ at: at(n), table: b.table, select: s.replace(/\s+/g, '') })
    } else if (b.table && FILTERS.has(m)) {
      const c = evalStr(n.arguments[0])
      if (c === null) out.unresolved.push(`${at(n)} ${m}`)
      else out.filters.push({ at: at(n), table: b.table, method: m, col: c })
    } else if (b.table && (m === 'insert' || m === 'update' || m === 'upsert')) {
      const k = keys(n.arguments[0])
      out.writes.push({ at: at(n), table: b.table, method: m, keys: k.keys })
      if (m === 'upsert' && n.arguments[1]?.type === 'ObjectExpression') {
        for (const p of n.arguments[1].properties) if (p.key?.name === 'onConflict') for (const c of (evalStr(p.value) || '').split(',')) out.filters.push({ at: at(n), table: b.table, method: 'onConflict', col: c.trim() })
      }
    }
  })
  return out
}

// ---- 2. კატალოგი
const catalog = JSON.parse(execFileSync('psql', ['-At', '-c', `
select json_build_object(
 'columns', (select json_object_agg(t, cols) from (select table_name t, json_agg(column_name) cols from information_schema.columns where table_schema='public' group by table_name) x),
 'functions', (select json_agg(json_build_object('name', p.proname, 'args', coalesce(p.proargnames[1:p.pronargs], '{}'), 'nargs', p.pronargs, 'ndefaults', p.pronargdefaults,
    'authenticated', has_function_privilege('authenticated', p.oid, 'execute'), 'service_role', has_function_privilege('service_role', p.oid, 'execute')))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
 'publication', (select coalesce(json_agg(tablename), '[]') from pg_publication_tables where pubname='supabase_realtime'))`]).toString())

// ---- 3. შემოწმება
const jwt = (role) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const h = b64({ alg: 'HS256', typ: 'JWT' })
  const p = b64({ role, sub: '00000000-0000-0000-0000-000000000001', aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 })
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}
const why = async (r) => { const j = await r.json().catch(() => ({})); return `${r.status} ${j.code ? `${j.code}: ` : ''}${j.message || r.statusText}` }
const problems = []
let counts = { select: 0, rpc: 0, filter: 0, write: 0, realtime: 0 }
for (const [kind, role] of [['app', 'authenticated'], ['server', 'service_role']]) {
  const H = { Authorization: `Bearer ${jwt(role)}`, 'Content-Type': 'application/json' }
  for (const file of files[kind]) {
    const c = extract(file)
    for (const u of c.unresolved) problems.push(`${u}: ვერ წავიკითხე (ცვლადი სახელით)`)
    const seen = new Map()
    for (const s of c.selects) {
      const key = `${s.table}|${s.select}`
      if (!seen.has(key)) {
        const r = await fetch(`${BASE}/${s.table}?select=${encodeURIComponent(s.select)}&limit=0`, { headers: H })
        seen.set(key, r.ok ? null : await why(r))
      }
      if (seen.get(key)) problems.push(`${s.at}: select ${s.table} — ${seen.get(key)}`)
      counts.select++
    }
    for (const s of c.rpcSelects) {
      const r = await fetch(`${BASE}/rpc/${s.rpc}?select=${encodeURIComponent(s.select)}&limit=0`, { method: 'POST', headers: H, body: JSON.stringify(Object.fromEntries(s.args.map((a) => [a, null]))) })
      if (!r.ok) problems.push(`${s.at}: rpc ${s.rpc}().select — ${await why(r)}`)
      counts.select++
    }
    for (const f of c.filters) {
      counts.filter++
      const cols = catalog.columns[f.table]
      if (!cols) { problems.push(`${f.at}: ცხრილი ${f.table} არ არსებობს`); continue }
      if (!f.col.includes('.') && !cols.includes(f.col)) problems.push(`${f.at}: ${f.method}('${f.col}') — ${f.table}-ში ასეთი სვეტი არაა`)
    }
    for (const w of c.writes) {
      counts.write++
      const cols = catalog.columns[w.table]
      if (!cols) { problems.push(`${w.at}: ცხრილი ${w.table} არ არსებობს`); continue }
      for (const k of w.keys) if (!cols.includes(k)) problems.push(`${w.at}: ${w.method} ${w.table}.${k} — ასეთი სვეტი არაა`)
    }
    for (const r of c.rpcs) {
      counts.rpc++
      const fns = (catalog.functions || []).filter((f) => f.name === r.name)
      if (!fns.length) { problems.push(`${r.at}: rpc ${r.name} არ არსებობს`); continue }
      const match = fns.find((f) => r.args.every((a) => f.args.includes(a)) && (r.partial || f.args.slice(0, f.nargs - f.ndefaults).every((a) => r.args.includes(a))))
      if (!match) problems.push(`${r.at}: rpc ${r.name}(${r.args.join(', ')}) — პარამეტრები არ ემთხვევა: ${fns.map((f) => `(${f.args.join(', ')})`).join(' | ')}`)
      else if (!match[role]) problems.push(`${r.at}: rpc ${r.name} — როლს ${role} გაშვების უფლება არ აქვს`)
    }
    for (const r of c.realtime) {
      counts.realtime++
      if (!catalog.publication.includes(r.table)) problems.push(`${r.at}: realtime ${r.table} — Realtime-ის სიაში არაა`)
      if (r.col && !catalog.columns[r.table]?.includes(r.col)) problems.push(`${r.at}: realtime ფილტრი ${r.table}.${r.col} — ასეთი სვეტი არაა`)
    }
  }
}
console.log(`შემოწმდა: select ${counts.select}, rpc ${counts.rpc}, ფილტრი ${counts.filter}, ჩაწერა ${counts.write}, realtime ${counts.realtime}`)
if (problems.length) {
  console.log(`პრობლემები (${problems.length}):\n` + problems.join('\n'))
  process.exit(1)
}
console.log('ყველაფერი რიგზეა')
