import { DEMO } from './supabase.js'
import { api as real } from './api.supabase.js'
import { api as demo } from './api.demo.js'

export const api = DEMO ? demo : real
