// Supabase-ის RPC Vercel-ის ფუნქციებიდან (anon/publishable გასაღებით — მხოლოდ საჯარო მონაცემები).
// „_“-ით დაწყებული ფაილი Vercel-ზე ცალკე მისამართად არ ჩანს.
export async function rpc(name, body = {}, timeout = 3500) {
  const base = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!base || !anon) return null
  try {
    const r = await fetch(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      // ახალი publishable გასაღები (sb_publishable_…) JWT არაა — მხოლოდ apikey-ში იგზავნება
      headers: { apikey: anon, ...(anon.startsWith('eyJ') ? { Authorization: `Bearer ${anon}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

export const originOf = (req) => `https://${req.headers['x-forwarded-host'] || req.headers.host}`
