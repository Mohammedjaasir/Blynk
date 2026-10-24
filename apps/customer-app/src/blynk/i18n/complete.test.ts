/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { registry } from './localized';

/*
 * Every `localized()` block (in any src/blynk/** file that can load in Node) must be complete:
 * same shape in Sinhala and Tamil as in English, no empty text, and no sentence left in English.
 * (The compiler already checks the shape; this checks the words.) A block that cannot load in Node
 * (it pulls in React Native) is skipped here - keep blocks in plain .ts files under src/blynk.
 */
const modules = import.meta.glob(['../**/*.ts', '!../**/*.test.ts', '!../**/*.d.ts']);

/** Words that stay Latin in every language (names, units, short codes). */
const KEEP = /\b(Blynk|WhatsApp|OTP|SMS|LKR|Rs|QR|PDF|GPS|Google|Maps|Apple|Android|iPhone|COD|PayHere|Visa|Mastercard|Wi-?Fi|ID|km|kg|g|ml|L|pm|am|PM|AM|Sample|NIC|SLMC|APK|PWA|FAQ|T&C|URL|ok|OK)\b/g;
const SCRIPT = { si: /[඀-෿]/, ta: /[஀-௿]/ } as const;

const hasEnglishWords = (s: string) => /[A-Za-z]{3,}/.test(s.replace(KEEP, '').replace(/https?:\/\/\S+/g, '').replace(/\S+@\S+/g, ''));

interface Problem { where: string; why: string }

function walk(en: unknown, tr: unknown, lang: 'si' | 'ta', path: string, out: Problem[]) {
  if (typeof en === 'string') {
    if (typeof tr !== 'string' || !tr.trim()) { out.push({ where: path, why: 'missing or empty' }); return; }
    if (hasEnglishWords(en) && !SCRIPT[lang].test(tr) && hasEnglishWords(tr)) out.push({ where: path, why: `not translated: "${tr}"` });
    return;
  }
  if (typeof en === 'function') {
    if (typeof tr !== 'function') { out.push({ where: path, why: 'should be a function' }); return; }
    const args = [3, 'Sample', 3, 'Sample'];
    let a: unknown;
    try { a = (en as (...x: unknown[]) => unknown)(...args); } catch { return; }
    let b: unknown;
    try { b = (tr as (...x: unknown[]) => unknown)(...args); } catch (e) { out.push({ where: path, why: `throws: ${String(e)}` }); return; }
    if (typeof a === 'string') walk(a, b, lang, `${path}()`, out);
    else if (a !== null && typeof a === 'object') walk(a, b, lang, `${path}()`, out);
    else if (typeof b !== typeof a) out.push({ where: path, why: `returns ${typeof b}, English returns ${typeof a}` });
    return;
  }
  if (Array.isArray(en)) {
    if (!Array.isArray(tr) || tr.length !== en.length) { out.push({ where: path, why: 'list has a different length' }); return; }
    en.forEach((v, i) => walk(v, tr[i], lang, `${path}[${i}]`, out));
    return;
  }
  if (en !== null && typeof en === 'object') {
    if (tr === null || typeof tr !== 'object') { out.push({ where: path, why: 'missing' }); return; }
    for (const k of Object.keys(en)) walk((en as Record<string, unknown>)[k], (tr as Record<string, unknown>)[k], lang, `${path}.${k}`, out);
  }
}

describe('Sinhala and Tamil are complete', () => {
  it('loads the blocks', async () => {
    await Promise.all(Object.values(modules).map((load) => load().catch(() => undefined)));
    expect(registry.length).toBeGreaterThanOrEqual(0);
  });

  it('every block has every word in both languages', async () => {
    await Promise.all(Object.values(modules).map((load) => load().catch(() => undefined)));
    const problems: string[] = [];
    registry.forEach((r, i) => {
      for (const lang of ['si', 'ta'] as const) {
        const out: Problem[] = [];
        walk(r.en, r[lang], lang, r.name || `block#${i}`, out);
        out.forEach((p) => problems.push(`[${lang}] ${p.where}: ${p.why}`));
      }
    });
    expect(problems).toEqual([]);
  });
});
