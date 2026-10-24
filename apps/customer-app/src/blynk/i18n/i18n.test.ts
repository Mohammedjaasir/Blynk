import { beforeEach, describe, expect, it } from 'vitest';
import { initialLang, langFromLocale, LANG_KEY, resetLangForTests, setLang, getLang, subscribeLang } from './lang';
import { localized, overlay, pick, registry } from './localized';
import { storage } from '@/blynk/lib/storage';

beforeEach(() => {
  resetLangForTests();
  storage.set(LANG_KEY, '');
});

describe('which language the app starts in', () => {
  it('maps a locale to ours, or to nothing', () => {
    expect(langFromLocale('si-LK')).toBe('si');
    expect(langFromLocale('ta_IN')).toBe('ta');
    expect(langFromLocale('EN-us')).toBe('en');
    expect(langFromLocale('de-DE')).toBeNull();
    expect(langFromLocale(null)).toBeNull();
  });

  it('prefers the saved choice, then a Sinhala / Tamil phone, else English', () => {
    expect(initialLang(() => 'ta', 'si-LK')).toBe('ta');
    expect(initialLang(() => null, 'si-LK')).toBe('si');
    expect(initialLang(() => null, 'ta')).toBe('ta');
    expect(initialLang(() => null, 'fr-FR')).toBe('en');
    expect(initialLang(() => 'klingon', 'en-US')).toBe('en');
  });

  it('setLang remembers the choice and tells listeners once; the same language is a no-op', () => {
    let calls = 0;
    const off = subscribeLang(() => { calls += 1; });
    expect(getLang()).toBe('en');
    setLang('si');
    setLang('si');
    expect(getLang()).toBe('si');
    expect(storage.get(LANG_KEY)).toBe('si');
    expect(calls).toBe(1);
    off();
    setLang('ta');
    expect(calls).toBe(1);
  });
});

describe('localized', () => {
  const T = localized(
    {
      title: 'Cart',
      count: (n: number) => `${n} item${n === 1 ? '' : 's'}`,
      nested: { hello: 'Hello', list: ['a', 'b'] },
    } as const,
    {
      si: { title: 'කරත්තය', count: (n: number) => `භාණ්ඩ ${n}`, nested: { hello: 'ආයුබෝවන්', list: ['අ', 'ආ'] } },
      ta: { title: 'வண்டி', count: (n: number) => `${n} பொருள்`, nested: { hello: 'வணக்கம்', list: ['அ', 'ஆ'] } },
    },
    'test.T',
  );

  it('reads the current language on every access', () => {
    expect(T.title).toBe('Cart');
    expect(T.count(1)).toBe('1 item');
    setLang('si');
    expect(T.title).toBe('කරත්තය');
    expect(T.count(3)).toBe('භාණ්ඩ 3');
    expect(T.nested.hello).toBe('ආයුබෝවන්');
    expect(T.nested.list).toEqual(['අ', 'ආ']);
    setLang('ta');
    expect(T.title).toBe('வண்டி');
    expect(T.count(2)).toBe('2 பொருள்');
    setLang('en');
    expect(T.nested.hello).toBe('Hello');
  });

  it('spreads and lists keys like the English object', () => {
    setLang('ta');
    expect(Object.keys(T)).toEqual(['title', 'count', 'nested']);
    expect({ ...T }.title).toBe('வண்டி');
    expect('title' in T).toBe(true);
    expect('nope' in T).toBe(false);
  });

  it('is in the registry for the completeness tests', () => {
    expect(registry.some((r) => r.name === 'test.T')).toBe(true);
  });

  it('pick chooses by language', () => {
    expect(pick('a', 'b', 'c')).toBe('a');
    setLang('si');
    expect(pick('a', 'b', 'c')).toBe('b');
    setLang('ta');
    expect(pick('a', 'b', 'c')).toBe('c');
  });
});

describe('overlay (the runtime safety net)', () => {
  it('keeps English for anything a translation lacks or gets the wrong kind of', () => {
    expect(overlay({ a: 'x', b: 'y', c: { d: 'z' } }, { a: 'A', c: {} })).toEqual({ a: 'A', b: 'y', c: { d: 'z' } });
    expect(overlay({ a: 'x' }, { a: 5 })).toEqual({ a: 'x' });
    expect(overlay(['a', 'b'], ['A'])).toEqual(['a', 'b']);
  });
});
