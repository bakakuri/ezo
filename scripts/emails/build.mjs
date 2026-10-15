// ავთენტიფიკაციის წერილები ქართულად (Supabase → Authentication → Emails → Templates).
// წყარო აქაა; აწყობა: node scripts/emails/build.mjs → supabase/email-templates/*.html და subjects.json
// შიგნით Go-ს შაბლონის ცვლადებია ({{ .ConfirmationURL }} და სხვ.) — Supabase თავად ჩასვამს.
import { mkdirSync, writeFileSync } from 'node:fs'

const C = { bg: '#f6f4f9', card: '#ffffff', ink: '#1b1622', ink2: '#5c5466', ink3: '#8b839c', line: '#e6e1ec', accent: '#c3183f', soft: '#fbe8ed' }
const FONT = "'Noto Sans Georgian','BPG Arial','DejaVu Sans',Arial,sans-serif"
const HELLO = '{{ if .Data.full_name }}გამარჯობა, {{ .Data.full_name }}!{{ else }}გამარჯობა!{{ end }}'

// name — როგორც Supabase-ის პანელშია; env — ლოკალური Auth-ის ცვლადის სუფიქსი (ტესტებისთვის)
export const TEMPLATES = [
  {
    key: 'confirmation', name: 'Confirm sign up', env: 'CONFIRMATION', subject: 'დაადასტურე ელფოსტა ეზოში',
    title: HELLO,
    body: 'ერთი ნაბიჯი დაგრჩა: დაადასტურე, რომ <b>{{ .Email }}</b> შენი ელფოსტაა, და ანგარიში ჩაირთვება.',
    button: ['ელფოსტის დადასტურება', '{{ .ConfirmationURL }}'],
    note: 'თუ ეზოში არ დარეგისტრირებულხარ, წერილი უბრალოდ წაშალე — ანგარიში არ შეიქმნება.',
  },
  {
    key: 'invite', name: 'Invite user', env: 'INVITE', subject: 'გეპატიჟებიან ეზოში',
    title: 'გეპატიჟებიან ეზოში',
    body: 'ეზო ქართული სოციალური ქსელია: მეგობრები და კლასელები, პოსტები და ვიდეოები, ნარდი და ჯოკერი ონლაინ, ბაზარი. მოწვევის მისაღებად დააჭირე ღილაკს და შეარჩიე პაროლი.',
    button: ['მოწვევის მიღება', '{{ .ConfirmationURL }}'],
    note: 'თუ ამ მოწვევას არ ელოდი, წერილი უბრალოდ წაშალე.',
  },
  {
    key: 'magic_link', name: 'Magic link', env: 'MAGIC_LINK', subject: 'შესვლა ეზოში',
    title: HELLO,
    body: 'დააჭირე ღილაკს და პაროლის გარეშე შეხვალ ეზოში. ან შეიყვანე კოდი:',
    code: '{{ .Token }}',
    button: ['შესვლა ეზოში', '{{ .ConfirmationURL }}'],
    note: 'ბმული და კოდი ერთხელ მუშაობს და მალე გაუქმდება. თუ შესვლა არ გიცდია, წერილი უბრალოდ წაშალე — ანგარიშს არაფერი დაემართება.',
  },
  {
    key: 'email_change', name: 'Change email address', env: 'EMAIL_CHANGE', subject: 'დაადასტურე ახალი ელფოსტა',
    title: 'ახალი ელფოსტის დადასტურება',
    body: 'ეზოს ანგარიშის ელფოსტა იცვლება: <b>{{ .Email }}</b> → <b>{{ .NewEmail }}</b>. დასადასტურებლად დააჭირე ღილაკს.',
    button: ['ცვლილების დადასტურება', '{{ .ConfirmationURL }}'],
    note: 'თუ ეს შენ არ მოგითხოვია, ღილაკს ნუ დააჭერ და შეცვალე პაროლი.',
  },
  {
    key: 'recovery', name: 'Reset password', env: 'RECOVERY', subject: 'პაროლის აღდგენა ეზოში',
    title: 'პაროლის აღდგენა',
    body: 'ანგარიშისთვის <b>{{ .Email }}</b> მოთხოვნილია პაროლის აღდგენა. დააჭირე ღილაკს და შეარჩიე ახალი პაროლი.',
    button: ['ახალი პაროლის არჩევა', '{{ .ConfirmationURL }}'],
    note: 'თუ ეს შენ არ მოგითხოვია, წერილი უბრალოდ წაშალე: ძველი პაროლი ისევ მოქმედებს.',
  },
  {
    key: 'reauthentication', name: 'Reauthentication', env: 'REAUTHENTICATION', subject: 'დადასტურების კოდი ეზოსთვის',
    title: 'დადასტურების კოდი',
    body: 'ცვლილების დასადასტურებლად ეზოში შეიყვანე ეს კოდი:',
    code: '{{ .Token }}',
    note: 'კოდი მალე გაუქმდება. თუ ეს შენ არ მოგითხოვია, შეცვალე პაროლი.',
  },
  {
    key: 'password_changed_notification', name: 'Password changed', env: 'PASSWORD_CHANGED_NOTIFICATION', notification: 'PASSWORD_CHANGED',
    subject: 'ეზოს პაროლი შეიცვალა',
    title: 'პაროლი შეიცვალა',
    body: 'ანგარიშის <b>{{ .Email }}</b> პაროლი ახლახან შეიცვალა.',
    button: ['ეზოს გახსნა', '{{ .SiteURL }}'],
    note: 'თუ ეს შენ იყავი, არაფერი გჭირდება. თუ არა — ახლავე აღადგინე პაროლი შესვლის გვერდზე („დაგავიწყდა პაროლი?“) და ჩართე ორფაქტორიანი შესვლა.',
  },
  {
    key: 'email_changed_notification', name: 'Email address changed', env: 'EMAIL_CHANGED_NOTIFICATION', notification: 'EMAIL_CHANGED',
    subject: 'ეზოს ელფოსტა შეიცვალა',
    title: 'ელფოსტა შეიცვალა',
    body: 'ეზოს ანგარიშის ელფოსტა შეიცვალა: <b>{{ .OldEmail }}</b> → <b>{{ .Email }}</b>.',
    button: ['ეზოს გახსნა', '{{ .SiteURL }}'],
    note: 'თუ ეს შენ არ გაგიკეთებია, სასწრაფოდ აღადგინე პაროლი და მოგვწერე.',
  },
  {
    key: 'mfa_factor_enrolled_notification', name: 'Verification method added', env: 'MFA_FACTOR_ENROLLED_NOTIFICATION', notification: 'MFA_FACTOR_ENROLLED',
    subject: 'ორფაქტორიანი შესვლა ჩაირთო',
    title: 'ორფაქტორიანი შესვლა ჩაირთო',
    body: 'ანგარიშს <b>{{ .Email }}</b> დაემატა დადასტურების მეთოდი (ავთენტიფიკატორის აპი). ახლა შესვლისას პაროლთან ერთად კოდიც დაგჭირდება.',
    button: ['ეზოს გახსნა', '{{ .SiteURL }}'],
    note: 'თუ ეს შენ არ გაგიკეთებია, ახლავე შეცვალე პაროლი.',
  },
  {
    key: 'mfa_factor_unenrolled_notification', name: 'Verification method removed', env: 'MFA_FACTOR_UNENROLLED_NOTIFICATION', notification: 'MFA_FACTOR_UNENROLLED',
    subject: 'ორფაქტორიანი შესვლა გამოირთო',
    title: 'ორფაქტორიანი შესვლა გამოირთო',
    body: 'ანგარიშს <b>{{ .Email }}</b> მოეხსნა დადასტურების მეთოდი (ავთენტიფიკატორის აპი). შესვლისას ახლა მხოლოდ პაროლი მოითხოვება.',
    button: ['ეზოს გახსნა', '{{ .SiteURL }}'],
    note: 'თუ ეს შენ არ გაგიკეთებია, ახლავე შეცვალე პაროლი და ხელახლა ჩართე ორფაქტორიანი შესვლა.',
  },
]

