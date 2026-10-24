import { getLang, type Lang } from './lang';

/*
 * One block of the app's words in three languages. `localized(en, { si, ta })` returns an object
 * that looks exactly like `en` (same keys, same functions) but reads from the CURRENT language on
 * every access, so a screen keeps writing `CART.title` or `ORDERS.count(3)` and gets Sinhala or
 * Tamil when the customer chose it. The root layout remounts the screens when the language changes,
 * so nothing else needs to listen.
 *
 *  - `si` / `ta` must have every key `en` has, in the same shape (the compiler checks: Widen<T>);
 *  - text with a number or name in it is a function in all three languages, same arguments;
 *  - do NOT read a block's words at module load (`const { title } = CART` at the top of a file):
 *    that freezes the language the app started in. Read them while rendering.
 */

/** `T` with string literals widened to string (so Sinhala text fits an `as const` English object). */
export type Widen<T> =
  T extends string ? string
  : T extends (...args: infer A) => infer R ? (...args: A) => Widen<R>
  : T extends readonly (infer U)[] ? readonly Widen<U>[]
  : T extends object ? { [K in keyof T]: Widen<T[K]> }
  : T;

export type Translations<T> = { si: Widen<T>; ta: Widen<T> };

type Dict = Record<PropertyKey, unknown>;

const isPlain = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `tr` laid over `en`: any leaf `tr` lacks (or has the wrong kind of) stays English. */
export function overlay(en: unknown, tr: unknown): unknown {
  if (isPlain(en)) {
    if (!isPlain(tr)) return en;
    const out: Dict = {};
    for (const k of Reflect.ownKeys(en)) out[k] = overlay(en[k], tr[k]);
    return out;
  }
  if (Array.isArray(en)) return Array.isArray(tr) && tr.length === en.length ? tr.map((v, i) => overlay(en[i], v)) : en;
  return typeof tr === typeof en && tr !== undefined && tr !== null ? tr : en;
}

/** Every block made, for the tests that check Sinhala and Tamil are complete. */
export const registry: { en: unknown; si: unknown; ta: unknown; name: string }[] = [];

export function localized<T extends object>(en: T, tr: Translations<T>, name = ''): T {
  const merged: Partial<Record<Lang, Dict>> = { en: en as Dict };
  registry.push({ en, si: tr.si, ta: tr.ta, name });
  const now = (): Dict => {
    const lang = getLang();
    return (merged[lang] ??= overlay(en, tr[lang as 'si' | 'ta']) as Dict);
  };
  return new Proxy(en, {
    get: (_t, p) => now()[p],
    has: (_t, p) => p in now(),
    ownKeys: () => Reflect.ownKeys(now()),
    getOwnPropertyDescriptor: (_t, p) => (p in now() ? { value: now()[p], enumerable: true, configurable: true, writable: true } : undefined),
  });
}

/** A single sentence in three languages, for the odd string that is not part of a block. */
export function pick(en: string, si: string, ta: string): string {
  const lang = getLang();
  return lang === 'si' ? si : lang === 'ta' ? ta : en;
}
