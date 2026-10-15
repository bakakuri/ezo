// ბმულის ბარათი: მეტა-ტეგების წაკითხვა და შიდა მისამართების დაბლოკვა
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPrivateIp, checkUrl, parseMeta, unfurl } from '../api/unfurl.js'

const publicDns = async () => [{ address: '93.184.216.34' }]
const html = (s) => new Response(s, { headers: { 'content-type': 'text/html; charset=utf-8' } })

test('შიდა მისამართები იბლოკება', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.ok(isPrivateIp(ip), ip)
  }
  assert.ok(!isPrivateIp('93.184.216.34'))
  for (const u of ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'ftp://example.com/', 'http://example.com:8080/', 'javascript:alert(1)', 'http://user:pw@example.com/', 'nope']) {
    await assert.rejects(checkUrl(u, publicDns), u)
  }
  // DNS-ით შიდაზე მიმავალი სახელი
  await assert.rejects(checkUrl('https://evil.example/', async () => [{ address: '10.0.0.5' }]))
  assert.equal((await checkUrl('https://example.com/a?b=1', publicDns)).hostname, 'example.com')
})

test('მეტა-ტეგები: og, twitter, title; ფარდობითი სურათი; მხოლოდ https სურათი', () => {
  const m = parseMeta(`<html><head><title>სათაური &amp; სხვა</title>
    <meta content="OG სათაური" property="og:title"><meta name='description' content='აღწერა &quot;ბრჭყალებით&quot;'>
    <meta property="og:image" content="/img/a.png"><meta property="og:site_name" content="მაგალითი"></head></html>`, 'https://example.com/p/1')
  assert.deepEqual(m, { title: 'OG სათაური', description: 'აღწერა "ბრჭყალებით"', image: 'https://example.com/img/a.png', site: 'მაგალითი' })
  const n = parseMeta('<title>მხოლოდ სათაური</title><meta property="og:image" content="http://insecure/x.png">', 'https://www.site.ge/')
  assert.deepEqual(n, { title: 'მხოლოდ სათაური', description: '', image: null, site: 'site.ge' })
  assert.ok(parseMeta(`<title>${'ა'.repeat(300)}</title>`, 'https://a.ge/').title.length <= 140)
})

test('unfurl: გადამისამართება შიდაზე იბლოკება, HTML-ის გარდა არაფერი', async () => {
  const redirectToPrivate = async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } })
  await assert.rejects(unfurl('https://example.com/', { fetchImpl: redirectToPrivate, lookup: publicDns }), /შიდა/)
  const pdf = async () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } })
  await assert.rejects(unfurl('https://example.com/f.pdf', { fetchImpl: pdf, lookup: publicDns }))
  let calls = 0
  const ok = async (url) => { calls++; return calls === 1 ? new Response(null, { status: 301, headers: { location: '/new' } }) : html('<title>ახალი</title>') }
  const r = await unfurl('https://example.com/old', { fetchImpl: ok, lookup: publicDns })
  assert.equal(r.url, 'https://example.com/new')
  assert.equal(r.title, 'ახალი')
})
