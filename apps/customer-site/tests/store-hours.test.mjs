// Store hours on the website follow Admin / Ops (owner, 2026-10-20: "make sure the timings can
// able controlled by the admins opening and closing timings").
// Run from the repo root:  node --test apps/customer-site/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const pages = [join(site, 'index.html'), ...walk(join(site, 'pages')).filter((f) => f.endsWith(`${sep}index.html`))];
// The written hours, in every language the pages use.
const WRITTEN = /8 AM|9 PM|පෙ\.ව\. 8|ප\.ව\. 9|காலை 8|இரவு 9|8–9/;

/** Visible text of a page with the parts store-hours.js rewrites taken out. */
function unmarkedText(html) {
  return html
    .replace(/<head>[\s\S]*?<\/head>/, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<([a-z]+)[^>]*data-hours="[^"]*"[^>]*>[^<]*<\/\1>/g, '')
    .replace(/<[^>]+>/g, ' ');
}

test('every hour the pages show is marked for store-hours.js, and the script is loaded', () => {
  for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    const left = unmarkedText(html).match(WRITTEN);
    assert.equal(left, null, `${file}: hours written without data-hours: "${left && left[0]}"`);
    if (/data-hours=/.test(html)) assert.match(html, /<script src="\/store-hours\.js\?v=\w+" defer><\/script>/, `${file}: store-hours.js not loaded`);
  }
});

test('the Dockerfile ships store-hours.js and fills in the API address', () => {
  const docker = readFileSync(join(site, 'Dockerfile'), 'utf8');
  assert.match(docker, /apps\/customer-site\/store-hours\.js/);
  assert.match(docker, /s#__BLYNK_API__#\$\{API_BASE_URL%\/\}#g/);
  const js = readFileSync(join(site, 'store-hours.js'), 'utf8');
  assert.equal(js.split('__BLYNK_API__').length - 1, 1, 'the placeholder appears once, in the code');
});
