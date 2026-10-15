// Edge Function „push“ — Web Push შეტყობინებების გაგზავნა.
// იძახებს ბაზა (pg_net) ახალი შეტყობინების, მესიჯის ან სვლის დროს.
// საჭირო საიდუმლოებები (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_SECRET
// JWT შემოწმება ამ ფუნქციისთვის გამორთეთ (ბაზა იძახებს x-push-secret სათაურით).
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

// სერვისის გასაღები: ახალი secret (sb_secret_…), თუ არა — ძველი service_role (მუშაობს 2026-ის ბოლომდე)
function serviceKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')
    const k = keys.default ?? Object.values(keys)[0]
    if (typeof k === 'string' && k) return k
  } catch { /* ძველი პროექტი */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
})

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@ezo.app',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.headers.get('x-push-secret') !== Deno.env.get('PUSH_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }
  const { user_id, payload } = await req.json()
  const { data: subs, error } = await admin.from('push_subscriptions').select('*').eq('user_id', user_id)
  if (error) return new Response(error.message, { status: 500 })

  const body = JSON.stringify(payload)
  const results = await Promise.allSettled((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 6 * 3600, urgency: 'high', topic: String(payload?.tag ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined },
      )
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      // გამოწერა აღარ არსებობს — ვშლით
      if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id)
      else throw e
    }
  }))
  const failed = results.filter((r) => r.status === 'rejected').length
  return new Response(JSON.stringify({ sent: results.length - failed, failed }), { headers: { 'Content-Type': 'application/json' } })
})
