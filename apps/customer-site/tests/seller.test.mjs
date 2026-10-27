// "Sell with Blynk" - the seller application form at blynk.lk/seller (owner's brother, 2026-10-27).
// Run from the repo root:  node --test "apps/customer-site/tests/*.test.mjs"
//
// seller.html is built by scripts/build-legal-pages.mjs (words in scripts/seller-page.mjs); seller.js posts
// the form as JSON to the API's public POST /seller-applications.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(site, f), 'utf8');
const html = read('seller.html');
const js = read('seller.js');
const API = 'https://api.test/api/v1';

/** What a visitor can read: no comments, scripts, styles or tags; entities decoded. */
const visible = (h) => h
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ');

// ------------------------------------------------------------------ the page

test('the page: head, headline, how it works and the apply form', () => {
  assert.match(html, /<title>Sell with Blynk — apply to become a seller<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/blynk\.lk\/seller">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/blynk\.lk\/seller">/);
  assert.match(html, /<link rel="stylesheet" href="\/styles\.css\?v=\w+">/);
  assert.match(html, /<link rel="stylesheet" href="\/seller\.css\?v=\w+">/);
  assert.match(html, /<h1>Sell with Blynk<\/h1>/);
  const text = visible(html);
  assert.match(text, /We deliver for you\./);
  assert.match(text, /You set your prices, and we pay you\./);
  assert.equal((html.match(/<ol class="seller-how"[\s\S]*?<\/ol>/)[0].match(/<li>/g) || []).length, 2, 'two lines on how it works');
  assert.match(html, /We will call you on this number about your application\. See our <a href="\/privacy">Privacy Policy<\/a>\./);
});

test('the form has the API fields, the right requirements and limits, and a hidden honeypot named website', () => {
  const form = html.match(/<form class="seller-form" data-seller-form[\s\S]*?<\/form>/)[0];
  const control = (name) => form.match(new RegExp(`<(input|textarea) [^>]*name="${name}"[^>]*>`))?.[0];
  for (const name of ['shop_name', 'owner_name', 'phone', 'town', 'what_they_sell']) {
    assert.ok(control(name), name);
    assert.match(control(name), /\brequired\b/, `${name} is required`);
    assert.match(form, new RegExp(`data-error-for="${name}"`), `${name} has an error line`);
  }
  for (const name of ['email', 'message']) {
    assert.ok(control(name), name);
    assert.doesNotMatch(control(name), /\brequired\b/, `${name} is optional`);
    assert.match(form, new RegExp(`for="seller-${name}">[^<]*<span class="seller-optional">\\(optional\\)</span>`), `${name} says optional`);
  }
  assert.match(control('phone'), /type="tel"/);
  assert.match(control('email'), /type="email"/);
  // every visible field has a label
  for (const id of [...form.matchAll(/<(?:input|textarea) id="([^"]+)"/g)].map((m) => m[1])) {
    assert.match(form, new RegExp(`<label for="${id}">`), `${id} has a label`);
  }
  // the limits the API enforces (seller-applications.ts SELLER_APPLICATION_LIMITS)
  const backend = readFileSync(join(site, '..', '..', 'backend', 'api', 'src', 'modules', 'sellers', 'seller-applications.ts'), 'utf8');
  const limit = (key) => Number(backend.match(new RegExp(`${key}: (\\d+),`))[1]);
  const maxlength = (name) => Number(control(name).match(/maxlength="(\d+)"/)[1]);
  assert.equal(maxlength('shop_name'), limit('shopName'));
  assert.equal(maxlength('owner_name'), limit('ownerName'));
  assert.equal(maxlength('town'), limit('town'));
  assert.equal(maxlength('what_they_sell'), limit('whatTheySell'));
  assert.equal(maxlength('email'), limit('email'));
  assert.equal(maxlength('message'), limit('message'));
  // the honeypot: named website, out of the tab order, not auto-filled, hidden from people and screen readers
  assert.match(control('website'), /type="text"/);
  assert.match(control('website'), /tabindex="-1"/);
  assert.match(control('website'), /autocomplete="off"/);
  assert.match(form, /<div class="seller-trap" aria-hidden="true">/);
  assert.match(read('seller.css'), /\.seller-trap \{[^}]*left: -10000px/);
  // without JavaScript the form never submits (it would put the details in the address bar)
  assert.match(form, /onsubmit="return false"/);
});

