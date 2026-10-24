import { toE164 } from '@/blynk/auth/phone';
import { localized } from '@/blynk/i18n/localized';
import type { PlaceOrderBody } from '@/blynk/orders/types';

/*
 * "Delivery details" at checkout (owner, 2026-10-12; the Flutter shop's
 * checkout_recipient_section.dart and OrderProvider): "For someone else" with the
 * receiver's name and Sri Lankan mobile for THIS order only, and a note for the rider.
 * "For someone else" shows only while staff allow it (checkout-info
 * `order_for_someone_else.enabled`); the note always shows. No "Needs help at the door"
 * option any more (owner, 2026-10-16: "remove need help at door option").
 */

/** Flutter's limits (tighter than the server's 128 / 500). */
export const RECIPIENT_NAME_MIN = 2;
export const RECIPIENT_NAME_MAX = 80;
export const NOTE_MAX = 300;

export const DETAILS_COPY = localized(
  {
    title: 'Delivery details',
    forSomeoneElse: 'For someone else',
    forSomeoneElseSub: (codeToReceiver: boolean) => (codeToReceiver
      ? 'Send this order to family. They get the order texts and the delivery code; you get updates too.'
      : 'Send this order to family. They get the order texts; you get the delivery code and updates.'),
    nameLabel: "Receiver's name",
    phoneLabel: "Receiver's mobile",
    onlyThisOrder: 'Only for this order - your saved address stays the same.',
    noteLabel: 'Note for the rider (optional)',
    noteHint: 'Gate, floor, landmark',
    nameError: "Enter the receiver's name",
    phoneError: "Enter the receiver's Sri Lankan mobile number",
    noteError: 'Check the note for the rider',
  } as const,
  {
    si: {
      title: 'බෙදාහැරීමේ විස්තර',
      forSomeoneElse: 'වෙනත් කෙනෙකු සඳහා',
      forSomeoneElseSub: (codeToReceiver: boolean) => (codeToReceiver
        ? 'මෙම ඇණවුම පවුලේ කෙනෙකුට යවන්න. ඇණවුම් පණිවිඩ සහ බෙදාහැරීමේ කේතය ඔවුන්ට ලැබේ; ඔබටත් යාවත්කාලීන ලැබේ.'
        : 'මෙම ඇණවුම පවුලේ කෙනෙකුට යවන්න. ඇණවුම් පණිවිඩ ඔවුන්ට ලැබේ; බෙදාහැරීමේ කේතය සහ යාවත්කාලීන ඔබට ලැබේ.'),
      nameLabel: 'ලබන්නාගේ නම',
      phoneLabel: 'ලබන්නාගේ ජංගම අංකය',
      onlyThisOrder: 'මෙම ඇණවුමට පමණයි - ඔබගේ සුරකින ලද ලිපිනය වෙනස් නොවේ.',
      noteLabel: 'රයිඩර් සඳහා සටහන (අත්‍යවශ්‍ය නොවේ)',
      noteHint: 'ගේට්ටුව, මහල, ලකුණු කරගත හැකි ස්ථානය',
      nameError: 'ලබන්නාගේ නම ඇතුළත් කරන්න',
      phoneError: 'ලබන්නාගේ ශ්‍රී ලංකා ජංගම දුරකථන අංකය ඇතුළත් කරන්න',
      noteError: 'රයිඩර් සඳහා සටහන පරීක්ෂා කරන්න',
    },
    ta: {
      title: 'டெலிவரி விவரங்கள்',
      forSomeoneElse: 'வேறொருவருக்காக',
      forSomeoneElseSub: (codeToReceiver: boolean) => (codeToReceiver
        ? 'இந்த ஆர்டரை குடும்பத்தினருக்கு அனுப்புங்கள். ஆர்டர் செய்திகளும் டெலிவரி குறியீடும் அவர்களுக்கு வரும்; உங்களுக்கும் அப்டேட்கள் வரும்.'
        : 'இந்த ஆர்டரை குடும்பத்தினருக்கு அனுப்புங்கள். ஆர்டர் செய்திகள் அவர்களுக்கு வரும்; டெலிவரி குறியீடும் அப்டேட்களும் உங்களுக்கு வரும்.'),
      nameLabel: 'பெறுபவரின் பெயர்',
      phoneLabel: 'பெறுபவரின் மொபைல் எண்',
      onlyThisOrder: 'இந்த ஆர்டருக்கு மட்டும் - உங்கள் சேமித்த முகவரி மாறாது.',
      noteLabel: 'ரைடருக்கான குறிப்பு (விருப்பம்)',
      noteHint: 'கேட், மாடி, அடையாளம்',
      nameError: 'பெறுபவரின் பெயரை உள்ளிடுங்கள்',
      phoneError: 'பெறுபவரின் இலங்கை மொபைல் எண்ணை உள்ளிடுங்கள்',
      noteError: 'ரைடருக்கான குறிப்பைச் சரிபாருங்கள்',
    },
  },
  'checkout.DETAILS_COPY',
);

