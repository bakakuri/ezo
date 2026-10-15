// საიტის მისამართი სოციალური ბარათებისთვის და საძიებოსთვის: VITE_SITE_URL ან Vercel-ის მთავარი დომენი
export const SITE = (process.env.VITE_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/+$/, '')

// Google Search Console-ის დადასტურება (არასავალდებულო): VITE_GOOGLE_SITE_VERIFICATION = meta-ტეგის content
const GSV = (process.env.VITE_GOOGLE_SITE_VERIFICATION || '').replace(/[^\w-]/g, '')

export function siteHtml(html, site = SITE, verify = GSV) {
  const ld = site && JSON.stringify({
    '@context': 'https://schema.org', '@type': 'WebSite', name: 'ეზო', alternateName: 'Ezo', url: `${site}/`, inLanguage: 'ka',
    description: 'ქართული სოციალური ქსელი: მეგობრები და კლასელები, ნარდი და ჯოკერი ონლაინ, ბაზარი, ჯგუფები და გაცნობა.',
  })
  return html
    .replaceAll('__EZO_SITE__', site)
    .replace('<!--ezo:site-->', [
      site && `<meta property="og:url" content="${site}/" />`,
      site && `<script type="application/ld+json">${ld}</script>`,
      verify && `<meta name="google-site-verification" content="${verify}" />`,
    ].filter(Boolean).join('\n    '))
}
