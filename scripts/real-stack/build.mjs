// რეალური რეჟიმის ტესტებისთვის აწყობა: აპის API (src/lib/api.supabase.js) და Edge Function „game“ Node-ისთვის,
// და anon/service_role გასაღებები (JWT) ლოკალური Auth-ის საიდუმლოთი.
// გაშვება: JWT_SECRET=… SUPABASE_URL=… node scripts/real-stack/build.mjs <out-dir>
// SUPABASE_JS (არასავალდებულო): supabase-js-ის ფაილი node_modules-ის ნაცვლად
import { build } from 'esbuild'
import { createHmac } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve(process.argv[2] || '.real-stack')
const SECRET = process.env.JWT_SECRET
const URL = process.env.SUPABASE_URL || 'http://localhost:54321'
const SUPA = process.env.SUPABASE_JS ? resolve(process.env.SUPABASE_JS) : null
if (!SECRET) throw new Error('JWT_SECRET is required')
mkdirSync(OUT, { recursive: true })

const jwt = (role) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const h = b64({ alg: 'HS256', typ: 'JWT' })
  const p = b64({ iss: 'supabase', role, iat: 1790000000, exp: 2100000000 })
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}
const anon = jwt('anon')
const service = jwt('service_role')
writeFileSync(`${OUT}/keys.env`, `ANON_KEY=${anon}\nSERVICE_KEY=${service}\n`)

// npm:@supabase/supabase-js@2 (Deno) → Node-ის პაკეტი
const supabaseJs = {
  name: 'supabase-js',
  setup(b) {
    b.onResolve({ filter: /^(npm:)?@supabase\/supabase-js(@[\d.]+)?$/ }, async (args) => {
      if (SUPA) return { path: SUPA }
      if (!args.path.startsWith('npm:')) return undefined
      return b.resolve('@supabase/supabase-js', { kind: args.kind, resolveDir: process.cwd() })
    })
  },
}
const common = { bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning', plugins: [supabaseJs] }

await build({
  ...common,
  entryPoints: ['src/lib/api.supabase.js'],
  outfile: `${OUT}/api-node.mjs`,
  define: {
    'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: anon, VITE_DEMO: '0' }),
    __EZO_RELEASE__: '"ci"',
  },
})
await build({ ...common, entryPoints: ['supabase/functions/game/index.ts'], outfile: `${OUT}/game-fn.mjs` })
console.log(`built → ${OUT}`)
