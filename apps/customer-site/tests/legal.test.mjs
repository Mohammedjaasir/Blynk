// The legal pages: the owner's Terms, Privacy and Refund policy text (2026-10-15).
// Run from the repo root:  node --test apps/customer-site/tests/
//
// terms.html, privacy.html and refunds.html are built by
// scripts/build-legal-pages.mjs from legal/*.md and legal/legal-config.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build, readConfig, LEGAL_PAGES } from '../scripts/build-legal-pages.mjs';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAMES = ['terms', 'privacy', 'refunds'];
const read = (f) => readFileSync(join(site, f), 'utf8');
const pages = Object.fromEntries(NAMES.map((n) => [n, read(`${n}.html`)]));

/** What a visitor can read: no comments, scripts, styles or tags; entities decoded. */
const visible = (html) => html
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ');

// "[" + letters + "]": an owner placeholder such as [number] or [registered address].
const PLACEHOLDER = /\[\s*[A-Za-z][^\]]*\]/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('the legal pages are up to date with scripts/build-legal-pages.mjs', () => {
  const r = spawnSync(process.execPath, [join(site, 'scripts', 'build-legal-pages.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('no [placeholder] text on any page, and no {{detail}} left unfilled', () => {
  const files = [...NAMES.map((n) => `${n}.html`), 'index.html',
    ...walk(join(site, 'pages')).filter((f) => f.endsWith('.html')).map((f) => f.slice(site.length + 1))];
  for (const f of files) {
    const html = read(f);
    const text = visible(html);
    const hit = text.match(PLACEHOLDER);
    assert.ok(!hit, `${f} shows a placeholder: ${hit && hit[0]}`);
    assert.ok(!text.includes('{{') && !text.includes('}}'), `${f} shows an unfilled {{detail}}`);
  }
  // The legal pages are checked whole (attributes too), and so are their sources.
  for (const n of NAMES) {
    const m = pages[n].match(PLACEHOLDER);
    assert.ok(!m, `${n}.html contains ${m && m[0]}`);
    const md = read(`legal/${n}.md`);
    const mm = md.match(PLACEHOLDER);
    assert.ok(!mm, `legal/${n}.md contains ${mm && mm[0]}`);
  }
  assert.doesNotMatch(pages.terms, /placeholder|template prepared/i);
});

test('the phone number is never shown as text on the legal pages, only in the Call us / WhatsApp us links', () => {
  for (const n of NAMES) {
    const text = visible(pages[n]);
    assert.ok(!text.replace(/[\s\-()+.]/g, '').includes('717107374'), `${n}: the number is visible`);
    assert.ok(!text.includes('71 710 7374'), `${n}: the number is visible`);
    assert.match(pages[n], /<a href="tel:\+94717107374">Call us<\/a>/, `${n}: Call us link`);
    assert.match(pages[n], /<a href="https:\/\/wa\.me\/94717107374" target="_blank" rel="noopener">WhatsApp us<\/a>/, `${n}: WhatsApp us link`);
    assert.match(text, /Hours: 8:00 am – 9:00 pm, daily/, `${n}: hours`);
  }
  // The same number as the home page's support links.
  const home = read('index.html');
  assert.equal(home.match(/href="tel:(\+\d+)"/)[1], readConfig().phone);
  assert.match(home, /href="https:\/\/wa\.me\/94717107374"/);
});

test('the owner\'s choices are filled in', () => {
  const t = visible(pages.terms);
  for (const s of [
    'operated by Blynk Quick Commerce , Sri Lanka.',
    'after 2 calls and 10 minutes of waiting',
    'We accept cash on delivery and online card/wallet payment through PayHere .',
    'processed by PayHere .',
    'Delivery fees do not earn points.',
    'Each point is worth LKR 1',
    'Points expire 12 months after they are earned.',
    'at least 30 days\' notice',
    'cannot be withdrawn as cash or transferred to another account.',
    'Wallet balance does not expire .',
    'courts of Kalutara , Sri Lanka',
    'through the Platform. We may refuse',
    'We currently deliver to Aluthgama, Dharga Town and areas within about 4 km of them.',
  ]) assert.ok(t.includes(s), `terms: "${s}"`);
  const p = visible(pages.privacy);
  for (const s of ['up to 12 months after you close it', 'up to 6 years for tax', 'up to 6 months', 'respond within 21 working days',
    'Send requests to us by phone or WhatsApp .']) {
    assert.ok(p.includes(s), `privacy: "${s}"`);
  }
  const r = visible(pages.refunds);
  for (const s of ['credited within 24 hours', 'contact us by phone or WhatsApp , or through the app']) assert.ok(r.includes(s), `refunds: "${s}"`);
});

test('details the owner has not given are left out cleanly', () => {
  const c = readConfig();
  for (const k of ['businessRegistrationNo', 'registeredAddress', 'supportEmail', 'privacyEmail', 'dataProtectionContact']) {
    if (c[k]) continue;
    const label = { businessRegistrationNo: /registration no/i, registeredAddress: /Address:/, supportEmail: /Email:/,
      privacyEmail: /Email:/, dataProtectionContact: /Data protection contact/ }[k];
    if (k === 'supportEmail' && c.privacyEmail) continue;
    if (k === 'privacyEmail' && c.supportEmail) continue;
    for (const n of NAMES) assert.doesNotMatch(visible(pages[n]), label, `${n} shows ${k} without a value`);
  }
  for (const n of NAMES) assert.doesNotMatch(pages[n], /mailto:/, `${n}: no email given yet`);
});

test('once the owner fills in the details they appear on the pages', () => {
  const filled = {
    ...readConfig(),
    businessRegistrationNo: 'PV 00123456',
    registeredAddress: '12 Main Street, Dharga Town',
    supportEmail: 'help@example.lk',
    privacyEmail: 'privacy@example.lk',
    dataProtectionContact: 'A. Perera, Data Protection Officer',
  };
  const out = build(filled);
  const terms = visible(out.get('terms.html'));
  assert.ok(terms.includes('operated by Blynk Quick Commerce , business registration no. PV 00123456 , of 12 Main Street, Dharga Town , Sri Lanka.'), terms);
  assert.match(terms, /Email: help@example\.lk/);
  assert.match(terms, /Address: 12 Main Street, Dharga Town/);
  const privacy = out.get('privacy.html');
  assert.match(visible(privacy), /Send requests to privacy@example\.lk \./);
  assert.match(visible(privacy), /Data protection contact: A\. Perera, Data Protection Officer/);
  assert.match(privacy, /href="mailto:privacy@example\.lk"/);
  assert.match(visible(out.get('refunds.html')), /Email: help@example\.lk/);
  assert.throws(() => build({ ...filled, supportEmail: '[support email]' }), /placeholder/);
});

test('each page: owner title, Last updated date, a contents list that matches its sections, no tracking', () => {
  const c = readConfig();
  assert.equal(c.lastUpdated, '2026-10-15');
  const titles = { terms: 'Terms and Conditions', privacy: 'Privacy Policy', refunds: 'Return, Refund and Cancellation Policy' };
  for (const n of NAMES) {
    const html = pages[n];
    assert.match(html, new RegExp(`<h1>${titles[n].replace(/[,]/g, '\\$&')}</h1>`), n);
    assert.match(html, /<p class="legal-meta">Last updated: <time datetime="2026-10-15">15 October 2026<\/time><\/p>/, n);
    const toc = [...html.match(/<nav class="legal-toc"[\s\S]*?<\/nav>/)[0].matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    const sections = [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(toc.length >= 7, `${n}: ${toc.length} contents entries`);
    assert.deepEqual(toc, sections, `${n}: contents list and sections differ`);
    assert.equal(new Set(sections).size, sections.length, `${n}: duplicate ids`);
    assert.doesNotMatch(html, /<script/i, `${n} has a script`);
  }
  // The owner's tables.
  assert.equal((pages.privacy.match(/<table class="legal-table"/g) || []).length, 1);
  assert.equal((pages.refunds.match(/<table class="legal-table"/g) || []).length, 1);
  assert.match(pages.refunds, /data-label="Report within">24 hours of delivery</);
  // The table styles exist in the stylesheet the pages load.
  const css = read('styles.css');
  assert.match(css, /\.legal-table\s*\{/);
  assert.match(css, /\.legal-table td::before \{ content: attr\(data-label\)/);
  assert.equal(LEGAL_PAGES.map((p) => p.name).join(), NAMES.join());
});

test('the Dockerfile ships the legal pages and the customer app still links to /terms, /privacy and /refunds', () => {
  const docker = read('Dockerfile');
  assert.match(docker, /apps\/customer-site\/privacy\.html apps\/customer-site\/terms\.html apps\/customer-site\/refunds\.html \/usr\/share\/nginx\/html\//);
  const policies = readFileSync(join(site, '..', 'customer-app', 'src', 'blynk', 'legal', 'policies.ts'), 'utf8');
  for (const n of NAMES) assert.match(policies, new RegExp(`path: '/${n}'`));
  assert.match(policies, /SITE = 'https:\/\/blynk\.lk'/);
});
