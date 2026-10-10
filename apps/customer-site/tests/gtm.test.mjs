// Google Tag Manager on blynk.lk (owner, 2026-10-10).
// Run from the repo root:  node --test apps/customer-site/tests/gtm.test.mjs
// Needs `sh` (Linux, macOS, or Git Bash on Windows) for gtm-inject.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const landing = join(site, 'index.html');
const shop = join(site, '..', 'customer', 'blinkit-clone-Flutter-ecommerce-', 'web', 'index.html');
const script = join(site, 'gtm-inject.sh');

function copies() {
  const dir = mkdtempSync(join(tmpdir(), 'blynk-gtm-'));
  const a = join(dir, 'landing.html');
  const b = join(dir, 'shop.html');
  copyFileSync(landing, a);
  copyFileSync(shop, b);
  return [a, b];
}

function inject(env, files) {
  return spawnSync('sh', [script, ...files], {
    env: { ...process.env, GTM_ID: '', CONSENT_DEFAULT: '', ...env },
    encoding: 'utf8',
  });
}

// The head snippet, as the browser would run it.
function runHead(html, nav = {}) {
  const code = html.match(/GTM-HEAD-START -->\s*<script>([\s\S]*?)<\/script>/)[1];
  const appended = [];
  const listeners = {};
  const window = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const document = {
    createElement: () => ({}),
    head: { appendChild: (el) => appended.push(el) },
  };
  vm.runInNewContext(code, { window, document, navigator: { ...nav } });
  return { window, appended, listeners };
}

test('both pages carry the GTM placeholders and markers', () => {
  for (const file of [landing, shop]) {
    const html = readFileSync(file, 'utf8');
    for (const marker of ['GTM-HEAD-START', 'GTM-HEAD-END', 'GTM-BODY-START', 'GTM-BODY-END', '__GTM_ID__', '__CONSENT_DEFAULT__']) {
      assert.ok(html.includes(marker), `${file} lacks ${marker}`);
    }
  }
});

test('no GTM_ID: every trace of GTM is removed, the pages stay whole', () => {
  const files = copies();
  const r = inject({}, files);
  assert.equal(r.status, 0, r.stderr);
  for (const f of files) {
    const html = readFileSync(f, 'utf8');
    assert.ok(!html.includes('googletagmanager'), f);
    assert.ok(!html.includes('__GTM_ID__'), f);
    assert.ok(!html.includes('GTM-HEAD-START') && !html.includes('GTM-BODY-START'), f);
    assert.ok(!html.includes('dataLayer'), f);
    assert.match(html, /<\/head>/);
    assert.match(html, /<\/body>/);
  }
  assert.ok(readFileSync(files[0], 'utf8').includes('/analytics.js'), 'landing keeps its scripts');
  assert.ok(readFileSync(files[1], 'utf8').includes('flutter.js'), 'shop keeps its loader');
});

test('GTM_ID set: the container ID and the consent default are filled in', () => {
  const files = copies();
  const r = inject({ GTM_ID: ' GTM-ABC1234 ' }, files);
  assert.equal(r.status, 0, r.stderr);
  for (const f of files) {
    const html = readFileSync(f, 'utf8');
    assert.ok(html.includes("'GTM-ABC1234', 'granted'"), f);
    assert.ok(html.includes('ns.html?id=GTM-ABC1234'), f);
    assert.ok(!html.includes('__GTM_ID__') && !html.includes('__CONSENT_DEFAULT__'), f);
  }
});

test('CONSENT_DEFAULT=denied is filled in', () => {
  const files = copies();
  const r = inject({ GTM_ID: 'GTM-ABC1234', CONSENT_DEFAULT: 'denied' }, files);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(readFileSync(files[0], 'utf8').includes("'GTM-ABC1234', 'denied'"));
});

test('a malformed GTM_ID or CONSENT_DEFAULT fails the build and changes nothing', () => {
  for (const env of [{ GTM_ID: 'GTM-abc/../x' }, { GTM_ID: "GTM-1234'; alert(1)" }, { GTM_ID: 'UA-12345' },
    { GTM_ID: 'GTM-ABC1234', CONSENT_DEFAULT: 'yes' }]) {
    const files = copies();
    const before = readFileSync(files[0], 'utf8');
    const r = inject(env, files);
    assert.notEqual(r.status, 0, JSON.stringify(env));
    assert.equal(readFileSync(files[0], 'utf8'), before);
  }
});

