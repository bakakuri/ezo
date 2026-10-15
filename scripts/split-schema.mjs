// schema.sql-ის დაყოფა 8 ნაწილად — ტელეფონიდან SQL Editor-ში ჩასასმელად (დიდი ტექსტი ტელეფონზე ძნელად ჩაისმება).
// ნაწილები გაუშვი თანმიმდევრობით: 1 → 8. ერთად აწყობილი ზუსტად schema.sql-ია (ამოწმებს tests/schema-parts.test.mjs).
// გაშვება (schema.sql-ის ყოველი ცვლილების შემდეგ): node scripts/split-schema.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const PARTS = 8

export const partHeader = (n, total) =>
  `-- ეზო — სქემის ნაწილი ${n}/${total}. ${n === 1 ? 'გაუშვი პირველი.' : `გაუშვი ${n - 1}-ის შემდეგ.`} (მთლიანი ფაილი: supabase/schema.sql)\n`

// უსაფრთხო საზღვრები: ცარიელი ხაზი $$-ის გარეთ, როცა წინა ბრძანება „;“-ით დასრულდა
export function safeCuts(sql) {
  const cuts = []
  let inBody = false
  let lastCode = ''
  let off = 0
  for (const line of sql.split('\n')) {
    if (!inBody && line.trim() === '' && lastCode.endsWith(';')) cuts.push(off)
    if ((line.match(/\$\$/g) || []).length % 2) inBody = !inBody
    const code = line.trim().startsWith('--') ? '' : line.trim()
    if (code) lastCode = code
    off += line.length + 1
  }
  return cuts
}

export function splitSchema(sql, parts = PARTS) {
  const safe = safeCuts(sql)
  const cuts = []
  for (let k = 1; k < parts; k++) {
    const target = (sql.length * k) / parts
    const prev = cuts.at(-1) ?? 0
    const best = safe.filter((c) => c > prev).reduce((a, c) => (Math.abs(c - target) < Math.abs(a - target) ? c : a), Infinity)
    if (!Number.isFinite(best)) throw new Error('უსაფრთხო საზღვარი ვერ ვიპოვე')
    cuts.push(best)
  }
  const bounds = [0, ...cuts, sql.length]
  return bounds.slice(0, -1).map((from, i) => partHeader(i + 1, parts) + sql.slice(from, bounds[i + 1]))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const parts = splitSchema(readFileSync('supabase/schema.sql', 'utf8'))
  mkdirSync('supabase/parts', { recursive: true })
  for (const f of readdirSync('supabase/parts')) if (/^schema-\d+\.sql$/.test(f)) rmSync(`supabase/parts/${f}`)
  parts.forEach((p, i) => writeFileSync(`supabase/parts/schema-${i + 1}.sql`, p))
  console.log(parts.map((p, i) => `supabase/parts/schema-${i + 1}.sql  ${Math.round(p.length / 1000)}k სიმბოლო`).join('\n'))
}
