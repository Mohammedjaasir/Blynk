import { storage } from '@/blynk/lib/storage';

/*
 * The start gate, carried over from the Flutter shop's SessionGate and GuestChoiceStorage
 * (owner, 2026-10-05 and 2026-10-14). After the launch intro a customer who is signed in, or who
 * chose "Skip for now" before, opens on the shop; anyone else sees the phone-number login (with
 * its Skip). Only the app start at `/` goes through it: a link straight to a product, category,
 * order or tracking page opens that page. Pure logic, no navigation (tested in gate.test.ts).
 */

/** The same key the Flutter shop used for this choice. */
export const LOGIN_SKIPPED_KEY = 'blynk_login_skipped';

type KeyValue = { get(key: string): string | null; set(key: string, value: string): void };

/**
 * True when this device chose "Skip for now" before. Unreadable storage counts as "no", which
 * only means the login screen shows once more (as Flutter).
 */
export function hasSkippedLogin(kv: KeyValue = storage): boolean {
  try {
    return kv.get(LOGIN_SKIPPED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember "Skip for now": the next launch opens straight on the shop. Never throws. */
export function rememberSkippedLogin(kv: KeyValue = storage): void {
  try {
    kv.set(LOGIN_SKIPPED_KEY, '1');
  } catch { /* storage blocked: the login screen shows again next launch */ }
}

export type StartRoute = '/home' | '/login';

/**
 * Where the intro hands over to. Signed in, or a guest who skipped before: the shop. The design
 * mock (demo) always opens on the shop. `skipped` is only read when it matters.
 */
export function startRoute(o: { demo: boolean; signedIn: boolean; skipped: () => boolean }): StartRoute {
  if (o.demo || o.signedIn) return '/home';
  return o.skipped() ? '/home' : '/login';
}

/**
 * The login, OTP, registration and birthday screens carry `?gate=1` when the start gate opened
 * them: Skip is offered, and a finished sign-in goes on to the shop instead of back. A URL
 * parameter (not memory) so a reload keeps it.
 */
export const GATE_PARAMS = { gate: '1' } as const;

/** Whether a screen's `gate` search parameter says the start gate opened it. */
export const isFromGate = (gate: unknown): boolean => gate === '1' || (Array.isArray(gate) && gate[0] === '1');
