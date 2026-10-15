import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// დემო რეჟიმი: თუ Supabase-ის გასაღებები არ არის, ან VITE_DEMO=1
export const DEMO = import.meta.env.VITE_DEMO === '1' || !url || !key

export const supabase = DEMO
  ? null
  : createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
