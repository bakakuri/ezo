// schema.sql-ის დაყოფა 4 ნაწილად — ტელეფონიდან SQL Editor-ში ჩასასმელად, თუ მთლიანი ფაილი ერთად არ ჩაჯდა.
// ნაწილები გაუშვი თანმიმდევრობით: 1 → 2 → 3 → 4. ერთად აწყობილი ზუსტად schema.sql-ია (ამოწმებს tests/schema-parts.test.mjs).
// გაშვება (schema.sql-ის ყოველი ცვლილების შემდეგ): node scripts/split-schema.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ნაწილების საზღვრები — სექციების სათაურები (ყოველთვის ორ ბრძანებას შორისაა)
const MARKS = ['--  v2:', '--  v5:', '--  v8:']

export const partHeader = (n, total) =>
  `-- ეზო — სქემის ნაწილი ${n}/${total}. ${n === 1 ? 'გაუშვი პირველი.' : `გაუშვი ${n - 1}-ის შემდეგ.`} (მთლიანი ფაილი: supabase/schema.sql)\n`

export function splitSchema(sql) {
  const cuts = MARKS.map((m) => {
    const at = sql.indexOf(`\n${m}`)
    if (at < 0) throw new Error(`სექცია ვერ ვიპოვე: ${m}`)
    return sql.lastIndexOf('\n-- =====', at) + 1
  })
  const bounds = [0, ...cuts, sql.length]
  return bounds.slice(0, -1).map((from, i) => partHeader(i + 1, bounds.length - 1) + sql.slice(from, bounds[i + 1]))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const parts = splitSchema(readFileSync('supabase/schema.sql', 'utf8'))
  mkdirSync('supabase/parts', { recursive: true })
  parts.forEach((p, i) => writeFileSync(`supabase/parts/schema-${i + 1}.sql`, p))
  console.log(parts.map((p, i) => `supabase/parts/schema-${i + 1}.sql  ${Math.round(p.length / 1000)}k სიმბოლო`).join('\n'))
}
