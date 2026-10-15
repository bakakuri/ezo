// ბმულები ტექსტში: პირველი ბმულის პოვნა (ბარათისთვის) და დომენი ჩვენებისთვის
export const URL_RE = /\bhttps?:\/\/[^\s<>"'«»“”]+[^\s<>"'«»“”.,;:!?)\]]/giu

export function firstUrl(text) {
  URL_RE.lastIndex = 0
  const m = URL_RE.exec(String(text || ''))
  return m ? m[0] : null
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

// ბმულის ტექსტი ეკრანზე: დომენი + მოკლე გზა
export function shortUrl(url, max = 40) {
  try {
    const u = new URL(url)
    // ქართული (და სხვა) ასოები გზაში — წასაკითხად; მიმართულების საფარავი სიმბოლოები — არა
    let path = u.pathname.replace(/\/$/, '')
    try { path = decodeURIComponent(path) } catch { /* დაზიანებული კოდირება — ვტოვებთ როგორც არის */ }
    path = path.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\s]/g, (c) => (c === ' ' ? ' ' : ''))
    const s = u.hostname.replace(/^www\./, '') + path + (u.search ? '?…' : '')
    return s.length > max ? `${s.slice(0, max - 1)}…` : s
  } catch { return url }
}