export interface CheckoutDetails {
  forSomeoneElse: boolean;
  recipientName: string;
  recipientPhone: string;
  /** Quick picks ("Leave at door", ...) that start the note. */
  noteChips: string[];
  note: string;
}

export const EMPTY_DETAILS: CheckoutDetails = {
  forSomeoneElse: false, recipientName: '', recipientPhone: '', noteChips: [], note: '',
};

/** Trims the ends and collapses runs of whitespace. */
export const normalizeText = (v: string | null | undefined) => (v ?? '').trim().replace(/\s+/g, ' ');

const NAME_CHARS = /^[\p{L} '\-.]+$/u;

export function recipientNameError(v: string): string | null {
  const t = normalizeText(v);
  return t.length < RECIPIENT_NAME_MIN || t.length > RECIPIENT_NAME_MAX || !NAME_CHARS.test(t) ? DETAILS_COPY.nameError : null;
}

export const recipientPhoneError = (v: string): string | null => (toE164(v) ? null : DETAILS_COPY.phoneError);

/** The note that goes to the rider: the quick picks, then the typed note. */
export function deliveryNote(d: Pick<CheckoutDetails, 'noteChips' | 'note'>): string {
  const typed = normalizeText(d.note);
  return [...d.noteChips, ...(typed ? [typed] : [])].join(', ');
}

export const noteError = (d: Pick<CheckoutDetails, 'noteChips' | 'note'>): string | null =>
  normalizeText(d.note).length > NOTE_MAX || deliveryNote(d).length > 500 ? DETAILS_COPY.noteError : null;

/**
 * What stops the order going, or null. `allowForSomeoneElse` false (staff switched it off)
 * ignores the receiver, as the Flutter shop does.
 */
export function detailsProblem(d: CheckoutDetails, allowForSomeoneElse: boolean): string | null {
  if (allowForSomeoneElse && d.forSomeoneElse) {
    if (recipientNameError(d.recipientName)) return DETAILS_COPY.nameError;
    if (recipientPhoneError(d.recipientPhone)) return DETAILS_COPY.phoneError;
  }
  return noteError(d);
}

/** The POST /orders fields for the receiver and the note. */
export function detailsBody(d: CheckoutDetails, allowForSomeoneElse: boolean):
  Pick<PlaceOrderBody, 'for_someone_else' | 'recipient' | 'delivery_note'> {
  const note = deliveryNote(d);
  return {
    ...(allowForSomeoneElse && d.forSomeoneElse
      ? { for_someone_else: true, recipient: { name: normalizeText(d.recipientName), phone: toE164(d.recipientPhone) ?? d.recipientPhone.trim() } }
      : {}),
    ...(note ? { delivery_note: note } : {}),
  };
}
