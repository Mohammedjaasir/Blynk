import { localized } from '@/blynk/i18n/localized';
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
export const DELETE_COPY = localized(
  {
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
  } as const,
  {
    si: {
      title: 'ඔබේ ගිණුම මකා දමන්නද?',
      points: [
        'ඔබේ නම, දුරකථන අංකය, සුරකින ලද ලිපිනයන් සහ සැකසුම් ඉවත් කර ඔබව ඉවත් කරනු ලැබේ.',
        'ඔබේ පරණ ඇණවුම් සාප්පුවේ වාර්තා සඳහා තබාගනී.',
        'ඉදිරි දන්ත වෛද්‍ය වෙන්කිරීම් අවලංගු කර, ඒවායින් ඔබේ නම සහ දුරකථන අංකය ඉවත් කෙරේ.',
        'මෙය ආපසු හැරවිය නොහැක.',
      ],
      confirm: 'ගිණුම මකන්න',
      cancel: 'අවලංගු කරන්න',
      done: 'ඔබේ ගිණුම මකා දමා ඇත.',
    },
    ta: {
      title: 'உங்கள் கணக்கை நீக்கவா?',
      points: [
        'உங்கள் பெயர், தொலைபேசி எண், சேமித்த முகவரிகள் மற்றும் அமைப்புகள் நீக்கப்படும்; நீங்கள் வெளியேற்றப்படுவீர்கள்.',
        'உங்கள் பழைய ஆர்டர்கள் கடையின் பதிவுகளுக்காக வைத்துக்கொள்ளப்படும்.',
        'வரவிருக்கும் பல் மருத்துவ முன்பதிவுகள் ரத்து செய்யப்பட்டு, அவற்றிலிருந்து உங்கள் பெயரும் தொலைபேசி எண்ணும் நீக்கப்படும்.',
        'இதைத் திரும்பப் பெற முடியாது.',
      ],
      confirm: 'கணக்கை நீக்கு',
      cancel: 'ரத்து செய்',
      done: 'உங்கள் கணக்கு நீக்கப்பட்டுவிட்டது.',
    },
  },
  'account.DELETE_COPY',
);

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