test('success, error and fallback states are in the page; the phone and WhatsApp links come from the generator', () => {
  assert.match(html, /<div class="seller-success" data-seller-success[^>]*hidden>[\s\S]*?Thanks! We received your application and will call you soon\./);
  assert.match(html, /<p class="seller-status" data-seller-status role="alert" hidden><\/p>/);
  const fallback = html.match(/<p class="seller-fallback" data-seller-fallback hidden>[\s\S]*?<\/p>/)[0];
  assert.match(fallback, /Please <a href="tel:\+94717107374">phone<\/a> or <a href="https:\/\/wa\.me\/94717107374" target="_blank" rel="noopener">WhatsApp<\/a> us to apply\./);
  const noscript = html.match(/<noscript>[\s\S]*?<\/noscript>/)[0];
  assert.match(noscript, /This form needs JavaScript/);
  assert.match(noscript, /href="tel:\+94717107374"/);
  assert.match(noscript, /href="https:\/\/wa\.me\/94717107374"/);
});

test('owner rules: no tracking, only seller.js, no number as text, no opening hours, no pictures but the logo', () => {
  assert.ok(!html.includes('googletagmanager') && !html.includes('GTM-HEAD-START'), 'no tracking on a page that takes personal details');
  assert.deepEqual([...html.matchAll(/<script[^>]*>/gi)].map((m) => m[0].replace(/\?v=\d+[a-z]?/, '')), ['<script src="/seller.js" defer>']);
  const text = visible(html);
  assert.ok(!text.replace(/[\s\-()+.]/g, '').includes('717107374'), 'the number is visible');
  assert.doesNotMatch(text, /8 AM|9 PM|am to|pm\b|opening hours|open daily|every day/i, 'typed-in hours');
  assert.doesNotMatch(html, /data-hours=/, 'no hours markers: nothing to fill in');
  assert.deepEqual([...html.matchAll(/<img [^>]*src="([^"]+)"/g)].map((m) => m[1]), ['/assets/logo-mark.png', '/assets/logo-mark.png']);
  assert.doesNotMatch(html, /mosque|skyline/i);
  assert.doesNotMatch(text, /free\s+deliver/i);
});

test('links to the page: landing footer, legal footers, the page itself, the sitemap and the privacy policy', () => {
  assert.match(read('index.html'), /<nav aria-label="Footer">[\s\S]*?<a href="\/seller">Become a seller<\/a>[\s\S]*?<\/nav>/);
  for (const n of ['privacy', 'terms', 'refunds', 'delete-account']) {
    assert.match(read(`${n}.html`), /<a href="\/seller">Become a seller<\/a>/, n);
  }
  assert.match(html, /<a href="\/seller" aria-current="page">Become a seller<\/a>/);
  assert.match(read('pages/sitemap.xml'), /<loc>https:\/\/blynk\.lk\/seller<\/loc>\s*<lastmod>2026-10-27<\/lastmod>/);
  const privacy = read('privacy.html');
  assert.ok(visible(privacy).includes('Seller applications Shop name, your name, phone number, town, what you sell'), 'what is stored');
  assert.ok(privacy.includes('Seller applications — we use what you send at blynk.lk/seller only to call you about selling with Blynk, keep it for up to <strong>12 months</strong>, and delete it when you ask us to'), 'why, how long, how to delete');
  assert.equal(JSON.parse(read('legal/legal-config.json')).lastUpdated, '2026-10-27');
});

test('nginx serves /seller and /seller/ like /privacy; the Dockerfile ships the files and fills in the API address', () => {
  const nginx = read('nginx.conf');
  const m = nginx.match(/location ~ "(\^\/\(privacy[^"]+)" \{[\s\S]*?try_files \/\$1\.html =404;/);
  assert.ok(m, 'legal location');
  const re = new RegExp(m[1]);
  for (const p of ['/seller', '/seller/', '/privacy', '/terms/']) assert.match(p, re, p);
  assert.equal('/seller'.match(re)[1], 'seller');
  assert.match(m[0], /Cache-Control "no-cache"/);
  // the legal location comes before the catch-all clean-URL one
  assert.ok(nginx.indexOf(m[0]) < nginx.indexOf('location ~ "^/(?!app/?$)'));
  const docker = read('Dockerfile');
  assert.match(docker, /^COPY apps\/customer-site\/seller\.html apps\/customer-site\/seller\.css apps\/customer-site\/seller\.js \/usr\/share\/nginx\/html\/$/m);
  assert.match(docker, /s#__BLYNK_API__#\$\{API_BASE_URL%\/\}#g" [^\n]*\/usr\/share\/nginx\/html\/seller\.js/);
  assert.match(docker, /! grep -q "__BLYNK_API__" [^\n]*\/usr\/share\/nginx\/html\/seller\.js/);
  assert.equal(js.split('__BLYNK_API__').length - 1, 1, 'the placeholder appears once, in the code');
});

// ------------------------------------------------------------------ seller.js

/** A tiny page: just what seller.js touches. */
function makePage(values = {}) {
  const el = (props = {}) => ({
    hidden: false, textContent: '', value: '', disabled: false, attrs: {}, focused: false,
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, focus() { this.focused = true; }, ...props,
  });
  const names = ['shop_name', 'owner_name', 'phone', 'town', 'what_they_sell', 'email', 'message', 'website'];
  const elements = Object.fromEntries(names.map((n) => [n, el({ value: values[n] ?? '' })]));
  const errors = names.slice(0, 7).map((n) => el({ attrs: { 'data-error-for': n }, hidden: true }));
  const button = el({ textContent: 'Send application' });
  const status = el({ hidden: true });
  const success = el({ hidden: true });
  const fallback = el({ hidden: true });
  const listeners = {};
  const form = el({
    elements,
    addEventListener(type, fn) { listeners[type] = fn; },
    querySelectorAll: (sel) => (sel === '[data-error-for]' ? errors : []),
    querySelector: (sel) => (sel === 'button[type="submit"]' ? button : null),
  });
  const document = {
    querySelector: (sel) => ({ '[data-seller-form]': form, '[data-seller-status]': status, '[data-seller-success]': success, '[data-seller-fallback]': fallback })[sel] ?? null,
  };
  return { document, form, elements, errors, button, status, success, fallback, submit: () => listeners.submit({ preventDefault() { this.prevented = true; } }) };
}

const reply = (status, body) => ({ status, json: async () => body });
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i += 1) await tick(); };

