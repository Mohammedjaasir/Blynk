import { expect, test } from 'vitest';
import { GATE_PARAMS, hasSkippedLogin, isFromGate, LOGIN_SKIPPED_KEY, rememberSkippedLogin, startRoute } from './gate';

const memory = () => {
  const m = new Map<string, string>();
  return { m, kv: { get: (k: string) => (m.has(k) ? (m.get(k) as string) : null), set: (k: string, v: string) => { m.set(k, v); } } };
};
const broken = { get: (): string | null => { throw new Error('blocked'); }, set: () => { throw new Error('blocked'); } };

test('uses the Flutter key and remembers the choice', () => {
  const { m, kv } = memory();
  expect(LOGIN_SKIPPED_KEY).toBe('blynk_login_skipped');
  expect(hasSkippedLogin(kv)).toBe(false);
  rememberSkippedLogin(kv);
  expect(m.get('blynk_login_skipped')).toBe('1');
  expect(hasSkippedLogin(kv)).toBe(true);
});

test('only "1" counts as skipped', () => {
  const { m, kv } = memory();
  for (const v of ['', '0', 'true', 'yes']) {
    m.set(LOGIN_SKIPPED_KEY, v);
    expect(hasSkippedLogin(kv)).toBe(false);
  }
});

test('unreadable storage counts as not skipped, and remembering never throws', () => {
  expect(hasSkippedLogin(broken)).toBe(false);
  expect(() => rememberSkippedLogin(broken)).not.toThrow();
});

test('signed in opens the shop without reading the skip flag', () => {
  let read = 0;
  const skipped = () => { read += 1; return false; };
  expect(startRoute({ demo: false, signedIn: true, skipped })).toBe('/home');
  expect(read).toBe(0);
});

test('a guest who skipped before opens the shop; a first-time guest sees the login', () => {
  expect(startRoute({ demo: false, signedIn: false, skipped: () => true })).toBe('/home');
  expect(startRoute({ demo: false, signedIn: false, skipped: () => false })).toBe('/login');
});

test('a guest with unreadable storage sees the login (as Flutter)', () => {
  expect(startRoute({ demo: false, signedIn: false, skipped: () => hasSkippedLogin(broken) })).toBe('/login');
});

test('the design mock always opens the shop', () => {
  expect(startRoute({ demo: true, signedIn: false, skipped: () => false })).toBe('/home');
});

test('the gate parameter', () => {
  expect(GATE_PARAMS).toEqual({ gate: '1' });
  expect(isFromGate('1')).toBe(true);
  expect(isFromGate(['1'])).toBe(true);
  for (const v of [undefined, null, '', '0', 1, ['0']]) expect(isFromGate(v)).toBe(false);
});
