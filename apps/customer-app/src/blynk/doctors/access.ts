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

export const DOCTORS_SIGN_IN = {
  title: 'Sign in to see doctors',
  message: 'Use your phone number to log in or create an account.',
  action: 'Log in / Sign up',
  bookTitle: 'Sign in to book',
} as const;