function load(page, fetchImpl, api = API) {
  const calls = [];
  const fetch = (url, init) => { calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null }); return fetchImpl(url, init); };
  vm.runInNewContext(js.replace('__BLYNK_API__', api), { document: page.document, fetch });
  return calls;
}

const FILLED = { shop_name: ' Sunrise Spices ', owner_name: 'Kamal Perera', phone: '077 123 4567', town: 'Aluthgama', what_they_sell: 'Spices and dry fish' };

test('seller.js posts the right JSON to /seller-applications (optional fields only when filled), then shows the thanks', async () => {
  const page = makePage(FILLED);
  const calls = load(page, async () => reply(200, { success: true, data: { received: true } }));
  const done = page.submit();
  assert.equal(page.button.disabled, true, 'the button is off while sending');
  assert.equal(page.button.textContent, 'Sending…');
  await done; await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API}/seller-applications`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(calls[0].body, {
    shop_name: 'Sunrise Spices', owner_name: 'Kamal Perera', phone: '077 123 4567', town: 'Aluthgama', what_they_sell: 'Spices and dry fish',
  });
  assert.equal(page.form.hidden, true, 'the form goes away');
  assert.equal(page.success.hidden, false, 'the thanks shows');
  assert.equal(page.success.focused, true);
  assert.equal(page.fallback.hidden, true);
});

test('seller.js sends email and message when filled, and the honeypot only when something is in it', async () => {
  const page = makePage({ ...FILLED, email: ' kamal@example.com ', message: ' Call after 4 ', website: 'https://spam.example' });
  const calls = load(page, async () => reply(200, { success: true, data: { received: true } }));
  page.submit(); await settle();
  assert.deepEqual(calls[0].body, {
    shop_name: 'Sunrise Spices', owner_name: 'Kamal Perera', phone: '077 123 4567', town: 'Aluthgama', what_they_sell: 'Spices and dry fish',
    email: 'kamal@example.com', message: 'Call after 4', website: 'https://spam.example',
  });
});

test('seller.js: pressing Send twice sends one request (double-submit protection), and the button comes back after an error', async () => {
  const page = makePage(FILLED);
  let release;
  const calls = load(page, () => new Promise((r) => { release = () => r(reply(503, { success: false, error: { code: 'SELLER_APPLICATIONS_NOT_READY' } })); }));
  page.submit(); page.submit(); page.submit();
  await tick();
  assert.equal(calls.length, 1);
  release(); await settle();
  assert.equal(page.button.disabled, false);
  assert.equal(page.button.textContent, 'Send application');
  page.submit(); await tick();
  assert.equal(calls.length, 2, 'a second try is allowed after the first one finished');
});

test('seller.js shows the API\'s message for each field (400) and keeps the form', async () => {
  const page = makePage({ ...FILLED, phone: '011 234 5678' });
  load(page, async () => reply(400, {
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: [
        { path: ['phone'], message: 'Phone must be a Sri Lankan mobile number, e.g. 077 123 4567' },
        { path: ['town'], message: 'Town needs at least 2 characters.' },
        { path: [], message: 'Something about the whole form.' },
      ],
    },
  }));
  page.submit(); await settle();
  const line = (name) => page.errors.find((e) => e.attrs['data-error-for'] === name);
  assert.equal(line('phone').textContent, 'Phone must be a Sri Lankan mobile number, e.g. 077 123 4567');
  assert.equal(line('phone').hidden, false);
  assert.equal(page.elements.phone.attrs['aria-invalid'], 'true');
  assert.equal(line('town').textContent, 'Town needs at least 2 characters.');
  assert.equal(line('shop_name').hidden, true);
  assert.equal(page.status.textContent, 'Something about the whole form.');
  assert.equal(page.form.hidden, false);
  assert.equal(page.success.hidden, true);
  assert.equal(page.fallback.hidden, true);
  // the next try starts clean
  page.submit(); await settle();
  assert.equal(line('phone').hidden, false);
});

test('seller.js: rate limit (429), server not ready (503), a server error and no connection all offer the phone and WhatsApp links', async () => {
  const cases = [
    [async () => reply(429, { success: false, error: { code: 'TOO_MANY_REQUESTS' } }), /Too many applications from this device/],
    [async () => reply(503, { success: false, error: { code: 'SELLER_APPLICATIONS_NOT_READY' } }), /cannot take applications online right now/],
    [async () => reply(500, null), /cannot take applications online right now/],
    [async () => { throw new TypeError('Failed to fetch'); }, /could not send your application/],
  ];
  for (const [impl, words] of cases) {
    const page = makePage(FILLED);
    load(page, impl);
    page.submit(); await settle();
    assert.match(page.status.textContent, words);
    assert.equal(page.status.hidden, false);
    assert.equal(page.fallback.hidden, false, 'the call / WhatsApp links show');
    assert.equal(page.form.hidden, false);
    assert.equal(page.button.disabled, false);
  }
});

test('seller.js does nothing on a page without the form, and sends nothing when no API address was filled in', async () => {
  vm.runInNewContext(js.replace('__BLYNK_API__', API), { document: { querySelector: () => null }, fetch: () => { throw new Error('no fetch'); } });
  const page = makePage(FILLED);
  const calls = load(page, async () => reply(200, {}), '__BLYNK_API__');
  page.submit(); await settle();
  assert.equal(calls.length, 0);
  assert.equal(page.fallback.hidden, false);
  assert.match(page.status.textContent, /cannot take applications/);
});
