import type { Session, SessionEndReason } from '@/blynk/auth/session';

/*
 * The one place that forgets a customer's data when their session ends - logout, the server
 * refusing the login, or account deletion - so the next person on the phone never sees it
 * (Flutter's AppSessionCleaner + PushSessionSync). The product catalogue is public and stays.
 * Each step runs even if an earlier one fails.
 */

/** What the customer is told afterwards (Flutter: kSessionEndedMessage, DeleteAccountSheet.doneMessage). */
export const SESSION_ENDED_MESSAGE = "You've been logged out. Log in again to see your orders.";
export const ACCOUNT_DELETED_MESSAGE = 'Your account has been deleted.';

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
  if (reason === 'rejected') return SESSION_ENDED_MESSAGE;
  if (reason === 'deleted') return ACCOUNT_DELETED_MESSAGE;
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
