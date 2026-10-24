import { localized } from '@/blynk/i18n/localized';

/**
 * "Doctors need sign-in" (owner, 2026-10-10; GET /store `doctors_require_sign_in`). Unknown (the
 * store has not answered yet, or an older backend) means ON, like the Flutter shop and the server.
 * A guest then sees "Sign in to see doctors"; with it off, guests browse and sign in to book.
 */
export function doctorsGate(signedIn: boolean, store: { doctors_require_sign_in?: boolean } | null | undefined): 'open' | 'sign-in' {
  if (signedIn) return 'open';
  const required = typeof store?.doctors_require_sign_in === 'boolean' ? store.doctors_require_sign_in : true;
  return required ? 'sign-in' : 'open';
}

export const DOCTORS_SIGN_IN = localized(
  {
    title: 'Sign in to see doctors',
    message: 'Use your phone number to log in or create an account.',
    action: 'Log in / Sign up',
    bookTitle: 'Sign in to book',
  } as const,
  {
    si: {
      title: 'වෛද්‍යවරුන් බැලීමට ඇතුල් වන්න',
      message: 'ඇතුල් වීමට හෝ ගිණුමක් සෑදීමට ඔබේ දුරකථන අංකය භාවිත කරන්න.',
      action: 'ඇතුල් වන්න / ලියාපදිංචි වන්න',
      bookTitle: 'වේලාවක් වෙන් කිරීමට ඇතුල් වන්න',
    },
    ta: {
      title: 'டாக்டர்களைப் பார்க்க உள்நுழையுங்கள்',
      message: 'உள்நுழைய அல்லது கணக்கு உருவாக்க உங்கள் தொலைபேசி எண்ணைப் பயன்படுத்துங்கள்.',
      action: 'உள்நுழை / பதிவு செய்',
      bookTitle: 'முன்பதிவு செய்ய உள்நுழையுங்கள்',
    },
  },
  'doctors.DOCTORS_SIGN_IN',
);

/**
 * Doctor channelling shown to customers (owner, 2026-10-14; GET /store `doctors_enabled`).
 * false hides the section: the Home entry and the Profile rows. Before /store has answered the
 * entry stays hidden (no flash of a row that then disappears); an older backend without the
 * field means on.
 */
export function doctorsVisible(store: { doctors_enabled?: boolean } | null | undefined): boolean {
  return !!store && store.doctors_enabled !== false;
}

/**
 * "My appointments" in Profile: signed in while the section is shown; while it is hidden, only
 * for a customer who has appointments (they stay reachable: GET /dental/appointments still works).
 */
export function showMyAppointments(signedIn: boolean, visible: boolean, hasAppointments: boolean): boolean {
  return signedIn && (visible || hasAppointments);
}
