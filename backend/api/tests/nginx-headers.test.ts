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
 * its own, so every location that sets a header (cache rules, the APK
 * download) must repeat the three - this test reads each config and checks
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

  it('keeps the existing cache and download headers', () => {
    const customer = fs.readFileSync(CONFIGS[3]!, 'utf8');
    expect(customer).toMatch(/location \/app\/ \{[^}]*Cache-Control "no-cache"/);
    expect(customer).toMatch(/add_header Content-Disposition "attachment";/);
    const admin = fs.readFileSync(CONFIGS[0]!, 'utf8');
    expect(admin).toMatch(/add_header Cache-Control "public, immutable";/);
  });
});
