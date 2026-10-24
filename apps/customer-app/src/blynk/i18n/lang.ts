import { storage } from '@/blynk/lib/storage';

/*
 * The app's language (owner, 2026-10-25: Sinhala and Tamil). English is the source language; Sinhala
 * and Tamil are the two the shop's customers speak. The choice is remembered on the phone
 * (storage key below) and, with nothing chosen yet, follows the phone's own language when that is
 * Sinhala or Tamil. Pure apart from `storage`; the React side is useLang.ts.
 */
export type Lang = 'en' | 'si' | 'ta';

export const LANGS: readonly { code: Lang; /** The language's own name, always shown in its own script. */ name: string; /** English name for screen readers / logs. */ english: string }[] = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'si', name: 'සිංහල', english: 'Sinhala' },
  { code: 'ta', name: 'தமிழ்', english: 'Tamil' },
];

export const LANG_KEY = 'blynk.lang';

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'si' || v === 'ta';
}

/** 'si-LK' / 'ta_IN' / 'en-US' -> si / ta / null (not one of ours). */
export function langFromLocale(locale: string | null | undefined): Lang | null {
  const base = String(locale ?? '').toLowerCase().split(/[-_]/)[0];
  return base === 'si' ? 'si' : base === 'ta' ? 'ta' : base === 'en' ? 'en' : null;
}

function deviceLocale(): string | null {
  try {
    const nav = (globalThis as { navigator?: { language?: string } }).navigator;
    return nav?.language ?? null;
  } catch {
    return null;
  }
}

/** Chosen language, else the phone's when it is Sinhala or Tamil, else English. */
export function initialLang(read: (key: string) => string | null = storage.get, locale: string | null = deviceLocale()): Lang {
  const saved = read(LANG_KEY);
  if (isLang(saved)) return saved;
  const dev = langFromLocale(locale);
  return dev === 'si' || dev === 'ta' ? dev : 'en';
}

let current: Lang | null = null;
const listeners = new Set<() => void>();

export function getLang(): Lang {
  if (current === null) current = initialLang();
  return current;
}

/** Switch language: remembered, and every listener (the root layout remounts the screens) is told. */
export function setLang(lang: Lang): void {
  if (!isLang(lang) || lang === getLang()) return;
  current = lang;
  storage.set(LANG_KEY, lang);
  listeners.forEach((l) => l());
}

export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Tests only: forget the language so the next read starts again from storage / the phone. */
export function resetLangForTests(): void {
  current = null;
  listeners.clear();
}
