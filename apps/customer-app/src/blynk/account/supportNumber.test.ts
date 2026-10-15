import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { SUPPORT } from './support';
import { HELP_HERO } from '../ui/strings';

/*
 * Owner 2026-10-15: the support number is never shown ("just 'Call us' is enough"). It lives only
 * in support.ts for the tel: / wa.me links and the clipboard; no screen, notice or error may
 * print SUPPORT.phoneLabel or the number itself.
 */
const SRC = fileURLToPath(new URL('../../', import.meta.url));
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (statSync(p).isDirectory()) return files(p);
  return /\.(ts|tsx)$/.test(n) && !n.endsWith('.test.ts') ? [p] : [];
});
const rel = (f: string) => relative(SRC, f).split(sep).join('/');

test('no app code uses SUPPORT.phoneLabel', () => {
  // SUPPORT.phoneLabel, or phoneLabel taken out of SUPPORT (checkout's own "Receiver's mobile" label is another thing)
  const uses = /SUPPORT\s*\??\.\s*phoneLabel|SUPPORT\s*\[|\bphoneLabel\b[^;]*\}\s*=\s*SUPPORT/;
  const hits = files(SRC).filter((f) => uses.test(readFileSync(f, 'utf8'))).map(rel);
  expect(hits).toEqual([]);
}, 30_000);

test('the number is written nowhere but support.ts (links only)', () => {
  const digits = SUPPORT.phone.replace(/\D/g, '').slice(-7); // 7107374
  const spaced = SUPPORT.phoneLabel.slice(-8); // "710 7374"
  const hits = files(SRC).filter((f) => {
    const t = readFileSync(f, 'utf8');
    return t.includes(digits) || t.includes(spaced);
  }).map(rel);
  expect(hits).toEqual(['blynk/account/support.ts']);
}, 30_000);

test('the copied notice and the contact rows carry no number', () => {
  for (const s of [HELP_HERO.copied, HELP_HERO.call, HELP_HERO.whatsApp]) expect(s).not.toMatch(/\d{3}/);
  expect(HELP_HERO.copied).toBe('Number copied');
  expect(HELP_HERO.call).toBe('Call us');
});
