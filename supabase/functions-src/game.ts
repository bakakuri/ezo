// Edge Function „game“ — ონლაინ თამაშების სერვერი.
// აწყობა: npm run build:functions → supabase/functions/game/index.ts (ერთი ფაილი, ძრავებით)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handle, HttpError } from './game-core.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

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

const must = ({ data, error }: { data: any; error: any }) => {
  if (error) throw new HttpError(error.code === 'P0001' ? 409 : 500, error.message)
  return data
}

const db = {
  async canAct(userId: string) {
    const p = must(await admin.from('profiles').select('banned_until').eq('id', userId).maybeSingle())
    return !p?.banned_until || new Date(p.banned_until) < new Date()
  },
  async getGame(id: string) {
    return must(await admin.from('games').select('*').eq('id', id).maybeSingle())
  },
  async getPrivate(id: string) {
    const row = must(await admin.from('game_private').select('state').eq('game_id', id).maybeSingle())
    return row?.state ?? null
  },
  async insertGame(row: Record<string, unknown>) {
    return must(await admin.from('games').insert(row).select('id').single()).id
  },
  async updateGame(id: string, patch: Record<string, unknown>, expectMoveNo: number, expectStatus = 'active') {
    const rows = must(await admin.from('games').update(patch).eq('id', id).eq('move_no', expectMoveNo).eq('status', expectStatus).select('id'))
    return rows.length === 1
  },
  async setPrivate(id: string, state: unknown) {
    must(await admin.from('game_private').upsert({ game_id: id, state }))
  },
  async setHands(id: string, rows: { seat: string; user_id: string | null; tiles: unknown }[]) {
    must(await admin.from('game_hands').upsert(rows.map((r) => ({ game_id: id, ...r }))))
  },
  async claim(userId: string, type: string, tc: string | null, tournament: string | null) {
    return must(await admin.rpc('svc_claim_game', { p_user: userId, p_type: type, p_tc: tc, p_tournament: tournament }))
  },
  async myWaiting(userId: string, type: string, tc: string | null, tournament: string | null) {
    let q = admin.from('games').select('id').eq('type', type).eq('status', 'waiting').eq('is_public', true).eq('player_a', userId)
    q = tc ? q.eq('tc', tc) : q.is('tc', null)
    q = tournament ? q.eq('tournament_id', tournament) : q.is('tournament_id', null)
    const row = must(await q.limit(1).maybeSingle())
    return row?.id ?? null
  },
  async takeSeat(userId: string, id: string) {
    return must(await admin.rpc('svc_take_seat', { p_user: userId, p_id: id }))
  },
  async takeAnySeat(userId: string, type: string) {
    return must(await admin.rpc('svc_take_any_seat', { p_user: userId, p_type: type }))
  },
  async leaveSeat(userId: string, id: string) {
    must(await admin.rpc('svc_leave_seat', { p_user: userId, p_id: id }))
  },
  async finishTable(id: string, winner: string | null, result: string, scores: Record<string, number>) {
    must(await admin.rpc('svc_finish_table', { p_id: id, p_winner: winner, p_result: result, p_scores: scores }))
  },
  async getTournament(id: string) {
    return must(await admin.from('tournaments').select('id, type, tc, starts_at, ends_at').eq('id', id).maybeSingle())
  },
  async isTournamentPlayer(tournamentId: string, userId: string) {
    const row = must(await admin.from('tournament_players').select('user_id').eq('tournament_id', tournamentId).eq('user_id', userId).maybeSingle())
    return Boolean(row)
  },
  async myActiveInTournament(userId: string, tournamentId: string) {
    const row = must(await admin.from('games').select('id').eq('tournament_id', tournamentId).eq('status', 'active')
      .or(`player_a.eq.${userId},player_b.eq.${userId}`).limit(1).maybeSingle())
    return row?.id ?? null
  },
  async join(userId: string, id: string) {
    must(await admin.rpc('svc_join_game', { p_user: userId, p_id: id }))
  },
  async finish(id: string, winner: string | null, result: string) {
    must(await admin.rpc('svc_finish', { p_id: id, p_winner: winner, p_result: result }))
  },
  async notify(row: Record<string, unknown>) {
    must(await admin.from('notifications').insert(row))
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data, error } = await admin.auth.getUser(jwt)
    if (error || !data?.user) throw new HttpError(401, 'შესვლა საჭიროა')
    const body = await req.json()
    return json(await handle(body, { userId: data.user.id, db }))
  } catch (e) {
    const status = (e as HttpError).status ?? 500
    if (status === 500) console.error(e)
    return json({ error: (e as Error).message }, status)
  }
})
