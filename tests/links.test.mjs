import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firstUrl, hostOf, shortUrl } from '../src/lib/links.js'

test('ბმული ტექსტიდან: პუნქტუაცია და ფრჩხილები არ ერთვის', () => {
  assert.equal(firstUrl('ნახე https://example.com/a?b=1. კარგია'), 'https://example.com/a?b=1')
  assert.equal(firstUrl('(https://ezo.ge/p/1)'), 'https://ezo.ge/p/1')
  assert.equal(firstUrl('„https://news.ge/სტატია“'), 'https://news.ge/სტატია')
  assert.equal(firstUrl('ბმული არ არის'), null)
  assert.equal(firstUrl('javascript:alert(1) ftp://x.ge'), null)
  assert.equal(firstUrl('ორი: http://a.ge და https://b.ge'), 'http://a.ge')
})

test('დომენი და მოკლე ბმული', () => {
  assert.equal(hostOf('https://www.ezo.ge/p/1'), 'ezo.ge')
  assert.equal(hostOf('nope'), '')
  assert.equal(shortUrl('https://www.ezo.ge/p/1?x=2'), 'ezo.ge/p/1?…')
  assert.equal(shortUrl('https://ka.wikipedia.org/wiki/%E1%83%9C%E1%83%90%E1%83%A0%E1%83%93%E1%83%98'), 'ka.wikipedia.org/wiki/ნარდი')
  assert.equal(shortUrl('https://a.ge/%E2%80%AEfdp.exe'), 'a.ge/fdp.exe')
  assert.equal(shortUrl('https://a.ge/%E0%A4%A'), 'a.ge/%E0%A4%A')
  assert.ok(shortUrl('https://example.com/' + 'a'.repeat(80)).length <= 40)
})
