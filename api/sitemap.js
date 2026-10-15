// Vercel Function: /sitemap.xml — მთავარი, წესები და საჯარო გვერდები (ღია პროფილები, განცხადებები, შეხვედრები).
// სია მოდის SQL ფუნქციიდან sitemap_entries (supabase/updates/b-sitemap.sql).
import { rpc, originOf } from './_rpc.js'

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])
const day = (t) => { const d = new Date(t); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) }

export function render(origin, data) {
  const urls = [[`${origin}/`, null, '1.0'], [`${origin}/privacy`, null, '0.3'], [`${origin}/terms`, null, '0.3']]
  for (const u of data?.u || []) if (/^[a-z0-9_.]{3,24}$/.test(u)) urls.push([`${origin}/u/${u}`, null, '0.6'])
  for (const [id, t] of data?.m || []) urls.push([`${origin}/market/${id}`, day(t), '0.5'])
  for (const [id, t] of data?.e || []) urls.push([`${origin}/events/${id}`, day(t), '0.5'])
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([loc, mod, pr]) => `  <url><loc>${esc(loc)}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ''}<priority>${pr}</priority></url>`).join('\n')}
</urlset>
`
}

export default async function handler(req, res) {
  const data = await rpc('sitemap_entries', {}, 5000)
  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.setHeader('Cache-Control', `public, s-maxage=${data ? 3600 : 300}, stale-while-revalidate=86400`)
  res.status(200).send(render(originOf(req), data))
}
