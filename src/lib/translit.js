// ქართული/ლათინური „ჩონჩხი“ ძებნისთვის: „გიორგი“ = „giorgi“, „beridze“ = „ბერიძე“.
// მსგავსი ბგერები ერთდება (თ/ტ, კ/ქ/ყ, პ/ფ, ჩ/ჭ, ც/წ), რომ ლათინურად აკრეფილიც მოიძებნოს.
// ზუსტად იგივე წესია SQL-ში: public.ka_skeleton (supabase/schema.sql) — ტესტები ორივეს ადარებს.
const PAIRS = [["ch'", 'č'], ['chh', 'č'], ['ch', 'č'], ['sh', 'š'], ['zh', 'ž'], ['kh', 'x'], ['gh', 'ğ'], ['dz', 'đ'],
  ["ts'", 'c'], ['tz', 'c'], ['ts', 'c'], ['th', 't'], ['ph', 'p'], ["'", '']]
const FROM = 'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰqywf'
const TO = 'abgdevztiklmnopžrstupkğkščcđcčxjhkkcp'
const MAP = new Map([...FROM].map((ch, i) => [ch, TO[i]]))

export function skeleton(text) {
  let s = String(text ?? '').toLowerCase()
  for (const [a, b] of PAIRS) s = s.split(a).join(b)
  let out = ''
  for (const ch of s) out += MAP.get(ch) ?? ch
  return out
}

// ემთხვევა თუ არა ტექსტი ძებნას (დემო რეჟიმისთვის და კლიენტის ფილტრებისთვის)
export function matches(text, query) {
  const q = skeleton(String(query ?? '').trim().replace(/^[#@]+/, ''))
  return q.length > 0 && skeleton(text).includes(q)
}
