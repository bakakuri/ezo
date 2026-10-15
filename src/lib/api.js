// API: ნამდვილი (Supabase) ან დემო. რომელი — აწყობისას წყდება (vite.config.js → ezo-api-impl),
// ასე ნამდვილ საიტზე დემოს კოდი, მონაცემები და თამაშის ბოტები საერთოდ არ ჩამოიტვირთება.
import { api as impl } from 'ezo-api-impl'
import { setErrorSender } from './errors.js'

export const api = impl

setErrorSender((e) => api.logError(e))
