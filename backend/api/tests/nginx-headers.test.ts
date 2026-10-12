import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Security headers on the web nginx configs (security audit 2026-10):
 * X-Frame-Options DENY, X-Content-Type-Options nosniff and Referrer-Policy
 * strict-origin-when-cross-origin on every response.
 *
 * nginx's add_header is inherited only by a location with NO add_header of
 * its own, so every location that sets a header (cache rules) must repeat
 * the three - this test reads each config and checks
 * the server level and every such location. A full script-src CSP is a
 * follow-up (GTM, MapLibre and Firebase need a reviewed allow-list).
 */
const APPS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps');
const CONFIGS = ['admin', 'operations', 'inventory', 'customer-site'].map((app) => path.join(APPS, app, 'nginx.conf'));
const REQUIRED = [
  /add_header\s+X-Frame-Options\s+"?DENY"?\s+always;/,
  /add_header\s+X-Content-Type-Options\s+"?nosniff"?\s+always;/,
  /add_header\s+Referrer-Policy\s+"?strict-origin-when-cross-origin"?\s+always;/,
];

/** Top-level `location ... { ... }` blocks (bodies) and the server text outside them. */
function split(conf: string) {
  const server = conf.slice(conf.indexOf('{') + 1, conf.lastIndexOf('}'));
  const locations: { head: string; body: string }[] = [];
  let outside = '';
  let i = 0;
  while (i < server.length) {
    const at = server.indexOf('location', i);
    if (at === -1) {
      outside += server.slice(i);
      break;
    }
    // Only a directive at the start of a line counts (comments mention "location" too).
    const lineStart = server.lastIndexOf('\n', at) + 1;
    if (server.slice(lineStart, at).trim() !== '') {
      outside += server.slice(i, at + 8);
      i = at + 8;
      continue;
    }
    outside += server.slice(i, at);
    const open = server.indexOf('{', at);
    let depth = 1;
    let j = open + 1;
    while (depth > 0) {
      if (server[j] === '{') depth++;
      if (server[j] === '}') depth--;
      j++;
    }
    locations.push({ head: server.slice(at, open).trim(), body: server.slice(open + 1, j - 1) });
    i = j;
  }
  return { outside: outside.replace(/#.*$/gm, ''), locations };
}

describe('web nginx security headers', () => {
  for (const file of CONFIGS) {
    const name = path.basename(path.dirname(file));
    it(`${name}: the three headers at server level and in every location that sets its own headers`, () => {
      const conf = fs.readFileSync(file, 'utf8');
      const { outside, locations } = split(conf);
      for (const re of REQUIRED) expect(outside, `${name} server level`).toMatch(re);
      for (const loc of locations) {
        const body = loc.body.replace(/#.*$/gm, '');
        if (!/add_header/.test(body)) continue;
        for (const re of REQUIRED) expect(body, `${name} ${loc.head}`).toMatch(re);
      }
      // No full script CSP yet (follow-up): it could break GTM / MapLibre / Firebase.
      expect(conf).not.toMatch(/Content-Security-Policy[^\n]*script-src/);
    });
  }

  it('keeps the existing cache headers', () => {
    const customer = fs.readFileSync(CONFIGS[3]!, 'utf8');
    expect(customer).toMatch(/location \/app\/ \{[^}]*Cache-Control "no-cache"/);
    const admin = fs.readFileSync(CONFIGS[0]!, 'utf8');
    expect(admin).toMatch(/add_header Cache-Control "public, immutable";/);
  });

  // Staff downloads moved behind sign-in (owner, 2026-10-12): the landing
  // site no longer serves any APK or version manifest. /download/ is a plain
  // 404 (never the landing page), and nothing in the image or config points
  // at the old built-in files.
  it('customer-site: /download/ is closed (404) and no APK or manifest is served', () => {
    const customer = fs.readFileSync(CONFIGS[3]!, 'utf8');
    const { locations } = split(customer);
    const download = locations.find((l) => l.head === 'location ^~ /download/');
    expect(download, 'location ^~ /download/').toBeDefined();
    expect(download!.body.replace(/#.*$/gm, '').trim()).toBe('return 404;');
    const bare = locations.find((l) => l.head === 'location = /download');
    expect(bare?.body.replace(/#.*$/gm, '').trim()).toBe('return 404;');
    const live = customer.replace(/#.*$/gm, '');
    expect(live).not.toMatch(/\.apk/);
    expect(live).not.toMatch(/\/download\/\(/);
    expect(live).not.toMatch(/try_files[^;]*\/files\//);
    expect(live).not.toMatch(/location \/files\//);
    expect(live).not.toMatch(/application\/vnd\.android\.package-archive/);
    const dockerfile = fs.readFileSync(path.join(APPS, 'customer-site', 'Dockerfile'), 'utf8').replace(/#.*$/gm, '');
    expect(dockerfile).not.toMatch(/customer-site\/files/);
    expect(dockerfile).not.toMatch(/html\/download/);
    const leftovers = path.join(APPS, 'customer-site', 'files');
    expect(fs.existsSync(leftovers) ? fs.readdirSync(leftovers) : []).toEqual([]);
  });

  it('the API image carries the APKs (backend/api/app-files) and .dockerignore keeps them', () => {
    const api = path.resolve(APPS, '..', 'backend', 'api');
    const dockerfile = fs.readFileSync(path.join(api, 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/COPY --chown=node:node app-files\/ \.\/app-files\//);
    expect(dockerfile).toMatch(/ENV APP_FILES_DIR=\/app\/app-files/);
    const ignore = fs.readFileSync(path.join(api, '.dockerignore'), 'utf8').replace(/#.*$/gm, '');
    expect(ignore).not.toMatch(/app-files|\.apk|\*\.json/);
    for (const f of ['ops.apk', 'ops.json', 'rider.apk', 'rider.json']) {
      expect(fs.existsSync(path.join(api, 'app-files', f)), f).toBe(true);
    }
  });
});
