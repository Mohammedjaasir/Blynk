import type { Session, SessionEndReason } from '@/blynk/auth/session';
import { localized } from '@/blynk/i18n/localized';

/*
 * The one place that forgets a customer's data when their session ends - logout, the server
 * refusing the login, or account deletion - so the next person on the phone never sees it
 * (Flutter's AppSessionCleaner + PushSessionSync). The product catalogue is public and stays.
 * Each step runs even if an earlier one fails.
 */

/** What the customer is told afterwards (Flutter: kSessionEndedMessage, DeleteAccountSheet.doneMessage). */
export const SESSION_NOTICES = localized(
  {
    ended: "You've been logged out. Log in again to see your orders.",
    deleted: 'Your account has been deleted.',
  } as const,
  {
    si: {
      ended: 'ඔබව ඉවත් කර ඇත. ඔබේ ඇණවුම් බැලීමට නැවත ඇතුල් වන්න.',
      deleted: 'ඔබේ ගිණුම මකා දමා ඇත.',
    },
    ta: {
      ended: 'நீங்கள் வெளியேற்றப்பட்டுள்ளீர்கள். உங்கள் ஆர்டர்களைப் பார்க்க மீண்டும் உள்நுழையுங்கள்.',
      deleted: 'உங்கள் கணக்கு நீக்கப்பட்டுவிட்டது.',
    },
  },
  'account.SESSION_NOTICES',
);

export type CleanupSteps = {
  /** Close every live rider stream and drop its last point. */
  stopTracking: () => void;
  /** Empty the cart (Flutter's cart.clear()). */
  clearCart: () => void;
  /** Forget the chosen address, the guest spot (it may hold a name and phone) and the address book. */
  clearAddresses: () => void;
  /** Forget the pending checkout's idempotency key. */
  clearCheckout: () => void;
  /** Unregister this device for push with the access token the customer had. */
  pushSignedOut: (accessToken: string) => void;
  notify: (text: string) => void;
};

export function noticeFor(reason: SessionEndReason): string | null {
  if (reason === 'rejected') return SESSION_NOTICES.ended;
  if (reason === 'deleted') return SESSION_NOTICES.deleted;
  return null; // a logout the customer asked for needs no message
}

export function createSessionCleaner(steps: CleanupSteps) {
  return (ended: Session, reason: SessionEndReason) => {
    const run = (f: () => void) => { try { f(); } catch { /* the rest still runs */ } };
    run(steps.stopTracking);
    run(steps.clearCart);
    run(steps.clearAddresses);
    run(steps.clearCheckout);
    run(() => steps.pushSignedOut(ended.accessToken));
    const text = noticeFor(reason);
    if (text) run(() => steps.notify(text));
  };
}
