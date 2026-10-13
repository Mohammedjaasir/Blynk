import { accountErrorText } from './errors';

/*
 * The delete-account sheet's states (Flutter's DeleteAccountSheet): confirm -> deleting ->
 * done, or back to confirm with the server's reason (an open order) and the customer still
 * signed in. Taps while deleting are ignored.
 */
export type DeleteState =
  | { step: 'closed' }
  | { step: 'confirm'; error: string | null }
  | { step: 'deleting' }
  | { step: 'done' };

export type DeleteEvent =
  | { type: 'open' }
  | { type: 'cancel' }
  | { type: 'confirm' }
  | { type: 'failed'; error: unknown }
  | { type: 'deleted' };

export function deleteReducer(s: DeleteState, e: DeleteEvent): DeleteState {
  switch (e.type) {
    case 'open': return s.step === 'closed' ? { step: 'confirm', error: null } : s;
    case 'cancel': return s.step === 'confirm' ? { step: 'closed' } : s;
    case 'confirm': return s.step === 'confirm' ? { step: 'deleting' } : s;
    case 'failed': return s.step === 'deleting' ? { step: 'confirm', error: accountErrorText(e.error) } : s;
    case 'deleted': return s.step === 'deleting' ? { step: 'done' } : s;
  }
}

/** The sheet's words, exactly as the Flutter shop has them. */
export const DELETE_COPY = {
  title: 'Delete your account?',
  points: [
    'Your name, phone number, saved addresses and settings are removed, and you are logged out.',
    "Your past orders are kept for the store's records.",
    'Upcoming dental bookings are cancelled, and your name and phone number are removed from them.',
    "This can't be undone.",
  ],
  confirm: 'Delete account',
  cancel: 'Cancel',
  done: 'Your account has been deleted.',
} as const;

/** Run the delete with a dispatcher; resolves true once the account is gone. */
export async function runDelete(dispatch: (e: DeleteEvent) => void, del: () => Promise<void>): Promise<boolean> {
  dispatch({ type: 'confirm' });
  try {
    await del();
    dispatch({ type: 'deleted' });
    return true;
  } catch (error) {
    dispatch({ type: 'failed', error });
    return false;
  }
}
