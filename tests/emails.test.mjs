// ავთენტიფიკაციის წერილები: ფაილები წყაროს შეესაბამება, ყველას აქვს საჭირო ცვლადი, გარე სტილი/სკრიპტი არ აქვს
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { TEMPLATES, render } from '../scripts/emails/build.mjs'

const dir = 'supabase/email-templates'

test('ყველა შაბლონი აწყობილია და წყაროს შეესაბამება (node scripts/emails/build.mjs)', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.html')).sort()
  assert.deepEqual(files, TEMPLATES.map((t) => `${t.key}.html`).sort())
  for (const t of TEMPLATES) assert.equal(readFileSync(`${dir}/${t.key}.html`, 'utf8'), render(t), `${t.key}.html მოძველდა`)
  const subjects = JSON.parse(readFileSync(`${dir}/subjects.json`, 'utf8'))
  for (const t of TEMPLATES) assert.equal(subjects[t.key].subject, t.subject)
})

test('საჭირო ცვლადები: ბმული ან კოდი, სადაც უნდა იყოს', () => {
  const need = { confirmation: '{{ .ConfirmationURL }}', invite: '{{ .ConfirmationURL }}', magic_link: '{{ .Token }}', email_change: '{{ .NewEmail }}',
    recovery: '{{ .ConfirmationURL }}', reauthentication: '{{ .Token }}', email_changed_notification: '{{ .OldEmail }}' }
  for (const t of TEMPLATES) {
    const html = render(t)
    if (need[t.key]) assert.ok(html.includes(need[t.key]), `${t.key}: ${need[t.key]} აკლია`)
    // Go-ს შაბლონი: ფრჩხილები დაბალანსებულია, if-ს აქვს end
    assert.equal((html.match(/\{\{/g) || []).length, (html.match(/\}\}/g) || []).length, t.key)
    assert.equal((html.match(/\{\{ if /g) || []).length, (html.match(/\{\{ end \}\}/g) || []).length, t.key)
    // შეტყობინებებში .Data შეიძლება არ იყოს — მისალმება მხოლოდ ავთენტიფიკაციის წერილებში
    if (t.notification) assert.ok(!html.includes('.Data'), `${t.key}: .Data შეტყობინებაში`)
  }
})

test('წერილი თვითკმარია: გარე CSS/JS/ფონტი არ აქვს, თემა ქართულია, ზომა მცირეა', () => {
  for (const t of TEMPLATES) {
    const html = render(t)
    assert.ok(!/<link|<script|@import|url\(/i.test(html), t.key)
    assert.match(t.subject, /[ა-ჿ]/)
    assert.ok(t.subject.length <= 60, `${t.key}: თემა გრძელია`)
    assert.ok(Buffer.byteLength(html) < 20000, `${t.key}: ზომა`)
    assert.ok(html.includes('lang="ka"'))
  }
})
