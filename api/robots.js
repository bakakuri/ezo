// Vercel Function: /robots.txt — საიტის მისამართით (ნებისმიერ დომენზე სწორი Sitemap ბმული).
// წინასწარი ნახვის (preview) ვერსიები საძიებო სისტემებში არ უნდა მოხვდეს.
import { originOf } from './_rpc.js'

// შესვლის შემდეგ ხელმისაწვდომი პირადი გვერდები — საძიებოს არაფერში სჭირდება
const PRIVATE = ['/api/', '/settings', '/admin', '/inbox', '/chat/', '/notifications', '/saved', '/requests', '/close-friends', '/guests', '/rewards', '/dating', '/g/', '/play/']

export function render(origin, production) {
  if (!production) return 'User-agent: *\nDisallow: /\n'
  return `User-agent: *\nAllow: /\n${PRIVATE.map((p) => `Disallow: ${p}`).join('\n')}\n\nSitemap: ${origin}/sitemap.xml\n`
}

export default function handler(req, res) {
  const production = !process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'production'
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=86400')
  res.status(200).send(render(originOf(req), production))
}