const button = ([label, href]) => `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 8px">
  <tr><td class="btn" bgcolor="${C.accent}" style="border-radius:999px;background:${C.accent}">
    <a href="${href}" target="_blank" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:16px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:999px">${label}</a>
  </td></tr>
</table>`

const code = (token) => `
<div class="code" style="margin:20px 0 4px;padding:16px 12px;border-radius:14px;background:${C.soft};text-align:center;font-family:'DejaVu Sans Mono',Menlo,Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:${C.ink}">${token}</div>`

const fallback = (href) => `
<p class="muted" style="margin:16px 0 0;font-size:13px;line-height:1.6;color:${C.ink3}">ღილაკი არ იხსნება? დააკოპირე ბმული ბრაუზერში:<br>
<a class="link" href="${href}" style="color:${C.accent};word-break:break-all">${href}</a></p>`

export function render(t) {
  const link = t.button?.[1]
  return `<!doctype html>
<html lang="ka">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${t.subject}</title>
<style>
  @media (prefers-color-scheme: dark) {
    body, .page { background: #0a0810 !important; }
    .brand, .link { color: #e2335a !important; }
    .card { background: #16121d !important; border-color: #2a2433 !important; }
    .ink { color: #f3eff7 !important; }
    .muted { color: #a79fb2 !important; }
    .code { background: #2c121b !important; color: #f3eff7 !important; }
    .rule { border-color: #2a2433 !important; }
  }
  @media (max-width: 480px) { .card { padding: 28px 20px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg}">
<table role="presentation" class="page" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${C.bg}">
<tr><td align="center" style="padding:32px 12px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px">
  <tr><td class="card" style="background:${C.card};border:1px solid ${C.line};border-radius:20px;padding:36px 32px;font-family:${FONT}">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
      <td style="padding-right:10px;vertical-align:middle"><img src="{{ .SiteURL }}/icon-192.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:12px"></td>
      <td class="brand" style="vertical-align:middle;font-family:${FONT};font-size:24px;font-weight:800;color:${C.accent}">ეზო</td>
    </tr></table>
    <h1 class="ink" style="margin:28px 0 12px;font-family:${FONT};font-size:22px;font-weight:800;line-height:1.35;color:${C.ink}">${t.title}</h1>
    <p class="muted" style="margin:0;font-family:${FONT};font-size:16px;line-height:1.65;color:${C.ink2}">${t.body}</p>${t.code ? code(t.code) : ''}${t.button ? button(t.button) : ''}${link && link !== '{{ .SiteURL }}' ? fallback(link) : ''}
    <hr class="rule" style="margin:28px 0 20px;border:0;border-top:1px solid ${C.line}">
    <p class="muted" style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.ink3}">${t.note}</p>
  </td></tr>
  <tr><td align="center" style="padding:20px 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.ink3}">
    <a href="{{ .SiteURL }}" style="color:${C.ink3};text-decoration:none">ეზო — ქართული სოციალური ქსელი</a><br>წერილი ავტომატურია — პასუხი არ მიიღება.
  </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>
`
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const dir = 'supabase/email-templates'
  mkdirSync(dir, { recursive: true })
  for (const t of TEMPLATES) writeFileSync(`${dir}/${t.key}.html`, render(t))
  writeFileSync(`${dir}/subjects.json`, JSON.stringify(Object.fromEntries(TEMPLATES.map((t) => [t.key, { name: t.name, subject: t.subject }])), null, 2) + '\n')
  console.log(`${TEMPLATES.length} წერილი → ${dir}`)
}
