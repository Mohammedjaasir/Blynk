// QR links on the website (owner, 2026-10-22): /q/<code> asks the API where a printed code leads.
// Run from the repo root:  node --test apps/customer-site/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(site, f), 'utf8');

test('the /q page is not indexed, loads q.js, and has a plain link to the shop', () => {
  const html = read('q.html');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<script src="\/q\.js\?v=\w+" defer><\/script>/);
  assert.match(html, /<a id="open" href="\/app\/">/);
});

test('nginx serves /q/<code> as that page, never cached, and the Dockerfile ships and fills it in', () => {
  const nginx = read('nginx.conf');
  assert.match(nginx, /location ~ "\^\/q\/\(\[A-Za-z0-9-\]\{1,24\}\)\/\?\$" \{[\s\S]*?try_files \/q\.html =404;/);
  const block = nginx.match(/location ~ "\^\/q\/[\s\S]*?\n    \}/)[0];
  assert.match(block, /Cache-Control "no-store"/);
  assert.match(block, /X-Robots-Tag "noindex, nofollow"/);
  const docker = read('Dockerfile');
  assert.match(docker, /apps\/customer-site\/q\.html apps\/customer-site\/q\.js/);
  assert.match(docker, /store-hours\.js \/usr\/share\/nginx\/html\/q\.js/);
  assert.match(docker, /! grep -q "__BLYNK_API__" \/usr\/share\/nginx\/html\/store-hours\.js \/usr\/share\/nginx\/html\/q\.js/);
});

test('q.js falls back to the shop, only follows https destinations, and keeps its placeholder once', () => {
  const js = read('q.js');
  assert.equal(js.split('__BLYNK_API__').length - 1, 1);
  assert.match(js, /const SHOP = '\/app\/'/);
  assert.ok(js.includes('/^https:\\/\\//.test(url)'), 'only an https destination is followed');
  assert.match(js, /setTimeout\(/);
});
