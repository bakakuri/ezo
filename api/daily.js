// Vercel Cron — დღეში ერთხელ (vercel.json → crons):
// 1) „გაღვიძება“: Supabase-ის უფასო პროექტი 7 დღის უმოქმედობის შემდეგ ჩერდება — ერთი მოთხოვნა ბაზაში საკმარისია;
// 2) საცავის დასუფთავება: წაშლილი პოსტების, სთორიების, განცხადებების, ავატარების… ფაილები.
//    მუშაობს მხოლოდ მაშინ, როცა Vercel-ში SUPABASE_SERVICE_ROLE_KEY (ან SUPABASE_SECRET_KEY) მითითებულია.
//    ეს გასაღები საიდუმლოა: არასდროს დაარქვა VITE_-ით დაწყებული სახელი (ასეთი ცვლადები ბრაუზერში ხვდება).
import { rpc } from './_rpc.js'

const base = () => (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ''
// ახალი საიდუმლო გასაღები (sb_secret_…) JWT არაა — მხოლოდ apikey-ში
const keyHeaders = (key) => ({ apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' })

export async function cleanup({ url = base(), key = serviceKey(), fetchImpl = fetch, limit = 200, batch = 100 } = {}) {
  if (!url || !key) return { skipped: 'SUPABASE_SERVICE_ROLE_KEY არ არის მითითებული' }
  const call = (fn, body) => fetchImpl(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: keyHeaders(key), body: JSON.stringify(body), signal: AbortSignal.timeout(20000) })
  const r = await call('media_cleanup_take', { p_limit: limit })
  if (!r.ok) throw new Error(`media_cleanup_take ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const paths = (await r.json()) || []
  let deleted = 0
  let failed = 0
  for (let i = 0; i < paths.length; i += batch) {
    const part = paths.slice(i, i + batch)
    const d = await fetchImpl(`${url}/storage/v1/object/media`, {
      method: 'DELETE', headers: keyHeaders(key), body: JSON.stringify({ prefixes: part }), signal: AbortSignal.timeout(20000),
    }).catch(() => null)
    if (d?.ok) deleted += part.length
    else {
      failed += part.length
      await call('media_cleanup_return', { p_paths: part }).catch(() => {})
    }
  }
  return { deleted, failed }
}

export default async function handler(req, res) {
  // CRON_SECRET თუ მითითებულია, Vercel მას Authorization-ში აგზავნის — სხვა ვერ გამოიძახებს
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  res.setHeader('Cache-Control', 'no-store')
  const alive = await rpc('keep_alive', {}, 10000)
  let media
  try { media = await cleanup() } catch (e) { media = { error: String(e?.message || e).slice(0, 300) } }
  res.status(alive ? 200 : 503).json({ alive: Boolean(alive), at: alive, media })
}