test('filled-in snippet: consent defaults first, then GTM loads with the ID', () => {
  const files = copies();
  inject({ GTM_ID: 'GTM-ABC1234' }, files);
  const { window, appended } = runHead(readFileSync(files[0], 'utf8'));
  const layer = window.dataLayer;
  const consent = Array.from(layer[0]);
  assert.deepEqual(consent.slice(0, 2), ['consent', 'default']);
  assert.equal(consent[2].ad_storage, 'granted');
  assert.equal(consent[2].analytics_storage, 'granted');
  assert.equal(consent[2].ad_user_data, 'granted');
  assert.equal(consent[2].ad_personalization, 'granted');
  assert.equal(layer[1].site, 'landing');
  assert.equal(layer[2].event, 'gtm.js');
  assert.equal(appended[0].src, 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234');
});

test('a browser asking not to be tracked (GPC / Do Not Track) gets denied', () => {
  const files = copies();
  inject({ GTM_ID: 'GTM-ABC1234' }, files);
  for (const nav of [{ globalPrivacyControl: true }, { doNotTrack: '1' }]) {
    const { window } = runHead(readFileSync(files[0], 'utf8'), nav);
    assert.equal(Array.from(window.dataLayer[0])[2].ad_storage, 'denied');
  }
});

test('the shop snippet tags its pages and reports a Home Screen install', () => {
  const files = copies();
  inject({ GTM_ID: 'GTM-ABC1234' }, files);
  const { window, listeners } = runHead(readFileSync(files[1], 'utf8'));
  assert.equal(window.dataLayer[1].site, 'app');
  listeners.appinstalled();
  assert.equal(window.dataLayer.at(-1).event, 'pwa_installed');
});

test('unfilled placeholders (a local run) load nothing', () => {
  const { window, appended } = runHead(readFileSync(landing, 'utf8'));
  assert.equal(window.dataLayer, undefined);
  assert.equal(appended.length, 0);
});

// ---- analytics.js: the landing page events --------------------------------

class Element {
  constructor(matches = {}, attrs = {}) { this.matches = matches; this.attrs = attrs; }
  closest(selector) { return this.matches[selector] === true ? this : this.matches[selector] || null; }
  getAttribute(name) { return this.attrs[name] ?? null; }
}

function runAnalytics({ withLayer = true, ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' } = {}) {
  let click;
  const window = withLayer ? { dataLayer: [] } : {};
  const context = {
    window,
    Element,
    navigator: { userAgent: ua, platform: 'iPhone', maxTouchPoints: 5 },
    location: { pathname: '/', href: 'https://blynk.lk/?utm_source=fb' },
    document: { title: 'Blynk', addEventListener: (type, fn) => { if (type === 'click') click = fn; } },
  };
  vm.runInNewContext(readFileSync(join(site, 'analytics.js'), 'utf8'), context);
  return { layer: window.dataLayer, click: (target) => click({ target }), window };
}

test('landing: page_view on load', () => {
  const { layer } = runAnalytics();
  assert.equal(layer[0].event, 'page_view');
  assert.equal(layer[0].page_path, '/');
});

test('landing: get_blynk_click says which button, contact_click only the method', () => {
  const { layer, click } = runAnalytics();
  const section = new Element({});
  section.id = 'about';
  click(new Element({ '[data-install]': true, '.hero': new Element() }));
  click(new Element({ '[data-install]': true, '.nav': new Element() }));
  click(new Element({ '[data-install]': true, 'section[id]': section }));
  click(new Element({ 'a[href]': true, footer: new Element() }, { href: 'tel:+94717107374' }));
  click(new Element({ 'a[href]': true, footer: new Element() }, { href: 'https://wa.me/94717107374' }));
  click(new Element({ '[data-walk-open]': true }));
  click(new Element({ 'a[href]': true }, { href: '#how' }));
  const events = layer.slice(1);
  assert.deepEqual(events.map((e) => e.event),
    ['get_blynk_click', 'get_blynk_click', 'get_blynk_click', 'contact_click', 'contact_click', 'open_app_click']);
  assert.deepEqual(events.slice(0, 3).map((e) => e.button_location), ['hero', 'header', 'about']);
  assert.equal(events[0].platform, 'ios');
  assert.deepEqual(events.slice(3, 5).map((e) => [e.method, e.link_location]), [['call', 'footer'], ['whatsapp', 'footer']]);
  assert.ok(!JSON.stringify(events).includes('717107374'), 'the phone number is never sent');
});

test('landing: no dataLayer (built without GTM) pushes nothing and never throws', () => {
  const { click, window } = runAnalytics({ withLayer: false });
  click(new Element({ '[data-install]': true, '.hero': new Element() }));
  window.blynkTrack('install_guide_step', { step_number: 1 });
  assert.equal(window.dataLayer, undefined);
});

test('walkthrough.js reports each step through blynkTrack', () => {
  const code = readFileSync(join(site, 'walkthrough.js'), 'utf8');
  assert.match(code, /blynkTrack\('install_guide_step', \{ platform: kind, step_number: at \+ 1/);
});

test('the Dockerfile wires GTM_ID and CONSENT_DEFAULT to the inject script for both pages', () => {
  const docker = readFileSync(join(site, 'Dockerfile'), 'utf8');
  assert.match(docker, /ARG GTM_ID=/);
  assert.match(docker, /ARG CONSENT_DEFAULT=granted/);
  assert.match(docker, /\/usr\/share\/nginx\/html\/index\.html \/usr\/share\/nginx\/html\/app\/index\.html/);
  assert.match(docker, /apps\/customer-site\/analytics\.js/);
  // After the shop is copied in, so its index.html is the one processed.
  assert.ok(docker.indexOf('COPY --from=app') < docker.indexOf('gtm.sh'));
});
