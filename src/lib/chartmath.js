// დიაგრამების დამხმარეები (ტესტებით: tests/chartmath.test.mjs)
const MONTHS = ['იან', 'თებ', 'მარ', 'აპრ', 'მაი', 'ივნ', 'ივლ', 'აგვ', 'სექ', 'ოქტ', 'ნოე', 'დეკ']
export const dayLabel = (iso) => {
  const [, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1] || ''}`
}
export const compact = (n) => {
  const v = Number(n) || 0
  if (v >= 10000) return `${Math.round(v / 1000)}K`
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return String(v)
}
// ღერძის ზედა ზღვარი: მრგვალი რიცხვი, რომ შუა ხაზიც მთელი იყოს
export function niceMax(v) {
  if (!(v > 0)) return 2
  if (v <= 2) return 2
  const p = 10 ** Math.floor(Math.log10(v))
  for (const k of [1, 2, 4, 5, 10]) if (k * p >= v && Number.isInteger((k * p) / 2)) return k * p
  return 10 * p
}
